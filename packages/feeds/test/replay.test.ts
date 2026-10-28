import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { arrivalMinutesLate, loadScenario, ReplayFeed, type FlightEvent } from "../src/index.ts";

const scenario = (name: string) => loadScenario(fileURLToPath(new URL(`../scenarios/${name}.yaml`, import.meta.url)));
const AUS_ORD = "ZZ1234-20261102-replay-0002";

function collect(feed: ReplayFeed) {
  const events: FlightEvent[] = [];
  feed.subscribe((e) => events.push(...e));
  return events;
}

describe("demo scenario: inbound aircraft late", () => {
  it("infers the delay from the inbound aircraft before the airline says so, and labels it", () => {
    const feed = new ReplayFeed(scenario("demo-inbound-late"));
    const events = collect(feed);

    feed.advanceTo(20);
    expect(events).toHaveLength(2); // the inbound flight's own delay, and the inference on ZZ1234
    const inference = events.find((e) => e.kind === "inbound_late");
    expect(inference).toMatchObject({
      kind: "inbound_late",
      flightId: AUS_ORD,
      inference: true,
      likelyDepartureDelayMinutes: 100, // lands 14:05 + 45 min turn = 14:50 vs 13:10 scheduled
    });
    expect(feed.getFlight(AUS_ORD)?.departure.estimated).toBe("2026-11-02T13:10:00Z"); // airline has not moved it
  });

  it("reports the airline's own update as a fact, then the gate assigned and the gate change", () => {
    const feed = new ReplayFeed(scenario("demo-inbound-late"));
    const events = collect(feed);
    feed.advanceTo(20);
    events.length = 0;

    feed.advanceTo(60);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "arrival_delay_change", flightId: AUS_ORD, inference: false, minutesLate: 100 }),
    );
    expect(events.filter((e) => e.kind === "inbound_late")).toHaveLength(0); // same inference, not repeated

    events.length = 0;
    feed.advanceTo(75);
    expect(events).toEqual([expect.objectContaining({ kind: "gate_change", side: "departure", from: null, to: "K14" })]); // the connection gets its gate

    events.length = 0;
    feed.advanceTo(90);
    expect(events).toEqual([expect.objectContaining({ kind: "gate_change", side: "departure", from: "12", to: "17" })]);
    expect(arrivalMinutesLate(feed.getFlight(AUS_ORD)!)).toBe(100);
  });

  it("stamps every snapshot with the time it was observed", () => {
    const feed = new ReplayFeed(scenario("demo-inbound-late"));
    feed.advanceTo(60);
    expect(feed.getFlight(AUS_ORD)?.observedAt).toBe("2026-11-02T12:00:00Z");
  });
});

describe("quiet scenario", () => {
  it("raises no alerts for small drifts (zero false alarms)", () => {
    const feed = new ReplayFeed(scenario("quiet-on-time"));
    const events = collect(feed);
    feed.advanceTo(240);
    expect(events).toEqual([]);
  });
});

describe("demo scenario: Mexico City to Montreal through O'Hare", () => {
  it("foresees the delay from the aircraft coming from Cancun before the airline says so", () => {
    const feed = new ReplayFeed(scenario("demo-mex-ord-yul"));
    const events = collect(feed);
    feed.advanceTo(20);
    expect(events).toContainEqual(expect.objectContaining({ kind: "inbound_late", likelyDepartureDelayMinutes: 70, minTurnMinutes: 22, inference: true }));
    events.length = 0;
    feed.advanceTo(60);
    expect(events).toContainEqual(expect.objectContaining({ kind: "arrival_delay_change", minutesLate: 70, inference: false }));
    events.length = 0;
    feed.advanceTo(90);
    expect(events.map((e) => e.kind)).toEqual(["gate_change", "gate_change"]); // the connection's gate, then the change in Mexico City
  });
});
