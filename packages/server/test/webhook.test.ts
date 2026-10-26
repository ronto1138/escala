import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "@escala/channel";
import { CloudApiChannel, createWebhookHandler } from "../src/index.ts";

const SECRET = "test-app-secret";
const VERIFY = "test-verify-token";
let server: Server | undefined;

afterEach(() => server?.close());

async function start(appSecret: string | undefined = SECRET) {
  const got: InboundMessage[] = [];
  const logs: Record<string, unknown>[] = [];
  const handler = createWebhookHandler({ verifyToken: VERIFY, appSecret, deliver: async (m) => void got.push(m), log: (e) => logs.push(e) });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, got, logs };
}

const payload = (id: string, text = "hi") => ({
  entry: [{ changes: [{ value: { messages: [{ id, from: "15550001111", timestamp: "1793620800", type: "text", text: { body: text } }] } }] }],
});
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const post = (base: string, body: string, signature?: string) =>
  fetch(`${base}/webhook`, { method: "POST", body, headers: { "Content-Type": "application/json", ...(signature ? { "X-Hub-Signature-256": signature } : {}) } });

describe("webhook: Meta's verification handshake", () => {
  it("answers the challenge only with the right token", async () => {
    const { base } = await start();
    const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    expect((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status).toBe(403);
  });
});

describe("webhook: deliveries", () => {
  it("processes a signed message once, even when Meta retries it", async () => {
    const { base, got, logs } = await start();
    const body = JSON.stringify(payload("wamid.A"));
    expect((await post(base, body, sign(body))).status).toBe(200);
    expect((await post(base, body, sign(body))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(got.map((m) => m.id)).toEqual(["wamid.A"]);
    expect(JSON.stringify(logs)).not.toContain("15550001111"); // no phone numbers in logs
    expect(JSON.stringify(logs)).not.toContain("hi\"");
  });

  it("refuses unsigned, wrongly signed or tampered deliveries", async () => {
    const { base, got } = await start();
    const body = JSON.stringify(payload("wamid.B"));
    expect((await post(base, body)).status).toBe(401);
    expect((await post(base, body, sign(body, "another-secret"))).status).toBe(401);
    expect((await post(base, body.replace("hi", "ho"), sign(body))).status).toBe(401);
    expect(got).toEqual([]);
  });

  it("refuses every delivery while the app secret is not configured", async () => {
    const { base, got } = await start("");
    const body = JSON.stringify(payload("wamid.C"));
    expect((await post(base, body, sign(body))).status).toBe(503);
    expect(got).toEqual([]);
  });

  it("refuses bodies over 1 MB and unknown paths", async () => {
    const { base } = await start();
    const big = "x".repeat(1024 * 1024 + 10);
    const r = await post(base, big, sign(big)).catch(() => ({ status: 413 }));
    expect(r.status).toBe(413);
    expect((await fetch(`${base}/admin`)).status).toBe(404);
  });
});

describe("Cloud API channel", () => {
  const fakeFetch = (calls: Array<{ url: string; init: any }>, response: unknown, status = 200) =>
    (async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response), { status });
    }) as unknown as typeof fetch;

  it("sends inside the 24-hour window, with the token only in the header", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    let now = Date.parse("2026-11-02T12:00:00Z");
    const ch = new CloudApiChannel({ accessToken: "TOKEN", phoneNumberId: "123", fetch: fakeFetch(calls, { messages: [{ id: "wamid.out" }] }), now: () => now });
    await ch.deliver({ id: "wamid.in", from: "15550001111", at: "2026-11-02T11:59:00Z", kind: "text", text: "hi" });
    expect(await ch.send("15550001111", { kind: "text", text: "Hello" })).toEqual({ id: "wamid.out" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer TOKEN");
    expect(calls[0]!.init.body).not.toContain("TOKEN");

    now += 25 * 3600 * 1000;
    await expect(ch.send("15550001111", { kind: "text", text: "Still there?" })).rejects.toThrow(/24-hour window/);
  });

  it("reports Meta's error without leaking the token", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const ch = new CloudApiChannel({ accessToken: "SECRET-TOKEN", phoneNumberId: "123", fetch: fakeFetch(calls, { error: { message: "Invalid parameter", code: 100 } }, 400), now: () => Date.parse("2026-11-02T12:00:00Z") });
    await ch.deliver({ id: "w", from: "15550001111", at: "2026-11-02T11:59:00Z", kind: "text", text: "hi" });
    const err = await ch.send("15550001111", { kind: "text", text: "x" }).catch((e) => e as Error);
    expect(String(err)).toMatch(/400.*code 100/);
    expect(String(err)).not.toContain("SECRET-TOKEN");
  });
});
