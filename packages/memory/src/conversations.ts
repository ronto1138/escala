import { DatabaseSync } from "node:sqlite";
import type { MemoryCrypto } from "./crypto.ts";

/**
 * Where each person is in the conversation (the question Escala asked, the trip, the last few turns), encrypted per
 * person like the memory, so it survives restarts and deploys. The database holds an opaque person ref, a timestamp
 * and a blob; nothing is readable without the master key. The caller decides what the state contains.
 */
export class ConversationStore<T extends { id: string }> {
  private readonly db: DatabaseSync;
  private readonly crypto: MemoryCrypto;

  constructor(opts: { path: string; crypto: MemoryCrypto }) {
    this.db = new DatabaseSync(opts.path);
    this.crypto = opts.crypto;
    this.db.exec("CREATE TABLE IF NOT EXISTS conversations (person TEXT PRIMARY KEY, updated_at TEXT NOT NULL, blob TEXT NOT NULL)");
  }

  load(id: string): T | undefined {
    const ref = this.crypto.personRef(id);
    const row = this.db.prepare("SELECT blob FROM conversations WHERE person = ?").get(ref) as { blob: string } | undefined;
    return row ? this.crypto.decrypt<T>(ref, row.blob) : undefined;
  }

  save(state: T, at = new Date()) {
    const ref = this.crypto.personRef(state.id);
    this.db
      .prepare("INSERT INTO conversations(person, updated_at, blob) VALUES (?, ?, ?) ON CONFLICT(person) DO UPDATE SET updated_at = excluded.updated_at, blob = excluded.blob")
      .run(ref, at.toISOString(), this.crypto.encrypt(ref, state));
  }

  delete(id: string) {
    this.db.prepare("DELETE FROM conversations WHERE person = ?").run(this.crypto.personRef(id));
  }

  /** Every stored state, for the retention sweep. Decrypts each one; run it on a schedule, not per message. */
  *all(): Generator<T> {
    for (const row of this.db.prepare("SELECT person, blob FROM conversations").all() as Array<{ person: string; blob: string }>) {
      yield this.crypto.decrypt<T>(row.person, row.blob);
    }
  }

  close() {
    this.db.close();
  }
}
