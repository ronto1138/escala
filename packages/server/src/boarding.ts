import type { OutboundMessage, ParticipantId } from "@escala/channel";
import type { Lang, Person } from "@escala/conversation";
import type { FlightFeed, FlightSnapshot } from "@escala/feeds";
import { TEMPLATE, TEMPLATE_LANG } from "./notifier.ts";

/**
 * Boarding rules the airlines publish on their own sites (read 2026-10-28). Most publish when the gate or door closes,
 * or by when you must be at the gate; few publish when boarding starts. Escala says only what the airline published.
 * Minutes are before scheduled departure; `intl` overrides for international flights.
 */
export interface BoardingRule {
  airline: string;
  startsMin?: number;
  gateByMin?: number;
  closesMin?: number;
  intl?: { startsMin?: number; gateByMin?: number; closesMin?: number };
  url: string;
  checkedOn: string;
  /** The demo's fictitious airline: an example rule, labelled as such. */
  example?: boolean;
}

export const BOARDING: Record<string, BoardingRule> = {
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

/** Without any published rule, the reminder comes this long before departure. */
const DEFAULT_LEAD_MIN = 60;
/** Margin before the earliest published moment (boarding starts, or be at the gate), to walk there. */
const WALK_MARGIN_MIN = 15;

export interface BoardingDeps {
  feed: Pick<FlightFeed, "findByIdent"> & { now?(): number };
  people(): Iterable<Person>;
  send(to: ParticipantId, m: OutboundMessage): Promise<unknown>;
  windowOpen(to: ParticipantId): boolean;
  /** "Austin" for "AUS"; falls back to the code. */
  cityOf?(iata: string): string | undefined;
  log?(event: Record<string, unknown>): void;
}

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");

/** International when the two airports' ICAO prefixes say different countries (K = US, C = Canada, MM = Mexico...). */
function international(s: FlightSnapshot): boolean {
  const country = (icao: string | null) => (!icao ? null : /^[KC]/.test(icao) ? icao[0] : icao.slice(0, 2));
  const a = country(s.origin.icao);
  const b = country(s.destination.icao);
  return Boolean(a && b && a !== b);
}

export function ruleFor(s: FlightSnapshot): { rule: BoardingRule; startsMin?: number; gateByMin?: number; closesMin?: number } | null {
  const rule = BOARDING[(s.operator ?? norm(s.ident).slice(0, 2)).toUpperCase()];
  if (!rule) return null;
  const o = international(s) ? { ...rule, ...rule.intl } : rule;
  return { rule, ...(o.startsMin ? { startsMin: o.startsMin } : {}), ...(o.gateByMin ? { gateByMin: o.gateByMin } : {}), ...(o.closesMin ? { closesMin: o.closesMin } : {}) };
}

/** When to remind: ahead of the earliest moment the airline publishes, or an hour before departure. */
export function remindAt(s: FlightSnapshot): number | null {
  const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
  if (!Number.isFinite(dep)) return null;
  const r = ruleFor(s);
  const earliest = Math.max(r?.startsMin ?? 0, r?.gateByMin ?? 0);
  return dep - Math.max(DEFAULT_LEAD_MIN, earliest + WALK_MARGIN_MIN) * 60_000;
}

function clock(ms: number, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  }
}

/** The sentence after "flight ZZ 1234 …": departure, gate, and what the airline published, in local time. */
export function boardingText(s: FlightSnapshot, lang: Lang, city: string): string {
  const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
  const tz = s.origin.timezone;
  const at = (min: number) => clock(dep - min * 60_000, tz);
  const r = ruleFor(s);
  const gate = s.departure.gate;
  const parts: Record<Lang, string[]> = { en: [], es: [], fr: [] };
  parts.en.push(`leaves at ${clock(dep, tz)} (${city} time)${gate ? ` from gate ${gate}` : ", no gate yet; I'll tell you when it has one"}`);
  parts.es.push(`sale a las ${clock(dep, tz)} (hora de ${city})${gate ? ` por la puerta ${gate}` : ", todavía sin puerta; te aviso en cuanto la tenga"}`);
  parts.fr.push(`part à ${clock(dep, tz)} (heure de ${city})${gate ? `, porte ${gate}` : ", pas encore de porte ; je vous préviens dès qu'elle est connue"}`);
  if (r) {
    const said: Record<Lang, string[]> = { en: [], es: [], fr: [] };
    if (r.startsMin) {
      said.en.push(`boarding starts around ${at(r.startsMin)}`);
      said.es.push(`el abordaje empieza hacia las ${at(r.startsMin)}`);
      said.fr.push(`l'embarquement commence vers ${at(r.startsMin)}`);
    }
    if (r.gateByMin) {
      said.en.push(`be at the gate by ${at(r.gateByMin)}`);
      said.es.push(`hay que estar en la puerta a más tardar a las ${at(r.gateByMin)}`);
      said.fr.push(`il faut être à la porte au plus tard à ${at(r.gateByMin)}`);
    }
    if (r.closesMin) {
      said.en.push(`the gate closes at ${at(r.closesMin)}`);
      said.es.push(`la puerta cierra a las ${at(r.closesMin)}`);
      said.fr.push(`la porte ferme à ${at(r.closesMin)}`);
    }
    const day = r.rule.checkedOn ? r.rule.checkedOn.slice(5).split("-").reverse().join("/") : "";
    parts.en.push(`${r.rule.example ? "Per the demo airline's example rule" : `Per ${r.rule.airline} (${r.rule.url}, checked ${day})`}, ${said.en.join(" and ")}`);
    parts.es.push(`${r.rule.example ? "Según la regla de ejemplo de la aerolínea del demo" : `Según ${r.rule.airline} (${r.rule.url}, consultado el ${day})`}, ${said.es.join(" y ")}`);
    parts.fr.push(`${r.rule.example ? "Selon la règle d'exemple de la compagnie de démo" : `Selon ${r.rule.airline} (${r.rule.url}, consulté le ${day})`}, ${said.fr.join(" et ")}`);
  } else {
    parts.en.push("The airline doesn't publish when it boards: check the time on your boarding pass");
    parts.es.push("La aerolínea no publica a qué hora aborda: revisa la hora en tu pase de abordar");
    parts.fr.push("La compagnie ne publie pas l'heure d'embarquement : vérifiez-la sur votre carte d'embarquement");
  }
  return parts[lang].join(". ");
}

const OPEN: Record<Lang, (flight: string, body: string) => string> = {
  en: (f, b) => `🛫 Time to head to your gate: flight ${f} ${b}.`,
  es: (f, b) => `🛫 Ya es buen momento para irte acercando a tu puerta: el vuelo ${f} ${b}.`,
  fr: (f, b) => `🛫 C'est le moment de vous rapprocher de votre porte : le vol ${f} ${b}.`,
};
const SIMULATED: Record<Lang, string> = { en: "(simulated flight data)", es: "(datos de vuelo simulados)", fr: "(données de vol simulées)" };

/**
 * Reminds each traveler, once per flight, to head to the gate. Not while they are still flying an earlier leg of the
 * trip (they cannot be at that gate), not after the flight left. Run `tick()` on a schedule.
 */
export function createBoardingReminders(deps: BoardingDeps) {
  const told = new Set<string>();
  return async function tick(): Promise<void> {
    const now = deps.feed.now?.() ?? Date.now();
    for (const p of deps.people()) {
      if (p.stage !== "ready") continue;
      const legs = ((p.trip as { legs?: Array<{ flight: string }> } | undefined)?.legs ?? []).map((l) => deps.feed.findByIdent(l.flight));
      for (let i = 0; i < legs.length; i++) {
        const s = legs[i];
        if (!s || s.cancelled || s.departure.actual) continue;
        const key = `${p.id}|${s.flightId}`;
        if (told.has(key)) continue;
        const at = remindAt(s);
        const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
        if (at === null || now < at || now >= dep) continue;
        const before = legs[i - 1];
        const lands = before ? Date.parse(before.arrival.actual ?? before.arrival.estimated ?? before.arrival.scheduled ?? "") : NaN;
        if (Number.isFinite(lands) && lands > now) continue; // still in the air on the flight before
        told.add(key);
        if (told.size > 50_000) told.delete(told.values().next().value!);
        const city = (s.origin.iata && deps.cityOf?.(s.origin.iata)) || s.origin.iata || "";
        const body = boardingText(s, p.lang, city);
        const flight = pretty(norm(s.ident));
        const open = deps.windowOpen(p.id);
        const m: OutboundMessage = open
          ? { kind: "text", text: `${OPEN[p.lang](flight, body)}${s.source === "replay" ? ` ${SIMULATED[p.lang]}` : ""}` }
          : { kind: "template", name: TEMPLATE, language: TEMPLATE_LANG[p.lang], bodyParams: [flight, body] };
        try {
          await deps.send(p.id, m);
          deps.log?.({ event: "boarding_reminder", via: open ? "text" : "template", published: Boolean(ruleFor(s)) });
        } catch (err) {
          deps.log?.({ event: "boarding_reminder_failed", error: String(err).slice(0, 160) });
        }
      }
    }
  };
}
