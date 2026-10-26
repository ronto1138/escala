import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConsentError, MemoryCrypto, MemoryStore, tripRetention } from "../src/index.ts";

const sam = "15550001111";
const LATER = "2099-01-01T00:00:00Z";
const source = { kind: "message" as const, ref: "wamid.1", at: "2026-11-02T12:00:00Z", quote: "I always check a bag" };

function store(now = new Date("2026-11-02T12:00:00Z"), key = randomBytes(32)) {
  const dir = mkdtempSync(join(tmpdir(), "escala-mem-"));
  const path = join(dir, "memory.db");
  return { s: new MemoryStore({ path, crypto: new MemoryCrypto(key), now: () => now }), path, key };
}

describe("memory with provenance", () => {
  it("keeps where each fact came from and returns it for 'what do you know about me?'", () => {
    const { s } = store();
    s.remember(sam, { scope: "trip", topic: "bag.checked", statement: "Checks one bag", source, expiresAt: LATER });
    const [f] = s.recall(sam);
    expect(f).toMatchObject({ topic: "bag.checked", source: { kind: "message", ref: "wamid.1", quote: "I always check a bag" } });
  });

  it("refuses a trip fact without an expiry date", () => {
    const { s } = store();
    expect(() => s.remember(sam, { scope: "trip", topic: "x", statement: "y", source })).toThrow(/expiry/);
  });

  it("refuses a fact without a source", () => {
    const { s } = store();
    expect(() => s.remember(sam, { scope: "trip", topic: "x", statement: "y", source: { kind: "derived", ref: "", at: "" } })).toThrow(/source/);
  });
});

describe("consent", () => {
  it("does not store profile memory until the person turns it on, and erases it when turned off", () => {
    const { s } = store();
    const learned = { scope: "profile" as const, topic: "connection.missed", statement: "Missed a 50-minute connection", source };
    expect(() => s.remember(sam, learned)).toThrow(ConsentError);

    s.updateSettings(sam, { share: "profile" });
    s.remember(sam, learned);
    expect(s.recall(sam, { scope: "profile" })).toHaveLength(1);

    s.updateSettings(sam, { share: "trip" });
    expect(s.recall(sam, { scope: "profile" })).toHaveLength(0);
    expect(s.settings(sam).features.recommendations).toBe(false);
  });

  it("defaults to the most private settings", () => {
    const { s } = store();
    expect(s.settings("new-person")).toMatchObject({ share: "trip", features: { recommendations: false } });
  });
});

describe("forgetting and retention", () => {
  it("forgets one fact, a topic, or everything", () => {
    const { s } = store();
    const a = s.remember(sam, { scope: "trip", topic: "bag.checked", statement: "Checks one bag", source, expiresAt: LATER });
    s.remember(sam, { scope: "trip", topic: "companion", statement: "Tells Diego about delays", source, expiresAt: LATER });
    s.remember(sam, { scope: "trip", topic: "companion", statement: "Tells Élise about delays", source, expiresAt: LATER });
    expect(s.forget(sam, { factId: a.id })).toBe(1);
    expect(s.forget(sam, { topic: "companion" })).toBe(2);
    s.remember(sam, { scope: "trip", topic: "x", statement: "y", source, expiresAt: LATER });
    expect(s.forget(sam, "all")).toBe(1);
    expect(s.recall(sam)).toEqual([]);
  });

  it("trip facts expire after the trip plus the claim deadline", () => {
    let now = new Date("2026-11-02T12:00:00Z");
    const key = randomBytes(32);
    const dir = mkdtempSync(join(tmpdir(), "escala-mem-"));
    const s = new MemoryStore({ path: join(dir, "m.db"), crypto: new MemoryCrypto(key), now: () => now });
    s.remember(sam, { scope: "trip", topic: "evidence.bag", statement: "Photo of the bag before check-in", source, expiresAt: tripRetention("2026-11-06T00:00:00Z", 7) });
    now = new Date("2026-11-12T00:00:00Z");
    expect(s.recall(sam)).toHaveLength(1);
    now = new Date("2026-11-14T00:00:00Z");
    expect(s.recall(sam)).toHaveLength(0);
    expect(s.purgeExpired()).toBe(1);
  });
});

describe("encryption at rest", () => {
  it("stores no statement, quote or phone number in the clear", () => {
    const { s, path } = store();
    s.remember(sam, { scope: "trip", topic: "bag.checked", statement: "Checks one green suitcase", source, expiresAt: LATER });
    s.close();
    const raw = readFileSync(path).toString("latin1");
    expect(raw).not.toContain("green suitcase");
    expect(raw).not.toContain("I always check a bag");
    expect(raw).not.toContain(sam);
  });

  it("a different master key cannot read the memory", () => {
    const { s, path } = store();
    s.remember(sam, { scope: "trip", topic: "bag.checked", statement: "Checks one bag", source, expiresAt: LATER });
    s.close();
    const other = new MemoryStore({ path, crypto: new MemoryCrypto(randomBytes(32)) });
    expect(other.recall(sam)).toEqual([]); // a different key derives a different person ref
  });

  it("rejects a master key of the wrong size", () => {
    expect(() => new MemoryCrypto(randomBytes(16))).toThrow(/32 bytes/);
  });
});
