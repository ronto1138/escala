import type { InboundMessage, OutboundMessage } from "@escala/channel";
import type { ConversationDeps, ExtractedTrip, Lang, Person } from "@escala/conversation";
import { arrivalMinutesLate, inboundDelayMinutes, type FlightFeed } from "@escala/feeds";
import { outputText, type MetaClient } from "@escala/meta-client";
import { assess, type RightEntry, type TripFacts } from "@escala/rights";
import { legLine } from "./format.ts";
import { extractTrip, scopeGuard, type MediaLoader, type ScopePart } from "./models.ts";
import { factsFor, journeys, norm, type Trip } from "./trip.ts";
import { numbersIn, verify, type Allowed, type Verdict } from "./verify.ts";

export interface AgentDeps {
  client: MetaClient;
  feed: FlightFeed;
  entries: RightEntry[];
  media: MediaLoader;
  /** Called with each step, for the trust panel. */
  trace?: (step: TraceStep) => void;
  maxToolRounds?: number;
}

export type TraceStep =
  | { kind: "scope"; parts: ScopePart[] }
  | { kind: "tool"; name: string; args: unknown; result: unknown }
  | { kind: "verify"; attempt: number; verdict: Verdict; draft: string }
  | { kind: "fallback"; reason: string };

const LANG_NAME: Record<Lang, string> = { en: "English", es: "Spanish (Mexico)", fr: "French (use vous)" };

const DECLINE: Record<Lang, (reasons: string) => string> = {
  en: (r) => `That one I can't help with: I'm only here for your trip (${r}).`,
  es: (r) => `Con eso no te puedo ayudar: solo estoy para tu viaje (${r}).`,
  fr: (r) => `Pour ça, je ne peux pas vous aider : je suis là seulement pour votre voyage (${r}).`,
};

const FALLBACK: Record<Lang, string> = {
  en: "I'd rather not give you a number I can't back with a source. Here's what I can say for sure: I'm checking your flights, and I'll tell you what applies as soon as I can cite the rule.",
  es: "Prefiero no darte una cifra que no pueda respaldar con una fuente. Lo que sí te puedo decir: estoy revisando tus vuelos y te digo qué te corresponde en cuanto pueda citarte la norma.",
  fr: "Je préfère ne pas vous donner un chiffre que je ne peux pas appuyer sur une source. Ce que je peux dire : je surveille vos vols et je vous dirai ce qui s'applique dès que je pourrai citer la règle.",
};

const TOOLS = [
  {
    type: "function",
    name: "get_flight_status",
    description: "Current status of one flight of the traveler's trip: scheduled and estimated times, gates, and whether the inbound aircraft is late (an inference).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["flight"],
      properties: { flight: { type: "string", description: "e.g. ZZ1234" } },
    },
    strict: true,
  },
  {
    type: "function",
    name: "rights_for_trip",
    description:
      "Which passenger rights apply to this trip, decided by rules. Pass only facts the traveler stated or the flight data shows; leave the rest null. " +
      "Returns entries that apply (with their amounts), entries that may apply and what they depend on, and the one question worth asking.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["flight", "disruption", "arrival_delay_h", "cause_category", "notice_days", "passenger_declined_alternative"],
      properties: {
        flight: { type: "string" },
        disruption: { type: ["string", "null"], enum: ["delay", "cancellation", "denied_boarding", "tarmac", "bag_delayed", "bag_damaged", "bag_lost", null] },
        arrival_delay_h: { type: ["number", "null"], description: "Hours late at the final destination of this journey, if known or stated" },
        cause_category: { type: ["string", "null"], enum: ["within_control", "within_control_safety", "outside_control", null] },
        notice_days: { type: ["number", "null"] },
        passenger_declined_alternative: { type: ["boolean", "null"] },
      },
    },
    strict: true,
  },
] as const;

/** Builds the pieces the Conversation needs: itinerary extraction and the trip agent. */
export function createEscalaAgent(deps: AgentDeps): Pick<ConversationDeps, "extractItinerary" | "agent"> {
  const trace = deps.trace ?? (() => {});
  const asked = new Map<string, string[]>(); // person -> facts already asked about

  async function extractItinerary(m: InboundMessage, p: Person, correction?: string): Promise<ExtractedTrip | null> {
    const current = (p.pending?.trip ?? p.trip) as Trip | undefined;
    const trip = await extractTrip(deps.client, deps.media, m, { ...(current ? { current } : {}), ...(correction ? { correction } : {}) });
    if (!trip) return null;
    return { lines: trip.legs.map((l) => legLine(l, p.lang)), trip };
  }

  async function agent(m: InboundMessage, p: Person): Promise<OutboundMessage[]> {
    if (m.kind !== "text") return []; // voice notes and photos are handled by their own flows
    const trip = p.trip as Trip | undefined;

    const parts = await scopeGuard(deps.client, m.text, trip, p.lang);
    trace({ kind: "scope", parts });
    const inScope = parts.filter((x) => x.in_scope);
    const outScope = parts.filter((x) => !x.in_scope);
    const replies: OutboundMessage[] = [];
    if (outScope.length) replies.push({ kind: "text", text: DECLINE[p.lang](outScope.map((x) => x.reason).join("; ")) });
    if (!inScope.length) return replies;

    const allowed: Allowed = { amounts: [], percents: [], durations: [] };
    const draft = await answer(inScope.map((x) => x.text).join(" "), p, trip, allowed);
    replies.push({ kind: "text", text: draft });
    return replies;
  }

  async function answer(question: string, p: Person, trip: Trip | undefined, allowed: Allowed): Promise<string> {
    const tripText = trip ? journeys(trip).map((j) => j.map((l) => legLine(l, "en")).join(" | ")).join(" ;; ") : "no itinerary yet";
    const instructions =
      `You are Escala, a warm, plain-spoken travel companion on WhatsApp, for this traveler's trip only. Reply in ${LANG_NAME[p.lang]}, briefly, like a person who knows travel. ` +
      "Use tools for facts; never guess flight status. Never state an amount, percentage, deadline or legal article unless rights_for_trip returned it under 'applies'. " +
      "If a right only 'may apply', say what it depends on and ask the single question returned, nothing else. If the inbound aircraft is late, say it is your inference, not airline data. " +
      "You give information with sources, not legal advice; never promise compensation. Never book anything. " +
      `Trip: ${tripText}.`;

    const input: any[] = [{ role: "user", content: question }];
    for (let round = 0; round < (deps.maxToolRounds ?? 4); round++) {
      const r = await deps.client.responses(
        { model: "muse-spark-1.3", reasoning: { effort: "low" }, max_output_tokens: 1500, instructions, input, tools: TOOLS as unknown as unknown[] },
        { caller: "agent/loop" },
      );
      const calls = (r.output ?? []).filter((o: any) => o.type === "function_call");
      if (!calls.length) return finalize(outputText(r), p, instructions, input, allowed);
      input.push(...(r.output ?? []));
      for (const c of calls) {
        let result: unknown;
        let args: any = {};
        try {
          args = JSON.parse(c.arguments || "{}");
          result = runTool(c.name, args, p, trip, allowed);
        } catch (err) {
          result = { error: `tool failed: ${String(err).slice(0, 120)}` };
        }
        trace({ kind: "tool", name: c.name, args, result });
        input.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(result) });
      }
    }
    trace({ kind: "fallback", reason: "too many tool rounds" });
    return FALLBACK[p.lang];
  }

  async function finalize(draft: string, p: Person, instructions: string, input: any[], allowed: Allowed): Promise<string> {
    let text = draft;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const verdict = verify(text, allowed);
      trace({ kind: "verify", attempt, verdict, draft: text });
      if (verdict.ok) return text;
      if (attempt === 2) break;
      const r = await deps.client.responses(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          max_output_tokens: 1200,
          instructions,
          input: [
            ...input,
            { role: "assistant", content: text },
            { role: "user", content: `Rewrite your answer without these unsupported figures: ${verdict.unmatched.map((u) => u.text).join(", ")}. Keep only what the tools returned.` },
          ],
        },
        { caller: "agent/rewrite" },
      );
      text = outputText(r);
    }
    trace({ kind: "fallback", reason: "unsupported figures after rewrite" });
    return FALLBACK[p.lang];
  }

  function runTool(name: string, args: any, p: Person, trip: Trip | undefined, allowed: Allowed): unknown {
    if (name === "get_flight_status") {
      const snap = deps.feed.findByIdent(args.flight);
      if (!snap) return { error: "no data for this flight" };
      const inbound = snap.inboundFlightId ? deps.feed.getFlight(snap.inboundFlightId) : undefined;
      const lateMin = arrivalMinutesLate(snap);
      const inboundMin = inboundDelayMinutes(snap, inbound);
      for (const n of [lateMin, inboundMin]) if (n) allowed.durations.push(n, Math.round((n / 60) * 10) / 10);
      const dz = snap.origin.timezone ?? "UTC";
      const az = snap.destination.timezone ?? "UTC";
      return {
        flight: snap.ident,
        observed_at: snap.observedAt,
        source: snap.source === "replay" ? "simulated data" : snap.source,
        times_are: "local time at each airport",
        departure: { airport: snap.origin.iata, scheduled: local(snap.departure.scheduled, dz), estimated: local(snap.departure.estimated, dz), actual: local(snap.departure.actual, dz), gate: snap.departure.gate, terminal: snap.departure.terminal },
        arrival: { airport: snap.destination.iata, scheduled: local(snap.arrival.scheduled, az), estimated: local(snap.arrival.estimated, az), actual: local(snap.arrival.actual, az), gate: snap.arrival.gate, terminal: snap.arrival.terminal, baggage_claim: snap.arrival.baggageClaim },
        arrival_minutes_late: lateMin,
        cancelled: snap.cancelled,
        inbound_aircraft_inference: inboundMin > 0 ? { likely_departure_delay_minutes: inboundMin, note: "inference from the inbound aircraft, not airline data" } : null,
      };
    }
    if (name === "rights_for_trip") {
      if (!trip) return { error: "no itinerary yet" };
      const facts: TripFacts = { ...factsFor(trip, args.flight) };
      for (const k of ["disruption", "arrival_delay_h", "cause_category", "notice_days", "passenger_declined_alternative"] as const) {
        const v = args[k];
        if (v === null || v === undefined || v === "null" || v === "") continue; // models sometimes write null as text
        const numeric = (k === "arrival_delay_h" || k === "notice_days") && typeof v === "string" && /^\d+(\.\d+)?$/.test(v);
        (facts as Record<string, string | number | boolean | undefined>)[k] = numeric ? Number(v) : v;
      }
      // A delay seen in the flight data on the day of travel was notified 0 days before departure: a fact, not a question.
      if (facts.notice_days === undefined && facts.disruption === "delay") {
        const snap = deps.feed.findByIdent(args.flight);
        const sched = snap?.departure.scheduled;
        if (snap && sched && Date.parse(sched) - Date.parse(snap.observedAt) < 24 * 3.6e6) facts.notice_days = 0;
      }
      const already = asked.get(p.id) ?? [];
      const a = assess(deps.entries, facts, { lang: p.lang, alreadyAsked: already });
      if (a.question) asked.set(p.id, [...already, a.question.fact]);
      const byId = new Map(deps.entries.map((e) => [e.id, e]));
      for (const r of a.citable) {
        const e = byId.get(r.id)!;
        if (r.outcome === "applies" && r.amount) for (const [currency, value] of Object.entries(r.amount)) allowed.amounts.push({ currency, value });
        numbersIn(e.applies_when).forEach((n) => allowed.durations.push(n));
        numbersIn(e.deadlines ?? {}).forEach((n) => allowed.durations.push(n));
      }
      if (typeof facts.arrival_delay_h === "number") allowed.durations.push(facts.arrival_delay_h);
      return {
        applies: a.citable.filter((r) => r.outcome === "applies").map((r) => cite(byId.get(r.id)!, p.lang, r.amount)),
        may_apply: a.citable.filter((r) => r.outcome === "may_apply").map((r) => ({ ...cite(byId.get(r.id)!, p.lang), depends_on: r.missing })),
        question: a.question?.text ?? null,
        does_not_apply: a.results.filter((r) => r.outcome === "not_applies").map((r) => ({ id: r.id, why: r.reason })),
      };
    }
    return { error: `unknown tool ${name}` };
  }

  return { extractItinerary, agent };
}

function cite(e: RightEntry, lang: Lang, amount?: Record<string, number>) {
  return {
    id: e.id,
    rule: `${e.instrument}, art. ${e.article}`,
    summary: e.summary[lang],
    source: e.source_url,
    ...(amount ? { amount } : {}),
    ...(e.deadlines ? { deadlines: e.deadlines } : {}),
    status: e.status,
  };
}

/** ISO UTC time -> "YYYY-MM-DD HH:MM" in the airport's time zone. */
function local(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  const opts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }); // unknown zone: say UTC rather than crash
    return `${f.format(new Date(iso)).replace(",", "")} UTC`;
  }
  return f.format(new Date(iso)).replace(",", "");
}

export { norm };
