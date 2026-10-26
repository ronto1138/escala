import type { Comparison, Condition, EntryResult, Lang, RightEntry, Scalar, Tri, TripFacts } from "./types.ts";

interface Eval {
  value: Tri;
  missing: Set<string>;
  failed: string[]; // human-readable conditions that evaluated to "no"
}

const yes = (): Eval => ({ value: "yes", missing: new Set(), failed: [] });

/** Three-valued (Kleene) evaluation: a missing fact makes a condition "unknown", not "no". */
export function evaluate(cond: Condition, facts: TripFacts): Eval {
  if ("all" in cond && Array.isArray(cond.all)) return combine(cond.all.map((c) => evaluate(c, facts)), "all");
  if ("any" in cond && Array.isArray(cond.any)) return combine(cond.any.map((c) => evaluate(c, facts)), "any");
  if ("not" in cond && typeof cond.not === "object" && cond.not !== null && !Array.isArray(cond.not)) {
    const inner = evaluate(cond.not as Condition, facts);
    const value: Tri = inner.value === "yes" ? "no" : inner.value === "no" ? "yes" : "unknown";
    return { value, missing: inner.missing, failed: value === "no" ? [`not(${describe(cond.not as Condition)})`] : [] };
  }
  const leaves = Object.entries(cond).map(([fact, test]) => leaf(fact, test as Scalar | Comparison, facts));
  return combine(leaves, "all");
}

function leaf(fact: string, test: Scalar | Comparison, facts: TripFacts): Eval {
  const v = facts[fact];
  if (v === undefined || v === null) return { value: "unknown", missing: new Set([fact]), failed: [] };
  const ok = typeof test === "object" ? compare(v, test) : v === test;
  return ok ? yes() : { value: "no", missing: new Set(), failed: [`${fact}=${JSON.stringify(v)} fails ${JSON.stringify(test)}`] };
}

function compare(v: Scalar, c: Comparison): boolean {
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.ne !== undefined && v === c.ne) return false;
  if (c.in !== undefined && !c.in.includes(v)) return false;
  if (typeof v === "number") {
    if (c.gt !== undefined && !(v > c.gt)) return false;
    if (c.gte !== undefined && !(v >= c.gte)) return false;
    if (c.lt !== undefined && !(v < c.lt)) return false;
    if (c.lte !== undefined && !(v <= c.lte)) return false;
  } else if ([c.gt, c.gte, c.lt, c.lte].some((x) => x !== undefined)) {
    return false;
  }
  return true;
}

function combine(parts: Eval[], mode: "all" | "any"): Eval {
  const missing = new Set(parts.flatMap((p) => [...p.missing]));
  const failed = parts.flatMap((p) => p.failed);
  if (mode === "all") {
    if (parts.some((p) => p.value === "no")) return { value: "no", missing: new Set(), failed };
    if (parts.every((p) => p.value === "yes")) return { value: "yes", missing: new Set(), failed: [] };
    return { value: "unknown", missing, failed: [] };
  }
  if (parts.some((p) => p.value === "yes")) return { value: "yes", missing: new Set(), failed: [] };
  if (parts.every((p) => p.value === "no")) return { value: "no", missing: new Set(), failed };
  return { value: "unknown", missing, failed: [] };
}

const describe = (c: Condition) => JSON.stringify(c);

/** Evaluates one entry against the trip. Rules decide; the model only words what comes out of here. */
export function evaluateEntry(entry: RightEntry, facts: TripFacts): EntryResult {
  const verified = entry.status === "VERIFICADO";
  const asOf = facts.as_of;
  const day = (d: string) => Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d);
  if (asOf && entry.valid_from && day(asOf) < day(entry.valid_from)) {
    return { id: entry.id, outcome: "not_applies", missing: [], reason: `not in force until ${entry.valid_from}`, verified };
  }
  if (asOf && entry.valid_to && day(asOf) > day(entry.valid_to)) {
    return { id: entry.id, outcome: "not_applies", missing: [], reason: `no longer in force since ${entry.valid_to}`, verified };
  }
  if (!asOf && entry.valid_from) {
    return { id: entry.id, outcome: "may_apply", missing: ["as_of"], reason: "depends on the date", verified };
  }

  const r = evaluate(entry.applies_when, facts);
  if (r.value === "no") return { id: entry.id, outcome: "not_applies", missing: [], reason: r.failed.join("; "), verified };
  if (r.value === "unknown") {
    const missing = [...r.missing].sort();
    return { id: entry.id, outcome: "may_apply", missing, reason: `depends on: ${missing.join(", ")}`, verified };
  }

  if (!entry.amount_rules?.length) return { id: entry.id, outcome: "applies", missing: [], reason: "applies", verified };
  const rules = entry.amount_rules.map((rule) => ({ rule, ev: evaluate(rule.when, facts) }));
  const matches = rules.filter((x) => x.ev.value === "yes");
  if (matches.length === 1) {
    return { id: entry.id, outcome: "applies", missing: [], reason: "applies", amount: matches[0]!.rule.amount, verified };
  }
  const open = [...new Set(rules.filter((x) => x.ev.value === "unknown").flatMap((x) => [...x.ev.missing]))].sort();
  const reason = matches.length > 1 ? "amount ambiguous: more than one amount rule matches" : `amount depends on: ${open.join(", ")}`;
  return { id: entry.id, outcome: "applies", missing: open, reason, verified };
}

export interface Assessment {
  results: EntryResult[];
  /** What the product may cite: applies and may_apply. not_applies never reaches the model. */
  citable: EntryResult[];
  /** The single question worth asking, if any. */
  question?: { fact: string; text: string; resolves: string[] };
  /**
   * Rules that do not apply only because this trip falls short of a threshold (3.5 h when the rule needs 6 h).
   * Worth saying: "the US refund rule needs 6 hours on an international trip; you are at 3.5".
   */
  belowThreshold: EntryResult[];
}

/** Numeric facts whose threshold alone can decide a rule. */
const THRESHOLD_FACTS = ["arrival_delay_h", "notice_days", "distance_km"] as const;

/**
 * Evaluates all entries and picks at most one question: the missing fact that resolves the most entries,
 * among facts that have question text and were not asked before on this trip.
 */
export function assess(
  entries: RightEntry[],
  facts: TripFacts,
  opts: { lang: Lang; alreadyAsked?: string[] },
): Assessment {
  const results = entries.map((e) => evaluateEntry(e, facts));
  const citable = results.filter((r) => r.outcome !== "not_applies");
  const asked = new Set(opts.alreadyAsked ?? []);
  const texts = new Map<string, string>();
  for (const e of entries) for (const [fact, t] of Object.entries(e.ask_if_unknown ?? {})) texts.set(fact, t[opts.lang]);

  const tally = new Map<string, string[]>();
  for (const r of citable) for (const f of r.missing) if (texts.has(f) && !asked.has(f)) tally.set(f, [...(tally.get(f) ?? []), r.id]);
  const best = [...tally.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];

  const belowThreshold = results.filter((r, i) => {
    if (r.outcome !== "not_applies" || /in force/.test(r.reason)) return false;
    const given = THRESHOLD_FACTS.filter((f) => typeof facts[f] === "number");
    if (!given.length) return false;
    const without: TripFacts = { ...facts };
    for (const f of given) delete without[f];
    return evaluateEntry(entries[i]!, without).outcome !== "not_applies";
  });

  return {
    results,
    citable,
    belowThreshold,
    ...(best ? { question: { fact: best[0], text: texts.get(best[0])!, resolves: best[1] } } : {}),
  };
}
