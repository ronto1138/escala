/**
 * Spending limits. Every message costs model calls, so nobody can make the service spend without bound: each person
 * has an hourly allowance (lower for photos and voice notes, which cost more), and the whole service has a daily
 * budget in USD. When a limit is reached, messages are dropped (logged, not answered) until it resets.
 */
export class Budget {
  private readonly hits = new Map<string, number[]>();
  private readonly media = new Map<string, number[]>();
  private day = "";
  private spent = 0;
  private readonly opts: { perPersonHour: number; mediaPerPersonHour: number; dailyUsd: number; now: () => number };

  constructor(opts: { perPersonHour: number; mediaPerPersonHour: number; dailyUsd: number; now?: () => number }) {
    this.opts = { now: Date.now, ...opts };
  }

  /** Counts the message against the person's allowance when `count` is true; false only checks. */
  allow(person: string, kind: "text" | "media", count = true): boolean {
    this.rollDay();
    if (this.spent >= this.opts.dailyUsd) return false;
    const now = this.opts.now();
    const recent = (m: Map<string, number[]>) => (m.get(person) ?? []).filter((t) => now - t < 3_600_000);
    const all = recent(this.hits);
    const med = recent(this.media);
    if (all.length >= this.opts.perPersonHour || (kind === "media" && med.length >= this.opts.mediaPerPersonHour)) return false;
    if (count) {
      this.hits.set(person, [...all, now]);
      if (kind === "media") this.media.set(person, [...med, now]);
      if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value!);
      if (this.media.size > 10_000) this.media.delete(this.media.keys().next().value!);
    }
    return true;
  }

  spend(usd: number) {
    this.rollDay();
    this.spent += Number.isFinite(usd) ? usd : 0;
  }

  why(person: string): string {
    this.rollDay();
    if (this.spent >= this.opts.dailyUsd) return "daily budget";
    return `hourly limit (${(this.hits.get(person) ?? []).length})`;
  }

  private rollDay() {
    const today = new Date(this.opts.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }
}
