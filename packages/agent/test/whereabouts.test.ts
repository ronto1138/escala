import { describe, expect, it } from "vitest";
import { CHECKING, createChecking, describeLocation, locationIsFresh, usableCheckingLine } from "../src/whereabouts.ts";

const trip = { legs: [{ flight: "ZZ567", from: "ORD", to: "YUL", date: "2026-11-02" }] } as any;
const at = "2026-11-02T18:00:00Z";
const now = Date.parse(at) + 5 * 60000;

describe("where the traveler is", () => {
  it("knows they are at the trip's airport, or in its city", () => {
    expect(describeLocation({ lat: 45.4706, lon: -73.7408, at }, trip, now)).toContain("at or next to Montreal airport (YUL)");
    expect(describeLocation({ lat: 45.5017, lon: -73.5673, at }, trip, now)).toMatch(/about 1\d(\.\d)? km from Montreal airport/);
    expect(describeLocation({ lat: 19.43, lon: -99.13, at }, trip, now)).toContain("away from the trip's airports");
  });

  it("is used for two hours only", () => {
    expect(locationIsFresh({ lat: 0, lon: 0, at }, now)).toBe(true);
    expect(locationIsFresh({ lat: 0, lon: 0, at }, Date.parse(at) + 2 * 3.6e6)).toBe(false);
  });
});

describe("the line said before a search", () => {
  it("varies and never repeats itself back to back", () => {
    const seq = [0.1, 0.1, 0.1, 0.5];
    const pick = createChecking(() => seq.shift() ?? 0.1);
    const a = pick("p", "es");
    const b = pick("p", "es");
    expect(a).not.toBe(b);
    expect(CHECKING.es).toContain(a);
  });

  it("uses the model's own line only if it is short, without figures or questions", () => {
    expect(usableCheckingLine("Busco cómo llegar del aeropuerto al centro.")).toBe(true);
    expect(usableCheckingLine("El taxi cuesta 49 dólares")).toBe(false);
    expect(usableCheckingLine("¿Quieres que busque?")).toBe(false);
    expect(usableCheckingLine("")).toBe(false);
  });
});
