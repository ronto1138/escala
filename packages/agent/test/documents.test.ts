import { describe, expect, it } from "vitest";
import { crossesBorder, documentsFor, passportFromStatement, tripCountries, type DocRule } from "../src/documents.ts";

const trip = { bookingRef: null, legs: [
  { flight: "ZZ100", date: "2026-11-02", from: "MEX", to: "IAH", dep_local: "07:00", arr_local: "09:30" },
  { flight: "ZZ200", date: "2026-11-02", from: "IAH", to: "YUL", dep_local: "12:00", arr_local: "16:30" },
] };
const rule = (over: Partial<DocRule>): DocRule => ({
  id: "t", passport: "MX", country: "US", role: "both", requirement: "synthetic requirement", url: "https://example.gov", quote: "q",
  checked_on: "2026-10-28", status: "VERIFICADO", ...over,
});

describe("documents by passport", () => {
  it("sees the connection as transit and the destination as entry", () => {
    expect(tripCountries(trip)).toEqual({ start: "MX", touched: [
      { country: "MX", role: "exit", airport: "MEX" },
      { country: "US", role: "transit", airport: "IAH" },
      { country: "CA", role: "entry", airport: "YUL" },
    ] });
    expect(crossesBorder({ bookingRef: null, legs: [{ ...trip.legs[0]!, to: "CUN" }] })).toBe(false);
  });

  it("returns only rules with a source, and says when a country is not covered", () => {
    const out = documentsFor("mx", trip, [rule({}), rule({ country: "CA", passport: "FR" })]).slice(1);
    expect(out[0]).toMatchObject({ country: "US", covered: true, rules: [{ requirement: "synthetic requirement", url: "https://example.gov" }] });
    expect(out[1]).toMatchObject({ country: "CA", covered: false, official_page: expect.stringContaining("canada.ca") });
    expect(documentsFor("FR", trip, [rule({ passport: "EU", country: "CA", role: "entry" })])[2]).toMatchObject({ covered: true });
    expect(documentsFor("US", trip, [])[1]).toMatchObject({ own_country: true });
  });

  it("reads back the remembered passport", () => {
    expect(passportFromStatement("passport: MX")).toBe("MX");
    expect(passportFromStatement("likes aisle seats")).toBeNull();
  });
});

describe("the official table", () => {
  it("tells a Mexican passport connecting in the US what both countries ask", () => {
    const [mx, us, ca] = documentsFor("MX", trip);
    expect(mx).toMatchObject({ role: "exit", own_country: true, rules: [expect.objectContaining({ requirement: expect.stringContaining("Formato Estadístico para Mexicanos") })] });
    expect(us!.rules.map((r) => r.url)).toEqual([
      expect.stringContaining("ecfr.gov"), expect.stringContaining("dhs.gov"), expect.stringContaining("cbp.gov"), expect.stringContaining("cbp.gov/travel/clearing-cbp"),
    ]);
    expect(us!.rules.find((r) => r.url.includes("newsroom"))!.status).toBe("NO_VERIFICADO");
    expect(ca).toMatchObject({ covered: true, rules: expect.arrayContaining([expect.objectContaining({ requirement: expect.stringContaining("US non-immigrant visa") }), expect.objectContaining({ requirement: expect.stringContaining("ArriveCAN") })]) });
  });

  it("a rule for everyone does not make a passport covered", () => {
    const [, us] = documentsFor("JP", trip);
    expect(us).toMatchObject({ covered: false, official_page: expect.stringContaining("travel.state.gov") });
    expect(us!.rules.length).toBeGreaterThan(0); // still: no airside transit
  });

  it("every rule has an official page, a quote and the day it was read", async () => {
    const { DOC_RULES } = await import("../src/documents.ts");
    for (const r of DOC_RULES) {
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.quote.length).toBeGreaterThan(10);
      expect(r.checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("what Escala still needs around the flights", () => {
  it("asks only for what is unknown, in the traveler's language", async () => {
    const { prepQuestion } = await import("../src/agent.ts");
    const p = (details: object) => ({ id: "x", lang: "es", details }) as any;
    expect(prepQuestion(p({}))).toBe("Para ayudarte en el camino, cuéntame dónde te vas a quedar (nombre y dirección: los formularios la piden), si vas a documentar maleta y si vas a rentar coche.");
    expect(prepQuestion(p({ stay: "Hotel Ejemplo", checkedBags: 1 }))).toBe("Para ayudarte en el camino, cuéntame si vas a rentar coche.");
    expect(prepQuestion(p({ stay: "H", checkedBags: 0, rentalCar: null }))).toBeNull();
  });
});
