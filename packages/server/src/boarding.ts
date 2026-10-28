import type { OutboundMessage, ParticipantId } from "@escala/channel";
import type { Lang, Person } from "@escala/conversation";
import { ruleFor, remindAt, TYPICAL_BOARDING, type FlightFeed, type FlightSnapshot } from "@escala/feeds";
import { TEMPLATE, TEMPLATE_LANG } from "./notifier.ts";

export { BOARDING, remindAt, ruleFor, type BoardingRule } from "@escala/feeds";

export interface BoardingDeps {
  feed: Pick<FlightFeed, "findByIdent"> & { now?(): number };
  people(): Iterable<Person>;
  send(to: ParticipantId, m: OutboundMessage): Promise<unknown>;
  windowOpen(to: ParticipantId): boolean;
  /** "Ciudad de México" for "MEX" in Spanish; falls back to the code. */
  cityOf?(iata: string, lang: Lang): string | undefined;
  log?(event: Record<string, unknown>): void;
}

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");

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
    if (r.startsMin && r.startsLatestMin) {
      said.en.push(`boarding starts between ${at(r.startsMin)} and ${at(r.startsLatestMin)}`);
      said.es.push(`el abordaje empieza entre las ${at(r.startsMin)} y las ${at(r.startsLatestMin)}`);
      said.fr.push(`l'embarquement commence entre ${at(r.startsMin)} et ${at(r.startsLatestMin)}`);
    } else if (r.startsMin) {
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
    const { fromMin: a, toMin: b } = TYPICAL_BOARDING;
    parts.en.push(`This airline doesn't publish its boarding time; airlines usually start ${a} to ${b} min before departure (the ranges American and United publish), so between ${at(b)} and ${at(a)}. Your boarding pass has the exact time`);
    parts.es.push(`Esta aerolínea no publica su hora de abordaje; las aerolíneas suelen empezar entre ${a} y ${b} min antes de la salida (los rangos que publican American y United), o sea entre las ${at(b)} y las ${at(a)}. La hora exacta está en tu pase de abordar`);
    parts.fr.push(`Cette compagnie ne publie pas son heure d'embarquement ; les compagnies commencent en général ${a} à ${b} min avant le départ (les fourchettes que publient American et United), soit entre ${at(b)} et ${at(a)}. L'heure exacte est sur votre carte d'embarquement`);
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
  const sending = new Set<string>();
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
        if (sending.has(key)) continue;
        const city = (s.origin.iata && deps.cityOf?.(s.origin.iata, p.lang)) || s.origin.iata || "";
        const body = boardingText(s, p.lang, city);
        const flight = pretty(norm(s.ident));
        const open = deps.windowOpen(p.id);
        const m: OutboundMessage = open
          ? { kind: "text", text: `${OPEN[p.lang](flight, body)}${s.source === "replay" ? ` ${SIMULATED[p.lang]}` : ""}` }
          : { kind: "template", name: TEMPLATE, language: TEMPLATE_LANG[p.lang], bodyParams: [flight, body] };
        sending.add(key);
        try {
          await deps.send(p.id, m);
          told.add(key); // only once it went out: a failed send is tried again on the next tick
          if (told.size > 50_000) told.delete(told.values().next().value!);
          deps.log?.({ event: "boarding_reminder", via: open ? "text" : "template", published: Boolean(ruleFor(s)) });
        } catch (err) {
          deps.log?.({ event: "boarding_reminder_failed", error: String(err).slice(0, 160) });
        } finally {
          sending.delete(key);
        }
      }
    }
  };
}
