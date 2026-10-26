import type { TripFacts } from "@escala/rights";

export interface Leg {
  flight: string; // "ZZ1234"
  date: string; // YYYY-MM-DD, local date of departure
  from: string; // IATA
  to: string; // IATA
  dep_local: string; // HH:MM
  arr_local: string; // HH:MM
}

export interface Trip {
  bookingRef: string | null;
  legs: Leg[];
}

interface Airport {
  city: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
}

/** Airports used by the demo and the evaluation set. Coordinates are public reference data (approximate). */
export const AIRPORTS: Record<string, Airport> = {
  AUS: { city: "Austin", country: "US", lat: 30.197, lon: -97.666 },
  ORD: { city: "Chicago O'Hare", country: "US", lat: 41.974, lon: -87.907 },
  DEN: { city: "Denver", country: "US", lat: 39.856, lon: -104.674 },
  ELP: { city: "El Paso", country: "US", lat: 31.807, lon: -106.378 },
  JFK: { city: "New York JFK", country: "US", lat: 40.641, lon: -73.778 },
  YUL: { city: "Montreal", country: "CA", lat: 45.47, lon: -73.741 },
  YYZ: { city: "Toronto", country: "CA", lat: 43.677, lon: -79.624 },
  YVR: { city: "Vancouver", country: "CA", lat: 49.195, lon: -123.18 },
  MEX: { city: "Mexico City", country: "MX", lat: 19.436, lon: -99.072 },
  MAD: { city: "Madrid", country: "ES", lat: 40.498, lon: -3.567 },
  LIS: { city: "Lisbon", country: "PT", lat: 38.774, lon: -9.134 },
  CDG: { city: "Paris CDG", country: "FR", lat: 49.01, lon: 2.548 },
  NCE: { city: "Nice", country: "FR", lat: 43.658, lon: 7.216 },
  LHR: { city: "London Heathrow", country: "GB", lat: 51.47, lon: -0.454 },
};

/** Fictitious airlines of the demo. Real airlines are never named in this repository. */
export const AIRLINES: Record<string, { country: string; eu261Carrier: boolean; apprSize: "large" | "small" }> = {
  ZZ: { country: "US", eu261Carrier: false, apprSize: "large" },
  ZY: { country: "FR", eu261Carrier: true, apprSize: "large" },
  ZX: { country: "CA", eu261Carrier: false, apprSize: "large" },
};

/** Countries where Regulation 261/2004 applies to departures (EU, plus EEA and Switzerland by agreement). */
const EU261_AREA = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS NO LI CH".split(" "),
);

export function greatCircleKm(a: string, b: string): number | undefined {
  const p = AIRPORTS[a];
  const q = AIRPORTS[b];
  if (!p || !q) return undefined;
  const rad = Math.PI / 180;
  const h =
    Math.sin(((q.lat - p.lat) * rad) / 2) ** 2 +
    Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(((q.lon - p.lon) * rad) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

/**
 * Splits a trip into journeys: consecutive legs with less than 24 hours on the ground are one journey
 * (a connection); a longer stop is the destination. Rights are measured per journey.
 */
export function journeys(trip: Trip): Leg[][] {
  const out: Leg[][] = [];
  for (const leg of trip.legs) {
    const last = out.at(-1)?.at(-1);
    const gapH = last ? (Date.parse(`${leg.date}T${leg.dep_local}`) - Date.parse(`${last.date}T${last.arr_local}`)) / 3.6e6 : Infinity;
    if (last && last.to === leg.from && gapH < 24) out.at(-1)!.push(leg);
    else out.push([leg]);
  }
  return out;
}

/** The facts the rights engine needs, for the journey that contains `flight`. Unknowns stay undefined. */
export function factsFor(trip: Trip, flight: string): TripFacts {
  const j = journeys(trip).find((js) => js.some((l) => norm(l.flight) === norm(flight)));
  if (!j) return {};
  const leg = j.find((l) => norm(l.flight) === norm(flight))!;
  const first = j[0]!;
  const last = j.at(-1)!;
  const country = (iata: string) => AIRPORTS[iata]?.country;
  const airline = AIRLINES[norm(leg.flight).slice(0, 2)];
  const countries = new Set(j.flatMap((l) => [country(l.from), country(l.to)]));
  const facts: TripFacts = {
    as_of: leg.date,
    itinerary_type: countries.size > 1 ? "international" : "domestic",
  };
  const set = (k: string, v: string | number | boolean | undefined) => {
    if (v !== undefined) facts[k] = v;
  };
  set("origin_country", country(first.from));
  set("destination_country", country(leg.to));
  set("final_destination_country", country(last.to));
  set("origin_in_eu261_area", country(first.from) ? EU261_AREA.has(country(first.from)!) : undefined);
  set("destination_in_eu261_area", country(last.to) ? EU261_AREA.has(country(last.to)!) : undefined);
  set("operating_carrier", norm(leg.flight).slice(0, 2));
  set("operating_carrier_country", airline?.country);
  set("carrier_is_eu261_carrier", airline?.eu261Carrier);
  set("carrier_size_appr", airline?.apprSize);
  set("distance_km", greatCircleKm(first.from, last.to));
  const ca = [country(first.from), country(last.to)];
  set("intra_eu261", ca.every((c) => c !== undefined && EU261_AREA.has(c)));
  return facts;
}

export const norm = (flight: string) => flight.replace(/\s+/g, "").toUpperCase();
