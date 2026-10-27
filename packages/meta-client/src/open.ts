import { newUsageId, type UsageSink } from "./usage.ts";

/**
 * Meta's open-weight model Muse Spark Open, served by a partner (Baseten) through an OpenAI-compatible endpoint.
 * Synchronous calls only: Baseten keeps no copy of inputs or outputs for synchronous Model API requests (zero data
 * retention). Usage lines carry provider "baseten" and the cost computed from Baseten's published prices.
 */
export const OPEN_MODEL = "meta-models/muse-spark-open-1026";
/** USD per 1M tokens (Baseten's model page, 2026-10-26). */
export const OPEN_PRICE = { input: 1.25, cached: 0.15, output: 4.25 };

export interface OpenModelOptions {
  apiKey: string;
  usage: UsageSink;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface JsonRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export function createOpenModelClient(opts: OpenModelOptions) {
  if (!opts.apiKey) throw new Error("BASETEN_API_KEY is missing");
  const baseUrl = (opts.baseUrl ?? "https://inference.baseten.co/v1").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;

  /** One structured-output call; returns the parsed JSON. */
  async function json<T = unknown>(req: JsonRequest, call: { caller: string }): Promise<T> {
    const started = Date.now();
    const body = {
      model: OPEN_MODEL,
      max_tokens: req.maxTokens ?? 3000,
      reasoning_effort: req.effort ?? "low",
      messages: [
        { role: "system", content: req.instructions },
        { role: "user", content: req.input },
      ],
      response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
    };
    let res: Response | undefined;
    let text = "";
    let error = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
        text = await res.text();
        if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) break;
        error = `HTTP ${res.status}`;
      } catch (err) {
        error = String(err).slice(0, 200);
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    let j: any = {};
    try {
      j = JSON.parse(text);
    } catch {
      j = {};
    }
    const u = j.usage ?? {};
    const cached = Number(u.prompt_tokens_details?.cached_tokens ?? 0);
    const input = Number(u.prompt_tokens ?? 0);
    const output = Number(u.completion_tokens ?? 0);
    const cost = (Math.max(0, input - cached) * OPEN_PRICE.input + cached * OPEN_PRICE.cached + output * OPEN_PRICE.output) / 1e6;
    const ok = !!res?.ok;
    await opts.usage.write({
      id: newUsageId(),
      ts: new Date().toISOString(),
      caller: call.caller,
      model: OPEN_MODEL,
      input_tokens: input,
      cached_tokens: cached,
      output_tokens: output,
      images: 0,
      latency_ms: Date.now() - started,
      cost_usd: Math.round(cost * 1e6) / 1e6,
      ok,
      provider: "baseten",
      ...(ok ? {} : { error: (error || `HTTP ${res?.status}`) + (text ? `: ${text.slice(0, 160)}` : "") }),
    });
    if (!ok) throw new Error(`Muse Spark Open request failed: ${error || `HTTP ${res?.status}`}`);
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Muse Spark Open returned no content");
    return JSON.parse(content) as T;
  }

  return { json };
}

export type OpenModelClient = ReturnType<typeof createOpenModelClient>;
