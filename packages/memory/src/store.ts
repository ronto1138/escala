import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { MemoryCrypto } from "./crypto.ts";

/** Where a remembered fact came from. Every fact has one; a fact without a source is never stored. */
export interface Source {
  kind: "message" | "document" | "flight_data" | "derived";
  /** Message id, document hash, flight id, or the facts it was derived from. */
  ref: string;
  at: string;
  /** Short quote of what the person said or what the data showed, for "what do you know about me?". */
  quote?: string;
}

/**
 * - `trip`: what this trip needs (itinerary, choices, evidence). Expires when the trip and claim deadlines end.
 * - `profile`: what Escala learns about how the person travels. Only stored if the person turned it on.
 */
export type Scope = "trip" | "profile";

export interface Fact {
  id: string;
  scope: Scope;
  /** Machine key, e.g. "connection.missed", "bag.checked", "pref.language", "companion". */
  topic: string;
  /** Plain statement in the person's language, e.g. "Missed a 50-minute connection at ORD (March)". */
  statement: string;
  data?: Record<string, unknown>;
  source: Source;
  createdAt: string;
  expiresAt: string | null;
}

export interface Settings {
  share: Scope; // "trip" by default: the most private option
  features: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  share: "trip",
  features: { recommendations: false, proactive_alerts: true, deadline_reminders: true, photos: true, voice_notes: true },
};

export class ConsentError extends Error {}

/**
 * Encrypted, provenance-carrying memory on SQLite. The database holds an opaque person ref, the scope, the topic,
 * dates for retention, and an encrypted blob; statements, quotes and data are only readable with the master key.
 */
export class MemoryStore {
  private readonly db: DatabaseSync;
  private readonly crypto: MemoryCrypto;
  private readonly now: () => Date;

  constructor(opts: { path: string; crypto: MemoryCrypto; now?: () => Date }) {
    this.db = new DatabaseSync(opts.path);
    this.crypto = opts.crypto;
    this.now = opts.now ?? (() => new Date());
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY, person TEXT NOT NULL, scope TEXT NOT NULL, topic TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT, blob TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS facts_person ON facts(person);
      CREATE TABLE IF NOT EXISTS settings (person TEXT PRIMARY KEY, blob TEXT NOT NULL);
    `);
  }

  settings(personId: string): Settings {
    const ref = this.crypto.personRef(personId);
    const row = this.db.prepare("SELECT blob FROM settings WHERE person = ?").get(ref) as { blob: string } | undefined;
    return row ? { ...DEFAULT_SETTINGS, ...this.crypto.decrypt<Settings>(ref, row.blob) } : structuredClone(DEFAULT_SETTINGS);
  }

  updateSettings(personId: string, change: Partial<Settings>): Settings {
    const ref = this.crypto.personRef(personId);
    const next = { ...this.settings(personId), ...change, features: { ...this.settings(personId).features, ...(change.features ?? {}) } };
    if (next.share === "trip") next.features.recommendations = false; // learning-based suggestions need profile memory
    this.db.prepare("INSERT INTO settings(person, blob) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET blob = excluded.blob").run(ref, this.crypto.encrypt(ref, next));
    if (next.share === "trip") this.db.prepare("DELETE FROM facts WHERE person = ? AND scope = 'profile'").run(ref);
    return next;
  }

  /** Stores a fact. Profile facts require the person's consent; every fact requires a source. */
  remember(personId: string, f: Omit<Fact, "id" | "createdAt" | "expiresAt"> & { expiresAt?: string | null }): Fact {
    if (!f.source?.ref || !f.source.at) throw new Error("a fact without a source is never stored");
    if (f.scope === "profile" && this.settings(personId).share !== "profile") {
      throw new ConsentError("profile memory is off for this person");
    }
    const ref = this.crypto.personRef(personId);
    const fact: Fact = { ...f, id: randomUUID(), createdAt: this.now().toISOString(), expiresAt: f.expiresAt ?? null };
    this.db
      .prepare("INSERT INTO facts(id, person, scope, topic, created_at, expires_at, blob) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(fact.id, ref, fact.scope, fact.topic, fact.createdAt, fact.expiresAt, this.crypto.encrypt(ref, fact));
    return fact;
  }

  /** Facts still in force for this person, newest first. */
  recall(personId: string, opts: { scope?: Scope; topic?: string } = {}): Fact[] {
    const ref = this.crypto.personRef(personId);
    const now = this.now().toISOString();
    const rows = this.db
      .prepare(
        "SELECT blob FROM facts WHERE person = ? AND (expires_at IS NULL OR expires_at > ?) " +
          (opts.scope ? "AND scope = ? " : "") +
          (opts.topic ? "AND topic = ? " : "") +
          "ORDER BY created_at DESC",
      )
      .all(...([ref, now, opts.scope, opts.topic].filter((x) => x !== undefined) as string[])) as Array<{ blob: string }>;
    return rows.map((r) => this.crypto.decrypt<Fact>(ref, r.blob));
  }

  /** "Forget this" (one fact or a topic) or "forget everything". Returns how many facts were erased. */
  forget(personId: string, what: { factId: string } | { topic: string } | "all"): number {
    const ref = this.crypto.personRef(personId);
    if (what === "all") {
      this.db.prepare("DELETE FROM settings WHERE person = ?").run(ref);
      return Number(this.db.prepare("DELETE FROM facts WHERE person = ?").run(ref).changes);
    }
    if ("factId" in what) return Number(this.db.prepare("DELETE FROM facts WHERE person = ? AND id = ?").run(ref, what.factId).changes);
    return Number(this.db.prepare("DELETE FROM facts WHERE person = ? AND topic = ?").run(ref, what.topic).changes);
  }

  /** Deletes everything past its retention date. Run on a schedule. */
  purgeExpired(): number {
    return Number(this.db.prepare("DELETE FROM facts WHERE expires_at IS NOT NULL AND expires_at <= ?").run(this.now().toISOString()).changes);
  }

  close() {
    this.db.close();
  }
}

/** Retention for trip facts: the end of the trip plus the longest claim deadline that applies. */
export function tripRetention(tripEndIso: string, longestDeadlineDays: number): string {
  const d = new Date(tripEndIso);
  d.setUTCDate(d.getUTCDate() + Math.max(0, longestDeadlineDays));
  return d.toISOString();
}
