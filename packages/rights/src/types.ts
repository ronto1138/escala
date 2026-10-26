export type Lang = "en" | "es" | "fr";
export type Tri = "yes" | "no" | "unknown";

/** Facts about one trip. A missing (undefined) fact is "unknown", never "no". */
export interface TripFacts {
  as_of?: string; // ISO date of the event, for validity windows
  origin_country?: string; // ISO 3166-1 alpha-2
  destination_country?: string;
  final_destination_country?: string;
  origin_in_eu261_area?: boolean;
  destination_in_eu261_area?: boolean;
  operating_carrier?: string;
  operating_carrier_country?: string;
  carrier_is_eu261_carrier?: boolean;
  carrier_size_appr?: "large" | "small";
  itinerary_type?: "domestic" | "international";
  disruption?: "delay" | "cancellation" | "denied_boarding" | "tarmac" | "bag_delayed" | "bag_damaged" | "bag_lost" | "renumbered";
  arrival_delay_h?: number;
  /** Hours late at departure (care thresholds are measured from the scheduled departure). */
  departure_delay_h?: number;
  /** Country of the airport this flight leaves from (tarmac and denied-boarding rules look at the airport). */
  leg_origin_country?: string;
  carrier_is_uk_or_eu_carrier?: boolean;
  tarmac_h?: number;
  bag_delay_h?: number;
  /** A Mishandled Baggage Report (or PIR) was filed with the airline. */
  bag_report_filed?: boolean;
  /** The damaged or lost item is a wheelchair or other mobility device. */
  mobility_device?: boolean;
  /** All flights of the journey were bought in one booking. */
  single_booking?: boolean;
  /** One-way fare paid, and its currency, for rules that pay a percentage of it. */
  fare?: number;
  fare_currency?: string;
  cause_category?: "within_control" | "within_control_safety" | "outside_control";
  extraordinary_circumstances?: boolean;
  notice_days?: number;
  passenger_declined_alternative?: boolean;
  distance_km?: number;
  [other: string]: string | number | boolean | undefined;
}

export type Scalar = string | number | boolean;
export interface Comparison {
  eq?: Scalar;
  ne?: Scalar;
  in?: Scalar[];
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

/** Declarative condition. A leaf object with several keys means "all of them". */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { [fact: string]: Scalar | Comparison };

export interface AmountRule {
  when: Condition;
  /** Fixed amounts: currency code -> amount, e.g. { CAD: 400 }. */
  amount?: Record<string, number>;
  /** Or a percentage of the one-way fare, optionally capped per currency (US denied boarding: 200 %, max USD 1,075). */
  percent_of_fare?: number;
  cap?: Record<string, number>;
}

export type Localized = Record<Lang, string>;

export interface RightEntry {
  id: string;
  jurisdiction: string;
  instrument: string;
  article: string;
  status: "VERIFICADO" | "PARCIAL" | "NO_CONFIRMADO";
  source_url: string;
  verified_on: string;
  valid_from?: string;
  valid_to?: string;
  summary: Localized;
  applies_when: Condition;
  amount_rules?: AmountRule[];
  deadlines?: Record<string, number>;
  ask_if_unknown?: Record<string, Localized>;
  not_covered?: string[];
  tests?: Array<{ name: string; facts: TripFacts; expect: Outcome; amount?: Record<string, number> }>;
}

export type Outcome = "applies" | "may_apply" | "not_applies";

export interface EntryResult {
  id: string;
  outcome: Outcome;
  /** Facts whose absence keeps the entry at may_apply (or keeps its amount open). */
  missing: string[];
  /** Why it does not apply, or what it depends on. Human-readable, for the trust panel. */
  reason: string;
  /** Present only when the entry applies and exactly one amount rule matches. */
  amount?: Record<string, number>;
  /** For percentage rules: the percentage and cap, even when the fare is unknown and no amount can be computed. */
  percent?: number;
  cap?: Record<string, number>;
  verified: boolean;
}
