import { describe, expect, it } from "vitest";
import { isLeg, type FlightSnapshot } from "../src/index.ts";

const snap = {
  ident: "ZZ1234",
  origin: { iata: "MEX", icao: null, timezone: "America/Mexico_City" },
  destination: { iata: "ORD", icao: null, timezone: "America/Chicago" },
  departure: { scheduled: "2026-11-02T06:05:00Z", estimated: null, actual: null, gate: null, terminal: null },
} as unknown as FlightSnapshot;

describe("audit (Oct 31): a followed flight is this leg only at its scheduled time", () => {
  it("matches number, route and the local scheduled departure", () => {
    expect(isLeg(snap, { flight: "ZZ 1234", from: "MEX", to: "ORD", date: "2026-11-02", dep_local: "00:05" })).toBe(true);
  });
  it("another run of the demo story, at another time, is not this leg", () => {
    expect(isLeg(snap, { flight: "ZZ1234", from: "MEX", to: "ORD", date: "2026-11-02", dep_local: "00:10" })).toBe(false);
    expect(isLeg(snap, { flight: "ZZ1234", from: "AUS", to: "ORD" })).toBe(false);
  });
  it("a leg without a time still matches by number and route", () => {
    expect(isLeg(snap, { flight: "ZZ1234", from: "MEX", to: "ORD" })).toBe(true);
  });
});
