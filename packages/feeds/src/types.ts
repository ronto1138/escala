/** The provider-neutral view of a flight that the rest of Escala uses. Times are ISO 8601 UTC. */
export interface FlightSnapshot {
  source: "replay" | "aeroapi";
  ident: string; // e.g. "ZZ1234"
  flightId: string; // provider's unique id for this departure
  operator: string | null;
  origin: AirportRef;
  destination: AirportRef;
  departure: Times & { gate: string | null; terminal: string | null };
  arrival: Times & { gate: string | null; terminal: string | null; baggageClaim: string | null };
  cancelled: boolean;
  diverted: boolean;
  inboundFlightId: string | null;
  /** ICAO type code (e.g. "A320", "B38M"), IATA when the ICAO code is unknown; null when the provider does not say. */
  aircraftType: string | null;
  /** Tail number, when known. A new one means the airline swapped the aircraft. */
  registration: string | null;
  /** When this snapshot was observed. Every statement made from it carries this time. */
  observedAt: string;
}

export interface AirportRef {
  iata: string | null;
  icao: string | null;
  timezone: string | null;
}

export interface Times {
  scheduled: string | null;
  estimated: string | null;
  actual: string | null;
}

/** Subset of the AeroAPI v4 flight object (GET /flights/{ident}) that Escala reads. */
export interface AeroFlight {
  ident: string;
  ident_iata?: string | null;
  fa_flight_id: string;
  operator: string | null;
  operator_iata?: string | null;
  inbound_fa_flight_id: string | null;
  aircraft_type?: string | null;
  registration?: string | null;
  cancelled: boolean;
  diverted: boolean;
  origin: AeroAirport | null;
  destination: AeroAirport | null;
  gate_origin: string | null;
  gate_destination: string | null;
  terminal_origin: string | null;
  terminal_destination: string | null;
  baggage_claim: string | null;
  scheduled_out: string | null;
  estimated_out: string | null;
  actual_out: string | null;
  scheduled_in: string | null;
  estimated_in: string | null;
  actual_in: string | null;
  status?: string;
}

export interface AeroAirport {
  code: string | null;
  code_icao: string | null;
  code_iata: string | null;
  timezone: string | null;
}

/**
 * A change worth telling the traveler about. `inference: true` means Escala deduced it from the data;
 * the airline has not said it. Messages must label it as such.
 */
export type FlightEvent =
  | { kind: "cancelled"; flightId: string; at: string; inference: false }
  | { kind: "diverted"; flightId: string; at: string; inference: false }
  | { kind: "arrival_delay_change"; flightId: string; at: string; inference: false; minutesLate: number; previousMinutesLate: number }
  | { kind: "gate_change"; flightId: string; at: string; inference: false; side: "departure" | "arrival"; from: string | null; to: string }
  | { kind: "baggage_claim"; flightId: string; at: string; inference: false; belt: string }
  | {
      kind: "inbound_late";
      flightId: string;
      at: string;
      inference: true;
      inboundFlightId: string;
      inboundArrivalEstimate: string;
      scheduledDeparture: string;
      minTurnMinutes: number;
      /** Where the turn time comes from: the manufacturer's document for this type, or the default when the type is unknown. */
      turnSource: string;
      /** How many flights back the delay starts (1 = the previous flight of this aircraft). */
      hops: number;
      likelyDepartureDelayMinutes: number;
    }
  /** The earlier inference no longer holds: the aircraft caught up, or the airline put another one on the flight. */
  | { kind: "inbound_late_cleared"; flightId: string; at: string; inference: true; aircraftChanged: boolean; previousDelayMinutes: number }
  /** The airline put another aircraft on the flight (new previous flight or new tail number). */
  | { kind: "aircraft_changed"; flightId: string; at: string; inference: false; likelyDepartureDelayMinutes: number };
