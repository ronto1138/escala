import { constants, createCipheriv, createDecipheriv, createHmac, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { InboundMessage, OutboundMessage } from "@escala/channel";

/**
 * Test phase (D43): Escala answers only numbers the team enrolled by hand, after telling each tester that the team
 * reads the conversations to improve Escala. Those conversations are written to the log sealed with a public key;
 * the private key never reaches the server, so neither the host nor the server can read them back.
 */

/** WhatsApp sends Mexican and Argentine mobiles with an extra digit (521…, 549…); both forms are the same person. */
export function canonicalNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (/^521\d{10}$/.test(d)) return `52${d.slice(3)}`;
  if (/^549\d{10}$/.test(d)) return `54${d.slice(3)}`;
  return d;
}

/**
 * A stable reference for an enrolled number, keyed with the memory master key: the list of enrolled numbers holds
 * these, never the numbers, and they cannot be reversed by trying numbers without the key.
 */
export function testerRef(masterKey: Buffer, number: string): string {
  return createHmac("sha256", masterKey).update(`tester:${canonicalNumber(number)}`).digest("hex").slice(0, 16);
}

export interface TranscriptRecord {
  who: string;
  at: string;
  dir: "in" | "out" | "forget";
  kind?: string;
  text?: string;
}

/** RSA-OAEP wraps a fresh AES-256-GCM key per record: version | wrapped key length (2 bytes) | wrapped key | iv | tag | ciphertext. */
export function seal(publicKeyPem: string, record: TranscriptRecord): string {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  const wrapped = publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  const head = Buffer.from([1, wrapped.length >> 8, wrapped.length & 0xff]);
  return Buffer.concat([head, wrapped, iv, cipher.getAuthTag(), body]).toString("base64");
}

export function open(privateKeyPem: string, box: string): TranscriptRecord {
  const b = Buffer.from(box, "base64");
  if (b[0] !== 1) throw new Error("unknown transcript version");
  const at = 3 + b.readUInt16BE(1);
  const wrapped = b.subarray(3, at);
  const iv = b.subarray(at, at + 12);
  const tag = b.subarray(at + 12, at + 28);
  const key = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, wrapped);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(b.subarray(at + 28)), decipher.final()]).toString("utf8"));
}

/** What a message says, as the tester saw it. Media are described, never downloaded again. */
export function inboundText(m: InboundMessage): { kind: string; text: string } {
  switch (m.kind) {
    case "text":
      return { kind: "text", text: m.text };
    case "interactive":
      return { kind: "tap", text: m.title };
    case "template_button":
      return { kind: "tap", text: m.text };
    case "location":
      return { kind: "location", text: m.name ?? "" };
    default:
      return { kind: m.voice ? "voice" : m.kind, text: m.caption ?? "" };
  }
}

export function outboundText(m: OutboundMessage): { kind: string; text: string } {
  switch (m.kind) {
    case "text":
      return { kind: "text", text: m.text };
    case "buttons":
      return { kind: "buttons", text: `${m.text}\n[${m.buttons.map((b) => b.title).join("] [")}]` };
    case "list":
      return { kind: "list", text: `${m.text}\n${m.sections.flatMap((s) => s.rows.map((r) => `· ${r.title}`)).join("\n")}` };
    case "template":
      return { kind: "template", text: `${m.name} ${JSON.stringify(m.bodyParams ?? [])}` };
    case "voice":
      return { kind: "voice", text: `[voice note, ${m.audio.length} bytes]` }; // the audio itself is never kept
  }
}

/** Numbers that enrolled themselves with an invitation code (the QR shared with the judges), kept across deploys. */
export interface TesterStore {
  has(ref: string): boolean;
  add(ref: string, label: string, at: Date): void;
  count(label: string): number;
}

/** Self-enrolled testers in the server's database: the keyed ref and the invitation label, never the number. */
export class SqliteTesterStore implements TesterStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS testers (ref TEXT PRIMARY KEY, label TEXT NOT NULL, enrolled_at TEXT NOT NULL)");
  }
  has(ref: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM testers WHERE ref = ?").get(ref));
  }
  add(ref: string, label: string, at: Date) {
    this.db.prepare("INSERT OR IGNORE INTO testers(ref, label, enrolled_at) VALUES (?, ?, ?)").run(ref, label, at.toISOString());
  }
  count(label: string) {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM testers WHERE label = ?").get(label) as { n: number }).n;
  }
}

export interface Invite {
  label: string;
  code: string;
  /** Last day (YYYY-MM-DD, UTC) the code enrolls someone. */
  until: string;
  max: number;
}

/** ESCALA_INVITES: `label:code:YYYY-MM-DD:max`, separated by `;`. Malformed entries are ignored. */
export function parseInvites(raw: string | undefined): Invite[] {
  return (raw ?? "")
    .split(";")
    .map((e) => e.trim().split(":"))
    .filter((p) => p.length === 4 && /^[a-z0-9-]{2,24}$/.test(p[0]!) && /^[A-Z0-9-]{8,32}$/.test(p[1]!) && /^\d{4}-\d{2}-\d{2}$/.test(p[2]!) && Number(p[3]) > 0)
    .map(([label, code, until, max]) => ({ label: label!, code: code!, until: until!, max: Number(max) }));
}

export interface TestPhaseOptions {
  masterKey: Buffer;
  /** Comma-separated tester refs. With no refs and no invitations, anyone may write and nothing is transcribed. */
  enrolled: string | undefined;
  /** Invitation codes that enroll whoever sends one (see parseInvites). */
  invites?: string | undefined;
  store?: TesterStore;
  /** PEM, or PEM in base64. Missing: no transcript. */
  publicKey: string | undefined;
  /** Last day (YYYY-MM-DD, UTC) transcripts are written; extended by changing the variable. */
  until: string | undefined;
  log(e: Record<string, unknown>): void;
  now?(): Date;
}

export function createTestPhase(o: TestPhaseOptions) {
  const enrolled = new Set((o.enrolled ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const invites = parseInvites(o.invites);
  const pem = o.publicKey && (o.publicKey.includes("BEGIN") ? o.publicKey : Buffer.from(o.publicKey, "base64").toString("utf8"));
  const until = Date.parse(`${o.until ?? "2026-11-30"}T23:59:59Z`);
  const now = o.now ?? (() => new Date());
  const ref = (id: string) => testerRef(o.masterKey, id);
  const closed = enrolled.size > 0 || invites.length > 0;
  const isTester = (id: string) => {
    const r = ref(id);
    return enrolled.has(r) || Boolean(o.store?.has(r));
  };
  const allowed = (id: string) => !closed || isTester(id);
  const recording = (id: string) => Boolean(pem) && closed && isTester(id) && now().getTime() <= until;
  const write = (id: string, r: Omit<TranscriptRecord, "who" | "at">) => {
    if (!recording(id)) return;
    try {
      o.log({ event: "transcript", box: seal(pem as string, { who: ref(id), at: now().toISOString(), ...r }) });
    } catch (err) {
      o.log({ event: "error", why: "transcript", error: String(err).slice(0, 80) });
    }
  };
  /**
   * A message from someone not enrolled that carries a live invitation code enrolls them. Returns the message without
   * the code (so the conversation reads the greeting), or null when there is no usable code.
   */
  const redeem = (m: InboundMessage): InboundMessage | null => {
    if (m.kind !== "text" || !o.store) return null;
    const words = m.text.toUpperCase().split(/[^A-Z0-9-]+/);
    const today = now().toISOString().slice(0, 10);
    const invite = invites.find((i) => words.includes(i.code));
    if (!invite) return null;
    if (invite.until < today || o.store.count(invite.label) >= invite.max) {
      o.log({ event: "invite_refused", label: invite.label, why: invite.until < today ? "expired" : "full" });
      return null;
    }
    o.store.add(ref(m.from), invite.label, now());
    o.log({ event: "enrolled", label: invite.label });
    const text = m.text.replace(new RegExp(`\\b${invite.code}\\b`, "gi"), "").replace(/\s{2,}/g, " ").trim();
    return { ...m, text: text || "Hi" };
  };
  return {
    closed,
    enrolledCount: enrolled.size,
    invites: invites.length,
    transcribing: Boolean(pem) && closed,
    allowed,
    redeem,
    ref,
    inbound: (m: InboundMessage) => write(m.from, { dir: "in", ...inboundText(m) }),
    outbound: (to: string, m: OutboundMessage) => write(to, { dir: "out", ...outboundText(m) }),
    /** "Delete everything": the local copy drops this person's lines when it next reads the log. */
    forget: (id: string) => write(id, { dir: "forget" }),
  };
}

/** The one answer someone who is not enrolled gets, once per restart. */
export const NOT_ENROLLED =
  "Escala is in a private test right now, open only to people the team has invited. / Escala está en una prueba privada, solo para personas invitadas por el equipo.";

/** What someone who joins with an invitation code reads first (the team tells the others in person). */
export const TEST_NOTICE =
  "Test phase: the Kokorio team reads conversations to improve Escala, and Meta may use them while we use free credits. Use made-up details.";
