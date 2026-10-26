import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { evaluateEntry } from "./engine.ts";
import type { RightEntry } from "./types.ts";

export * from "./types.ts";
export { assess, evaluate, evaluateEntry, type Assessment } from "./engine.ts";

export const DEFAULT_ENTRIES_DIR = fileURLToPath(new URL("../data/entries/", import.meta.url));

export function loadEntries(dir = DEFAULT_ENTRIES_DIR): RightEntry[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => parse(readFileSync(join(dir, f), "utf8")) as RightEntry);
}

/** Problems that make the base unusable. An empty list means the base is valid. */
export function validateEntries(entries: RightEntry[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const e of entries) {
    const where = e.id ?? "(no id)";
    if (!e.id) problems.push(`${where}: missing id`);
    if (ids.has(e.id)) problems.push(`${where}: duplicate id`);
    ids.add(e.id);
    for (const k of ["jurisdiction", "instrument", "article", "status", "source_url", "verified_on", "applies_when"] as const) {
      if (e[k] === undefined || e[k] === "") problems.push(`${where}: missing ${k}`);
    }
    for (const lang of ["en", "es", "fr"] as const) if (!e.summary?.[lang]) problems.push(`${where}: missing summary.${lang}`);
    if (e.source_url && !/^https:\/\//.test(e.source_url)) problems.push(`${where}: source_url must be https`);
    const empty = (c: unknown): boolean =>
      !!c && typeof c === "object" &&
      ((Array.isArray((c as any).all) && ((c as any).all.length === 0 || (c as any).all.some(empty))) ||
        (Array.isArray((c as any).any) && ((c as any).any.length === 0 || (c as any).any.some(empty))));
    if (empty(e.applies_when)) problems.push(`${where}: empty all/any in applies_when (would be vacuously true or false)`);

    if (e.status === "VERIFICADO") {
      const kinds = new Set((e.tests ?? []).map((t) => t.expect));
      for (const k of ["applies", "may_apply", "not_applies"] as const) {
        if (!kinds.has(k)) problems.push(`${where}: VERIFICADO entries need a "${k}" test`);
      }
    }
    for (const [i, rule] of (e.amount_rules ?? []).entries()) {
      if (!rule.amount === (rule.percent_of_fare === undefined)) problems.push(`${where}: amount rule ${i} needs exactly one of amount or percent_of_fare`);
    }
    for (const t of e.tests ?? []) {
      const r = evaluateEntry(e, t.facts);
      if (r.outcome !== t.expect) problems.push(`${where}: test "${t.name}" expected ${t.expect}, got ${r.outcome} (${r.reason})`);
      if (t.amount && JSON.stringify(r.amount) !== JSON.stringify(t.amount)) {
        problems.push(`${where}: test "${t.name}" expected amount ${JSON.stringify(t.amount)}, got ${JSON.stringify(r.amount)}`);
      }
    }
  }
  return problems;
}
