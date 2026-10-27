// Published Meta Model API prices, USD. Source: https://dev.meta.ai/products/meta-model-api/ (checked 2026-10-14).
// Contributor variants are deliberately absent: this project only uses Standard mode.

export interface TokenPrice {
  kind: "tokens";
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}

export interface ImagePrice {
  kind: "images";
  perImage: number;
}

export interface AudioPrice {
  kind: "audio";
  perHour: number;
}

export const MODELS = {
  "muse-spark-1.3": { kind: "tokens", inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 },
  "muse-spark-1.2": { kind: "tokens", inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 },
  "muse-wonder-1.0": { kind: "tokens", inputPerM: 4.0, cachedInputPerM: 0.2, outputPerM: 20.0 },
  "sam-3.1": { kind: "images", perImage: 2.5 / 1000 },
  "muse-voice-transcribe-1.0": { kind: "audio", perHour: 0.18 },
} as const satisfies Record<string, TokenPrice | ImagePrice | AudioPrice>;

export type ModelId = keyof typeof MODELS;

export function isAllowedModel(model: string): model is ModelId {
  return Object.hasOwn(MODELS, model);
}

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  images: number;
  /** Seconds of audio, for speech-to-text. */
  audioSeconds?: number;
  /** Built-in web searches the model ran in this response. */
  webSearches?: number;
}

/** Built-in web search: US$2.50 per 1,000 searches (https://dev.meta.ai/docs pricing). */
export const WEB_SEARCH_PER_CALL = 2.5 / 1000;

/** Cost in USD. Cached tokens are billed at the cached rate and are not billed again as regular input. */
export function costUsd(model: ModelId, u: Usage): number {
  const p = MODELS[model];
  if (p.kind === "images") return round6(u.images * p.perImage);
  if (p.kind === "audio") return round6(((u.audioSeconds ?? 0) / 3600) * p.perHour);
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  return round6((fresh * p.inputPerM + u.cachedTokens * p.cachedInputPerM + u.outputTokens * p.outputPerM) / 1e6 + (u.webSearches ?? 0) * WEB_SEARCH_PER_CALL);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
