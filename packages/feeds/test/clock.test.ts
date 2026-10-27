import { scenarioLegs, shiftScenario } from "../src/clock.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { loadScenario, ReplayClock, type FlightEvent } from "../src/index.ts";

afterEach(() => vi.useRealTimers());

describe("replay clock", () => {
  it("plays the demo scenario in real time and restarts it from the beginning", () => {
    vi.useFakeTimers();
    const clock = new ReplayClock(loadScenario(fileURLToPath(new URL("../scenarios/demo-inbound-late.yaml", import.meta.url))), { secondsPerMinute: 1 });
    const kinds: string[] = [];
    clock.subscribe((events: FlightEvent[]) => kinds.push(...events.map((e) => e.kind)));
    expect(clock.idents()).toContain("ZZ1234");
    clock.restart();
    vi.advanceTimersByTime(100_000);
    expect(kinds).toContain("inbound_late");
    expect(clock.running).toBe(false); // stops after the last step
    const before = kinds.length;
    clock.restart();
    vi.advanceTimersByTime(100_000);
    expect(kinds.length).toBeGreaterThan(before); // the same story again
  });
});

describe("the demo trip happens the day it is asked for", () => {
  const scenario = loadScenario(new URL("../scenarios/demo-inbound-late.yaml", import.meta.url).pathname);

  it("moves every time, so the flights leave about two hours after the start", () => {
    const startAt = Date.parse("2026-11-06T16:00:00Z");
    const moved = shiftScenario(scenario, startAt - Date.parse(scenario.start));
    expect(moved.start).toBe("2026-11-06T16:00:00Z");
    const zz1234 = moved.flights.find((f) => f.ident === "ZZ1234")!;
    expect(zz1234.scheduled_out).toBe("2026-11-06T18:10:00Z");
  });

  it("gives the legs in local time at each airport", () => {
    const legs = scenarioLegs(scenario, ["ZZ1234", "ZZ567"], Date.parse("2026-11-06T16:00:00Z"));
    expect(legs[0]).toEqual({ flight: "ZZ1234", date: "2026-11-06", from: "AUS", to: "ORD", dep_local: "12:10", arr_local: "14:35" });
    expect(legs[1]).toMatchObject({ flight: "ZZ567", from: "ORD", to: "YUL" });
  });

  it("restarts at the given moment", () => {
    const clock = new ReplayClock(scenario, { secondsPerMinute: 60 });
    clock.restart(Date.parse("2026-11-06T16:00:00Z"));
    expect(clock.findByIdent("ZZ1234")?.departure.scheduled).toBe("2026-11-06T18:10:00Z");
    clock.stop();
  });
});
