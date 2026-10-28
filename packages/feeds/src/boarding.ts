import type { FlightSnapshot } from "./types.ts";

/**
 * Boarding rules the airlines publish on their own sites (read 2026-10-28). Most publish when the gate or door closes,
 * or by when you must be at the gate; few publish when boarding starts. Escala says only what the airline published.
 * Minutes are before scheduled departure; `intl` overrides for international flights.
 */
export interface BoardingRule {
  airline: string;
  /** Boarding starts this long before departure; with `startsLatestMin`, the early end of a published range. */
  startsMin?: number;
  startsLatestMin?: number;
  gateByMin?: number;
  closesMin?: number;
  intl?: { startsMin?: number; gateByMin?: number; closesMin?: number };
  url: string;
  checkedOn: string;
  /** The demo's fictitious airline: an example rule, labelled as such. */
  example?: boolean;
}

export const BOARDING: Record<string, BoardingRule> = {
  UA: { airline: "United", startsMin: 50, startsLatestMin: 40, closesMin: 15, url: "https://www.united.com/en/us/fly/travel/airport/boarding-process.html", checkedOn: "2026-10-28" },
  AA: { airline: "American", closesMin: 15, url: "https://www.aa.com/i18n/travel-info/boarding-process.jsp", checkedOn: "2026-10-28" },
  DL: { airline: "Delta", gateByMin: 15, intl: { gateByMin: 45 }, url: "https://www.delta.com/us/en/check-in-security/check-in-time-requirements/domestic-check-in", checkedOn: "2026-10-28" },
  WN: { airline: "Southwest", gateByMin: 10, url: "https://support.southwest.com/helpcenter/s/article/online-checkin", checkedOn: "2026-10-28" },
  AS: { airline: "Alaska", gateByMin: 30, url: "https://www.alaskaair.com/content/legal/contract-of-carriage/view-all", checkedOn: "2026-10-28" },
  B6: { airline: "JetBlue", closesMin: 15, intl: { closesMin: 20 }, url: "https://www.jetblue.com/help/boarding-procedures", checkedOn: "2026-10-28" },
  F9: { airline: "Frontier", startsMin: 45, closesMin: 20, url: "https://faq.flyfrontier.com/help/airport-information-what-times-do-i-need-to-keep-in-mind-to-ensure-i-make-my-flight", checkedOn: "2026-10-28" },
  AC: { airline: "Air Canada", gateByMin: 30, closesMin: 15, intl: { gateByMin: 45, closesMin: 15 }, url: "https://www.aircanada.com/ca/en/aco/home/plan/check-in-information/check-in-and-boarding-times.html", checkedOn: "2026-10-28" },
  WS: { airline: "WestJet", gateByMin: 60, closesMin: 15, url: "https://www.westjet.com/en-ca/legal/travel-terms-conditions/westjet-flights", checkedOn: "2026-10-28" },
  TS: { airline: "Air Transat", closesMin: 15, url: "https://www.airtransat.com/en-US/travel-information/airports-and-check-in/airport-information/airport-check-in-times", checkedOn: "2026-10-28" },
  ZZ: { airline: "ZZ", startsMin: 40, closesMin: 15, url: "", checkedOn: "", example: true },
};

/**
 * When the airline publishes nothing: the ranges two large airlines publish for "most flights" (read 2026-10-28: American
 * 30-50 min, United 40-50). It is a typical range, not this airline's rule, and is said as such.
 */
export const TYPICAL_BOARDING = {
  fromMin: 30,
  toMin: 50,
  sources: ["https://www.aa.com/i18n/travel-info/boarding-process.jsp", "https://www.united.com/en/us/fly/travel/airport/boarding-process.html"],
  checkedOn: "2026-10-28",
};

/** Without any published rule, the reminder comes ahead of the early end of the typical range. */
const DEFAULT_LEAD_MIN = 60;
/** Margin before the earliest published moment (boarding starts, or be at the gate), to walk there. */
const WALK_MARGIN_MIN = 15;


const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** International when the two airports' ICAO prefixes say different countries (K = US, C = Canada, MM = Mexico...). */
export function international(s: FlightSnapshot): boolean {
  const country = (icao: string | null) => (!icao ? null : /^[KC]/.test(icao) ? icao[0] : icao.slice(0, 2));
  const a = country(s.origin.icao);
  const b = country(s.destination.icao);
  return Boolean(a && b && a !== b);
}

export function ruleFor(s: FlightSnapshot): { rule: BoardingRule; startsMin?: number; startsLatestMin?: number; gateByMin?: number; closesMin?: number } | null {
  const rule = BOARDING[(s.operator ?? norm(s.ident).slice(0, 2)).toUpperCase()];
  if (!rule) return null;
  const o = international(s) ? { ...rule, ...rule.intl } : rule;
  return { rule, ...(o.startsMin ? { startsMin: o.startsMin } : {}), ...(o.startsLatestMin ? { startsLatestMin: o.startsLatestMin } : {}), ...(o.gateByMin ? { gateByMin: o.gateByMin } : {}), ...(o.closesMin ? { closesMin: o.closesMin } : {}) };
}

/** When to remind: ahead of the earliest moment the airline publishes, or an hour before departure. */
export function remindAt(s: FlightSnapshot): number | null {
  const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
  if (!Number.isFinite(dep)) return null;
  const r = ruleFor(s);
  const earliest = r ? Math.max(r.startsMin ?? 0, r.gateByMin ?? 0) : TYPICAL_BOARDING.toMin;
  return dep - Math.max(DEFAULT_LEAD_MIN, earliest + WALK_MARGIN_MIN) * 60_000;
}

