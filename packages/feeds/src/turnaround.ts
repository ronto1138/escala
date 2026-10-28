/**
 * Minimum time to turn an aircraft around at the gate, by type. Figures come from the manufacturers' airport planning
 * documents (minimum servicing where they give it); a type that is not listed uses DEFAULT_TURN, and says so.
 */
export interface TurnTime {
  minutes: number;
  source: string;
}

export const DEFAULT_TURN: TurnTime = { minutes: 45, source: "default: aircraft type unknown" };

const TURNS: Record<string, TurnTime> = {};

/** Turn time for an ICAO (or IATA) type code. */
export function turnTime(type: string | null | undefined, fallback: TurnTime = DEFAULT_TURN): TurnTime {
  return (type && TURNS[type.toUpperCase()]) || fallback;
}
