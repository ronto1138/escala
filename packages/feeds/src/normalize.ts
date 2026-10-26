import type { AeroAirport, AeroFlight, AirportRef, FlightSnapshot } from "./types.ts";

export function fromAeroFlight(f: AeroFlight, observedAt: string, source: FlightSnapshot["source"]): FlightSnapshot {
  return {
    source,
    ident: f.ident_iata ?? f.ident,
    flightId: f.fa_flight_id,
    operator: f.operator_iata ?? f.operator,
    origin: airport(f.origin),
    destination: airport(f.destination),
    departure: {
      scheduled: f.scheduled_out,
      estimated: f.estimated_out,
      actual: f.actual_out,
      gate: f.gate_origin,
      terminal: f.terminal_origin,
    },
    arrival: {
      scheduled: f.scheduled_in,
      estimated: f.estimated_in,
      actual: f.actual_in,
      gate: f.gate_destination,
      terminal: f.terminal_destination,
      baggageClaim: f.baggage_claim,
    },
    cancelled: f.cancelled,
    diverted: f.diverted,
    inboundFlightId: f.inbound_fa_flight_id,
    observedAt,
  };
}

function airport(a: AeroAirport | null): AirportRef {
  return { iata: a?.code_iata ?? null, icao: a?.code_icao ?? null, timezone: a?.timezone ?? null };
}

/** Minutes between scheduled and best-known arrival (actual, else estimated). Null when unknown. */
export function arrivalMinutesLate(s: FlightSnapshot): number | null {
  const best = s.arrival.actual ?? s.arrival.estimated;
  if (!best || !s.arrival.scheduled) return null;
  return Math.round((Date.parse(best) - Date.parse(s.arrival.scheduled)) / 60_000);
}
