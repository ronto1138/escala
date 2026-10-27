import type { DetectorOptions } from "./detector.ts";
import { ReplayFeed, type FlightFeed, type Scenario } from "./replay.ts";
import type { FlightEvent, FlightSnapshot } from "./types.ts";

/**
 * Plays a scenario in real time, faster than life: one scenario minute every `secondsPerMinute` seconds. `restart()`
 * starts it again from minute 0, so each demo run sees the same story. Listeners stay subscribed across restarts.
 * The flights are simulated and every message built from them must say so where it matters.
 */
export class ReplayClock implements FlightFeed {
  private feed: ReplayFeed;
  private timer: ReturnType<typeof setInterval> | undefined;
  private minute = 0;
  private readonly listeners = new Set<(events: FlightEvent[], snapshot: FlightSnapshot) => void>();
  private readonly scenario: Scenario;
  /** The scenario as last started: moved in time so it begins when someone starts the demo. */
  private current: Scenario;
  private readonly opts: { secondsPerMinute: number; detector?: DetectorOptions };

  constructor(scenario: Scenario, opts: { secondsPerMinute: number; detector?: DetectorOptions }) {
    this.scenario = scenario;
    this.current = scenario;
    this.opts = opts;
    this.feed = this.fresh();
  }

  /** The flight numbers this scenario plays, e.g. "ZZ1234". */
  idents(): string[] {
    return this.scenario.flights.map((f) => f.ident.replace(/\s+/g, "").toUpperCase());
  }

  /** Starts the story again from minute 0; with `startAt`, the story's minute 0 is that moment (dates included). */
  restart(startAt?: number) {
    this.stop();
    this.current = startAt === undefined ? this.scenario : shiftScenario(this.scenario, startAt - Date.parse(this.scenario.start));
    this.feed = this.fresh();
    this.minute = 0;
    const last = Math.max(0, ...this.current.steps.map((s) => s.minute));
    this.timer = setInterval(() => {
      this.minute++;
      this.feed.advanceTo(this.minute);
      if (this.minute >= last) this.stop();
    }, this.opts.secondsPerMinute * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get running() {
    return this.timer !== undefined;
  }

  getFlight(id: string) {
    return this.feed.getFlight(id);
  }
  findByIdent(ident: string) {
    return this.feed.findByIdent(ident);
  }
  getInbound(id: string) {
    return this.feed.getInbound(id);
  }
  subscribe(cb: (events: FlightEvent[], snapshot: FlightSnapshot) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private fresh() {
    const f = new ReplayFeed(this.current, this.opts.detector ?? {});
    f.subscribe((events, snap) => {
      for (const l of this.listeners) l(events, snap);
    });
    return f;
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

/** The same story, every timestamp moved by `ms` (so a demo started on any day happens that day). */
export function shiftScenario(s: Scenario, ms: number): Scenario {
  const move = (v: unknown): unknown => {
    if (typeof v === "string" && ISO.test(v)) return new Date(Date.parse(v) + ms).toISOString().replace(".000Z", "Z");
    if (Array.isArray(v)) return v.map(move);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, move(x)]));
    return v;
  };
  return move(s) as Scenario;
}

/**
 * The traveler's legs for some of the scenario's flights, as if the story started at `startAt`: local dates and times
 * at each airport, ready to be confirmed like any itinerary.
 */
export function scenarioLegs(s: Scenario, idents: string[], startAt: number) {
  const moved = shiftScenario(s, startAt - Date.parse(s.start));
  const local = (iso: string, tz: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(iso))
        .map((x) => [x.type, x.value]),
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  };
  return idents.map((ident) => {
    const f = moved.flights.find((x) => x.ident.replace(/\s+/g, "").toUpperCase() === ident.toUpperCase());
    if (!f || !f.scheduled_out || !f.scheduled_in || !f.origin || !f.destination) throw new Error(`${ident} is not in the scenario`);
    const dep = local(f.scheduled_out, f.origin.timezone ?? "UTC");
    const arr = local(f.scheduled_in, f.destination.timezone ?? "UTC");
    const from = f.origin.code_iata ?? f.origin.code ?? "";
    const to = f.destination.code_iata ?? f.destination.code ?? "";
    return { flight: ident, date: dep.date, from, to, dep_local: dep.time, arr_local: arr.time };
  });
}

