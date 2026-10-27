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
  private readonly opts: { secondsPerMinute: number; detector?: DetectorOptions };

  constructor(scenario: Scenario, opts: { secondsPerMinute: number; detector?: DetectorOptions }) {
    this.scenario = scenario;
    this.opts = opts;
    this.feed = this.fresh();
  }

  /** The flight numbers this scenario plays, e.g. "ZZ1234". */
  idents(): string[] {
    return this.scenario.flights.map((f) => f.ident.replace(/\s+/g, "").toUpperCase());
  }

  restart() {
    this.stop();
    this.feed = this.fresh();
    this.minute = 0;
    const last = Math.max(0, ...this.scenario.steps.map((s) => s.minute));
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
    const f = new ReplayFeed(this.scenario, this.opts.detector ?? {});
    f.subscribe((events, snap) => {
      for (const l of this.listeners) l(events, snap);
    });
    return f;
  }
}
