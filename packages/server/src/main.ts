// Runs Escala on WhatsApp: the webhook, the conversation, the agent, the rules and the encrypted memory.
// Flights come from the replay feed (simulated data) until a flight data provider is connected.
// Listens on 127.0.0.1 by default: exposing it to the Internet is a separate, deliberate step.
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AIRPORTS, createEscalaAgent, longestDeadlineDays, readIntent, type TraceStep } from "@escala/agent";
import type { InboundMessage } from "@escala/channel";
import { Conversation, keywordIntent } from "@escala/conversation";
import { loadScenario, ReplayClock } from "@escala/feeds";
import { MemoryCrypto, MemoryStore } from "@escala/memory";
import { createMetaClient, createOpenModelClient, fileSink, type UsageLine } from "@escala/meta-client";
import { loadEntries } from "@escala/rights";
import { toWav, tripKeywords } from "./audio.ts";
import { Budget } from "./budget.ts";
import { CloudApiChannel } from "./cloud.ts";
import { createNotifier } from "./notifier.ts";
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
const budget = new Budget({
  perPersonHour: Number(env.LIMIT_MESSAGES_PER_HOUR ?? 30),
  mediaPerPersonHour: Number(env.LIMIT_MEDIA_PER_HOUR ?? 10),
  dailyUsd: Number(env.LIMIT_DAILY_USD ?? 5),
});
const usage = {
  write: async (line: UsageLine) => {
    budget.spend(line.cost_usd);
    log({ event: "usage", ...line });
    await usageFile.write(line);
  },
};
const client = createMetaClient({ apiKey: need("META_API_KEY"), usage, timeoutMs: 90_000 });
const dbPath = env.MEMORY_DB ?? "data/memory.db";
mkdirSync(dirname(dbPath), { recursive: true });
const memory = new MemoryStore({ path: dbPath, crypto: MemoryCrypto.fromEnv() });
// Retention is enforced, not just promised: expired facts are deleted at start and every hour.
const claimDays = longestDeadlineDays(loadEntries());
const scenario = fileURLToPath(new URL("../../feeds/scenarios/demo-inbound-late.yaml", import.meta.url));
// Flights are simulated (no flight data provider yet): the demo scenario plays in real time, faster than life, from
// the moment someone confirms a trip with its flights, so changes and their alerts arrive on their own.
const feed = new ReplayClock(loadScenario(scenario), { secondsPerMinute: Number(env.REPLAY_SECONDS_PER_MINUTE ?? 3) });

// Muse Spark Open on Baseten: the memory that learns (D36). Optional; without the key Escala only remembers on request.
const learner = env.BASETEN_API_KEY ? createOpenModelClient({ apiKey: env.BASETEN_API_KEY, usage, timeoutMs: 60_000 }) : undefined;
// What the agent decided, for the operations report: counts and kinds only, never content.
const escala = createEscalaAgent({
  client, feed, entries: loadEntries(), media: channel, memory, ...(learner ? { learner } : {}),
  trace: (s: TraceStep) => log(traceEvent(s)),
});
const conversation = new Conversation({
  channel,
  extractItinerary: escala.extractItinerary,
  agent: escala.agent!,
  // Short answers to Escala's questions: keywords first, Muse Spark when they are not enough.
  understand: async (text, p) => {
    const k = keywordIntent(text, p.lang);
    if (k !== "other") return k;
    try {
      return await readIntent(client, text, p.lang, p.awaiting);
    } catch (err) {
      log({ event: "error", why: "intent", error: String(err).slice(0, 120) });
      return "other";
    }
  },
  // Voice notes: download, convert in memory, transcribe with the trip's places as hints. Audio is never stored.
  transcribe: async (m, p) => {
    try {
      const dataUrl = await channel.dataUrl(m.mediaId, m.mimeType);
      const match = /^data:[\w.+-]+\/[\w.+-]+;base64,/.exec(dataUrl);
      if (!match) throw new Error("media is not a base64 data URL");
      const wav = await toWav(Buffer.from(dataUrl.slice(match[0].length), "base64"));
      const keywords = tripKeywords(p?.trip, (code) => AIRPORTS[code]?.city);
      return (await client.transcribe(wav, { keywords }, { caller: "voice/transcribe" })).text || null;
    } catch (err) {
      log({ event: "error", why: "voice note", from: tag(m.from), error: String(err).slice(0, 200) });
      return null;
    }
  },
  onShareChanged: async (p) => void memory.updateSettings(p.id, { share: p.share }),
  onTripConfirmed: async (p) => {
    const legs = (p.trip as { legs?: Array<{ flight: string }> } | undefined)?.legs ?? [];
    const played = feed.idents();
    if (legs.some((l) => played.includes(l.flight.replace(/\s+/g, "").toUpperCase()))) {
      feed.restart();
      log({ event: "demo_replay", from: tag(p.id) });
    }
  },
  onDelete: async (id) => {
    memory.forget(id, "all");
    escala.reset(id);
  },
});

// Retention for what lives in this process and in the database, hourly. A failure is logged and retried next hour.
const sweep = () => {
  try {
    log({ event: "purge", deleted: memory.purgeExpired(), forgotten: conversation.evict(Date.now(), claimDays) });
    escala.sweep();
  } catch (err) {
    log({ event: "error", why: "purge", error: String(err).slice(0, 120) });
  }
};
sweep();
setInterval(sweep, 60 * 60 * 1000).unref();

// One person's messages are handled in order; different people in parallel. Capped so a flood cannot exhaust memory,
// and every message passes the spending limits first (per person and per day for the whole service).
const MAX_QUEUES = 500;
const MAX_PENDING_PER_PERSON = 5;
const queues = new Map<string, Promise<void>>();
const pending = new Map<string, number>();
const deliver = (m: InboundMessage) => {
  const kind = m.kind === "text" ? "text" : "media";
  if ((!queues.has(m.from) && queues.size >= MAX_QUEUES) || (pending.get(m.from) ?? 0) >= MAX_PENDING_PER_PERSON || !budget.allow(m.from, kind)) {
    log({ event: "shed", from: tag(m.from), why: budget.why(m.from) });
    return Promise.resolve();
  }
  pending.set(m.from, (pending.get(m.from) ?? 0) + 1);
  const received = Date.now();
  const next = (queues.get(m.from) ?? Promise.resolve())
    .then(() => channel.deliver(m))
    .then(() => log({ event: "handled", from: tag(m.from), kind: m.kind, ms: Date.now() - received }))
    .catch((err) => log({ event: "error", from: tag(m.from), error: String(err).slice(0, 200) }))
    .finally(() => pending.set(m.from, Math.max(0, (pending.get(m.from) ?? 1) - 1)));
  queues.set(m.from, next);
  void next.finally(() => queues.get(m.from) === next && queues.delete(m.from));
  return Promise.resolve();
};

// Every message sent, counted by kind; failures with Meta's error code (never the text).
const sendRaw = channel.send.bind(channel);
channel.send = async (to, m) => {
  try {
    const r = await sendRaw(to, m);
    log({ event: "sent", kind: m.kind });
    return r;
  } catch (err) {
    log({ event: "send_failed", kind: m.kind, error: String(err).slice(0, 160) });
    throw err;
  }
};

// Flight changes become messages: free text inside the 24-hour window, the approved template outside it.
const notify = createNotifier({ send: (to, m) => channel.send(to, m), windowOpen: (to) => channel.windowOpen(to), people: () => conversation.people.values(), log });
feed.subscribe((events, snap) => void notify(events, snap));

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

/** One agent step as a log event, without any content: how many parts, blocked figures, tool names, outcomes. */
function traceEvent(s: TraceStep): Record<string, unknown> {
  switch (s.kind) {
    case "scope":
      return { event: "guard", parts: s.parts.length, out: s.parts.filter((p) => !p.in_scope).length };
    case "verify":
      return { event: "verify_figures", attempt: s.attempt, ok: s.verdict.ok, claims: s.verdict.claims.length, blocked: s.verdict.unmatched.length };
    case "fallback":
      return { event: "fallback", reason: s.reason.slice(0, 60) };
    case "tool": {
      const r = s.result as { kept?: unknown[]; error?: unknown } | undefined;
      return { event: "tool", name: s.name, ...(s.name === "learn" ? { kept: r?.kept?.length ?? 0 } : {}), ...(r && typeof r === "object" && "error" in r ? { failed: true } : {}) };
    }
  }
}

