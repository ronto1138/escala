import type { FlightSnapshot } from "./types.ts";

export interface LegRef {
  flight: string;
  from?: string;
  to?: string;
  date?: string;
  dep_local?: string;
}

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/**
 * Whether a followed flight is this leg: same number, same route and, when both say it, the same scheduled departure
 * (local date and time at the origin). Another traveler's demo story, started at another time, is not this one
 * (audit 31-oct: one shared story restarted for a newcomer gave the first traveler the newcomer's times).
 */
export function isLeg(s: FlightSnapshot, leg: LegRef): boolean {
  if (norm(s.ident) !== norm(leg.flight)) return false;
  if (leg.from && s.origin.iata && s.origin.iata !== leg.from) return false;
  if (leg.to && s.destination.iata && s.destination.iata !== leg.to) return false;
  if (!leg.date || !leg.dep_local || !s.departure.scheduled || !s.origin.timezone) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: s.origin.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(s.departure.scheduled))
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === `${leg.date}T${leg.dep_local}`;
}
