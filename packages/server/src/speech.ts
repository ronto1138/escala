import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

type Lang = "en" | "es" | "fr";

const TIMEOUT_MS = 45_000;
const MAX_WAV_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 600;
const CACHE_SIZE = 200;
const SCRIPT = fileURLToPath(new URL("../../../services/tts/speak.py", import.meta.url));

export interface SpeechOptions {
  /** The Python that has kokoro-onnx installed. */
  python?: string;
  /** Folder with kokoro-v1.0.int8.onnx and voices-v1.0.bin. */
  models?: string;
  log?(event: Record<string, unknown>): void;
}

/**
 * Reads a card aloud as a WhatsApp voice note (OGG/Opus), on this server: the text never leaves it. One synthesis at a
 * time, so a burst of cards cannot exhaust memory; results are kept in memory only (they hold an address), by text.
 */
export function createSpeech(opts: SpeechOptions = {}) {
  const cache = new Map<string, Uint8Array>();
  let queue: Promise<unknown> = Promise.resolve();

  async function synthesize(text: string, lang: Lang): Promise<Uint8Array> {
    const wav = await run(opts.python ?? "python3", [SCRIPT], JSON.stringify({ lang, text }), { ...process.env, ...(opts.models ? { TTS_MODELS: opts.models } : {}) });
    // Mono Opus at a voice bitrate, the format WhatsApp plays as a voice note.
    return run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "1", "-f", "wav", "-i", "pipe:0", "-ac", "1", "-c:a", "libopus", "-b:a", "24k", "-map_metadata", "-1", "-f", "ogg", "pipe:1"], wav);
  }

  return async function speak(text: string, lang: Lang): Promise<Uint8Array | null> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
    if (!clean) return null;
    const key = createHash("sha256").update(`${lang}|${clean}`).digest("hex");
    const hit = cache.get(key);
    if (hit) return hit;
    const job = queue.then(() => synthesize(clean, lang));
    queue = job.catch(() => undefined);
    try {
      const ogg = await job;
      cache.set(key, ogg);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
      return ogg;
    } catch (err) {
      // Never the text: it holds the traveler's address.
      opts.log?.({ event: "speech_failed", lang, error: String(err).slice(0, 160) });
      return null;
    }
  };
}

function run(cmd: string, args: string[], input: string | Uint8Array, env?: NodeJS.ProcessEnv): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], ...(env ? { env } : {}) });
    const out: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, TIMEOUT_MS);
    p.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_WAV_BYTES) out.push(c);
    });
    p.stderr.on("data", () => undefined); // may echo the text: never kept
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} is not available: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && size > 0 && size <= MAX_WAV_BYTES) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited with ${code}`));
    });
    p.stdin.on("error", () => undefined);
    p.stdin.end(input);
  });
}
