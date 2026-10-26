import { describe, expect, it } from "vitest";
import { assess, evaluate, loadEntries, validateEntries, type TripFacts } from "../src/index.ts";

const entries = loadEntries();

describe("rights base", () => {
  it("is valid and every entry passes its own tests", () => {
    expect(validateEntries(entries)).toEqual([]);
  });
});

describe("three-valued conditions", () => {
  it("treats a missing fact as unknown, not as no", () => {
    expect(evaluate({ cause_category: "within_control" }, {}).value).toBe("unknown");
    expect(evaluate({ all: [{ a: 1 }, { b: 2 }] }, { a: 2 }).value).toBe("no");
    expect(evaluate({ any: [{ a: 1 }, { b: 2 }] }, { b: 2 }).value).toBe("yes");
    expect(evaluate({ any: [{ a: 1 }, { b: 2 }] }, { a: 2 }).value).toBe("unknown");
  });

  it("does not compare numbers against strings", () => {
    const stringly = { arrival_delay_h: "4" } as unknown as TripFacts; // e.g. a badly parsed itinerary
    expect(evaluate({ arrival_delay_h: { gte: 3 } }, stringly).value).toBe("no");
  });
});

describe("demo trip: Austin -> Chicago -> Montreal, 3.5 h late, inbound aircraft", () => {
  const facts: TripFacts = {
    as_of: "2026-11-02",
    origin_country: "US",
    destination_country: "US",
    final_destination_country: "CA",
    origin_in_eu261_area: false,
    destination_in_eu261_area: false,
    carrier_is_eu261_carrier: false,
    carrier_size_appr: "large",
    itinerary_type: "international",
    disruption: "delay",
    arrival_delay_h: 3.5,
    notice_days: 0,
    distance_km: 2400,
  };

  it("keeps the EU's 600 euros out, leaves Canada pending on the cause, and asks one question", () => {
    const a = assess(entries, facts, { lang: "en" });
    const byId = Object.fromEntries(a.results.map((r) => [r.id, r]));

    expect(byId["eu-261-7"]?.outcome).toBe("not_applies");
    expect(a.citable.map((r) => r.id)).not.toContain("eu-261-7");
    expect(byId["ca-appr-19"]).toMatchObject({ outcome: "may_apply", missing: ["cause_category"] });
    expect(byId["ca-appr-19"]?.amount).toBeUndefined();
    expect(byId["us-260-refund"]?.outcome).toBe("not_applies"); // international itinerary: 6 h threshold

    expect(a.question?.fact).toBe("cause_category");
    expect(a.question?.text).toMatch(/why the flight is late/);
  });

  it("gives CAD 400 once the airline's cause is within its control", () => {
    const a = assess(entries, { ...facts, cause_category: "within_control" }, { lang: "fr" });
    const ca = a.results.find((r) => r.id === "ca-appr-19");
    expect(ca).toMatchObject({ outcome: "applies", amount: { CAD: 400 } });
  });

  it("never asks the same question twice on a trip", () => {
    const a = assess(entries, facts, { lang: "es", alreadyAsked: ["cause_category"] });
    expect(a.question?.fact).not.toBe("cause_category");
  });
});
