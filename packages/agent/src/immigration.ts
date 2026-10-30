import { AIRPORTS, cityName, type Trip } from "./trip.ts";
import { tripCountries } from "./documents.ts";

type Lang = "en" | "es" | "fr";

/** Why they travel, as the officer may ask it. Saved from what the traveler says, never guessed. */
export const PURPOSES = ["tourism", "family", "friends", "business", "study", "event"] as const;
export type Purpose = (typeof PURPOSES)[number];

/** The language(s) the card is written in, by country: what the officer speaks. Others get English. */
const CARD_LANGS: Record<string, Lang[]> = { US: ["en"], GB: ["en"], IE: ["en"], CA: ["en", "fr"], MX: ["es"], ES: ["es"], FR: ["fr"] };

/**
 * Connecting between international flights at these Canadian airports there is no officer since June 2026 (documents.ts).
 * Toronto only at Terminal 1, which the itinerary does not say: Toronto gets a card, which does no harm if unused.
 */
const CA_NO_TRANSIT_INSPECTION = new Set(["YUL", "YVR"]);

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
  stayWith?: "friends" | "family" | "rental" | undefined;
  stayAddress?: string | undefined;
  purpose?: Purpose | undefined;
  /** The passport they fly with: entering its own country, they are returning home, not visiting. */
  passport?: string | undefined;
}

const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");
const day = (date: string, lang: Lang) =>
  new Intl.DateTimeFormat({ en: "en-US", es: "es-MX", fr: "fr-CA" }[lang], { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const STAY_WITH: Record<"friends" | "family" | "rental", Record<Lang, (at?: string) => string>> = {
  friends: { en: (a) => `I will stay with friends${a ? ` at ${a}` : ""}.`, es: (a) => `Me voy a quedar con unos amigos${a ? `, en ${a}` : ""}.`, fr: (a) => `Je loge chez des amis${a ? `, ${a}` : ""}.` },
  family: { en: (a) => `I will stay with family${a ? ` at ${a}` : ""}.`, es: (a) => `Me voy a quedar con mi familia${a ? `, en ${a}` : ""}.`, fr: (a) => `Je loge dans ma famille${a ? `, ${a}` : ""}.` },
  rental: { en: (a) => `I will stay in a rental${a ? ` at ${a}` : ""}.`, es: (a) => `Me voy a quedar en un alojamiento rentado${a ? `, en ${a}` : ""}.`, fr: (a) => `Je loge dans une location${a ? `, ${a}` : ""}.` },
};

const PURPOSE_LINE: Record<Purpose, Record<Lang, string>> = {
  tourism: { en: "I am here as a tourist.", es: "Vengo de turista.", fr: "Je viens en touriste." },
  family: { en: "I am visiting family.", es: "Vengo a visitar a mi familia.", fr: "Je viens rendre visite à ma famille." },
  friends: { en: "I am visiting friends.", es: "Vengo a visitar a unos amigos.", fr: "Je viens rendre visite à des amis." },
  business: { en: "I am here on business.", es: "Vengo por trabajo.", fr: "Je viens pour le travail." },
  study: { en: "I am here to study.", es: "Vengo a estudiar.", fr: "Je viens pour étudier." },
  event: { en: "I am here for an event.", es: "Vengo a un evento.", fr: "Je viens pour un événement." },
};

/**
 * The card for one stop, in the officer's language: only what the trip and the traveler's own words show. Nothing is
 * invented; a fact that is missing is left out and reported in `missing`.
 */
export function immigrationCard(trip: Trip, stop: ImmigrationStop, given: CardFacts) {
  const legs = trip.legs;
  // One line each, short: what the traveler typed must not add sentences to a card shown to an officer.
  const flat = (v: string | undefined, max: number) => {
    // Links and markup never reach a card shown to an officer.
    const s = v?.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/[*_`#<>|[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
    return s && !/^(null|none|undefined|n\/a)$/i.test(s) ? s : undefined;
  };
  const facts = {
    stay: flat(given.stay, 80),
    stayAddress: flat(given.stayAddress, 160),
    purpose: given.purpose && (PURPOSES as readonly string[]).includes(given.purpose) ? given.purpose : undefined,
    // A named place goes as written; a private home is said in the officer's language, never in the traveler's words.
    stayWith: flat(given.stay, 80) ? undefined : given.stayWith && STAY_WITH[given.stayWith] ? given.stayWith : undefined,
  };
  const langs = CARD_LANGS[stop.country] ?? ["en"];
  const returning = stop.role === "entry" && Boolean(given.passport) && given.passport!.toUpperCase() === stop.country;
  const missing: Array<"purpose" | "stay" | "stay_address"> = [];
  const lines = (lang: Lang): string[] => {
    const out: string[] = [];
    if (stop.role === "transit") {
      const i = legs.findIndex((l) => l.to === stop.airport);
      const landed = legs[i];
      const next = legs[i + 1];
      if (landed && next) {
        // The day it leaves, as the itinerary says it; "today" only when it is the day this flight lands.
        // An unknown time ("") is not an overnight flight.
        const lands = /^\d{2}:\d{2}$/.test(landed.arr_local) && /^\d{2}:\d{2}$/.test(landed.dep_local) && landed.arr_local < landed.dep_local ? new Date(Date.parse(`${landed.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : landed.date;
        const when = next.date === lands ? { en: "today", es: "hoy", fr: "aujourd'hui" }[lang] : { en: `on ${day(next.date, lang)}`, es: `el ${day(next.date, lang)}`, fr: `le ${day(next.date, lang)}` }[lang];
        const to = cityName(next.to, lang);
        out.push({
          en: `I am only connecting: ${when} I fly on to ${to} on flight ${pretty(next.flight)}.`,
          es: `Solo voy en conexión: ${when} sigo a ${to} en el vuelo ${pretty(next.flight)}.`,
          fr: `Je suis seulement en correspondance : ${when === "aujourd'hui" ? "je continue aujourd'hui" : `je continue ${when}`} vers ${to} sur le vol ${pretty(next.flight)}.`,
        }[lang]);
      }
      return out;
    }
    if (returning) {
      out.push({ en: "I am returning home.", es: "Regreso a casa.", fr: "Je rentre chez moi." }[lang]);
      if (facts.stayAddress) out.push({ en: `My address: ${facts.stayAddress.replace(/[.\s]+$/, "")}.`, es: `Mi dirección: ${facts.stayAddress.replace(/[.\s]+$/, "")}.`, fr: `Mon adresse : ${facts.stayAddress.replace(/[.\s]+$/, "")}.` }[lang]);
      return out;
    }
    if (facts.purpose) out.push(PURPOSE_LINE[facts.purpose][lang]);
    if (facts.stay) {
      const where = (facts.stayAddress ? `${facts.stay}, ${facts.stayAddress}` : facts.stay).replace(/[.\s]+$/, "");
      out.push({ en: `I will stay at ${where}.`, es: `Me voy a quedar en ${where}.`, fr: `Je loge à ${where}.` }[lang]);
    } else if (facts.stayWith) {
      const at = facts.stayAddress?.replace(/[.\s]+$/, "");
      out.push(STAY_WITH[facts.stayWith][lang](at));
    }
    const arrived = legs.findIndex((l) => l.to === stop.airport);
    // Only a flight home is "back"; a flight on to another country is not.
    const home = AIRPORTS[legs[0]!.from]?.country;
    const back = legs.slice(arrived + 1).find((l) => AIRPORTS[l.from]?.country === stop.country && AIRPORTS[l.to]?.country === home);
    if (back) {
      out.push({
        en: `I fly back on ${day(back.date, lang)}, flight ${pretty(back.flight)}.`,
        es: `Me regreso el ${day(back.date, lang)}, vuelo ${pretty(back.flight)}.`,
        fr: `Je repars le ${day(back.date, lang)}, vol ${pretty(back.flight)}.`,
      }[lang]);
    }
    return out;
  };
  if (stop.role === "entry" && !returning) {
    if (!facts.purpose) missing.push("purpose");
    if (!facts.stay && !facts.stayWith) missing.push("stay");
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

/**
 * The line sent right before each voice note, which WhatsApp cannot caption: where, in which language, for whom.
 * "🔊 Chicago O'Hare, en inglés: para el oficial de migración de Estados Unidos (tu conexión)."
 */
export function voiceLabel(stop: ImmigrationStop, cardLang: Lang, lang: Lang): string {
  const locale = { en: "en-US", es: "es-MX", fr: "fr-CA" }[lang];
  const country = new Intl.DisplayNames([locale], { type: "region" }).of(stop.country) ?? stop.country;
  const tongue = new Intl.DisplayNames([locale], { type: "language" }).of(cardLang) ?? cardLang;
  const city = cityName(stop.airport, lang);
  const transit = stop.role === "transit";
  return {
    en: `🔊 ${city}, in ${tongue}: for the ${country} immigration officer (${transit ? "your connection" : "your arrival"}).`,
    es: `🔊 ${city}, en ${tongue}: para el oficial de migración de ${country} (${transit ? "tu conexión" : "tu llegada"}).`,
    fr: `🔊 ${city}, en ${tongue} : pour l'agent d'immigration (${country}, ${transit ? "votre correspondance" : "votre arrivée"}).`,
  }[lang];
}

/** Said when the card also goes as a voice note: what it is for, without promising the booth allows it. */
const VOICE: Record<Lang, string> = {
  en: "🔊 Below, each card read aloud, with a line saying which one it is: listen before you land to practice it. If the officer lets you, you can play it.",
  es: "🔊 Abajo te mando cada tarjeta en audio, con una línea que dice cuál es: escúchala antes de aterrizar para practicarla. Si el oficial te lo permite, puedes ponérsela.",
  fr: "🔊 Ci-dessous, chaque carte lue à voix haute, avec une ligne qui dit laquelle : écoutez-la avant d'atterrir pour vous entraîner. Si l'agent le permet, vous pouvez la lui faire écouter.",
};

/** The message sent before the flight that lands at an immigration stop: a heads-up plus the card. */
export function immigrationText(trip: Trip, stop: ImmigrationStop, facts: CardFacts, lang: Lang, voice = false): string {
  const c = immigrationCard(trip, stop, facts);
  const city = cityName(stop.airport, lang);
  const cards = c.card.filter((k) => k.lines.length).map((k) => `📋 ${k.lines.join(" ")}`);
  const ask = c.missing.length ? ADD[lang](c.missing.map((m) => MISSING[lang][m]).join(lang === "en" ? " and " : lang === "es" ? " y " : " et ")) : "";
  const head = HEAD[lang](city, stop.role === "transit" && stop.country === "US");
  return [cards.length ? `${head} ${SNAP[lang]}` : head, ...cards, ask, voice && cards.length ? VOICE[lang] : ""].filter(Boolean).join("\n\n");
}
