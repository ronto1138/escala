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
  /** Weights in pounds that Escala converted: "50.71 pounds" said of a bag. */
  weights?: number[];
}

export interface Claim {
  kind: "amount" | "percent" | "duration" | "number_word";
  text: string;
  value: number;
  currency?: string;
  /** Written as a bare pound, libra or livre: money or a weight. */
  maybeWeight?: boolean;
}

export interface Verdict {
  ok: boolean;
  claims: Claim[];
  unmatched: Claim[];
}

// "Pound", "libra" and "livre" alone are weights as often as money (a 50-pound bag): they are read as pounds sterling,
// and pass only if they are a weight Escala converted (Allowed.weights), never as money.
const CURRENCY: Record<string, string> = {
  $: "$", usd: "USD", "us$": "USD", cad: "CAD", "ca$": "CAD", "c$": "CAD", eur: "EUR", "€": "EUR", euros: "EUR", euro: "EUR",
  gbp: "GBP", "£": "GBP", pound: "GBP", pounds: "GBP", libra: "GBP", libras: "GBP", livre: "GBP", livres: "GBP", sterling: "GBP", esterlina: "GBP", esterlinas: "GBP",
  mxn: "MXN", pesos: "MXN", dólares: "$", dollars: "$", dollar: "$",
  sdr: "SDR", xdr: "SDR", deg: "SDR", dts: "SDR", uma: "UMA",
  jpy: "JPY", "¥": "JPY", yen: "JPY", yenes: "JPY", chf: "CHF", francs: "CHF", francos: "CHF", aud: "AUD", cny: "CNY", inr: "INR",
};
// Thousands groups only when there is at least one separator; otherwise "2026" would read as "202" and "6".
const NUM = String.raw`\d{1,3}(?:[   .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`US\$|CA\$|C\$|USD|CAD|EUR|GBP|MXN|SDR|XDR|DEG|DTS|UMA|JPY|CHF|AUD|CNY|INR|€|£|¥|\$|euros?|pesos|(?:pounds?|livres?)\s+sterling|libras?\s+esterlinas?|pounds?|libras?|livres?|sterling|yen(?:es)?|francs?|francos?|(?:US\s|U\.S\.\s|canadian\s)?dollars?|dólares(?:\s(?:estadounidenses|canadienses))?|dollars?\s(?:américains|canadiens)`;
const UNIT = String.raw`s|secs?|seconds?|segundos?|secondes?|h|hrs?|hours?|horas?|heures?|min|minutes?|minutos?|days?|días?|dias?|jours?|weeks?|semanas?|semaines?|months?|meses|mes|mois|years?|años?|ans?|années?`;
const SP = String.raw`[\s\u00a0\u202f]+`;
/** Optional separator between a number and its unit: whitespace and stray punctuation ("600-CAD", "600(CAD)"). */
const SPO = String.raw`[\s\u00a0\u202f\-–—/().]*`;
const PCT = String.raw`%|pct\.?|per\s*cent|percent|por\s*ciento|porciento|pour\s*cent|pourcent`;
/** Spelled-out numbers right before money, a percentage or a time unit cannot be checked: the draft fails closed. */
const WORD = String.raw`zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|` +
  String.raw`cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|cientos|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|` +
  String.raw`zéro|une|deux|trois|quatre|cinq|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix-sept|dix-huit|dix-neuf|vingt|trente|quarante|cinquante|soixante|cent|cents|mille`;
const NUMBER_WORDS_BEFORE_UNIT = () =>
  new RegExp(
    String.raw`\b(?:${WORD})(?:[\s-]+(?:and|y|et|-)?[\s-]*(?:${WORD}))*[\s\u00a0]+(?:${CUR}|${PCT}|${UNIT})\b`,
    "gi",
  );

/** Parses "1,075", "1 075", "1.075" (thousands) and "3,5" / "3.5" (decimals). */
export function parseNumber(raw: string): number {
  const s = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (/^\d+(?:[.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, "")); // only thousands separators
  const last = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (last < 0) return Number(s);
  // "17,596.50" and "17.596,50": the last separator is the decimal one, the others group thousands.
  return Number(`${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}`);
}

export function extractClaims(raw: string): Claim[] {
  // A clock time is not a duration: "13:50 hora de Chicago" must not read as "50 horas". Same length, so positions hold.
  const text = raw.replace(/\b(\d{1,2}):(\d{2})\b/g, (m) => "#".repeat(m.length));
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
  const weightWord = (raw: string) => (/^(?:pounds?|libras?|livres?)$/i.test(raw.trim()) ? { maybeWeight: true } : {});
  // A range or an alternative ("400-600", "400 to 600", "entre 400 y 600", "400 or 600") carries two claims.
  const RANGE = String.raw`(${NUM})(?:[\s\u00a0\u202f]*(?:-|–|—|\bto\b|\ba\b|\bà\b|\by\b|\bet\b|\band\b|\bor\b|\bo\b|\bou\b)[\s\u00a0\u202f]*(${NUM}))?`;
  for (const m of text.matchAll(new RegExp(String.raw`(${CUR})${SPO}${RANGE}`, "gi"))) {
    const c = cur(m[1]!);
    push({ kind: "amount", text: m[0], value: parseNumber(m[2]!), currency: c, ...weightWord(m[1]!) }, m.index!);
    if (m[3]) push({ kind: "amount", text: m[0], value: parseNumber(m[3]), currency: c, ...weightWord(m[1]!) }, m.index! + 1);
  }
  // "art. 20 — 1,800 CAD": the first number is an article, not the start of a range.
  const afterArticle = (at: number) => /(?:\bart(?:icle|ículo|iculo)?s?\.?|\bs\.|§|\bsection|\bsecci[oó]n|\bpart(?:e|ie)?)\s*$/i.test(text.slice(Math.max(0, at - 12), at));
  for (const m of text.matchAll(new RegExp(String.raw`${RANGE}${SPO}(${CUR})(?![a-z])`, "gi"))) {
    const c = cur(m[3]!);
    if (m[2] && !afterArticle(m.index!)) push({ kind: "amount", text: m[0], value: parseNumber(m[1]!), currency: c, ...weightWord(m[3]!) }, m.index! + 2);
    push({ kind: "amount", text: m[0], value: parseNumber(m[2] ?? m[1]!), currency: c, ...weightWord(m[3]!) }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`(${NUM})${SPO}(${PCT})`, "gi"))) {
    push({ kind: "percent", text: m[0], value: parseNumber(m[1]!) }, m.index!);
  }
  for (const m of text.matchAll(new RegExp(String.raw`${RANGE}${SPO}(${UNIT})\b`, "gi"))) {
    if (!(m[2] && afterArticle(m.index!))) push({ kind: "duration", text: m[0], value: parseNumber(m[1]!) }, m.index!);
    if (m[2]) push({ kind: "duration", text: m[0], value: parseNumber(m[2]) }, m.index! + 1);
  }
  // Fail closed on spelled-out numbers next to money, percentages or time units ("four hundred dollars", "un año").
  for (const m of text.matchAll(NUMBER_WORDS_BEFORE_UNIT())) {
    push({ kind: "number_word", text: m[0], value: NaN }, m.index!);
  }
  return claims;
}

export function verify(draft: string, allowed: Allowed): Verdict {
  // Links are not claims: a map link carries coordinates and "%2C", a source link carries dates and ids.
  const claims = extractClaims(draft.replace(/https?:\/\/\S+/g, " "));
  const unmatched = claims.filter((c) => {
    if (c.kind === "number_word") return true; // cannot be checked: rewrite with digits
    if (c.kind === "percent") return !allowed.percents.includes(c.value);
    if (c.kind === "duration") return !allowed.durations.includes(c.value);
    if (c.maybeWeight && allowed.weights?.includes(c.value)) return false;
    return !allowed.amounts.some(
      (a) =>
        a.value === c.value &&
        (a.currency === c.currency ||
          // "$" is dollars or pesos: a bare "$" matches any of them, either way round (a source wrote "$49.45", the answer "49.45 CAD").
          (c.currency === "$" && ["USD", "CAD", "MXN"].includes(a.currency)) ||
          (a.currency === "$" && ["USD", "CAD", "MXN"].includes(c.currency ?? ""))),
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
