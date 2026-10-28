import { describe, expect, it } from "vitest";
import { detect, fromAeroFlight, inboundChain, inboundInference, type AeroFlight, type FlightSnapshot } from "../src/index.ts";

// Synthetic aircraft day: A (DEN-AUS) -> B (AUS-ORD) -> C (ORD-YUL), same plane. Times UTC.
const base: AeroFlight = {
  ident: "ZZ1", fa_flight_id: "A", operator: "ZZ", inbound_fa_flight_id: null, cancelled: false, diverted: false,
  origin: null, destination: null, gate_origin: null, gate_destination: null, terminal_origin: null, terminal_destination: null,
  baggage_claim: null, scheduled_out: null, estimated_out: null, actual_out: null, scheduled_in: null, estimated_in: null, actual_in: null,
};
const flight = (id: string, inbound: string | null, out: string, inn: string, over: Partial<AeroFlight> = {}): AeroFlight => ({
  ...base, ident: `ZZ${id}`, fa_flight_id: id, inbound_fa_flight_id: inbound,
  scheduled_out: out, estimated_out: out, scheduled_in: inn, estimated_in: inn, ...over,
});
const day = (over: Record<string, Partial<AeroFlight>> = {}) => {
  const fs = [
    flight("A", null, "2026-11-02T10:00:00Z", "2026-11-02T12:00:00Z", over.A),
    flight("B", "A", "2026-11-02T13:00:00Z", "2026-11-02T15:00:00Z", over.B),
    flight("C", "B", "2026-11-02T16:00:00Z", "2026-11-02T18:00:00Z", over.C),
  ];
  const snaps = new Map<string, FlightSnapshot>(fs.map((f) => [f.fa_flight_id, fromAeroFlight(f, "2026-11-02T09:00:00Z", "replay")]));
  return { get: (id: string) => snaps.get(id), c: snaps.get("C")! };
};

describe("the aircraft's earlier flights", () => {
  it("sees a delay two flights back before it reaches the previous flight", () => {
    // A leaves 2 h late; B still shows on time, but cannot leave before A lands plus the turn.
    const { get, c } = day({ A: { estimated_out: "2026-11-02T12:00:00Z", estimated_in: "2026-11-02T14:00:00Z" } });
    expect(inboundChain(get, c).map((f) => f.flightId)).toEqual(["B", "A"]);
    const inf = inboundInference(c, inboundChain(get, c), 45)!;
    // A lands 14:00, B out 14:45, B in 16:45, C ready 17:30 against 16:00 scheduled.
    expect(inf).toMatchObject({ likelyDepartureDelayMinutes: 90, hops: 2, minTurnMinutes: 45 });
  });

  it("stays quiet when the schedule absorbs the delay", () => {
    const { get, c } = day({ A: { estimated_in: "2026-11-02T12:10:00Z" } });
    expect(inboundInference(c, inboundChain(get, c), 45)).toBeUndefined();
  });

  it("says when the expected delay no longer applies, and when the airline swaps the aircraft", () => {
    const late = day({ B: { estimated_in: "2026-11-02T16:00:00Z" } });
    const caughtUp = day({ B: { estimated_in: "2026-11-02T15:05:00Z" } });
    const chainOf = (d: ReturnType<typeof day>) => inboundChain(d.get, d.c);
    expect(detect(late.c, caughtUp.c, { curr: chainOf(caughtUp), prev: chainOf(late) }, { minTurnMinutes: 45 })).toEqual([
      expect.objectContaining({ kind: "inbound_late_cleared", previousDelayMinutes: 45 }),
    ]);

    const swapped = { ...caughtUp.c, inboundFlightId: "X" };
    const other = fromAeroFlight(flight("X", null, "2026-11-02T13:00:00Z", "2026-11-02T14:30:00Z"), "2026-11-02T09:00:00Z", "replay");
    expect(detect(late.c, swapped, { curr: [other], prev: chainOf(late) }, { minTurnMinutes: 45 })).toEqual([
      expect.objectContaining({ kind: "aircraft_changed", likelyDepartureDelayMinutes: 0 }),
    ]);
  });
});
