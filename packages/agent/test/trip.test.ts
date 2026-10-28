import { describe, expect, it } from "vitest";
import { assess, loadEntries } from "@escala/rights";
import { dayLabel, factsFor, journeys, legLine, type Trip } from "../src/index.ts";

const demo: Trip = {
  bookingRef: "QX7P2L",
  legs: [
    { flight: "ZZ1234", date: "2026-11-02", from: "AUS", to: "ORD", dep_local: "07:10", arr_local: "09:35" },
    { flight: "ZZ567", date: "2026-11-02", from: "ORD", to: "YUL", dep_local: "10:30", arr_local: "13:40" },
    { flight: "ZZ568", date: "2026-11-06", from: "YUL", to: "ORD", dep_local: "15:15", arr_local: "16:40" },
    { flight: "ZZ1251", date: "2026-11-06", from: "ORD", to: "AUS", dep_local: "18:05", arr_local: "20:55" },
  ],
};

describe("journeys and facts", () => {
  it("splits outbound and return at the four-day stay", () => {
    expect(journeys(demo).map((j) => j.map((l) => l.flight))).toEqual([["ZZ1234", "ZZ567"], ["ZZ568", "ZZ1251"]]);
  });

  it("derives the demo facts from the itinerary, not from guesses", () => {
    expect(factsFor(demo, "ZZ1234")).toMatchObject({
      origin_country: "US",
      destination_country: "US",
      final_destination_country: "CA",
      itinerary_type: "international",
      origin_in_eu261_area: false,
      carrier_is_eu261_carrier: false,
      carrier_size_appr: "large",
    });
  });

  it("with the facts the traveler adds, the rules engine reaches CAD 400", () => {
    const facts = { ...factsFor(demo, "ZZ1234"), disruption: "delay" as const, arrival_delay_h: 3.5, cause_category: "within_control" as const, notice_days: 0 };
    const ca = assess(loadEntries(), facts, { lang: "es" }).results.find((r) => r.id === "ca-appr-19");
    expect(ca).toMatchObject({ outcome: "applies", amount: { CAD: 400 } });
  });
});

describe("dates are written by code in the person's language", () => {
  it("es, en, fr", () => {
    expect(dayLabel("2026-11-02", "es")).toBe("lun 2 de nov");
    expect(dayLabel("2026-11-02", "en")).toBe("Mon Nov 2");
    expect(dayLabel("2026-11-02", "fr")).toBe("lun 2 nov");
    expect(legLine(demo.legs[1]!, "fr")).toBe("ZZ 567 · lun 2 nov · Chicago O'Hare 10 h 30 → Montréal 13 h 40");
  });
});

describe("Muse Code audit (Oct 26): unknown airports", () => {
  it("B3: an unknown airport does not make a domestic trip international", () => {
    const t: Trip = { bookingRef: null, legs: [{ flight: "ZZ1", date: "2026-11-02", from: "AUS", to: "XXX", dep_local: "07:00", arr_local: "09:00" }] };
    expect(factsFor(t, "ZZ1").itinerary_type).toBeUndefined();
  });
});
