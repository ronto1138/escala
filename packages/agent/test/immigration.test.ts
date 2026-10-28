import { describe, expect, it } from "vitest";
import { immigrationCard, immigrationStops, immigrationText } from "../src/immigration.ts";

const leg = (flight: string, from: string, to: string, date = "2026-11-02", dep = "07:00", arr = "09:30") => ({ flight, date, from, to, dep_local: dep, arr_local: arr });
const viaChicago = { bookingRef: null, legs: [leg("ZZ1234", "MEX", "ORD", "2026-11-02", "08:00", "12:15"), leg("ZZ567", "ORD", "YUL", "2026-11-02", "14:45", "18:00")] };

describe("immigration card", () => {
  it("stops at a US connection and at the destination, not at a Canadian connection with no officer", () => {
    expect(immigrationStops(viaChicago)).toEqual([
      { country: "US", airport: "ORD", role: "transit", flight: "ZZ1234" },
      { country: "CA", airport: "YUL", role: "entry", flight: "ZZ567" },
    ]);
    const viaMontreal = { bookingRef: null, legs: [leg("ZZ1", "MEX", "YUL", "2026-11-02", "08:00", "14:00"), leg("ZZ2", "YUL", "DUB", "2026-11-02", "18:00", "23:00")] };
    expect(immigrationStops(viaMontreal).map((s) => s.airport)).toEqual(["DUB"]);
    expect(immigrationStops({ bookingRef: null, legs: [leg("ZZ9", "MEX", "CUN")] })).toEqual([]);
  });

  it("holds only the traveler's facts, in the officer's language", () => {
    const [chicago, montreal] = immigrationStops(viaChicago);
    expect(immigrationCard(viaChicago, chicago!, {}).card).toEqual([{ lang: "en", lines: ["I am only connecting: today I fly on to Montreal on flight ZZ 567."] }]);
    const c = immigrationCard(viaChicago, montreal!, { purpose: "family", stay: "Hotel Synthetic", stayAddress: "100 Rue Exemple" });
    expect(c.card).toEqual([
      { lang: "en", lines: ["I am visiting family.", "I will stay at Hotel Synthetic, 100 Rue Exemple."] },
      { lang: "fr", lines: ["Je viens rendre visite à ma famille.", "Je loge à Hotel Synthetic, 100 Rue Exemple."] },
    ]);
    expect(c.missing).toEqual([]);
  });

  it("adds the flight back, and asks for what is missing instead of inventing it", () => {
    const roundTrip = { bookingRef: null, legs: [leg("ZZ10", "MEX", "EWR"), leg("ZZ11", "EWR", "MEX", "2026-11-20")] };
    const [newark] = immigrationStops(roundTrip);
    const es = immigrationText(roundTrip, newark!, { stay: "Casa de la familia" }, "es");
    expect(es).toContain("🛂 Para migración en Newark.");
    expect(es).toContain("📋 I will stay at Casa de la familia. I fly back on November 20, flight ZZ 11.");
    expect(es).toContain("en la caseta no grabes ni llames");
    expect(es).toContain("Si me dices a qué vas y la dirección donde te quedas, lo agrego a la tarjeta.");
    const nothing = immigrationText({ bookingRef: null, legs: [leg("ZZ10", "MEX", "EWR")] }, newark!, {}, "es");
    expect(nothing).not.toContain("📋");
    expect(nothing).not.toContain("captura");
  });

  it("tells that a US connection means going through US immigration", () => {
    const [chicago] = immigrationStops(viaChicago);
    expect(immigrationText(viaChicago, chicago!, {}, "es")).toMatch(/^🛂 Para migración en Chicago O'Hare: ahí pasas migración y aduana de EE\. UU\. aunque solo vayas en conexión\. Toma captura/);
  });
});
