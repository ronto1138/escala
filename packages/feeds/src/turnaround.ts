/**
 * Minimum time to turn an aircraft around at the gate, by type, from the manufacturers' airport planning documents
 * (read 2026-10-28). Where a document gives both, the minimum (en route, transit, outstation) case is used, so a delay
 * is only foreseen when even the fastest documented turn cannot make it. The manufacturers say real times depend on each
 * airline's practices; charts with no printed total were read from the bars (about ±1 min). A type that is not listed
 * uses DEFAULT_TURN, and says so.
 */
export interface TurnTime {
  minutes: number;
  source: string;
}

export const DEFAULT_TURN: TurnTime = { minutes: 45, source: "default: aircraft type unknown" };

const TURNS: Record<string, TurnTime> = {
  A319: { minutes: 21, source: "Airbus AC A319, Jul 01/26, 5-3-0 minimum servicing (printed)" },
  A19N: { minutes: 21, source: "Airbus AC A319, Jul 01/26, 5-3-0 minimum servicing (printed)" },
  A320: { minutes: 22, source: "Airbus AC A320, Jul 01/26, 5-3-0 minimum servicing (printed)" },
  A20N: { minutes: 22, source: "Airbus AC A320, Jul 01/26, 5-3-0 minimum servicing (printed)" },
  A321: { minutes: 23, source: "Airbus AC A321, Jul 01/26, 5-3-0 minimum servicing (printed)" },
  A21N: { minutes: 23, source: "Airbus AC A321, Jul 01/26, 5-3-0 minimum servicing (printed)" },
  BCS1: { minutes: 20, source: "Airbus Canada A220 ACP Issue 013, Nov 27 2025, turnaround (printed; no minimum published)" },
  BCS3: { minutes: 20, source: "Airbus Canada A220 ACP Issue 013, Nov 27 2025, turnaround (printed; no minimum published)" },
  B737: { minutes: 15, source: "Boeing ACAPS 737NG Rev C, Oct 2025, 5.3.2 en route (printed 15.2)" },
  B738: { minutes: 16, source: "Boeing ACAPS 737NG Rev C, Oct 2025, 5.3.3 en route (printed 16.5)" },
  B739: { minutes: 18, source: "Boeing ACAPS 737NG Rev C, Oct 2025, 5.3.4 en route (printed)" },
  B38M: { minutes: 40, source: "Boeing ACAPS 737 MAX Rev K, Jul 2025, 5.2.2 turnaround (read from the chart; no en-route case published)" },
  B39M: { minutes: 23, source: "Boeing ACAPS 737 MAX Rev K, Jul 2025, 5.3.4 en route (read from the chart)" },
  B752: { minutes: 25, source: "Boeing ACAPS 757 Rev H, Dec 2024, 5.3.1 en route (read from the chart)" },
  B753: { minutes: 34, source: "Boeing ACAPS 757 Rev H, Dec 2024, 5.3.2 en route (read from the chart)" },
  B763: { minutes: 32, source: "Boeing ACAPS 767 Rev K, Dec 2024, 5.3.2 en route (read from the chart)" },
  B764: { minutes: 48, source: "Boeing ACAPS 767 Rev K, Dec 2024, 5.2.6 turnaround (read from the chart)" },
  B788: { minutes: 28, source: "Boeing ACAPS 787 Rev Q, Oct 2025, 5.3.1 en route (read from the chart)" },
  B789: { minutes: 28, source: "Boeing ACAPS 787 Rev Q, Oct 2025, 5.3.2 en route (read from the chart)" },
  B78X: { minutes: 42, source: "Boeing ACAPS 787 Rev Q, Oct 2025, 5.3.3 en route (read from the chart)" },
  B772: { minutes: 48, source: "Boeing ACAPS 777-200/-200ER/-300 Rev E, Dec 2024, 5.2.1 turnaround (read from the chart)" },
  B77W: { minutes: 35, source: "Boeing ACAPS 777-200LR/-300ER/-F Rev G, Dec 2024, 5.3.2 en route (read from the chart)" },
  A332: { minutes: 31, source: "Airbus AC A330, Dec 01/25, 5-3-0 transit (printed)" },
  A338: { minutes: 31, source: "Airbus AC A330, Dec 01/25, 5-3-0 transit (printed)" },
  A333: { minutes: 34, source: "Airbus AC A330, Dec 01/25, 5-3-0 transit (printed)" },
  A339: { minutes: 34, source: "Airbus AC A330, Dec 01/25, 5-3-0 transit (printed)" },
  A359: { minutes: 31, source: "Airbus AC A350, Jul 01/26, 5-3-0 transit (printed)" },
  A35K: { minutes: 34, source: "Airbus AC A350, Jul 01/26, 5-3-0 transit (printed)" },
  E190: { minutes: 18, source: "Embraer APM-1901 Rev 24, Nov 29 2024, Fig. 5.4 turnaround (read from the chart)" },
  CRJ7: { minutes: 20, source: "Bombardier CRJ700 APM CSP B-020 Rev 15, Dec 17 2015, total turnaround (printed)" },
  CRJ9: { minutes: 20, source: "Bombardier CRJ900 APM CSP C-020 Rev 11, Dec 17 2015, total turnaround (printed)" },
};

/** Turn time for an ICAO (or IATA) type code. */
export function turnTime(type: string | null | undefined, fallback: TurnTime = DEFAULT_TURN): TurnTime {
  return (type && TURNS[type.toUpperCase()]) || fallback;
}
