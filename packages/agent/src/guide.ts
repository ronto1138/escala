import type { Lang } from "@escala/conversation";
import type { MetaClient } from "@escala/meta-client";

/**
 * The trip guide: getting around (airport transfers, transit, taxi or ride-hailing), places, events, tours and safety,
 * found with Muse Spark's built-in web search. What comes from the web is a suggestion with its sources and the date
 * it was checked; anything no source confirms is said to be unconfirmed (D45).
 */
export interface GuideResult {
  findings: string;
  sources: string[];
  checked_on: string;
  /** No web search ran or no source came back: the traveler must be told it could not be confirmed. */
  unconfirmed: boolean;
}

/** Rights and compensation are never looked up on the web: only the rules engine answers them. */
export const RIGHTS_TOPIC = /\b(compensat\w*|refund\w*|reimburs\w*|indemni\w*|reembols\w*|compensaci\w*|derechos?|rights?|droits?|remboursement\w*|APPR|EU ?261|reclam\w*)\b/i;

const LANG_NAME: Record<Lang, string> = { en: "English", es: "Spanish (Mexico)", fr: "French" };

export async function searchTravel(
  client: MetaClient,
  q: { query: string; place: string | null; lang: Lang; profile: string[]; today: string },
): Promise<GuideResult> {
  const instructions =
    `You research one question for a traveler and report back to their travel companion, in ${LANG_NAME[q.lang]}. ` +
    "Use web search at most twice. Prefer official sources (the airport, the transit agency, the city, government travel advisories) over aggregators and blogs. " +
    "Report in under 150 words. Give a price, a time, a schedule or an address only if a page you found states it, next to the name of that source. " +
    "If sources disagree or nothing confirms a detail, say so plainly. Do not describe your search, only what you found. " +
    "Never cover passenger rights, compensation or refunds." +
    (q.profile.length ? ` What the traveler told us about their preferences (use it to choose, mention it when it matters): ${q.profile.join("; ")}.` : "");
  const r = await client.responses(
    {
      model: "muse-spark-1.3",
      reasoning: { effort: "low" },
      max_output_tokens: 6000,
      instructions,
      input: [{ role: "user", content: `${q.query}${q.place ? ` (place: ${q.place})` : ""}. Today is ${q.today}.` }],
      tools: [{ type: "web_search" }],
    },
    { caller: "agent/guide" },
  );
  const output = (r.output ?? []) as any[];
  const searched = output.some((o) => o.type === "web_search_call");
  // Only the last message is the report; earlier ones narrate the search ("checking the 3rd…").
  const last = [...output].reverse().find((o) => o.type === "message");
  const parts = (last?.content ?? []) as any[];
  const findings = parts.map((c) => c.text ?? "").join("\n").trim() || String(r.output_text ?? "").trim();
  const cited = output
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .flatMap((c: any) => c.annotations ?? [])
    .map((a: any) => a.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const inText = findings.match(/https?:\/\/[^\s)\]>"]+/g) ?? [];
  const sources = [...new Set([...cited, ...inText])].slice(0, 4);
  return { findings, sources, checked_on: q.today, unconfirmed: !searched || sources.length === 0 };
}

// ---------- Units: exact, in code.

const UNITS: Record<string, { dim: string; toBase: (v: number) => number; fromBase: (v: number) => number }> = {
  km: { dim: "length", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  m: { dim: "length", toBase: (v) => v, fromBase: (v) => v },
  cm: { dim: "length", toBase: (v) => v / 100, fromBase: (v) => v * 100 },
  mi: { dim: "length", toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
  ft: { dim: "length", toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
  in: { dim: "length", toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
  kg: { dim: "mass", toBase: (v) => v, fromBase: (v) => v },
  g: { dim: "mass", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  lb: { dim: "mass", toBase: (v) => v * 0.45359237, fromBase: (v) => v / 0.45359237 },
  oz: { dim: "mass", toBase: (v) => v * 0.028349523125, fromBase: (v) => v / 0.028349523125 },
  l: { dim: "volume", toBase: (v) => v, fromBase: (v) => v },
  ml: { dim: "volume", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  gal: { dim: "volume", toBase: (v) => v * 3.785411784, fromBase: (v) => v / 3.785411784 }, // US gallon
  floz: { dim: "volume", toBase: (v) => v * 0.0295735295625, fromBase: (v) => v / 0.0295735295625 }, // US fluid ounce
  c: { dim: "temperature", toBase: (v) => v, fromBase: (v) => v },
  f: { dim: "temperature", toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 },
  kmh: { dim: "speed", toBase: (v) => v, fromBase: (v) => v },
  mph: { dim: "speed", toBase: (v) => v * 1.609344, fromBase: (v) => v / 1.609344 },
};

export const UNIT_NAMES = Object.keys(UNITS);

export function convertUnits(value: number, from: string, to: string): { value: number; from: string; to: string } | { error: string } {
  const a = UNITS[from.toLowerCase()];
  const b = UNITS[to.toLowerCase()];
  if (!a || !b) return { error: `unknown unit; use one of ${UNIT_NAMES.join(", ")}` };
  if (a.dim !== b.dim) return { error: `cannot convert ${a.dim} to ${b.dim}` };
  const out = b.fromBase(a.toBase(value));
  return { value: Math.round(out * 100) / 100, from, to };
}

// ---------- Currency: European Central Bank reference rates (official, free, daily, euro-based).

export const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface Rates {
  /** Units of each currency per euro. */
  perEuro: Record<string, number>;
  date: string;
}

export function parseEcb(xml: string): Rates {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const perEuro: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) perEuro[m[1]!] = Number(m[2]);
  if (!date || Object.keys(perEuro).length < 5) throw new Error("unexpected ECB format");
  return { perEuro, date };
}

/** Rates cached for six hours; the ECB publishes once a working day around 16:00 CET. */
export function createRates(fetchXml: () => Promise<string> = async () => {
  const r = await fetch(ECB_URL, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`ECB answered ${r.status}`);
  return r.text();
}) {
  let cached: { rates: Rates; at: number } | undefined;
  return async function convertCurrency(amount: number, from: string, to: string) {
    if (!cached || Date.now() - cached.at > 6 * 3.6e6) cached = { rates: parseEcb(await fetchXml()), at: Date.now() };
    const { perEuro, date } = cached.rates;
    const a = perEuro[from.toUpperCase()];
    const b = perEuro[to.toUpperCase()];
    if (!a || !b) return { error: `no reference rate for ${!a ? from : to}` };
    return {
      amount: Math.round(((amount / a) * b) * 100) / 100,
      currency: to.toUpperCase(),
      rate_date: date,
      source: "European Central Bank reference rate",
      note: "reference rate, not the rate a bank or exchange office will give",
    };
  };
}
