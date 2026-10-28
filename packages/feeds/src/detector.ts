import { arrivalMinutesLate } from "./normalize.ts";
import { DEFAULT_TURN, turnTime, type TurnTime } from "./turnaround.ts";
import type { FlightEvent, FlightSnapshot } from "./types.ts";

export interface DetectorOptions {
  /** Report a new arrival estimate only when it moves at least this much. */
  delayStepMinutes?: number;
  /** Turn time to use for every aircraft, instead of the one for its type (tests). */
  minTurnMinutes?: number;
}

/**
 * Compares two observations of the same flight and returns what changed. `inbound.curr` and `inbound.prev`
 * are the latest and previous observations of the aircraft's earlier flights, nearest first, if known. Pure function.
 */
export function detect(
  prev: FlightSnapshot | undefined,
  curr: FlightSnapshot,
  inbound: { curr?: FlightSnapshot[]; prev?: FlightSnapshot[] } = {},
  opts: DetectorOptions = {},
): FlightEvent[] {
  const step = opts.delayStepMinutes ?? 15;
  const at = curr.observedAt;
  const id = curr.flightId;
  const events: FlightEvent[] = [];

  if (curr.cancelled && !prev?.cancelled) events.push({ kind: "cancelled", flightId: id, at, inference: false });
  if (curr.diverted && !prev?.diverted) events.push({ kind: "diverted", flightId: id, at, inference: false });
  if (curr.cancelled) return events;

  const late = arrivalMinutesLate(curr);
  const before = prev ? (arrivalMinutesLate(prev) ?? 0) : 0;
  if (late !== null && Math.abs(late - before) >= step && (late >= step || before >= step)) {
    events.push({ kind: "arrival_delay_change", flightId: id, at, inference: false, minutesLate: late, previousMinutesLate: before });
  }

  for (const side of ["departure", "arrival"] as const) {
    const to = curr[side].gate;
    const from = prev?.[side].gate ?? null;
    if (to && prev && to !== from) events.push({ kind: "gate_change", flightId: id, at, inference: false, side, from, to });
  }

  const belt = curr.arrival.baggageClaim;
  if (belt && prev && belt !== prev.arrival.baggageClaim) events.push({ kind: "baggage_claim", flightId: id, at, inference: false, belt });

  // The aircraft's earlier flights: a late one means this flight will likely leave late, until the airline says so.
  const minTurn = opts.minTurnMinutes;
  const likely = inboundLate(curr, inbound.curr ?? [], minTurn, at);
  const earlier = prev ? inboundLate(prev, inbound.prev ?? [], minTurn, at) : undefined;
  const swapped = Boolean(
    prev &&
      ((prev.inboundFlightId && curr.inboundFlightId !== prev.inboundFlightId) ||
        (prev.registration && curr.registration && prev.registration !== curr.registration)),
  );
  if (!curr.departure.actual) {
    if (swapped && (likely || earlier)) {
      events.push({ kind: "aircraft_changed", flightId: id, at, inference: false, likelyDepartureDelayMinutes: likely?.likelyDepartureDelayMinutes ?? 0 });
    } else if (likely) {
      if (!earlier || Math.abs(likely.likelyDepartureDelayMinutes - earlier.likelyDepartureDelayMinutes) >= step) events.push(likely);
    } else if (earlier && !airlineMovedDeparture(curr, step)) {
      events.push({ kind: "inbound_late_cleared", flightId: id, at, inference: true, aircraftChanged: false, previousDelayMinutes: earlier.likelyDepartureDelayMinutes });
    }
  }
  return events;
}

/** The aircraft's earlier flights, nearest first, as far back as `max` (stops where the provider does not link them). */
export function inboundChain(get: (flightId: string) => FlightSnapshot | undefined, snap: FlightSnapshot, max = 3): FlightSnapshot[] {
  const chain: FlightSnapshot[] = [];
  for (let id = snap.inboundFlightId; id && chain.length < max; ) {
    const f = get(id);
    if (!f || chain.some((c) => c.flightId === f.flightId)) break;
    chain.push(f);
    id = f.inboundFlightId;
  }
  return chain;
}

/** The likely departure delay because the aircraft is late on an earlier flight, with how it was worked out; undefined if none. */
export function inboundInference(curr: FlightSnapshot, chain: FlightSnapshot[], minTurn?: number) {
  return inboundLate(curr, chain, minTurn, curr.observedAt);
}

/** Minutes of likely departure delay because the aircraft is late on an earlier flight; 0 if none or unknown. */
export function inboundDelayMinutes(curr: FlightSnapshot, chain: FlightSnapshot[], minTurn?: number): number {
  return inboundInference(curr, chain, minTurn)?.likelyDepartureDelayMinutes ?? 0;
}

function airlineMovedDeparture(s: FlightSnapshot, step: number): boolean {
  const { scheduled, estimated } = s.departure;
  return Boolean(scheduled && estimated && Date.parse(estimated) - Date.parse(scheduled) >= step * 60_000);
}

/**
 * When the aircraft is ready to leave after the flights in `chain` (nearest first): each earlier flight that runs late
 * pushes the next one back by at least its turn time and its scheduled flight time. Null when the chain is unusable.
 */
function readyAfter(chain: FlightSnapshot[], minTurn: number | undefined): { readyAt: number; arrival: number; turn: TurnTime } | null {
  let ready: number | null = null;
  let last: { readyAt: number; arrival: number; turn: TurnTime } | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const h = chain[i]!;
    if (h.cancelled) {
      ready = null; // the aircraft's day was rearranged before this flight: what came earlier no longer says anything
      continue;
    }
    let arrival = Date.parse(h.arrival.actual ?? h.arrival.estimated ?? h.arrival.scheduled ?? "");
    const block = Date.parse(h.arrival.scheduled ?? "") - Date.parse(h.departure.scheduled ?? "");
    if (ready !== null && !h.departure.actual && Number.isFinite(block)) {
      const out = Math.max(Date.parse(h.departure.estimated ?? h.departure.scheduled ?? "") || 0, ready);
      arrival = Number.isFinite(arrival) ? Math.max(arrival, out + block) : out + block;
    }
    if (!Number.isFinite(arrival)) {
      ready = null;
      continue;
    }
    const turn = turnTime(h.aircraftType, minTurn === undefined ? DEFAULT_TURN : { minutes: minTurn, source: "configured" });
    ready = arrival + turn.minutes * 60_000;
    last = { readyAt: ready, arrival, turn };
  }
  return last;
}

/**
 * The aircraft that will operate this flight is still on an earlier flight. If it cannot land, reach the gate and turn
 * around before the scheduled departure, a delay is likely. This is an inference.
 */
function inboundLate(
  curr: FlightSnapshot,
  chain: FlightSnapshot[],
  minTurn: number | undefined,
  at: string,
): Extract<FlightEvent, { kind: "inbound_late" }> | undefined {
  const inbound = chain[0];
  if (!inbound || inbound.flightId !== curr.inboundFlightId || inbound.cancelled) return undefined;
  const scheduledOut = Date.parse(curr.departure.scheduled ?? "");
  // The turn at this flight's gate depends on this flight's aircraft type.
  const typed = chain.map((h, i) => (i === 0 && curr.aircraftType ? { ...h, aircraftType: curr.aircraftType } : h));
  const full = readyAfter(typed, minTurn);
  if (!full || !Number.isFinite(scheduledOut)) return undefined;
  const delay = Math.round((full.readyAt - scheduledOut) / 60_000);
  if (!Number.isFinite(delay) || delay <= 0) return undefined;
  // The nearest flight that already explains the whole delay is where it starts.
  let hops = typed.length;
  for (let k = 1; k < typed.length; k++) {
    const r = readyAfter(typed.slice(0, k), minTurn);
    if (r && Math.round((r.readyAt - scheduledOut) / 60_000) >= delay) {
      hops = k;
      break;
    }
  }
  return {
    kind: "inbound_late",
    flightId: curr.flightId,
    at,
    inference: true,
    inboundFlightId: inbound.flightId,
    inboundArrivalEstimate: new Date(full.arrival).toISOString().replace(".000Z", "Z"),
    scheduledDeparture: curr.departure.scheduled!,
    minTurnMinutes: full.turn.minutes,
    turnSource: full.turn.source,
    hops,
    likelyDepartureDelayMinutes: delay,
  };
}
