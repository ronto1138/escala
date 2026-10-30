import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "@escala/channel";
import { createPacer } from "../src/pacer.ts";

describe("pacing what Escala sends on its own (Ives' recording, 30-oct)", () => {
  const setup = (ready = () => true) => {
    let t = 0;
    const sent: Array<{ at: number; m: OutboundMessage }> = [];
    const pacer = createPacer({ send: async (_to, m) => void sent.push({ at: t, m }), gapMs: 4_000, quietMs: 12_000, allowed: ready, now: () => t, sleep: async (ms) => void (t += ms) });
    return { pacer, sent, at: () => t, set: (v: number) => void (t = v) };
  };
  const text = (s: string): OutboundMessage => ({ kind: "text", text: s });

  it("waits for the traveler to read an answer, then spaces the messages and keeps a group together", async () => {
    const { pacer, sent } = setup();
    pacer.touch("a"); // an answer just went out at t=0
    const label = text("🔊 Chicago");
    const voice: OutboundMessage = { kind: "voice", audio: new Uint8Array([1]) };
    await Promise.all([pacer.send("a", text("✈️ alert")), pacer.send("a", [label, voice]), pacer.send("a", text("🧳 bag"))]);
    expect(sent.map((x) => [x.at, x.m.kind === "text" ? x.m.text : "voice"])).toEqual([
      [12_000, "✈️ alert"],
      [16_000, "🔊 Chicago"],
      [16_000, "voice"],
      [20_000, "🧳 bag"],
    ]);
  });

  it("drops what was waiting for someone who said STOP", async () => {
    let ok = true;
    const { pacer, sent } = setup(() => ok);
    pacer.touch("b");
    const p = pacer.send("b", text("✈️ alert"));
    ok = false;
    await p;
    expect(sent).toHaveLength(0);
  });
});
