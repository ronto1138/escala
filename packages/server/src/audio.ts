import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Voice notes longer than this are cut: it caps the cost and the wait. */
export const MAX_VOICE_SECONDS = 180;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const RATE = 24_000;
/** Less than this much audio is treated as nothing said. */
const MIN_PCM_BYTES = Math.round(RATE * 2 * 0.3);

/**
 * Converts a voice note (WhatsApp's OGG/Opus, or any format ffmpeg reads: M4A, MP3…) to what Muse Voice Transcribe
 * accepts: mono, 16-bit PCM WAV at 24 kHz. The input goes to a private temporary file, because some containers
 * (M4A) cannot be read from a pipe; the file is deleted as soon as ffmpeg finishes, whatever happens. ffmpeg returns
 * raw PCM and the WAV header is written here, with the real sizes.
 */
export async function toWav(input: Uint8Array): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) throw new Error("voice note is larger than 16 MB");
  const dir = await mkdtemp(join(tmpdir(), "escala-voice-"));
  const src = join(dir, "in");
  try {
    await writeFile(src, input, { mode: 0o600 });
    const pcm = await run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "1", "-i", src, "-vn", "-t", String(MAX_VOICE_SECONDS),
      "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-acodec", "pcm_s16le", "-map_metadata", "-1", "pipe:1"]);
    if (pcm.length < MIN_PCM_BYTES) throw new Error("voice note has no audio");
    return Buffer.concat([wavHeader(pcm.length), pcm]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let size = 0;
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("audio conversion timed out"));
    }, TIMEOUT_MS);
    p.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= RATE * 2 * (MAX_VOICE_SECONDS + 1)) out.push(c);
    });
    p.stderr.on("data", (c: Buffer) => {
      err = (err + c.toString()).slice(-2000);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg is not available: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      // ffmpeg's messages can echo metadata from the file (titles, tags): they never leave this function.
      else reject(new Error(`audio conversion failed (exit ${code})`));
    });
  });
}

/** A 44-byte WAV header for mono 16-bit PCM at 24 kHz. */
function wavHeader(dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** The words a traveler is likely to say about this trip, to bias recognition: cities and flight numbers. */
export function tripKeywords(trip: unknown, cityOf: (iata: string) => string | undefined): string[] {
  const legs = (trip as { legs?: Array<{ flight: string; from: string; to: string }> } | undefined)?.legs ?? [];
  const words = new Set<string>();
  for (const l of legs) {
    words.add(l.flight);
    words.add(l.flight.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2"));
    for (const code of [l.from, l.to]) {
      const city = cityOf(code);
      if (city) words.add(city);
    }
  }
  return [...words].slice(0, 50);
}
