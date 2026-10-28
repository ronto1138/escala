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
  tz: string; // IANA time zone
  /** The city as written in Spanish and French, when it differs from English. */
  names?: { es?: string; fr?: string };
}

/** The airport's city in the person's language; the code itself when the airport is unknown. */
export function cityName(iata: string, lang: "en" | "es" | "fr"): string {
  const a = AIRPORTS[iata];
  if (!a) return iata;
  return (lang !== "en" && a.names?.[lang]) || a.city;
}

/** Airports used by the demo and the evaluation set. Coordinates are public reference data (approximate). */
export const AIRPORTS: Record<string, Airport> = {
  AUS: { city: "Austin", country: "US", lat: 30.197, lon: -97.666, tz: "America/Chicago" },
  ORD: { city: "Chicago O'Hare", country: "US", lat: 41.974, lon: -87.907, tz: "America/Chicago" },
  DEN: { city: "Denver", country: "US", lat: 39.856, lon: -104.674, tz: "America/Denver" },
  ELP: { city: "El Paso", country: "US", lat: 31.807, lon: -106.378, tz: "America/Denver" },
  JFK: { city: "New York JFK", country: "US", lat: 40.641, lon: -73.778, tz: "America/New_York", names: { es: "Nueva York JFK", fr: "New York JFK" } },
  YUL: { city: "Montreal", country: "CA", lat: 45.47, lon: -73.741, tz: "America/Toronto", names: { es: "Montreal", fr: "Montréal" } },
  YYZ: { city: "Toronto", country: "CA", lat: 43.677, lon: -79.624, tz: "America/Toronto" },
  YVR: { city: "Vancouver", country: "CA", lat: 49.195, lon: -123.18, tz: "America/Vancouver" },
  MEX: { city: "Mexico City", country: "MX", lat: 19.436, lon: -99.072, tz: "America/Mexico_City", names: { es: "Ciudad de México", fr: "Mexico" } },
  MAD: { city: "Madrid", country: "ES", lat: 40.498, lon: -3.567, tz: "Europe/Madrid" },
  LIS: { city: "Lisbon", country: "PT", lat: 38.774, lon: -9.134, tz: "Europe/Lisbon", names: { es: "Lisboa", fr: "Lisbonne" } },
  CDG: { city: "Paris CDG", country: "FR", lat: 49.01, lon: 2.548, tz: "Europe/Paris", names: { es: "París Charles de Gaulle", fr: "Paris-Charles-de-Gaulle" } },
  NCE: { city: "Nice", country: "FR", lat: 43.658, lon: 7.216, tz: "Europe/Paris", names: { es: "Niza", fr: "Nice" } },
  LHR: { city: "London Heathrow", country: "GB", lat: 51.47, lon: -0.454, tz: "Europe/London", names: { es: "Londres Heathrow", fr: "Londres Heathrow" } },
  ATL: { city: "Atlanta", country: "US", lat: 33.64, lon: -84.427, tz: "America/New_York" },
  BOS: { city: "Boston", country: "US", lat: 42.366, lon: -71.01, tz: "America/New_York" },
  DFW: { city: "Dallas/Fort Worth", country: "US", lat: 32.9, lon: -97.04, tz: "America/Chicago" },
  IAH: { city: "Houston", country: "US", lat: 29.99, lon: -95.337, tz: "America/Chicago" },
  LAX: { city: "Los Angeles", country: "US", lat: 33.942, lon: -118.408, tz: "America/Los_Angeles" },
  LGA: { city: "New York LaGuardia", country: "US", lat: 40.777, lon: -73.872, tz: "America/New_York", names: { es: "Nueva York LaGuardia", fr: "New York LaGuardia" } },
  MIA: { city: "Miami", country: "US", lat: 25.796, lon: -80.287, tz: "America/New_York" },
  MSP: { city: "Minneapolis", country: "US", lat: 44.885, lon: -93.222, tz: "America/Chicago" },
  PHX: { city: "Phoenix", country: "US", lat: 33.435, lon: -112.008, tz: "America/Phoenix" },
  SEA: { city: "Seattle", country: "US", lat: 47.45, lon: -122.309, tz: "America/Los_Angeles" },
  SFO: { city: "San Francisco", country: "US", lat: 37.621, lon: -122.379, tz: "America/Los_Angeles" },
  YQB: { city: "Quebec City", country: "CA", lat: 46.791, lon: -71.393, tz: "America/Toronto", names: { es: "Quebec", fr: "Québec" } },
  YYC: { city: "Calgary", country: "CA", lat: 51.131, lon: -114.01, tz: "America/Edmonton" },
  CUN: { city: "Cancun", country: "MX", lat: 21.037, lon: -86.877, tz: "America/Cancun" },
  GDL: { city: "Guadalajara", country: "MX", lat: 20.522, lon: -103.311, tz: "America/Mexico_City" },
  MID: { city: "Merida", country: "MX", lat: 20.937, lon: -89.658, tz: "America/Merida" },
  MTY: { city: "Monterrey", country: "MX", lat: 25.778, lon: -100.107, tz: "America/Monterrey" },
  TIJ: { city: "Tijuana", country: "MX", lat: 32.541, lon: -116.97, tz: "America/Tijuana" },
  BCN: { city: "Barcelona", country: "ES", lat: 41.297, lon: 2.078, tz: "Europe/Madrid", names: { es: "Barcelona", fr: "Barcelone" } },
  FCO: { city: "Rome Fiumicino", country: "IT", lat: 41.8, lon: 12.239, tz: "Europe/Rome", names: { es: "Roma Fiumicino", fr: "Rome Fiumicino" } },
};

/** Fictitious airlines of the demo. Real airlines are never named in this repository. */
export type Airlines = Record<string, { country: string; eu261Carrier: boolean; apprSize?: "large" | "small" }>;

export const AIRLINES: Airlines = {
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
export function factsFor(trip: Trip, flight: string, airlines: Airlines = AIRLINES): TripFacts {
  const j = journeys(trip).find((js) => js.some((l) => norm(l.flight) === norm(flight)));
  if (!j) return {};
  const leg = j.find((l) => norm(l.flight) === norm(flight))!;
  const first = j[0]!;
  const last = j.at(-1)!;
  const country = (iata: string) => AIRPORTS[iata]?.country;
  const airline = airlines[norm(leg.flight).slice(0, 2)];
  const all = j.flatMap((l) => [country(l.from), country(l.to)]);
  const countries = new Set(all.filter(Boolean));
  const facts: TripFacts = { as_of: leg.date };
  // An unknown airport makes the itinerary type unknown, never a guess.
  if (all.every(Boolean)) facts.itinerary_type = countries.size > 1 ? "international" : "domestic";
  else if (countries.size > 1) facts.itinerary_type = "international";
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
  set("carrier_is_uk_or_eu_carrier", airline ? airline.eu261Carrier || airline.country === "GB" : undefined);
  set("leg_origin_country", country(leg.from));
  set("connection", j.length > 1);
  set("distance_km", greatCircleKm(first.from, last.to));
  const ca = [country(first.from), country(last.to)];
  set("intra_eu261", ca.every((c) => c !== undefined && EU261_AREA.has(c)));
  return facts;
}

export const norm = (flight: string) => flight.replace(/\s+/g, "").toUpperCase();
