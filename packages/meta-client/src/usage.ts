import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** One line per API call. The shape is stable: an external script may aggregate it. */
export interface UsageLine {
  id: string;
  ts: string;
  caller: string;
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  images: number;
  latency_ms: number;
  cost_usd: number;
  ok: boolean;
  error?: string;
}

export interface UsageSink {
  write(line: UsageLine): Promise<void>;
}

/** Appends JSON lines to a local file (git-ignored). */
export function fileSink(path: string): UsageSink {
  return { write: (line) => appendFile(path, JSON.stringify(line) + "\n", "utf8") };
}

/** Keeps lines in memory; used by tests and by the trust panel's per-trip cost. */
export function memorySink(): UsageSink & { lines: UsageLine[] } {
  const lines: UsageLine[] = [];
  return { lines, write: async (line) => void lines.push(line) };
}

export const newUsageId = () => randomUUID();
