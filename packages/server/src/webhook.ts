import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fromWebhook, verifySignature, type InboundMessage } from "@escala/channel";
import { PRIVACY_HTML } from "./privacy.ts";

const MAX_BODY_BYTES = 1024 * 1024;
const SEEN_LIMIT = 10_000;

export interface WebhookOptions {
  /** The token typed in the app's webhook settings; Meta sends it back once to verify the URL. */
  verifyToken: string;
  /** The app secret that signs every delivery (X-Hub-Signature-256). Without it, deliveries are refused. */
  appSecret: string | undefined;
  /** Each verified, new user message. Runs after the 200 is sent: Meta retries slow answers. */
  deliver(m: InboundMessage): Promise<void>;
  log?(event: Record<string, unknown>): void;
}

/**
 * A tag for logs instead of the phone number: keyed with a random key made at start, so it cannot be reversed by
 * trying phone numbers, and it does not link people across restarts.
 */
const TAG_KEY = randomBytes(32);
export const tag = (id: string) => createHmac("sha256", TAG_KEY).update(id).digest("hex").slice(0, 16);

/**
 * The WhatsApp webhook. Nothing is processed unless it is signed with the app secret; duplicate deliveries (Meta
 * retries) are processed once; the body is capped. Logs carry no message content and no phone numbers.
 */
export function createWebhookHandler(opts: WebhookOptions) {
  const log = opts.log ?? (() => {});
  const probeTag = createHash("sha256").update(`probe:${opts.verifyToken}`).digest("hex").slice(0, 16);
  const seen = new Set<string>();
  const remember = (id: string) => {
    seen.add(id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);
  };

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body = "", type = "text/plain") => {
      if (res.headersSent) return;
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    };
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost"); // "//[" throws: answered, never allowed to crash the process
    } catch {
      return reply(400);
    }

    if (url.pathname === "/health" && req.method === "GET") return reply(200, "ok");
    if (url.pathname === "/privacy" && req.method === "GET") return reply(200, PRIVACY_HTML, "text/html; charset=utf-8");
    if (url.pathname !== "/webhook") return reply(404);

    if (req.method === "GET") {
      const ok =
        url.searchParams.get("hub.mode") === "subscribe" &&
        sameSecret(url.searchParams.get("hub.verify_token") ?? "", opts.verifyToken);
      log({ event: "verify", ok });
      return ok ? reply(200, url.searchParams.get("hub.challenge") ?? "") : reply(403);
    }
    if (req.method !== "POST") return reply(405);
    // Our own checks (deploy script, operations report) carry a value only we can compute; they are refused exactly
    // the same way, and only labelled, so the report can tell them from someone else probing the webhook.
    const probe = req.headers["x-escala-probe"] === probeTag;
    if (!opts.appSecret) {
      log({ event: "refused", why: "no app secret configured", ...(probe ? { probe } : {}) });
      return reply(503);
    }

    let raw: Buffer;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch {
      return reply(413);
    }
    const header = req.headers["x-hub-signature-256"];
    if (!verifySignature(opts.appSecret, raw, typeof header === "string" ? header : undefined)) {
      log({ event: "refused", why: "bad signature", ...(probe ? { probe } : {}) });
      return reply(403);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply(400);
    }
    reply(200);

    let messages: InboundMessage[];
    try {
      messages = fromWebhook(payload);
    } catch (err) {
      log({ event: "error", why: "unreadable payload", error: String(err).slice(0, 120) });
      return;
    }
    for (const m of messages) {
      if (seen.has(m.id)) {
        log({ event: "duplicate", from: tag(m.from) });
        continue;
      }
      remember(m.id);
      log({ event: "inbound", from: tag(m.from), kind: m.kind });
      try {
        await opts.deliver(m);
      } catch (err) {
        log({ event: "error", from: tag(m.from), error: String(err).slice(0, 200) });
      }
    }
  };
}

function sameSecret(given: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
