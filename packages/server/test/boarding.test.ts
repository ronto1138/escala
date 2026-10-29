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
    expect(boardingText({ ...first, operator: "UA" }, "en", "Austin")).toMatch(/Per United .*boarding starts between 14:00 and 14:10 and the gate closes at 14:35/);
    expect(boardingText({ ...first, operator: "AM" }, "en", "Austin")).toMatch(/doesn.t publish its boarding time; airlines usually start 30 to 50 min .* between 14:00 and 14:20/);
  });

  it("is sent once, and never while the traveler is still flying the leg before", async () => {
    const sent: Array<{ to: string; m: OutboundMessage }> = [];
    let now = Date.parse("2026-11-02T20:00:00Z");
    const person = { id: "a", lang: "es", stage: "ready", details: { checkedBags: 0 }, trip: { legs: [{ flight: "ZZ1234" }, { flight: "ZZ567" }] } } as unknown as Person;
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

describe("around the airport", () => {
  const setup = (person: Person, now: number) => {
    const sent: OutboundMessage[] = [];
    const tick = createBoardingReminders({
      feed: { findByIdent: (i) => (i === "ZZ1234" ? first : second), now: () => now },
      people: () => [person], send: async (_to, m) => void sent.push(m), windowOpen: () => true, cityOf: () => "Austin",
    });
    return { sent, tick };
  };

  it("asks for photos of the bag and its tag before check-in, unless they carry everything on", async () => {
    const at = Date.parse("2026-11-02T19:15:00Z"); // 95 min before a domestic departure
    const bag = setup({ id: "b", lang: "es", stage: "ready", trip: { legs: [{ flight: "ZZ1234" }] } } as unknown as Person, at);
    await bag.tick();
    expect((bag.sent[0] as { text: string }).text).toMatch(/^🧳 Si vas a documentar maleta: antes de entregarla, tómale una foto/);
    const carryOn = setup({ id: "c", lang: "es", stage: "ready", details: { checkedBags: 0 }, trip: { legs: [{ flight: "ZZ1234" }] } } as unknown as Person, at);
    await carryOn.tick();
    expect(carryOn.sent).toHaveLength(0);
  });

  it("uses the boarding time printed on their pass, and says when the gate moved", async () => {
    const person = { id: "d", lang: "en", stage: "ready", details: { checkedBags: 0 }, boardingPasses: { ZZ1234: { boardingTime: "14:20", gate: "12" } }, trip: { legs: [{ flight: "ZZ1234" }] } } as unknown as Person;
    const early = setup(person, Date.parse("2026-11-02T19:50:00Z")); // the airline rule would remind now; the pass says 14:20 local (20:20Z)
    await early.tick();
    expect(early.sent).toHaveLength(0);
    const due = setup(person, Date.parse("2026-11-02T20:06:00Z"));
    await due.tick();
    expect((due.sent[0] as { text: string }).text).toMatch(/Your boarding pass says boarding starts at 14:20\. The pass says gate 12, but it is now 17/);
  });
});

describe("immigration card before the flight", () => {
  it("goes out once with the boarding reminder of the flight into a US connection, only inside the window", async () => {
    const intl = { ...first, origin: { iata: "MEX", icao: "MMMX", timezone: "America/Mexico_City" } } as FlightSnapshot;
    const trip = { bookingRef: null, legs: [
      { flight: "ZZ1234", date: "2026-11-02", from: "MEX", to: "ORD", dep_local: "14:50", arr_local: "17:15" },
      { flight: "ZZ567", date: "2026-11-02", from: "ORD", to: "YUL", dep_local: "19:30", arr_local: "22:40" },
    ] };
    const person = { id: "a", lang: "es", stage: "ready", details: { checkedBags: 0 }, trip } as unknown as Person;
    const sent: OutboundMessage[] = [];
    let open = false;
    const tick = createBoardingReminders({
      feed: { findByIdent: (i) => (i === "ZZ1234" ? intl : second), now: () => Date.parse("2026-11-02T20:00:00Z") },
      people: () => [person], send: async (_to, m) => void sent.push(m), windowOpen: () => open, cityOf: () => "Ciudad de México",
    });
    await tick();
    expect(sent.some((m) => "text" in m && m.text.startsWith("🛂"))).toBe(false);
    open = true;
    await tick();
    await tick();
    const cards = sent.filter((m) => "text" in m && m.text.startsWith("🛂"));
    expect(cards).toHaveLength(1);
    expect((cards[0] as { text: string }).text).toContain("📋 I am only connecting: today I fly on to Montreal on flight ZZ 567.");
  });

  it("reads each card aloud after the text, once, in the officer's language", async () => {
    const intl = { ...first, origin: { iata: "MEX", icao: "MMMX", timezone: "America/Mexico_City" } } as FlightSnapshot;
    const trip = { bookingRef: null, legs: [
      { flight: "ZZ1234", date: "2026-11-02", from: "MEX", to: "ORD", dep_local: "14:50", arr_local: "17:15" },
      { flight: "ZZ567", date: "2026-11-02", from: "ORD", to: "YUL", dep_local: "19:30", arr_local: "22:40" },
    ] };
    const person = { id: "a", lang: "es", stage: "ready", details: { checkedBags: 0 }, trip } as unknown as Person;
    const sent: OutboundMessage[] = [];
    const spoken: string[] = [];
    const tick = createBoardingReminders({
      feed: { findByIdent: (i) => (i === "ZZ1234" ? intl : second), now: () => Date.parse("2026-11-02T20:00:00Z") },
      people: () => [person], send: async (_to, m) => void sent.push(m), windowOpen: () => true, cityOf: () => "Ciudad de México",
      speak: async (text, lang) => (spoken.push(`${lang}: ${text}`), new Uint8Array([1, 2, 3])),
    });
    await tick();
    await tick();
    await new Promise((r) => setTimeout(r, 10));
    const card = sent.find((m) => "text" in m && m.text.startsWith("🛂")) as { text: string };
    expect(card.text).toContain("🔊 Abajo te mando la tarjeta en audio");
    expect(spoken).toEqual(["en: I am only connecting: today I fly on to Montreal on flight ZZ 567."]);
    expect(sent.filter((m) => m.kind === "voice")).toHaveLength(1);
    expect(sent.findIndex((m) => m.kind === "voice")).toBeGreaterThan(sent.indexOf(card as OutboundMessage));
  });
});

