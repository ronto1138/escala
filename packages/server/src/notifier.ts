import type { OutboundMessage, ParticipantId } from "@escala/channel";
import type { Lang, Person } from "@escala/conversation";
import { isLeg, type FlightEvent, type FlightSnapshot, type LegRef } from "@escala/feeds";

/**
 * Tells travelers when one of their flights changes. Inside the 24-hour window it writes freely; outside it, it uses
 * the approved template `escala_flight_update`, whose button reopens the conversation. Each change is told once per
 * person. An inference (the inbound aircraft is late) is labelled as such. People who said STOP are not written to.
 */

export const TEMPLATE = "escala_flight_update";
export const TEMPLATE_LANG: Record<Lang, string> = { en: "en_US", es: "es_MX", fr: "fr" };

export interface NotifierDeps {
  send(to: ParticipantId, m: OutboundMessage): Promise<{ id: string }>;
  windowOpen(to: ParticipantId): boolean;
  people(): Iterable<Person>;
  log?(event: Record<string, unknown>): void;
  /**
   * Changes that arrive within this many milliseconds go out as one message, so a delay and two gate changes are one
   * update, not three in a row. 0 (the default) sends each call's changes at once.
   */
  coalesceMs?: number;
}

/** What changed, as the end of the sentence "flight ZZ 1234 …", in the person's language. Null when not worth telling. */
export function changeText(e: FlightEvent, lang: Lang): string | null {
  switch (e.kind) {
    case "cancelled":
      return { en: "was cancelled", es: "fue cancelado", fr: "a été annulé" }[lang];
    case "diverted":
      return { en: "was diverted to another airport", es: "se desvió a otro aeropuerto", fr: "a été dérouté vers un autre aéroport" }[lang];
    case "arrival_delay_change":
      return e.minutesLate <= 5
        ? { en: "is back on time", es: "vuelve a ir a tiempo", fr: "est de nouveau à l'heure" }[lang]
        : { en: `now arrives about ${e.minutesLate} min late`, es: `ahora llega con unos ${e.minutesLate} min de retraso`, fr: `arrive maintenant avec environ ${e.minutesLate} min de retard` }[lang];
    case "gate_change":
      if (!e.from) {
        return e.side === "departure"
          ? { en: `has its departure gate: ${e.to}`, es: `ya tiene puerta de embarque: ${e.to}`, fr: `a sa porte d'embarquement : ${e.to}` }[lang]
          : { en: `has its arrival gate: ${e.to}`, es: `ya tiene puerta de llegada: ${e.to}`, fr: `a sa porte d'arrivée : ${e.to}` }[lang];
      }
      return e.side === "departure"
        ? { en: `now leaves from gate ${e.to}`, es: `ahora sale por la puerta ${e.to}`, fr: `part maintenant de la porte ${e.to}` }[lang]
        : { en: `now arrives at gate ${e.to}`, es: `ahora llega a la puerta ${e.to}`, fr: `arrive maintenant à la porte ${e.to}` }[lang];
    case "baggage_claim":
      return { en: `has its bags on belt ${e.belt}`, es: `entrega maletas en la banda ${e.belt}`, fr: `livre les bagages au tapis ${e.belt}` }[lang];
    case "inbound_late": {
      const m = e.likelyDepartureDelayMinutes;
      const back = e.hops > 1;
      return {
        en: `may leave about ${m} min late: the plane that flies it ${back ? "is running late on its earlier flights" : "is late coming in"} (my estimate, not the airline's)`,
        es: `podría salir unos ${m} min tarde: el avión que lo opera ${back ? "viene arrastrando retraso de vuelos anteriores" : "viene retrasado"} (es mi estimación, no un dato de la aerolínea)`,
        fr: `pourrait partir environ ${m} min en retard : l'avion qui l'assure ${back ? "accumule du retard sur ses vols précédents" : "arrive en retard"} (c'est mon estimation, pas une information de la compagnie)`,
      }[lang];
    }
    case "inbound_late_cleared":
      return {
        en: "looks on time again: the plane caught up, so the delay I expected no longer applies (my estimate, not the airline's)",
        es: "vuelve a verse a tiempo: el avión recuperó el retraso, así que el que te anticipé ya no aplica (es mi estimación, no un dato de la aerolínea)",
        fr: "semble de nouveau à l'heure : l'avion a rattrapé son retard, celui que je prévoyais ne s'applique plus (c'est mon estimation, pas une information de la compagnie)",
      }[lang];
    case "aircraft_changed": {
      const m = e.likelyDepartureDelayMinutes;
      return m > 0
        ? {
            en: `has a different plane now, and it may still leave about ${m} min late (my estimate, not the airline's)`,
            es: `ahora lo opera otro avión, y aun así podría salir unos ${m} min tarde (es mi estimación, no un dato de la aerolínea)`,
            fr: `est maintenant assuré par un autre avion, qui pourrait encore partir environ ${m} min en retard (c'est mon estimation, pas une information de la compagnie)`,
          }[lang]
        : {
            en: "has a different plane now, one that is on time: the delay I expected no longer applies",
            es: "ahora lo opera otro avión que llega a tiempo: el retraso que te anticipé ya no aplica",
            fr: "est maintenant assuré par un autre avion, à l'heure : le retard que je prévoyais ne s'applique plus",
          }[lang];
    }
  }
}

const OPEN_TEXT: Record<Lang, (flight: string, change: string) => string> = {
  en: (f, c) => `✈️ Update: flight ${f} ${c}. Reply and I'll tell you what it means for your connection and your rights.`,
  es: (f, c) => `✈️ Novedad: el vuelo ${f} ${c}. Respóndeme y te digo qué significa para tu conexión y tus derechos.`,
  fr: (f, c) => `✈️ Du nouveau : le vol ${f} ${c}. Répondez-moi et je vous dirai ce que cela change pour votre correspondance et vos droits.`,
};

const MANY_TEXT: Record<Lang, (lines: string[]) => string> = {
  en: (ls) => `✈️ Updates:\n${ls.map((l) => `• ${l}`).join("\n")}\nReply and I'll tell you what it means for your connection and your rights.`,
  es: (ls) => `✈️ Novedades:\n${ls.map((l) => `• ${l}`).join("\n")}\nRespóndeme y te digo qué significa para tu conexión y tus derechos.`,
  fr: (ls) => `✈️ Du nouveau :\n${ls.map((l) => `• ${l}`).join("\n")}\nRépondez-moi et je vous dirai ce que cela change pour votre correspondance et vos droits.`,
};
const FLIGHT_WORD: Record<Lang, string> = { en: "flight", es: "el vuelo", fr: "le vol" };

/** Flights from the replayed scenario are said to be simulated, every time. */
const SIMULATED: Record<Lang, string> = { en: "(simulated flight data)", es: "(datos de vuelo simulados)", fr: "(données de vol simulées)" };

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");

export function createNotifier(deps: NotifierDeps) {
  const told = new Set<string>();
  type Change = { key: string; flight: string; change: string; kind: FlightEvent["kind"]; inference: boolean; simulated: boolean };
  const pending = new Map<ParticipantId, { lang: Lang; changes: Change[]; timer?: ReturnType<typeof setTimeout> }>();

  const flush = async (to: ParticipantId) => {
    const batch = pending.get(to);
    pending.delete(to);
    if (!batch?.changes.length) return;
    // The person may have said STOP, or changed language, while the batch waited.
    const person = [...deps.people()].find((x) => x.id === to);
    if (!person || person.stage !== "ready") return;
    const lang = person.lang;
    const { changes } = batch;
    const open = deps.windowOpen(to);
    // Outside the window the approved template carries one change; inside it, one message says them all.
    const messages: Array<{ m: OutboundMessage; kinds: Change[] }> = open
      ? [{
          m: {
            kind: "text",
            text:
              (changes.length === 1
                ? OPEN_TEXT[lang](changes[0]!.flight, changes[0]!.change)
                : MANY_TEXT[lang](changes.map((c) => `${FLIGHT_WORD[lang]} ${c.flight} ${c.change}`))) +
              (changes.some((c) => c.simulated) ? ` ${SIMULATED[lang]}` : ""),
          },
          kinds: changes,
        }]
      : changes.map((c) => ({ m: { kind: "template", name: TEMPLATE, language: TEMPLATE_LANG[lang], bodyParams: [c.flight, c.change] } as OutboundMessage, kinds: [c] }));
    for (const { m, kinds } of messages) {
      try {
        await deps.send(to, m);
        for (const c of kinds) deps.log?.({ event: "alert", kind: c.kind, via: open ? "text" : "template", inference: c.inference });
      } catch (err) {
        for (const c of kinds) {
          told.delete(c.key); // not sent: the next snapshot may tell it again
          deps.log?.({ event: "alert_failed", kind: c.kind, via: open ? "text" : "template", error: String(err).slice(0, 160) });
        }
      }
    }
  };

  return async function onEvents(events: FlightEvent[], snap: FlightSnapshot): Promise<void> {
    const ident = norm(snap.ident);
    const day = (snap.departure.scheduled ?? snap.observedAt).slice(0, 10);
    const now: ParticipantId[] = [];
    for (const p of deps.people()) {
      if (p.stage !== "ready") continue; // no trip yet, or STOP
      // Same flight number and the same route: another trip's ZZ 1234 from another city is not this one.
      const legs = ((p.trip as { legs?: Array<LegRef & { date: string }> } | undefined)?.legs ?? []).filter((l) => isLeg(snap, l));
      // Same flight number within a day of the scheduled departure (local and UTC dates can differ by one).
      if (!legs.some((l) => Math.abs(Date.parse(l.date) - Date.parse(day)) <= 86_400_000)) continue;
      for (const e of events) {
        const change = changeText(e, p.lang);
        if (!change) continue;
        const key = `${p.id}|${e.flightId}|${snap.departure.scheduled}|${e.kind}|${change}`; // a new run of the demo is a new flight
        if (told.has(key)) continue;
        told.add(key);
        if (told.size > 50_000) told.delete(told.values().next().value!);
        const batch = pending.get(p.id) ?? { lang: p.lang, changes: [] };
        batch.changes.push({ key, flight: pretty(ident), change, kind: e.kind, inference: Boolean(e.inference), simulated: snap.source === "replay" });
        pending.set(p.id, batch);
        if (!deps.coalesceMs) {
          if (!now.includes(p.id)) now.push(p.id);
        } else if (!batch.timer) {
          batch.timer = setTimeout(() => void flush(p.id), deps.coalesceMs);
          batch.timer.unref?.();
        }
      }
    }
    for (const id of now) await flush(id);
  };
}
