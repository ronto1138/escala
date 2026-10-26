import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { toWav, tripKeywords } from "../src/audio.ts";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("voice notes", () => {
  it.skipIf(!hasFfmpeg)("turns an OGG/Opus note into mono 24 kHz 16-bit WAV, in memory", async () => {
    const ogg = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", "-f", "ogg", "pipe:1"]);
    const wav = await toWav(ogg);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44); // real data size, not "unknown"
    expect(wav.length - 44).toBeGreaterThan(24000 * 2 * 0.9); // about one second of audio
  });

  it.skipIf(!hasFfmpeg)("reads M4A too, which cannot be streamed from a pipe", async () => {
    const m4a = execFileSync("sh", ["-c", "f=$(mktemp --suffix=.m4a) && ffmpeg -hide_banner -loglevel error -y -f lavfi -i sine=frequency=300:duration=1 -c:a aac \"$f\" && cat \"$f\" && rm -f \"$f\""]);
    const wav = await toWav(m4a);
    expect(wav.length - 44).toBeGreaterThan(24000 * 2 * 0.9);
  });

  it.skipIf(!hasFfmpeg)("rejects something that is not audio", async () => {
    await expect(toWav(Buffer.from("not audio at all"))).rejects.toThrow(/conversion failed|no audio/);
  });

  it("hints the trip's cities and flight numbers", () => {
    const trip = { legs: [{ flight: "ZZ1234", from: "AUS", to: "ORD" }, { flight: "ZZ567", from: "ORD", to: "YUL" }] };
    const city: Record<string, string> = { AUS: "Austin", ORD: "Chicago O'Hare", YUL: "Montreal" };
    expect(tripKeywords(trip, (c) => city[c])).toEqual(["ZZ1234", "ZZ 1234", "Austin", "Chicago O'Hare", "ZZ567", "ZZ 567", "Montreal"]);
    expect(tripKeywords(undefined, () => undefined)).toEqual([]);
  });
});
