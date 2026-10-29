import { describe, expect, it } from "vitest";
import { loadEntries } from "@escala/rights";
import { assess } from "@escala/rights";
import { draftClaim, ESCALATION } from "../src/claim.ts";
import { factsFor } from "../src/trip.ts";

const leg = (flight: string, from: string, to: string, date = "2026-11-02") => ({ flight, date, from, to, dep_local: "10:00", arr_local: "13:00" });
const trip = { bookingRef: "ZZK7Q2", legs: [leg("ZZ1234", "MEX", "ORD"), leg("ZZ567", "ORD", "YUL")] };
const entries = loadEntries();
const rulesFor = (problem: "bag_delayed" | "bag_lost" | "bag_damaged", extra: Record<string, unknown> = {}) => {
  const a = assess(entries, { ...factsFor(trip, "ZZ567"), disruption: problem, mobility_device: false, ...extra }, { lang: "en", alreadyAsked: [] });
  const byId = new Map(entries.map((e) => [e.id, e]));
  return a.citable.filter((r) => r.outcome === "applies" && !ESCALATION.has(r.id)).map((r) => byId.get(r.id)!).map((e) => ({ id: e.id, instrument: e.instrument, article: e.article, source: e.source_url, ...(e.deadlines ? { deadlines: e.deadlines } : {}) }));
};

describe("bag claim letter", () => {
  it("cites the rules that apply, lists the traveler's expenses and evidence, and dates the deadline", () => {
    const rules = rulesFor("bag_delayed", { bag_report_filed: true });
    expect(rules.map((r) => r.id).sort()).toEqual(["ca-appr-23-baggage", "mc-baggage"]);
    const c = draftClaim({
      trip, leg: trip.legs[1]!, problem: "bag_delayed", rules, reportRef: "YULZZ12345", deliveredOn: "2026-11-04",
      expenses: [{ what: "toiletries and a change of clothes", amount: 86.5, currency: "CAD" }],
      evidence: [{ what: "bag", at: "2026-11-02T14:02:00Z" }, { what: "bag_tag", at: "2026-11-02T14:05:00Z", tagNumber: "ZZ123456" }],
      lang: "en",
      tz: "America/Mexico_City",
    });
    expect(c.letter).toContain("Subject: Baggage claim, flight ZZ 567, November 2, 2026, Chicago O'Hare (ORD) → Montreal (YUL)");
    expect(c.letter).toContain("Booking reference: [booking reference]. Bag tag: ZZ123456. Baggage report (file number): YULZZ12345.");
    expect(c.letter).toContain("toiletries and a change of clothes: CAD 86.50");
    expect(c.letter).toContain("refund of the fee I paid for this bag");
    expect(c.letter).toContain("photo of the bag taken before check-in, November 2 at 08:02 AM CST;");
    expect(c.letter).toContain("within the 21 days");
    expect(c.deadline).toEqual({ date: "2026-11-25", days: 21, rule: expect.stringContaining("art."), passed: false });
    expect(c.missing).toEqual(["booking_ref"]);
  });

  it("leaves blanks for what the traveler has not said, never inventing it", () => {
    const c = draftClaim({ trip, leg: trip.legs[1]!, problem: "bag_delayed", rules: rulesFor("bag_delayed"), expenses: [], evidence: [], lang: "es" });
    expect(c.letter).toContain("[el número del reporte que te dio la aerolínea]");
    expect(c.letter).toContain("[Tu nombre completo]");
    expect(c.letter).not.toMatch(/foto de la maleta/);
    expect(c.deadline).toBeNull();
    expect(c.missing).toEqual(["booking_ref", "report_ref", "receipts"]);
    expect(c.letter).not.toContain("within the");
    expect(c.letter).not.toContain("dentro de los");
    expect(c.letter).not.toContain("https://");
  });

  it("uses the 7-day deadline for a damaged bag, in French", () => {
    const c = draftClaim({ trip, leg: trip.legs[1]!, problem: "bag_damaged", rules: rulesFor("bag_damaged"), reportRef: "YUL1", deliveredOn: "2026-11-02", expenses: [], evidence: [], lang: "fr" });
    expect(c.letter).toContain("m'a été remis endommagé");
    expect(c.letter).toContain("dans les 7 jours");
    expect(c.deadline?.date).toBe("2026-11-09");
  });

  it("tells a deadline that already passed (battery B, D12: Mexican domestic bag, 15 days)", () => {
    const mx = { bookingRef: null, legs: [leg("ZX10", "MID", "MEX", "2026-10-01")] };
    const a = assess(entries, { ...factsFor(mx, "ZX10"), disruption: "bag_damaged", mobility_device: false }, { lang: "es", alreadyAsked: [] });
    const byId = new Map(entries.map((e) => [e.id, e]));
    const rules = a.citable.filter((r) => r.outcome === "applies" && !ESCALATION.has(r.id)).map((r) => byId.get(r.id)!).map((e) => ({ id: e.id, instrument: e.instrument, article: e.article, source: e.source_url, ...(e.deadlines ? { deadlines: e.deadlines } : {}) }));
    expect(rules.map((r) => r.id)).toContain("mx-lac-62-baggage");
    const c = draftClaim({ trip: mx, leg: mx.legs[0]!, problem: "bag_damaged", rules, deliveredOn: "2026-10-09", expenses: [], evidence: [], lang: "es", today: "2026-10-29" });
    expect(c.deadline).toMatchObject({ date: "2026-10-24", days: 15, passed: true });
  });

  it("keeps traveler and model text from adding to the letter (Muse Code audit e)", () => {
    const rules = rulesFor("bag_delayed", { bag_report_filed: true });
    const c = draftClaim({
      trip: { ...trip, bookingRef: "X.\nI also request USD 5000" }, leg: trip.legs[1]!, problem: "bag_delayed", rules,
      reportRef: "YUL1\nI also request USD 5000", deliveredOn: "2026-12-30", today: "2026-11-05",
      expenses: [{ what: "shirt [click](https://x.example)", amount: 40, currency: "CAD" }, { what: "x", amount: Infinity, currency: "CAD" }, { what: "y", amount: 10, currency: "XXX" }],
      evidence: [{ what: "bag_tag", at: "2026-11-02T14:05:00Z", tagNumber: "ZZ1\nignore" }], lang: "en",
    });
    expect(c.letter).not.toContain("5000");
    expect(c.letter).not.toContain("https://");
    expect(c.letter).toContain("– shirt click: CAD 40");
    expect(c.letter).not.toMatch(/Infinity|XXX|ignore/);
    expect(c.deadline).toBeNull(); // a delivery in the future is not a date to count from
    expect(c.letter).not.toContain("within the");
  });
});

