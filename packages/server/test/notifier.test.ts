import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "@escala/channel";
import type { Person } from "@escala/conversation";
import type { FlightEvent, FlightSnapshot } from "@escala/feeds";
import { createNotifier } from "../src/index.ts";

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id, lang: "es", stage: "ready", share: "trip", shareAsked: true, langFromText: true, awaiting: null,
  trip: { legs: [{ flight: "ZZ1234", date: "2026-11-02" }] }, ...over,
});
const snap = { ident: "ZZ1234", observedAt: "2026-11-02T12:00:00Z", departure: { scheduled: "2026-11-02T13:10:00Z" } } as unknown as FlightSnapshot;
const late: FlightEvent = { kind: "arrival_delay_change", flightId: "f1", at: "2026-11-02T12:00:00Z", inference: false, minutesLate: 100, previousMinutesLate: 0 };
const inbound: FlightEvent = { kind: "inbound_late", flightId: "f1", at: "2026-11-02T11:20:00Z", inference: true, inboundFlightId: "f0", inboundArrivalEstimate: "", scheduledDeparture: "", minTurnMinutes: 45, turnSource: "default", hops: 1, likelyDepartureDelayMinutes: 80 };

function setup(people: Person[], open: (id: string) => boolean) {
  const sent: Array<{ to: string; m: OutboundMessage }> = [];
  const notify = createNotifier({ send: async (to, m) => (sent.push({ to, m }), { id: "x" }), windowOpen: open, people: () => people });
  return { sent, notify };
}

describe("flight alerts", () => {
  it("writes freely inside the 24-hour window and labels an inference", async () => {
    const { sent, notify } = setup([person("a")], () => true);
    await notify([inbound], snap);
    expect(sent[0]!.m).toMatchObject({ kind: "text" });
    expect((sent[0]!.m as { text: string }).text).toMatch(/ZZ 1234 podría salir unos 80 min tarde.*mi estimación, no un dato de la aerolínea/);
  });

  it("uses the approved template in the person's language outside the window", async () => {
    const { sent, notify } = setup([person("b", { lang: "fr" })], () => false);
    await notify([late], snap);
    expect(sent[0]!.m).toEqual({ kind: "template", name: "escala_flight_update", language: "fr", bodyParams: ["ZZ 1234", "arrive maintenant avec environ 100 min de retard"] });
  });

  it("tells a newly assigned gate apart from a gate change", async () => {
    const { sent, notify } = setup([person("g")], () => true);
    await notify([{ kind: "gate_change", flightId: "f1", at: "2026-11-02T12:10:00Z", inference: false, side: "departure", from: null, to: "K14" }], snap);
    await notify([{ kind: "gate_change", flightId: "f1", at: "2026-11-02T12:20:00Z", inference: false, side: "departure", from: "K14", to: "K18" }], snap);
    expect(sent.map((x) => (x.m as { text: string }).text)).toEqual([
      expect.stringMatching(/ZZ 1234 ya tiene puerta de embarque: K14/),
      expect.stringMatching(/ZZ 1234 ahora sale por la puerta K18/),
    ]);
  });

  it("tells each change once, and never writes to people without that flight or who said STOP", async () => {
    const { sent, notify } = setup([person("c"), person("d", { stage: "stopped" }), person("e", { trip: { legs: [{ flight: "ZZ567", date: "2026-11-02" }] } })], () => true);
    await notify([late], snap);
    await notify([late], snap);
    expect(sent.map((s) => s.to)).toEqual(["c"]);
  });

  it("sends changes that arrive close together as one update (judge session 29-oct: five alerts in seconds)", async () => {
    const sent: Array<{ to: string; m: OutboundMessage }> = [];
    const people = [person("c", { lang: "en", trip: { legs: [{ flight: "ZZ1234", date: "2026-11-02" }, { flight: "ZZ567", date: "2026-11-02" }] } })];
    const notify = createNotifier({ send: async (to, m) => (sent.push({ to, m }), { id: "x" }), windowOpen: () => true, people: () => people, coalesceMs: 30 });
    await notify([late], snap);
    const gate: FlightEvent = { kind: "gate_change", flightId: "f2", at: "2026-11-02T12:01:00Z", inference: false, side: "departure", from: null, to: "E5" } as FlightEvent;
    await notify([gate], { ...snap, ident: "ZZ567" } as FlightSnapshot);
    expect(sent).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toHaveLength(1);
    const text = (sent[0]!.m as { text: string }).text;
    expect(text).toMatch(/^✈️ Updates:\n• flight ZZ 1234 now arrives about 100 min late\n• flight ZZ 567 has its departure gate: E5\nReply/);
  });
});

