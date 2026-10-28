import { AIRPORTS, cityName, type Trip } from "./trip.ts";
import { tripCountries } from "./documents.ts";

type Lang = "en" | "es" | "fr";

/** Why they travel, as the officer may ask it. Saved from what the traveler says, never guessed. */
export const PURPOSES = ["tourism", "family", "friends", "business", "study", "event"] as const;
export type Purpose = (typeof PURPOSES)[number];

/** The language(s) the card is written in, by country: what the officer speaks. Others get English. */
const CARD_LANGS: Record<string, Lang[]> = { US: ["en"], GB: ["en"], IE: ["en"], CA: ["en", "fr"], MX: ["es"], ES: ["es"], FR: ["fr"] };

/** Connecting between international flights at these Canadian airports there is no officer since June 2026 (documents.ts). */
const CA_NO_TRANSIT_INSPECTION = new Set(["YUL", "YYZ", "YVR"]);

export interface ImmigrationStop {
  country: string;
  airport: string;
  role: "entry" | "transit";
  /** The flight that lands there. */
  flight: string;
}

/** Where this trip meets an immigration officer: every entry, and transit where there is no airside transit (the US). */
export function immigrationStops(trip: Trip | undefined): ImmigrationStop[] {
  const legs = trip?.legs ?? [];
  return tripCountries(trip)
    .touched.filter((t) => t.role !== "exit" && !(t.role === "transit" && t.country === "CA" && CA_NO_TRANSIT_INSPECTION.has(t.airport)))
    .map((t) => ({ country: t.country, airport: t.airport, role: t.role as "entry" | "transit", flight: legs.find((l) => l.to === t.airport)?.flight ?? "" }));
}

export interface CardFacts {
  stay?: string | undefined;
  stayAddress?: string | undefined;
  purpose?: Purpose | undefined;
}

const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");
const day = (date: string, lang: Lang) =>
  new Intl.DateTimeFormat({ en: "en-US", es: "es-MX", fr: "fr-CA" }[lang], { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const PURPOSE_LINE: Record<Purpose, Record<Lang, string>> = {
  tourism: { en: "I am here as a tourist.", es: "Vengo de turista.", fr: "Je viens en touriste." },
  family: { en: "I am visiting family.", es: "Vengo a visitar a mi familia.", fr: "Je viens rendre visite à ma famille." },
  friends: { en: "I am visiting friends.", es: "Vengo a visitar a unos amigos.", fr: "Je viens rendre visite à des amis." },
  business: { en: "I am here for business meetings.", es: "Vengo a reuniones de trabajo.", fr: "Je viens pour des réunions de travail." },
  study: { en: "I am here to study.", es: "Vengo a estudiar.", fr: "Je viens pour étudier." },
  event: { en: "I am here for a family event.", es: "Vengo a un evento familiar.", fr: "Je viens pour un événement familial." },
};

/**
 * The card for one stop, in the officer's language: only what the trip and the traveler's own words show. Nothing is
 * invented; a fact that is missing is left out and reported in `missing`.
 */
export function immigrationCard(trip: Trip, stop: ImmigrationStop, facts: CardFacts) {
  const legs = trip.legs;
  const langs = CARD_LANGS[stop.country] ?? ["en"];
  const missing: Array<"purpose" | "stay" | "stay_address"> = [];
  const lines = (lang: Lang): string[] => {
    const out: string[] = [];
    if (stop.role === "transit") {
      const i = legs.findIndex((l) => l.to === stop.airport);
      const next = legs[i + 1];
      const final = legs.at(-1)!;
      if (next) {
        out.push({
          en: `I am only connecting: today I fly on to ${cityName(final.to, lang)} on flight ${pretty(next.flight)}.`,
          es: `Solo voy en conexión: hoy sigo a ${cityName(final.to, lang)} en el vuelo ${pretty(next.flight)}.`,
          fr: `Je suis seulement en correspondance : je continue aujourd'hui vers ${cityName(final.to, lang)} sur le vol ${pretty(next.flight)}.`,
        }[lang]);
      }
      return out;
    }
    if (facts.purpose) out.push(PURPOSE_LINE[facts.purpose][lang]);
    if (facts.stay) {
      const where = facts.stayAddress ? `${facts.stay}, ${facts.stayAddress}` : facts.stay;
      out.push({ en: `I will stay at ${where}.`, es: `Me voy a quedar en ${where}.`, fr: `Je loge à ${where}.` }[lang]);
    }
    const arrived = legs.findIndex((l) => l.to === stop.airport);
    const back = legs.slice(arrived + 1).find((l) => AIRPORTS[l.from]?.country === stop.country && AIRPORTS[l.to]?.country !== stop.country);
    if (back) {
      out.push({
        en: `I fly back on ${day(back.date, lang)}, flight ${pretty(back.flight)}.`,
        es: `Me regreso el ${day(back.date, lang)}, vuelo ${pretty(back.flight)}.`,
        fr: `Je repars le ${day(back.date, lang)}, vol ${pretty(back.flight)}.`,
      }[lang]);
    }
    return out;
  };
  if (stop.role === "entry") {
    if (!facts.purpose) missing.push("purpose");
    if (!facts.stay) missing.push("stay");
    else if (!facts.stayAddress) missing.push("stay_address");
  }
  return {
    country: stop.country,
    airport: stop.airport,
    role: stop.role,
    flight: stop.flight,
    card: langs.map((lang) => ({ lang, lines: lines(lang) })),
    missing,
  };
}

const HEAD: Record<Lang, (city: string, transit: boolean) => string> = {
  en: (c, t) => `🛂 Getting ready for immigration in ${c}${t ? ": you go through US immigration and customs there even though you are only connecting" : ""}.`,
  es: (c, t) => `🛂 Para migración en ${c}${t ? ": ahí pasas migración y aduana de EE. UU. aunque solo vayas en conexión" : ""}.`,
  fr: (c, t) => `🛂 Pour l'immigration à ${c}${t ? " : vous y passez l'immigration et la douane américaines même en simple correspondance" : ""}.`,
};
/** Recording or calling at the officer's booth is not allowed, and officers may ask to put phones away: the card goes as a screenshot. */
const SNAP: Record<Lang, string> = {
  en: "Take a screenshot of this card now, before you land. If the officer asks, read it or show it; don't record or call at the booth.",
  es: "Toma captura de esta tarjeta ahora, antes de aterrizar. Si el oficial te pregunta, léela o enséñala; en la caseta no grabes ni llames.",
  fr: "Faites une capture de cette carte maintenant, avant d'atterrir. Si l'agent vous interroge, lisez-la ou montrez-la ; au guichet, n'enregistrez pas et n'appelez pas.",
};
const MISSING: Record<Lang, Record<"purpose" | "stay" | "stay_address", string>> = {
  en: { purpose: "why you travel", stay: "where you stay", stay_address: "the address where you stay" },
  es: { purpose: "a qué vas", stay: "dónde te quedas", stay_address: "la dirección donde te quedas" },
  fr: { purpose: "le motif du voyage", stay: "où vous logez", stay_address: "l'adresse où vous logez" },
};
const ADD: Record<Lang, (xs: string) => string> = {
  en: (x) => `If you tell me ${x}, I'll add it to the card.`,
  es: (x) => `Si me dices ${x}, lo agrego a la tarjeta.`,
  fr: (x) => `Si vous me dites ${x}, je l'ajoute à la carte.`,
};

/** The message sent before the flight that lands at an immigration stop: a heads-up plus the card. */
export function immigrationText(trip: Trip, stop: ImmigrationStop, facts: CardFacts, lang: Lang): string {
  const c = immigrationCard(trip, stop, facts);
  const city = cityName(stop.airport, lang);
  const cards = c.card.filter((k) => k.lines.length).map((k) => `📋 ${k.lines.join(" ")}`);
  const ask = c.missing.length ? ADD[lang](c.missing.map((m) => MISSING[lang][m]).join(lang === "en" ? " and " : lang === "es" ? " y " : " et ")) : "";
  const head = HEAD[lang](city, stop.role === "transit" && stop.country === "US");
  return [cards.length ? `${head} ${SNAP[lang]}` : head, ...cards, ask].filter(Boolean).join("\n\n");
}
