import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "@escala/channel";
import type { Person } from "@escala/conversation";
import type { FlightSnapshot } from "@escala/feeds";
import { boardingText, createBoardingReminders, remindAt } from "../src/boarding.ts";

const snap = (over: Partial<FlightSnapshot> & { ident: string; out: string; inn: string; gate?: string | null }): FlightSnapshot =>
  ({
    source: "replay", ident: over.ident, flightId: over.ident, operator: over.operator ?? "ZZ",
    origin: { iata: "AUS", icao: "KAUS", timezone: "America/Chicago" }, destination: { iata: "ORD", icao: "KORD", timezone: "America/Chicago" },
    departure: { scheduled: over.out, estimated: over.out, actual: null, gate: over.gate === undefined ? "17" : over.gate, terminal: null },
    arrival: { scheduled: over.inn, estimated: over.inn, actual: null, gate: null, terminal: null, baggageClaim: null },
    cancelled: false, diverted: false, inboundFlightId: null, aircraftType: null, registration: null, observedAt: over.out,
  }) as FlightSnapshot;

const first = snap({ ident: "ZZ1234", out: "2026-11-02T20:50:00Z", inn: "2026-11-02T23:15:00Z" });
const second = { ...snap({ ident: "ZZ567", out: "2026-11-02T22:30:00Z", inn: "2026-11-03T00:40:00Z" }), origin: { iata: "ORD", icao: "KORD", timezone: "America/Chicago" } };

describe("heading to the gate", () => {
  it("comes ahead of what the airline publishes, in local time, saying whose rule it is", () => {
    // Example rule of the demo airline: boarding 40 min before; reminder 15 min before that.
    expect(new Date(remindAt(first)!).toISOString()).toBe("2026-11-02T19:50:00.000Z");
    const es = boardingText(first, "es", "Austin");
    expect(es).toContain("sale a las 14:50 (hora de Austin) por la puerta 17");
    expect(es).toContain("regla de ejemplo de la aerolínea del demo, el abordaje empieza hacia las 14:10 y la puerta cierra a las 14:35");
    expect(boardingText({ ...first, operator: "DL" }, "en", "Austin")).toMatch(/Per Delta \(https:\/\/www\.delta\.com.*\), be at the gate by 14:35/);
    expect(boardingText({ ...first, operator: "UA" }, "en", "Austin")).toMatch(/doesn't publish when it boards/);
  });

  it("is sent once, and never while the traveler is still flying the leg before", async () => {
    const sent: Array<{ to: string; m: OutboundMessage }> = [];
    let now = Date.parse("2026-11-02T20:00:00Z");
    const person = { id: "a", lang: "es", stage: "ready", trip: { legs: [{ flight: "ZZ1234" }, { flight: "ZZ567" }] } } as unknown as Person;
    const tick = createBoardingReminders({
      feed: { findByIdent: (i) => (i === "ZZ1234" ? first : second), now: () => now },
      people: () => [person], send: async (to, m) => void sent.push({ to, m }), windowOpen: () => true, cityOf: () => "Austin",
    });
    await tick();
    await tick();
    expect(sent).toHaveLength(1);
    expect((sent[0]!.m as { text: string }).text).toMatch(/^🛫 .*vuelo ZZ 1234 sale a las 14:50.*\(datos de vuelo simulados\)$/);
    now = Date.parse("2026-11-02T21:40:00Z"); // ZZ567's reminder time, but ZZ1234 lands at 23:15
    await tick();
    expect(sent).toHaveLength(1);
  });
});
