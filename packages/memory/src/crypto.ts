import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Per-person encryption at rest. A master key (32 bytes, from the environment) derives one AES-256-GCM key per
 * person with HKDF, and an opaque lookup id with HMAC, so the database never holds a phone number in the clear
 * and one person's key cannot open another person's memory.
 */
export class MemoryCrypto {
  private readonly master: Buffer;

  constructor(masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error("memory master key must be 32 bytes");
    this.master = masterKey;
  }

  /** Reads ESCALA_MEMORY_KEY (base64, 32 bytes). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): MemoryCrypto {
    const b64 = env.ESCALA_MEMORY_KEY;
    if (!b64) throw new Error("ESCALA_MEMORY_KEY is missing (32 random bytes, base64)");
    return new MemoryCrypto(Buffer.from(b64, "base64"));
  }

  /** Opaque, stable id for a person: what the database stores instead of the phone number. */
  personRef(personId: string): string {
    return createHmac("sha256", this.master).update(`person:${personId}`).digest("hex");
  }

  private keyFor(personRef: string): Buffer {
    return Buffer.from(hkdfSync("sha256", this.master, Buffer.from(personRef, "hex"), "escala-memory-v1", 32));
  }

  encrypt(personRef: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keyFor(personRef), iv);
    cipher.setAAD(Buffer.from(personRef, "hex")); // a record copied to another person fails to decrypt
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
  }

  decrypt<T>(personRef: string, blob: string): T {
    const [iv, tag, ct] = blob.split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", this.keyFor(personRef), iv!);
    decipher.setAAD(Buffer.from(personRef, "hex"));
    decipher.setAuthTag(tag!);
    return JSON.parse(Buffer.concat([decipher.update(ct!), decipher.final()]).toString("utf8")) as T;
  }
}
