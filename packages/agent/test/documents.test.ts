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
      { country: "US", role: "transit", airport: "IAH" },
      { country: "CA", role: "entry", airport: "YUL" },
    ] });
    expect(crossesBorder({ bookingRef: null, legs: [{ ...trip.legs[0]!, to: "CUN" }] })).toBe(false);
  });

  it("returns only rules with a source, and says when a country is not covered", () => {
    const out = documentsFor("mx", trip, [rule({}), rule({ country: "CA", passport: "FR" })]);
    expect(out[0]).toMatchObject({ country: "US", covered: true, rules: [{ requirement: "synthetic requirement", url: "https://example.gov" }] });
    expect(out[1]).toMatchObject({ country: "CA", covered: false, official_page: expect.stringContaining("canada.ca") });
    expect(documentsFor("FR", trip, [rule({ passport: "EU", country: "CA", role: "entry" })])[1]).toMatchObject({ covered: true });
    expect(documentsFor("US", trip, [])[0]).toMatchObject({ own_country: true });
  });

  it("reads back the remembered passport", () => {
    expect(passportFromStatement("passport: MX")).toBe("MX");
    expect(passportFromStatement("likes aisle seats")).toBeNull();
  });
});
