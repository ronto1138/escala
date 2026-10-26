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

// One person's messages are handled in order; different people in parallel.
const queues = new Map<string, Promise<void>>();
const deliver = (m: InboundMessage) => {
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
createServer((req, res) => void handler(req, res)).listen(port, host, () => {
  log({ event: "listening", host, port, signed_deliveries: Boolean(env.WHATSAPP_APP_SECRET) });
});
