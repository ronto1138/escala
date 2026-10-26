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
  kind: "amount" | "percent" | "duration" | "number_word";
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
const CUR = String.raw`US\$|CA\$|C\$|USD|CAD|EUR|GBP|MXN|€|£|\$|euros?|pesos|(?:US\s|U\.S\.\s|canadian\s)?dollars?|dólares(?:\s(?:estadounidenses|canadienses))?|dollars?\s(?:américains|canadiens)`;
const UNIT = String.raw`h|hrs?|hours?|horas?|heures?|min|minutes?|minutos?|days?|días?|dias?|jours?|weeks?|semanas?|semaines?|months?|meses|mes|mois|years?|años?|ans?|années?`;
const SP = String.raw`[\s\u00a0\u202f]+`;
/** Optional whitespace. (`${SPO}` would be a lazy "one or more", not optional.) */
const SPO = String.raw`[\s\u00a0\u202f]*`;
/** Spelled-out numbers right before money, a percentage or a time unit cannot be checked: the draft fails closed. */
const WORD = String.raw`one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|` +
  String.raw`un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|cientos|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|` +
  String.raw`une|deux|trois|quatre|cinq|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|cents|mille`;
const NUMBER_WORDS_BEFORE_UNIT = () =>
  new RegExp(
    String.raw`\b(?:${WORD})(?:[\s-]+(?:and|y|et|-)?[\s-]*(?:${WORD}))*[\s\u00a0]+(?:${CUR}|percent|por ciento|pour cent|${UNIT})\b`,
    "gi",
  );

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
  const cur = (raw: string) => {
    const r = raw.toLowerCase().replace(/\s+/g, " ");
    if (/\b(us|u\.s\.)\b|américains|estadounidenses/.test(r)) return "USD";
    if (/canadian|canadiens|canadienses/.test(r)) return "CAD";
    return CURRENCY[r] ?? CURRENCY[r.split(" ").pop()!] ?? raw;
  };
  // A range ("400-600", "400 to 600", "entre 400 y 600") carries two claims; both are checked.
  const RANGE = String.raw`(${NUM})(?:${SPO}(?:-|–|—|to|a|à|y|et|and)${SPO}(${NUM}))?`;
  for (const m of text.matchAll(new RegExp(String.raw`(${CUR})${SPO}${RANGE}`, "gi"))) {
    const c = cur(m[1]!);
    push({ kind: "amount", text: m[0], value: parseNumber(m[2]!), currency: c }, m.index!);
    if (m[3]) push({ kind: "amount", text: m[0], value: parseNumber(m[3]), currency: c }, m.index! + 1);
  }
  for (const m of text.matchAll(new RegExp(String.raw`${RANGE}${SPO}(${CUR})(?![a-z])`, "gi"))) {
    const c = cur(m[3]!);
    if (m[2]) push({ kind: "amount", text: m[0], value: parseNumber(m[1]!), currency: c }, m.index! + 2);
    push({ kind: "amount", text: m[0], value: parseNumber(m[2] ?? m[1]!), currency: c }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${NUM})${SPO}(%|por ciento|percent|pour cent)`, "gi"))) {
    push({ kind: "percent", text: m[0], value: parseNumber(m[1]!) }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`${RANGE}${SPO}(${UNIT})\b`, "gi"))) {
    push({ kind: "duration", text: m[0], value: parseNumber(m[1]!) }, m.index!);
    if (m[2]) push({ kind: "duration", text: m[0], value: parseNumber(m[2]) }, m.index! + 1);
  }
  // Fail closed on spelled-out numbers next to money, percentages or time units ("four hundred dollars", "un año").
  for (const m of text.matchAll(NUMBER_WORDS_BEFORE_UNIT())) {
    push({ kind: "number_word", text: m[0], value: NaN }, m.index!);
  }
  return claims;
}

export function verify(draft: string, allowed: Allowed): Verdict {
  const claims = extractClaims(draft);
  const unmatched = claims.filter((c) => {
    if (c.kind === "number_word") return true; // cannot be checked: rewrite with digits
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
