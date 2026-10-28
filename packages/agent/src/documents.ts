import { AIRPORTS, type Trip } from "./trip.ts";
import { legInstant } from "./whereabouts.ts";

/**
 * Entry and transit documents by passport and country. Every rule carries the official page it comes from, the words
 * that support it and the day it was read; Escala never states a requirement that is not here. A pair that is not
 * covered is said to be not covered, with the country's official page.
 */
export interface DocRule {
  id: string;
  /** Passport country (ISO 3166-1 alpha-2), or "EU" for any EU passport. */
  passport: string;
  /** Country where it applies (ISO 3166-1 alpha-2). */
  country: string;
  role: "entry" | "transit" | "both";
  requirement: string;
  conditions?: string;
  url: string;
  quote: string;
  checked_on: string;
  status: "VERIFICADO" | "NO_VERIFICADO";
  /** Announced but not in force yet: from this date. */
  in_force_from?: string;
}

export const DOC_RULES: DocRule[] = [];

const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

/** Where each country publishes its entry rules, for pairs the table does not cover. */
export const OFFICIAL_PAGES: Record<string, string> = {
  US: "https://travel.state.gov/content/travel/en/us-visas.html",
  CA: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html",
  MX: "https://www.gob.mx/inm",
};

/** A trip crosses borders when any flight lands in a country other than where the trip starts. */
export function tripCountries(trip: Trip | undefined): { start: string | null; touched: Array<{ country: string; role: "entry" | "transit"; airport: string }> } {
  const legs = trip?.legs ?? [];
  const country = (iata: string) => AIRPORTS[iata]?.country ?? null;
  const start = legs[0] ? country(legs[0].from) : null;
  const touched: Array<{ country: string; role: "entry" | "transit"; airport: string }> = [];
  legs.forEach((l, i) => {
    const c = country(l.to);
    if (!c || c === start) return;
    const next = legs[i + 1];
    // A connection: the next flight leaves from the same airport within a day of landing.
    const landed = legInstant(l.date, l.arr_local, l.to);
    const leaves = next ? legInstant(next.date, next.dep_local, next.from) : NaN;
    const transit = Boolean(next && next.from === l.to && Number.isFinite(landed) && leaves - landed >= 0 && leaves - landed < 24 * 3600_000 && country(next.to) !== c);
    if (!touched.some((t) => t.country === c && t.role === (transit ? "transit" : "entry"))) touched.push({ country: c, role: transit ? "transit" : "entry", airport: l.to });
  });
  return { start, touched };
}

export function crossesBorder(trip: Trip | undefined): boolean {
  return tripCountries(trip).touched.length > 0;
}

/** What the table says for this passport in each country the trip touches. */
export function documentsFor(passport: string, trip: Trip | undefined, rules: DocRule[] = DOC_RULES) {
  const pp = passport.toUpperCase();
  return tripCountries(trip).touched.map(({ country, role, airport }) => {
    if (country === pp) return { country, role, airport, own_country: true, rules: [], covered: true };
    const found = rules.filter(
      (r) => r.country === country && (r.passport === pp || (r.passport === "EU" && EU.has(pp))) && (r.role === role || r.role === "both"),
    );
    return {
      country,
      role,
      airport,
      own_country: false,
      covered: found.length > 0,
      rules: found.map(({ requirement, conditions, url, quote, checked_on, status, in_force_from }) => ({ requirement, conditions, url, quote, checked_on, status, in_force_from })),
      official_page: found.length ? undefined : OFFICIAL_PAGES[country],
    };
  });
}

/** The passport written down by set_passport, as kept in memory ("passport: MX"). */
export function passportFromStatement(statement: string): string | null {
  return statement.match(/passport:\s*([A-Z]{2})\b/)?.[1] ?? null;
}
