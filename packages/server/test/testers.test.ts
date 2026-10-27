import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalNumber, createTestPhase, open, parseInvites, seal, testerRef } from "../src/testers.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const master = Buffer.alloc(32, 7);
const tester = "5215550000001"; // synthetic
const stranger = "15550000002";

function phase(over: Partial<Parameters<typeof createTestPhase>[0]> = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const t = createTestPhase({
    masterKey: master,
    enrolled: testerRef(master, "525550000001"),
    publicKey: Buffer.from(publicKey).toString("base64"),
    until: "2026-11-30",
    log: (e) => logs.push(e),
    now: () => new Date("2026-10-28T12:00:00Z"),
    ...over,
  });
  return { t, logs };
}

describe("test phase", () => {
  it("treats 521… and 52… as the same person", () => {
    expect(canonicalNumber("+52 1 555 000 0001")).toBe("525550000001");
    expect(testerRef(master, tester)).toBe(testerRef(master, "525550000001"));
  });

  it("answers only enrolled numbers, and anyone when nobody is enrolled", () => {
    expect(phase().t.allowed(tester)).toBe(true);
    expect(phase().t.allowed(stranger)).toBe(false);
    expect(phase({ enrolled: "" }).t.allowed(stranger)).toBe(true);
  });

  it("seals what a tester says and hears; only the private key opens it", () => {
    const { t, logs } = phase();
    t.inbound({ id: "1", from: tester, at: "", kind: "text", text: "hola" });
    t.outbound(tester, { kind: "buttons", text: "¿Es tu viaje?", buttons: [{ id: "y", title: "Sí" }] });
    expect(logs.map((l) => l.event)).toEqual(["transcript", "transcript"]);
    expect(JSON.stringify(logs)).not.toContain("hola");
    const [a, b] = logs.map((l) => open(privateKey, l.box as string));
    expect(a).toMatchObject({ who: testerRef(master, tester), dir: "in", text: "hola" });
    expect(b?.text).toContain("[Sí]");
  });

  it("writes nothing for strangers, without a key, with nobody enrolled, or after the last day", () => {
    for (const { t, logs } of [phase(), phase({ publicKey: undefined }), phase({ until: "2026-10-27" })]) {
      t.inbound({ id: "1", from: stranger, at: "", kind: "text", text: "x" });
      expect(logs).toEqual([]);
    }
    const open_ = phase({ enrolled: "" });
    open_.t.inbound({ id: "1", from: tester, at: "", kind: "text", text: "x" });
    expect(open_.logs).toEqual([]);
    const late = phase({ until: "2026-10-27" });
    late.t.inbound({ id: "1", from: tester, at: "", kind: "text", text: "x" });
    expect(late.logs).toEqual([]);
  });

  it("round-trips a record", () => {
    const r = { who: "ab", at: "t", dir: "forget" as const };
    expect(open(privateKey, seal(publicKey, r))).toEqual(r);
  });
});

describe("invitation codes", () => {
  const memoryStore = () => {
    const rows = new Map<string, string>();
    return { has: (r: string) => rows.has(r), add: (r: string, l: string) => void rows.set(r, l), count: (l: string) => [...rows.values()].filter((x) => x === l).length };
  };
  const make = (store = memoryStore(), invites = "juez:JUEZ-ABC123:2026-11-20:2") =>
    createTestPhase({ masterKey: master, enrolled: "", invites, store, publicKey: undefined, until: undefined, log: () => {}, now: () => new Date("2026-10-28T12:00:00Z") });

  it("closes the door once an invitation exists, and the code opens it", () => {
    const t = make();
    expect(t.allowed(stranger)).toBe(false);
    const m = t.redeem({ id: "1", from: stranger, at: "", kind: "text", text: "Hi Escala! juez-abc123" });
    expect(m && m.kind === "text" && m.text).toBe("Hi Escala!");
    expect(t.allowed(stranger)).toBe(true);
  });

  it("refuses a wrong, expired or used-up code", () => {
    const store = memoryStore();
    const t = make(store);
    expect(t.redeem({ id: "1", from: stranger, at: "", kind: "text", text: "JUEZ-ABC124" })).toBeNull();
    t.redeem({ id: "1", from: "15550000003", at: "", kind: "text", text: "JUEZ-ABC123" });
    t.redeem({ id: "2", from: "15550000004", at: "", kind: "text", text: "JUEZ-ABC123" });
    expect(t.redeem({ id: "3", from: stranger, at: "", kind: "text", text: "JUEZ-ABC123" })).toBeNull();
    expect(make(memoryStore(), "juez:JUEZ-ABC123:2026-10-27:5").redeem({ id: "1", from: stranger, at: "", kind: "text", text: "JUEZ-ABC123" })).toBeNull();
  });

  it("ignores malformed invitations", () => {
    expect(parseInvites("juez:short:2026-11-20:5;x:JUEZ-ABC123:soon:5;ok-1:JUEZ-ABC123:2026-11-20:5")).toEqual([{ label: "ok-1", code: "JUEZ-ABC123", until: "2026-11-20", max: 5 }]);
  });
});
