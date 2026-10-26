/**
 * Deterministic claim verifier. The model proposes; this code decides. Every amount of money and every
 * percentage in a draft must equal an amount the rights engine computed for this trip; every duration (hours,
 * days) must appear in the facts or the rules that were cited. No model is involved in this decision.
 */

export interface Allowed {
  /** Amounts from `applies` entries, e.g. [{ currency: "CAD", value: 400 }]. */
  amounts: Array<{ currency: string; value: number }>;
  percents: number[];
  /** Hours and days that appear in the cited rules, the trip facts or the flight data. */
  durations: number[];
}

export interface Claim {
  kind: "amount" | "percent" | "duration";
  text: string;
  value: number;
  currency?: string;
}

export interface Verdict {
  ok: boolean;
  claims: Claim[];
  unmatched: Claim[];
}

const CURRENCY: Record<string, string> = {
  $: "$", usd: "USD", "us$": "USD", cad: "CAD", "ca$": "CAD", "c$": "CAD", eur: "EUR", "€": "EUR", euros: "EUR", euro: "EUR",
  gbp: "GBP", "£": "GBP", mxn: "MXN", pesos: "MXN", dólares: "$", dollars: "$", dollar: "$",
};
const NUM = String.raw`\d{1,3}(?:[   .,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`US\$|CA\$|C\$|USD|CAD|EUR|GBP|MXN|€|£|\$|euros?|pesos|dólares|dollars?`;
const UNIT_H = String.raw`h|hrs?|hours?|horas?|heures?`;
const UNIT_D = String.raw`days?|días?|dias?|jours?`;

/** Parses "1,075", "1 075", "1.075" (thousands) and "3,5" / "3.5" (decimals). */
export function parseNumber(raw: string): number {
  const s = raw.replace(/[\s  ]/g, "");
  const m = s.match(/^(\d+)(?:([.,])(\d{3}))+$/);
  if (m) return Number(s.replace(/[.,]/g, "")); // only thousands separators
  return Number(s.replace(",", "."));
}

export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  const push = (c: Claim, start: number) => {
    const key = `${start}:${c.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      claims.push(c);
    }
  };
  for (const m of text.matchAll(new RegExp(String.raw`(${CUR})\s?(${NUM})`, "gi"))) {
    push({ kind: "amount", text: m[0], value: parseNumber(m[2]!), currency: CURRENCY[m[1]!.toLowerCase()] ?? m[1]! }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${NUM})\s?(${CUR})(?![a-z])`, "gi"))) {
    push({ kind: "amount", text: m[0], value: parseNumber(m[1]!), currency: CURRENCY[m[2]!.toLowerCase()] ?? m[2]! }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${NUM})\s?(%|por ciento|percent|pour cent)`, "gi"))) {
    push({ kind: "percent", text: m[0], value: parseNumber(m[1]!) }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${NUM})\s?(${UNIT_H}|${UNIT_D})\b`, "gi"))) {
    push({ kind: "duration", text: m[0], value: parseNumber(m[1]!) }, m.index!);
  }
  return claims;
}

export function verify(draft: string, allowed: Allowed): Verdict {
  const claims = extractClaims(draft);
  const unmatched = claims.filter((c) => {
    if (c.kind === "percent") return !allowed.percents.includes(c.value);
    if (c.kind === "duration") return !allowed.durations.includes(c.value);
    return !allowed.amounts.some(
      (a) => a.value === c.value && (a.currency === c.currency || (c.currency === "$" && ["USD", "CAD"].includes(a.currency))),
    );
  });
  return { ok: unmatched.length === 0, claims, unmatched };
}

/** Collects every number used in a rule condition or deadline, so cited thresholds can be repeated. */
export function numbersIn(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === "number") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}
