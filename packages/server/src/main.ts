// Runs Escala on WhatsApp: the webhook, the conversation, the agent, the rules and the encrypted memory.
// Flights come from the replay feed (simulated data) until a flight data provider is connected.
// Listens on 127.0.0.1 by default: exposing it to the Internet is a separate, deliberate step.
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEscalaAgent } from "@escala/agent";
import type { InboundMessage } from "@escala/channel";
import { Conversation } from "@escala/conversation";
import { loadScenario, ReplayFeed } from "@escala/feeds";
import { MemoryCrypto, MemoryStore } from "@escala/memory";
import { createMetaClient, fileSink, type UsageLine } from "@escala/meta-client";
import { loadEntries } from "@escala/rights";
import { CloudApiChannel } from "./cloud.ts";
import { createWebhookHandler, tag } from "./webhook.ts";

const env = process.env;
const need = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is missing (see .env.example)`);
  return v;
};
const log = (e: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...e }));

const channel = new CloudApiChannel({
  accessToken: need("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: need("WHATSAPP_PHONE_NUMBER_ID"),
  ...(env.WHATSAPP_GRAPH_VERSION ? { graphVersion: env.WHATSAPP_GRAPH_VERSION } : {}),
});
// Usage lines (tokens, cost; never content) go to a file and to the log, so they can be collected from the host.
const usageFile = fileSink(env.USAGE_LOG ?? "usage.jsonl");
const usage = { write: async (line: UsageLine) => { log({ event: "usage", ...line }); await usageFile.write(line); } };
const client = createMetaClient({ apiKey: need("META_API_KEY"), usage, timeoutMs: 90_000 });
const dbPath = env.MEMORY_DB ?? "data/memory.db";
mkdirSync(dirname(dbPath), { recursive: true });
const memory = new MemoryStore({ path: dbPath, crypto: MemoryCrypto.fromEnv() });
// Retention is enforced, not just promised: expired facts are deleted at start and every hour.
const purge = () => log({ event: "purge", deleted: memory.purgeExpired() });
purge();
setInterval(purge, 60 * 60 * 1000).unref();
const scenario = fileURLToPath(new URL("../../feeds/scenarios/demo-inbound-late.yaml", import.meta.url));
const feed = new ReplayFeed(loadScenario(scenario));

const escala = createEscalaAgent({ client, feed, entries: loadEntries(), media: channel, memory });
new Conversation({
  channel,
  extractItinerary: escala.extractItinerary,
  agent: escala.agent!,
  onShareChanged: async (p) => void memory.updateSettings(p.id, { share: p.share }),
  onDelete: async (id) => {
    memory.forget(id, "all");
    escala.reset(id);
  },
});

// One person's messages are handled in order; different people in parallel. Capped so a flood cannot exhaust memory.
const MAX_QUEUES = 500;
const queues = new Map<string, Promise<void>>();
const deliver = (m: InboundMessage) => {
  if (!queues.has(m.from) && queues.size >= MAX_QUEUES) {
    log({ event: "shed", from: tag(m.from) });
    return Promise.resolve();
  }
  const next = (queues.get(m.from) ?? Promise.resolve()).then(() => channel.deliver(m)).catch((err) => {
    log({ event: "error", from: tag(m.from), error: String(err).slice(0, 200) });
  });
  queues.set(m.from, next);
  void next.finally(() => queues.get(m.from) === next && queues.delete(m.from));
  return Promise.resolve();
};

const handler = createWebhookHandler({ verifyToken: need("WHATSAPP_VERIFY_TOKEN"), appSecret: env.WHATSAPP_APP_SECRET, deliver, log });
const host = env.HOST ?? "127.0.0.1";
const port = Number(env.PORT ?? 8080);
// Nothing a request does may take the process down; a failure is logged (without content) and answered with 500.
process.on("unhandledRejection", (err) => log({ event: "error", why: "unhandled rejection", error: String(err).slice(0, 200) }));
const server = createServer((req, res) =>
  void handler(req, res).catch((err) => {
    log({ event: "error", why: "handler", error: String(err).slice(0, 200) });
    if (!res.headersSent) res.writeHead(500).end();
  }),
);
// Slow clients cannot hold connections open: headers in 10 s, the whole request in 30 s.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.listen(port, host, () => {
  log({ event: "listening", host, port, signed_deliveries: Boolean(env.WHATSAPP_APP_SECRET) });
});
