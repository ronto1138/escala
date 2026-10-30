import { costUsd, isAllowedModel, type ModelId } from "./pricing.ts";
import { newUsageId, type UsageSink } from "./usage.ts";

export { MODELS, costUsd, isAllowedModel, type ModelId, type Usage } from "./pricing.ts";
export { fileSink, memorySink, type UsageLine, type UsageSink } from "./usage.ts";
export { createOpenModelClient, OPEN_MODEL, OPEN_PRICE, type JsonRequest, type OpenModelClient, type OpenModelOptions } from "./open.ts";
export { responsesViaOpen } from "./failsafe.ts";

export interface MetaClientOptions {
  apiKey: string;
  usage: UsageSink;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * When a model answers "model_not_found" (Meta stopped serving muse-spark-1.3 for a while on 2026-10-27), the call is
   * retried once with this Standard model, and the original is skipped for ten minutes. Contributor models never appear.
   */
  fallbacks?: Partial<Record<ModelId, ModelId>>;
  /**
   * The last resort when the Meta Model API does not answer at all (outage, network, rate limit, key): serve the same
   * request with another Meta model elsewhere (Muse Spark Open on Baseten, `responsesViaOpen`). Never for a bad request
   * (400), which is ours to fix, and never for SAM 3.1, which has no substitute.
   */
  failsafe?: (req: ResponsesRequest, call: CallOptions) => Promise<any>;
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
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.body = body;
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

  const fallbacks: Partial<Record<ModelId, ModelId>> = opts.fallbacks ?? { "muse-spark-1.3": "muse-spark-1.2" };
  const unavailableUntil = new Map<string, number>();

  let metaDownUntil = 0;

  async function responses(req: ResponsesRequest, call: CallOptions): Promise<any> {
    const canFailsafe = !!opts.failsafe && req.model !== "sam-3.1";
    if (canFailsafe && Date.now() < metaDownUntil) return opts.failsafe!(req, call);
    try {
      return await viaMeta(req, call);
    } catch (err) {
      if (!canFailsafe || !metaUnavailable(err)) throw err;
      // Do not wait on Meta for every message while it is down, but come back soon: its outages so far lasted a minute
      // or two, and the open model on Baseten reads messages less well (Ives' recording, 30-oct).
      metaDownUntil = Date.now() + 45_000;
      return opts.failsafe!(req, call);
    }
  }

  async function viaMeta(req: ResponsesRequest, call: CallOptions): Promise<any> {
    const alt = isAllowedModel(req.model) ? fallbacks[req.model] : undefined;
    if (alt && (unavailableUntil.get(req.model) ?? 0) > Date.now()) return once({ ...req, model: alt }, { ...call, caller: `${call.caller}+fallback` });
    try {
      return await once(req, call);
    } catch (err) {
      if (!alt || !(err instanceof MetaApiError) || err.status !== 404 || !/model_not_found/.test(err.body)) throw err;
      unavailableUntil.set(req.model, Date.now() + 60_000);
      return once({ ...req, model: alt }, { ...call, caller: `${call.caller}+fallback` });
    }
  }

  async function once(req: ResponsesRequest, call: CallOptions): Promise<any> {
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
          webSearches: Array.isArray(json?.output) ? json.output.filter((o: any) => o?.type === "web_search_call").length : 0,
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
          ...(usage.webSearches ? { web_searches: usage.webSearches } : {}),
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

  /**
   * Speech to text with Muse Voice Transcribe. Takes mono 16-bit WAV (16 or 24 kHz). `keywords` bias recognition
   * toward words the person is likely to say (the trip's cities and flight numbers), which fixes most misheard names.
   */
  async function transcribe(wav: Uint8Array, o: { keywords?: string[] }, call: CallOptions): Promise<{ text: string; seconds: number }> {
    const model = "muse-voice-transcribe-1.0" as const;
    const started = Date.now();
    let lastError = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const form = new FormData();
      const request = { model, audioEncoding: "WAV", ...(o.keywords?.length ? { keywords: o.keywords.slice(0, 50) } : {}) };
      form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
      const bytes = new Uint8Array(wav.length); // a copy backed by a plain ArrayBuffer, as Blob requires
      bytes.set(wav);
      form.append("audio", new Blob([bytes], { type: "audio/wav" }), "note.wav");
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/asr/transcribe`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = String(err);
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        break;
      }
      if (res.ok) {
        const json: any = await res.json();
        const seconds = Math.ceil(num(json?.audioDurationMs) / 1000);
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
          cost_usd: costUsd(model, { inputTokens: 0, cachedTokens: 0, outputTokens: 0, images: 0, audioSeconds: seconds }),
          ok: true,
        });
        return { text: String(json?.transcript ?? "").trim(), seconds };
      }
      const text = await res.text();
      lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        await sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoff(attempt));
        continue;
      }
      break;
    }
    await logFailure(model, call, started, lastError);
    throw new MetaApiError(`Meta API request failed: ${lastError}`, 0, "");
  }

  return { responses, transcribe };
}

export type MetaClient = ReturnType<typeof createMetaClient>;

/** Meta did not serve the request for reasons that are not ours: down, unreachable, throttled, key refused, model gone. */
function metaUnavailable(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  return err.status === 0 || err.status === 401 || err.status === 403 || err.status === 404 || err.status === 408 || err.status === 429 || err.status >= 500;
}

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
