import type { Lang, SharedLocation } from "@escala/conversation";
import { AIRPORTS, type Trip } from "./trip.ts";

/** A shared location is used for this moment only: after two hours Escala asks for a fresh one. */
export const LOCATION_TTL_MS = 2 * 60 * 60 * 1000;

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The trip's airport closest to the person, with the distance; the trip's places come first because they matter. */
export function nearestTripAirport(loc: SharedLocation, trip: Trip | undefined): { iata: string; city: string; km: number } | null {
  const codes = new Set((trip?.legs ?? []).flatMap((l) => [l.from, l.to]));
  let best: { iata: string; city: string; km: number } | null = null;
  for (const code of codes) {
    const a = AIRPORTS[code];
    if (!a) continue;
    const d = km(loc.lat, loc.lon, a.lat, a.lon);
    if (!best || d < best.km) best = { iata: code, city: a.city, km: Math.round(d * 10) / 10 };
  }
  return best;
}

/**
 * Where the person is, in words for the models: coordinates rounded to about ten meters, the place name WhatsApp sent
 * if they picked one, and the trip airport it is near ("at the airport" within 3 km).
 */
export function describeLocation(loc: SharedLocation, trip: Trip | undefined, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(loc.at)) / 60000));
  const near = nearestTripAirport(loc, trip);
  const where =
    near && near.km <= 3
      ? `at or next to ${near.city} airport (${near.iata})`
      : near && near.km <= 80
        ? `about ${near.km} km from ${near.city} airport (${near.iata}), so in or around ${near.city}`
        : "away from the trip's airports";
  return `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}${loc.name ? ` ("${loc.name}")` : ""}, ${where}, shared ${minutes} min ago`;
}

export function locationIsFresh(loc: SharedLocation | undefined, now: number): loc is SharedLocation {
  return Boolean(loc) && now - Date.parse(loc!.at) < LOCATION_TTL_MS;
}

/**
 * Said before a web search (10–16 s), only then. The model usually writes its own line about what it is checking;
 * these are the fallback, never the same one twice in a row for a person.
 */
export const CHECKING: Record<Lang, string[]> = {
  en: [
    "Let me look that up, one moment.",
    "Checking that for you, give me a few seconds.",
    "Good question. Looking into it now.",
    "Hang on, I'm finding the current details.",
    "On it. This takes a few seconds.",
    "Let me check the latest on that.",
    "Give me a moment to find a reliable source.",
    "Looking it up so I don't guess.",
  ],
  es: [
    "Déjame revisarlo, un momento.",
    "Lo busco y te digo en unos segundos.",
    "Buena pregunta, ya lo estoy checando.",
    "Dame unos segundos, busco la información al día.",
    "Voy, esto tarda poquito.",
    "Déjame ver qué hay de eso ahorita.",
    "Un momento, busco una fuente confiable.",
    "Lo reviso para no adivinarte.",
  ],
  fr: [
    "Je vérifie, un instant.",
    "Je regarde ça pour vous, quelques secondes.",
    "Bonne question, je cherche tout de suite.",
    "Un moment, je trouve les informations à jour.",
    "Je m'en occupe, ça prend quelques secondes.",
    "Laissez-moi voir ce qu'il en est.",
    "Un instant, je cherche une source fiable.",
    "Je vérifie plutôt que de deviner.",
  ],
};

export function createChecking(random: () => number = Math.random) {
  const last = new Map<string, number>();
  return (personId: string, lang: Lang): string => {
    const pool = CHECKING[lang];
    let i = Math.floor(random() * pool.length);
    if (i === last.get(personId)) i = (i + 1) % pool.length;
    last.set(personId, i);
    if (last.size > 5000) last.delete(last.keys().next().value!);
    return pool[i]!;
  };
}

/** The model's own line before a search is used only if it is short, has no figures and is not a question. */
export function usableCheckingLine(text: string): boolean {
  const t = text.trim();
  return t.length >= 8 && t.length <= 160 && !/\d/.test(t) && !t.includes("?") && !/https?:/.test(t);
}

/** A local date and time at an airport ("2026-11-02", "07:10") as a UTC instant; NaN when the airport is unknown. */
export function legInstant(date: string, time: string, iata: string): number {
  const tz = AIRPORTS[iata]?.tz;
  if (!tz || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const guess = Date.parse(`${date}T${time}:00Z`);
  // The zone's offset at that moment, read back from Intl; twice, so a guess across a DST change settles.
  let at = guess;
  for (let i = 0; i < 2; i++) at = guess - offsetMs(tz, at);
  return at;
}

function offsetMs(tz: string, at: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - Math.floor(at / 1000) * 1000;
}

/**
 * Where the traveler most likely is right now, from the shared location if it is fresh and near the trip, otherwise from
 * the itinerary and the clock: before the first flight, between flights, in the air, or after the last one.
 * WhatsApp does not tell us the phone's time zone, so the airport's zone stands in for it.
 */
export function whereNow(trip: Trip | undefined, now: number, loc?: SharedLocation): { iata: string; city: string; tz: string; why: string } | null {
  if (loc && locationIsFresh(loc, now)) {
    const near = nearestTripAirport(loc, trip);
    if (near && near.km <= 80) return { iata: near.iata, city: near.city, tz: AIRPORTS[near.iata]!.tz, why: "from the location they shared" };
  }
  const legs = (trip?.legs ?? [])
    .map((l) => {
      const dep = legInstant(l.date, l.dep_local, l.from);
      let arr = legInstant(l.date, l.arr_local, l.to);
      if (arr < dep) arr += 24 * 60 * 60 * 1000; // lands the next day
      return { l, dep, arr };
    })
    .filter((x) => Number.isFinite(x.dep))
    .sort((a, b) => a.dep - b.dep);
  if (!legs.length) return null;
  const at = (iata: string, why: string) => (AIRPORTS[iata] ? { iata, city: AIRPORTS[iata]!.city, tz: AIRPORTS[iata]!.tz, why } : null);
  if (now < legs[0]!.dep) return at(legs[0]!.l.from, "before the first flight, so where the trip starts");
  for (let i = 0; i < legs.length; i++) {
    const x = legs[i]!;
    if (now < x.dep) return at(x.l.from, `between flights, before ${x.l.flight}`);
    if (Number.isFinite(x.arr) && now < x.arr) return at(x.l.from, `in the air on ${x.l.flight} (scheduled), so the time shown is where it left`);
  }
  return at(legs.at(-1)!.l.to, "after the last flight");
}

/** "Wed Oct 28, 14:23" in the zone, for the models. */
export function localClock(now: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
}
