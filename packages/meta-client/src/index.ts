import { costUsd, isAllowedModel, type ModelId } from "./pricing.ts";
import { newUsageId, type UsageSink } from "./usage.ts";

export { MODELS, costUsd, isAllowedModel, type ModelId, type Usage } from "./pricing.ts";
export { fileSink, memorySink, type UsageLine, type UsageSink } from "./usage.ts";

export interface MetaClientOptions {
  apiKey: string;
  usage: UsageSink;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Request body for POST /v1/responses. `store` is not accepted from callers: it is always false. */
export interface ResponsesRequest {
  model: string;
  input: unknown;
  instructions?: string;
  tools?: unknown[];
  text?: { format?: unknown };
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high" | "xhigh" };
  max_output_tokens?: number;
  metadata?: Record<string, string>;
  [extra: string]: unknown;
}

export interface CallOptions {
  /** Who made the call, for the usage log (e.g. "agent/loop", "trust/scope"). */
  caller: string;
  /** For image models (SAM 3.1), how many images this call bills. */
  images?: number;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

export function createMetaClient(opts: MetaClientOptions) {
  const baseUrl = (opts.baseUrl ?? "https://api.meta.ai/v1").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 2;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!opts.apiKey) throw new Error("META_API_KEY is missing");

  async function responses(req: ResponsesRequest, call: CallOptions): Promise<any> {
    if (!isAllowedModel(req.model)) throw new Error(`model not allowed: ${req.model}`);
    const model: ModelId = req.model;
    const body = JSON.stringify({ ...req, store: false });
    const started = Date.now();
    let lastError = "";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/responses`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: ctrl.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        lastError = ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : String(err);
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        break;
      }
      clearTimeout(timer);

      if (res.ok) {
        const json: any = await res.json();
        const u = json?.usage ?? {};
        const usage = {
          inputTokens: num(u.input_tokens),
          cachedTokens: num(u.input_tokens_details?.cached_tokens),
          outputTokens: num(u.output_tokens),
          images: call.images ?? 0,
        };
        await opts.usage.write({
          id: newUsageId(),
          ts: new Date().toISOString(),
          caller: call.caller,
          model,
          input_tokens: usage.inputTokens,
          cached_tokens: usage.cachedTokens,
          output_tokens: usage.outputTokens,
          images: usage.images,
          latency_ms: Date.now() - started,
          cost_usd: costUsd(model, usage),
          ok: true,
        });
        return json;
      }

      const text = await res.text();
      lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        await sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoff(attempt));
        continue;
      }
      await logFailure(model, call, started, lastError);
      throw new MetaApiError(`Meta API request failed: ${lastError}`, res.status, text);
    }

    await logFailure(model, call, started, lastError);
    throw new MetaApiError(`Meta API request failed: ${lastError}`, 0, "");
  }

  async function logFailure(model: ModelId, call: CallOptions, started: number, error: string) {
    await opts.usage.write({
      id: newUsageId(),
      ts: new Date().toISOString(),
      caller: call.caller,
      model,
      input_tokens: 0,
      cached_tokens: 0,
      output_tokens: 0,
      images: 0,
      latency_ms: Date.now() - started,
      cost_usd: 0,
      ok: false,
      error,
    });
  }

  return { responses };
}

export type MetaClient = ReturnType<typeof createMetaClient>;

/** Concatenated output text of a Responses API result. */
export function outputText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output ?? [])
    .filter((o: any) => o?.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c?.type === "output_text")
    .map((c: any) => c.text)
    .join("");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const backoff = (attempt: number) => 500 * 2 ** attempt;

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(secs, 60) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(0, date - Date.now()), 60_000);
}
