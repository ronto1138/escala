import type { Lang } from "@escala/conversation";
import { AIRPORTS, type Leg } from "./trip.ts";

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-MX", fr: "fr-CA" };

/** Dates are written by code in the person's language; the model only returns ISO dates. */
export function dayLabel(isoDate: string, lang: Lang): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(d)
    .replace(/\.(?=\s|$)/g, "")
    .replace(/,/g, "");
}

export function timeLabel(hhmm: string, lang: Lang): string {
  if (lang === "fr") return hhmm.replace(":", " h ");
  return hhmm;
}

export function legLine(l: Leg, lang: Lang): string {
  const city = (iata: string) => AIRPORTS[iata]?.city ?? iata;
  const flight = l.flight.replace(/^([A-Z0-9]{2})(\d)/, "$1 $2");
  return `${flight} · ${dayLabel(l.date, lang)} · ${city(l.from)} ${timeLabel(l.dep_local, lang)} → ${city(l.to)} ${timeLabel(l.arr_local, lang)}`;
}

/**
 * WhatsApp shows plain text with its own marks (*bold*, _italic_): a Markdown link becomes "label: url" so the URL
 * stays tappable, "**bold**" becomes "*bold*", and Markdown headings lose their "#".
 */
export function forWhatsApp(text: string): string {
  return text
    .replace(/\[([^\]\n]{1,80})\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "");
}

