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
