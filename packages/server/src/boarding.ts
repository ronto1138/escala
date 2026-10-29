import type { OutboundMessage, ParticipantId } from "@escala/channel";
import type { Lang, Person } from "@escala/conversation";
import { AIRPORTS, immigrationCard, immigrationStops, immigrationText, journeys, legInstant, type Purpose, type Trip } from "@escala/agent";
import { international, ruleFor, remindAt, TYPICAL_BOARDING, type FlightFeed, type FlightSnapshot } from "@escala/feeds";
import { TEMPLATE, TEMPLATE_LANG } from "./notifier.ts";

export { BOARDING, remindAt, ruleFor, type BoardingRule } from "@escala/feeds";

export interface BoardingDeps {
  feed: Pick<FlightFeed, "findByIdent"> & { now?(): number };
  people(): Iterable<Person>;
  send(to: ParticipantId, m: OutboundMessage): Promise<unknown>;
  windowOpen(to: ParticipantId): boolean;
  /** Reads a card aloud as a voice note; absent or null when speech is not available. */
  speak?(text: string, lang: "en" | "es" | "fr"): Promise<Uint8Array | null>;
  /** "Ciudad de México" for "MEX" in Spanish; falls back to the code. */
  cityOf?(iata: string, lang: Lang): string | undefined;
  log?(event: Record<string, unknown>): void;
}

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

type DayBefore = { flight: string; to: string; from: string; date: string; time: string; simulated: boolean };
const SIM: Record<Lang, string> = { en: " (simulated flight data)", es: " (datos de vuelo simulados)", fr: " (données de vol simulées)" };
const dayName = (date: string, lang: Lang) =>
  new Intl.DateTimeFormat({ en: "en-US", es: "es-MX", fr: "fr-CA" }[lang], { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
/** Inside the window: a reminder that invites anything they need before leaving. */
function dayBeforeText(r: DayBefore, lang: Lang): string {
  return {
    en: `✈️ A reminder: your flight ${r.flight} to ${r.to} leaves tomorrow, ${r.date}, at ${r.time} from ${r.from} (local time).${r.simulated ? SIM.en : ""} Anything you need before you go?`,
    es: `✈️ Te recuerdo que tu vuelo ${r.flight} a ${r.to} sale mañana, ${r.date}, a las ${r.time} de ${r.from} (hora local).${r.simulated ? SIM.es : ""} ¿Necesitas algo antes de irte?`,
    fr: `✈️ Petit rappel : votre vol ${r.flight} pour ${r.to} part demain, ${r.date}, à ${r.time} de ${r.from} (heure locale).${r.simulated ? SIM.fr : ""} Besoin de quelque chose avant de partir ?`,
  }[lang];
}
/** Outside the window: the end of the approved template's sentence "flight {{1}} {{2}}". */
function dayBeforeChange(r: DayBefore, lang: Lang): string {
  return {
    en: `to ${r.to} leaves tomorrow, ${r.date}, at ${r.time} from ${r.from} (local time)`,
    es: `a ${r.to} sale mañana, ${r.date}, a las ${r.time} de ${r.from} (hora local)`,
    fr: `pour ${r.to} part demain, ${r.date}, à ${r.time} de ${r.from} (heure locale)`,
  }[lang];
}
const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");

function clock(ms: number, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  }
}

/** The sentence after "flight ZZ 1234 …": departure, gate, and what the airline published, in local time. */
export function boardingText(s: FlightSnapshot, lang: Lang, city: string, pass?: { boardingTime?: string; gate?: string }): string {
  const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
  const tz = s.origin.timezone;
  const at = (min: number) => clock(dep - min * 60_000, tz);
  const r = ruleFor(s);
  const gate = s.departure.gate;
  const parts: Record<Lang, string[]> = { en: [], es: [], fr: [] };
  parts.en.push(`leaves at ${clock(dep, tz)} (${city} time)${gate ? ` from gate ${gate}` : ", no gate yet; I'll tell you when it has one"}`);
  parts.es.push(`sale a las ${clock(dep, tz)} (hora de ${city})${gate ? ` por la puerta ${gate}` : ", todavía sin puerta; te aviso en cuanto la tenga"}`);
  parts.fr.push(`part à ${clock(dep, tz)} (heure de ${city})${gate ? `, porte ${gate}` : ", pas encore de porte ; je vous préviens dès qu'elle est connue"}`);
  if (pass?.boardingTime) {
    parts.en.push(`Your boarding pass says boarding starts at ${pass.boardingTime}`);
    parts.es.push(`Tu pase dice que el abordaje empieza a las ${pass.boardingTime}`);
    parts.fr.push(`Votre carte indique un embarquement à ${pass.boardingTime}`);
    if (pass.gate && gate && pass.gate !== gate) {
      parts.en.push(`The pass says gate ${pass.gate}, but it is now ${gate}`);
      parts.es.push(`El pase dice puerta ${pass.gate}, pero ahora es la ${gate}`);
      parts.fr.push(`La carte indique la porte ${pass.gate}, mais c'est maintenant la ${gate}`);
    }
  } else if (r) {
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
    const { fromMin: a, toMin: b, checkedOn } = TYPICAL_BOARDING;
    const seen = checkedOn.slice(5).split("-").reverse().join("/");
    parts.en.push(`This airline doesn't publish its boarding time; airlines usually start ${a} to ${b} min before departure (the ranges American and United publish on aa.com and united.com, checked ${seen}), so between ${at(b)} and ${at(a)}. Your boarding pass has the exact time`);
    parts.es.push(`Esta aerolínea no publica su hora de abordaje; las aerolíneas suelen empezar entre ${a} y ${b} min antes de la salida (los rangos que publican American y United en aa.com y united.com, consultados el ${seen}), o sea entre las ${at(b)} y las ${at(a)}. La hora exacta está en tu pase de abordar`);
    parts.fr.push(`Cette compagnie ne publie pas son heure d'embarquement ; les compagnies commencent en général ${a} à ${b} min avant le départ (les fourchettes que publient American et United sur aa.com et united.com, consultées le ${seen}), soit entre ${at(b)} et ${at(a)}. L'heure exacte est sur votre carte d'embarquement`);
  }
  return parts[lang].join(". ");
}

/** Before check-in: photos of the bag and, after, of the tag, so anything that happens later can be shown. */
export function checkinText(lang: Lang, checkedBags: number | undefined): string {
  const unknown = checkedBags === undefined;
  return {
    en: `🧳 ${unknown ? "If you check a bag: before" : "Before"} you hand it over, take a photo of it, and after check-in one of the tag sticker they give you, and send them here. I keep them as evidence with the time, in case anything happens on the way.`,
    es: `🧳 ${unknown ? "Si vas a documentar maleta: antes" : "Antes"} de entregarla, tómale una foto, y después de documentar otra a la etiqueta que te den, y mándamelas aquí. Las guardo como evidencia con la hora, por si algo pasa en el camino.`,
    fr: `🧳 ${unknown ? "Si vous enregistrez un bagage : avant" : "Avant"} de le remettre, prenez-le en photo, puis après l'enregistrement l'étiquette qu'on vous donne, et envoyez-les ici. Je les garde comme preuve avec l'heure, au cas où.`,
  }[lang];
}

/** Check-in reminder this long before the first flight's scheduled departure (international, domestic). */
const CHECKIN_LEAD_MIN = { international: 150, domestic: 100 };

/** A boarding time printed on the pass ("13:25"), as an instant on the departure's local day. */
function passInstant(time: string, s: FlightSnapshot, dep: number): number {
  const tz = s.origin.timezone ?? "UTC";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(dep)).map((x) => [x.type, x.value]));
  const at = s.origin.iata ? legInstant(`${p.year}-${p.month}-${p.day}`, time, s.origin.iata) : NaN;
  return Number.isFinite(at) && at > dep ? at - 24 * 60 * 60 * 1000 : at;
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
  const send = async (key: string, p: Person, m: OutboundMessage, event: string, extra: Record<string, unknown>) => {
    if (sending.has(key)) return;
    sending.add(key);
    try {
      await deps.send(p.id, m);
      told.add(key); // only once it went out: a failed send is tried again on the next tick
      if (told.size > 50_000) told.delete(told.values().next().value!);
      deps.log?.({ event, via: m.kind, ...extra });
    } catch (err) {
      deps.log?.({ event: `${event}_failed`, error: String(err).slice(0, 160) });
    } finally {
      sending.delete(key);
    }
  };
  const voiceNotes = async (p: Person, cards: Array<{ lang: "en" | "es" | "fr"; lines: string[] }>) => {
    for (const c of cards.filter((k) => k.lines.length)) {
      const audio = await deps.speak!(c.lines.join(" "), c.lang);
      if (!audio) continue;
      try {
        await deps.send(p.id, { kind: "voice", audio });
        deps.log?.({ event: "immigration_card_voice", lang: c.lang });
      } catch (err) {
        deps.log?.({ event: "immigration_card_voice_failed", error: String(err).slice(0, 160) });
      }
    }
  };
  return async function tick(): Promise<void> {
    const now = deps.feed.now?.() ?? Date.now();
    for (const p of deps.people()) {
      if (p.stage !== "ready") continue;

      // The day before each journey, from 9:00 local at the airport it leaves from. From the itinerary's own times, so
      // it also reaches flights Escala cannot follow; with the approved template when the 24-hour window is closed.
      const trip = p.trip as Trip | undefined;
      for (const j of trip ? journeys(trip) : []) {
        const l = j[0]!;
        const tz = AIRPORTS[l.from]?.tz;
        if (!tz) continue;
        const snap = deps.feed.findByIdent(l.flight);
        const sameDay = snap?.departure.scheduled && new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(snap.departure.scheduled)) === l.date;
        const leaves = sameDay ? Date.parse(snap!.departure.estimated ?? snap!.departure.scheduled!) : legInstant(l.date, l.dep_local, l.from);
        if (!Number.isFinite(leaves) || now >= leaves) continue;
        const key = `${p.id}|${norm(l.flight)}|${l.date}|daybefore`;
        if (told.has(key)) continue;
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(now));
        const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
        if (l.date !== tomorrow || hour < 9 || hour >= 22) continue;
        const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(leaves));
        const r = { flight: pretty(norm(l.flight)), to: deps.cityOf?.(l.to, p.lang) || l.to, from: deps.cityOf?.(l.from, p.lang) || l.from, date: dayName(l.date, p.lang), time, simulated: Boolean(sameDay && snap?.source === "replay") };
        const m: OutboundMessage = deps.windowOpen(p.id)
          ? { kind: "text", text: dayBeforeText(r, p.lang) }
          : { kind: "template", name: TEMPLATE, language: TEMPLATE_LANG[p.lang], bodyParams: [r.flight, dayBeforeChange(r, p.lang)] };
        await send(key, p, m, "day_before_reminder", {});
      }

      const legs = ((p.trip as { legs?: Array<{ flight: string }> } | undefined)?.legs ?? []).map((l) => deps.feed.findByIdent(l.flight));
      const open = deps.windowOpen(p.id);

      // Before check-in at the start of the trip, unless they said they carry everything on.
      const first = legs[0];
      const sched = first ? Date.parse(first.departure.scheduled ?? "") : NaN;
      if (first && Number.isFinite(sched) && p.details?.checkedBags !== 0 && open) {
        const key = `${p.id}|${first.flightId}|checkin`;
        const lead = international(first) ? CHECKIN_LEAD_MIN.international : CHECKIN_LEAD_MIN.domestic;
        if (!told.has(key) && now >= sched - lead * 60_000 && now < sched - 45 * 60_000) {
          await send(key, p, { kind: "text", text: checkinText(p.lang, p.details?.checkedBags) }, "checkin_reminder", {});
        }
      }

      for (let i = 0; i < legs.length; i++) {
        const s = legs[i];
        if (!s || s.cancelled || s.departure.actual) continue;
        const key = `${p.id}|${s.flightId}`;
        if (told.has(key)) continue;
        const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
        const stored = p.boardingPasses?.[norm(s.ident)];
        // A pass for the same flight number on another day says nothing about this one.
        const depDay = s.departure.scheduled && s.origin.timezone ? new Intl.DateTimeFormat("en-CA", { timeZone: s.origin.timezone }).format(new Date(s.departure.scheduled)) : null;
        const pass = stored && (!stored.date || !depDay || stored.date === depDay) ? stored : undefined;
        const printed = pass?.boardingTime ? passInstant(pass.boardingTime, s, dep) : NaN;
        // The pass's own boarding time beats any rule: remind a quarter of an hour before it.
        const at = Number.isFinite(printed) ? printed - 15 * 60_000 : remindAt(s);
        if (at === null || now < at || now >= dep) continue;
        const before = legs[i - 1];
        const lands = before ? Date.parse(before.arrival.actual ?? before.arrival.estimated ?? before.arrival.scheduled ?? "") : NaN;
        if (Number.isFinite(lands) && lands > now) continue; // still in the air on the flight before
        const city = (s.origin.iata && deps.cityOf?.(s.origin.iata, p.lang)) || s.origin.iata || "";
        const body = boardingText(s, p.lang, city, Number.isFinite(printed) ? pass : undefined);
        const flight = pretty(norm(s.ident));
        const m: OutboundMessage = open
          ? { kind: "text", text: `${OPEN[p.lang](flight, body)}${s.source === "replay" ? ` ${SIMULATED[p.lang]}` : ""}` }
          : { kind: "template", name: TEMPLATE, language: TEMPLATE_LANG[p.lang], bodyParams: [flight, body] };
        await send(key, p, m, "boarding_reminder", { published: Boolean(ruleFor(s)), from_pass: Number.isFinite(printed) });
      }

      // Before the flight that lands where an officer waits: the immigration card, to screenshot while there is signal.
      // Only inside the 24-hour window: no approved template carries it.
      // (trip was read above, for the day-before reminder)
      for (const stop of open && trip ? immigrationStops(trip) : []) {
        const s = deps.feed.findByIdent(stop.flight);
        if (!s || s.cancelled) continue;
        const key = `${p.id}|${s.flightId}|immigration`;
        if (told.has(key)) continue;
        const at = remindAt(s);
        const lands = Date.parse(s.arrival.actual ?? s.arrival.estimated ?? s.arrival.scheduled ?? "");
        const dep = Date.parse(s.departure.estimated ?? s.departure.scheduled ?? "");
        const until = Number.isFinite(lands) ? lands - 20 * 60_000 : dep; // no arrival time: only until it leaves
        if (at === null || now < at || !(now < until)) continue;
        const d = p.details ?? {};
        const facts = { stay: d.stay, stayWith: d.stayWith, stayAddress: d.stayAddress, purpose: d.purpose as Purpose | undefined };
        const text = immigrationText(trip!, stop, facts, p.lang, Boolean(deps.speak));
        await send(key, p, { kind: "text", text }, "immigration_card", { country: stop.country, role: stop.role });
        // Each card in the officer's language, read aloud, after the text; it never holds up the other reminders.
        if (told.has(key) && deps.speak) void voiceNotes(p, immigrationCard(trip!, stop, facts).card);
      }
    }
  };
}
