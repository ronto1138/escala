/** The provider-neutral view of a flight that the rest of PortulAIn uses. Times are ISO 8601 UTC. */
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

/** Subset of the AeroAPI v4 flight object (GET /flights/{ident}) that PortulAIn reads. */
export interface AeroFlight {
  ident: string;
  ident_iata?: string | null;
  fa_flight_id: string;
  operator: string | null;
  operator_iata?: string | null;
  inbound_fa_flight_id: string | null;
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
 * A change worth telling the traveler about. `inference: true` means PortulAIn deduced it from the data;
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
      likelyDepartureDelayMinutes: number;
    };
