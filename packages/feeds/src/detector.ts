import { arrivalMinutesLate } from "./normalize.ts";
import type { FlightEvent, FlightSnapshot } from "./types.ts";

export interface DetectorOptions {
  /** Report a new arrival estimate only when it moves at least this much. */
  delayStepMinutes?: number;
  /** Minimum time to turn the aircraft around at the gate before its next departure. */
  minTurnMinutes?: number;
}

/**
 * Compares two observations of the same flight and returns what changed. `inbound.curr` and `inbound.prev`
 * are the latest and previous observations of the aircraft's previous flight, if known. Pure function.
 */
export function detect(
  prev: FlightSnapshot | undefined,
  curr: FlightSnapshot,
  inbound: { curr?: FlightSnapshot | undefined; prev?: FlightSnapshot | undefined } = {},
  opts: DetectorOptions = {},
): FlightEvent[] {
  const step = opts.delayStepMinutes ?? 15;
  const minTurn = opts.minTurnMinutes ?? 45;
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

  const inboundEvent = inboundLate(curr, inbound.curr, minTurn, at);
  const prevInbound = prev ? inboundLate(prev, inbound.prev, minTurn, at) : undefined;
  if (inboundEvent && !curr.departure.actual) {
    const moved = !prevInbound || Math.abs(inboundEvent.likelyDepartureDelayMinutes - prevInbound.likelyDepartureDelayMinutes) >= step;
    if (moved) events.push(inboundEvent);
  }
  return events;
}

/** Minutes of likely departure delay because the inbound aircraft is late; 0 if none or unknown. */
export function inboundDelayMinutes(curr: FlightSnapshot, inbound: FlightSnapshot | undefined, minTurn = 45): number {
  return inboundLate(curr, inbound, minTurn, curr.observedAt)?.likelyDepartureDelayMinutes ?? 0;
}

/**
 * The aircraft that will operate this flight is still on its previous flight. If it cannot land, reach
 * the gate and turn around before the scheduled departure, a delay is likely. This is an inference.
 */
function inboundLate(
  curr: FlightSnapshot,
  inbound: FlightSnapshot | undefined,
  minTurn: number,
  at: string,
): Extract<FlightEvent, { kind: "inbound_late" }> | undefined {
  if (!inbound || inbound.flightId !== curr.inboundFlightId) return undefined;
  const inboundArrival = inbound.arrival.actual ?? inbound.arrival.estimated;
  const scheduledOut = curr.departure.scheduled;
  if (!inboundArrival || !scheduledOut || inbound.cancelled) return undefined;
  const readyAt = Date.parse(inboundArrival) + minTurn * 60_000;
  const delay = Math.round((readyAt - Date.parse(scheduledOut)) / 60_000);
  if (!Number.isFinite(delay) || delay <= 0) return undefined;
  return {
    kind: "inbound_late",
    flightId: curr.flightId,
    at,
    inference: true,
    inboundFlightId: inbound.flightId,
    inboundArrivalEstimate: inboundArrival,
    scheduledDeparture: scheduledOut,
    minTurnMinutes: minTurn,
    likelyDepartureDelayMinutes: delay,
  };
}
