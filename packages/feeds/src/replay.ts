import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { detect, type DetectorOptions } from "./detector.ts";
import { fromAeroFlight } from "./normalize.ts";
import type { AeroFlight, FlightEvent, FlightSnapshot } from "./types.ts";

/**
 * A scripted, fully synthetic flight timeline in the AeroAPI v4 flight shape. Each step patches the
 * flights at a given minute after `start`. Scenarios are labeled "simulated data" wherever they are shown.
 */
export interface Scenario {
  name: string;
  start: string; // ISO time of minute 0
  flights: AeroFlight[];
  steps: Array<{ minute: number; patch: Record<string, Partial<AeroFlight>> }>;
}

export function loadScenario(path: string): Scenario {
  return parse(readFileSync(path, "utf8"), { merge: true }) as Scenario;
}

export interface FlightFeed {
  getFlight(flightId: string): FlightSnapshot | undefined;
  getInbound(flightId: string): FlightSnapshot | undefined;
  subscribe(cb: (events: FlightEvent[], snapshot: FlightSnapshot) => void): () => void;
}

/**
 * Plays a scenario. Time only moves when `advanceTo` is called, so tests and the demo control it exactly.
 */
export class ReplayFeed implements FlightFeed {
  private flights = new Map<string, AeroFlight>();
  private snapshots = new Map<string, FlightSnapshot>();
  private listeners = new Set<(events: FlightEvent[], snapshot: FlightSnapshot) => void>();
  private minute = -1;
  private readonly scenario: Scenario;
  private readonly detector: DetectorOptions;

  constructor(scenario: Scenario, detector: DetectorOptions = {}) {
    this.scenario = scenario;
    this.detector = detector;
    for (const f of scenario.flights) this.flights.set(f.fa_flight_id, structuredClone(f));
    this.observeAll(this.timeAt(0), true);
    this.minute = 0;
  }

  /** Applies every step up to `minute` (inclusive) and notifies listeners of what changed. */
  advanceTo(minute: number): void {
    const due = this.scenario.steps.filter((s) => s.minute > this.minute && s.minute <= minute).sort((a, b) => a.minute - b.minute);
    for (const step of due) {
      for (const [id, patch] of Object.entries(step.patch)) {
        const f = this.flights.get(id);
        if (!f) throw new Error(`scenario "${this.scenario.name}" patches unknown flight ${id}`);
        Object.assign(f, patch);
      }
      this.observeAll(this.timeAt(step.minute), false);
    }
    this.minute = Math.max(this.minute, minute);
  }

  getFlight(flightId: string) {
    return this.snapshots.get(flightId);
  }

  getInbound(flightId: string) {
    const id = this.snapshots.get(flightId)?.inboundFlightId;
    return id ? this.snapshots.get(id) : undefined;
  }

  subscribe(cb: (events: FlightEvent[], snapshot: FlightSnapshot) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private observeAll(at: string, initial: boolean) {
    const next = new Map<string, FlightSnapshot>();
    for (const f of this.flights.values()) next.set(f.fa_flight_id, fromAeroFlight(f, at, "replay"));
    const old = this.snapshots;
    this.snapshots = next; // commit before notifying, so listeners read the new state
    for (const [id, snap] of next) {
      if (initial) continue;
      const inboundId = snap.inboundFlightId;
      const inbound = inboundId ? { curr: next.get(inboundId), prev: old.get(inboundId) } : {};
      const events = detect(old.get(id), snap, inbound, this.detector);
      if (events.length) for (const l of this.listeners) l(events, snap);
    }
  }

  private timeAt(minute: number) {
    return new Date(Date.parse(this.scenario.start) + minute * 60_000).toISOString().replace(".000Z", "Z");
  }
}
