import type { OutboundMessage, ParticipantId } from "@escala/channel";
import type { Lang, Person } from "@escala/conversation";
import type { FlightEvent, FlightSnapshot } from "@escala/feeds";

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
    case "inbound_late":
      return {
        en: `may leave about ${e.likelyDepartureDelayMinutes} min late: the plane coming in is late (my estimate, not the airline's)`,
        es: `podría salir unos ${e.likelyDepartureDelayMinutes} min tarde: el avión que lo opera viene retrasado (es mi estimación, no un dato de la aerolínea)`,
        fr: `pourrait partir environ ${e.likelyDepartureDelayMinutes} min en retard : l'avion qui l'assure arrive en retard (c'est mon estimation, pas une information de la compagnie)`,
      }[lang];
  }
}

const OPEN_TEXT: Record<Lang, (flight: string, change: string) => string> = {
  en: (f, c) => `✈️ Update: flight ${f} ${c}. Reply and I'll tell you what it means for your connection and your rights.`,
  es: (f, c) => `✈️ Novedad: el vuelo ${f} ${c}. Respóndeme y te digo qué significa para tu conexión y tus derechos.`,
  fr: (f, c) => `✈️ Du nouveau : le vol ${f} ${c}. Répondez-moi et je vous dirai ce que cela change pour votre correspondance et vos droits.`,
};

/** Flights from the replayed scenario are said to be simulated, every time. */
const SIMULATED: Record<Lang, string> = { en: "(simulated flight data)", es: "(datos de vuelo simulados)", fr: "(données de vol simulées)" };

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");

export function createNotifier(deps: NotifierDeps) {
  const told = new Set<string>();
  return async function onEvents(events: FlightEvent[], snap: FlightSnapshot): Promise<void> {
    const ident = norm(snap.ident);
    const day = (snap.departure.scheduled ?? snap.observedAt).slice(0, 10);
    for (const p of deps.people()) {
      if (p.stage !== "ready") continue; // no trip yet, or STOP
      const legs = ((p.trip as { legs?: Array<{ flight: string; date: string }> } | undefined)?.legs ?? []).filter((l) => norm(l.flight) === ident);
      // Same flight number within a day of the scheduled departure (local and UTC dates can differ by one).
      if (!legs.some((l) => Math.abs(Date.parse(l.date) - Date.parse(day)) <= 86_400_000)) continue;
      for (const e of events) {
        const change = changeText(e, p.lang);
        if (!change) continue;
        const key = `${p.id}|${e.flightId}|${e.kind}|${change}`;
        if (told.has(key)) continue;
        told.add(key);
        if (told.size > 50_000) told.delete(told.values().next().value!);
        const flight = pretty(ident);
        const open = deps.windowOpen(p.id);
        const m: OutboundMessage = open
          ? { kind: "text", text: `${OPEN_TEXT[p.lang](flight, change)}${snap.source === "replay" ? ` ${SIMULATED[p.lang]}` : ""}` }
          : { kind: "template", name: TEMPLATE, language: TEMPLATE_LANG[p.lang], bodyParams: [flight, change] };
        try {
          await deps.send(p.id, m);
          deps.log?.({ event: "alert", kind: e.kind, via: open ? "text" : "template", inference: e.inference });
        } catch (err) {
          deps.log?.({ event: "alert_failed", kind: e.kind, via: open ? "text" : "template", error: String(err).slice(0, 160) });
        }
      }
    }
  };
}
