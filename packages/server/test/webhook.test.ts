import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
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
    expect((await post(base, body)).status).toBe(403);
    expect((await post(base, body, sign(body, "another-secret"))).status).toBe(403);
    expect((await post(base, body.replace("hi", "ho"), sign(body))).status).toBe(403);
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
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v26.0/123/messages");
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

describe("Muse Code security audit (Oct 26) before the first deploy", () => {
  it("a malformed request target is answered 400 and the server keeps running", async () => {
    const { base } = await start();
    const { port } = new URL(base);
    const raw = await new Promise<string>((resolve) => {
      const s = require("node:net").connect(Number(port), "127.0.0.1", () => s.write("GET //[ HTTP/1.1\r\nHost: x\r\n\r\n"));
      s.on("data", (d: Buffer) => { resolve(d.toString()); s.destroy(); });
    });
    expect(raw).toMatch(/^HTTP\/1\.1 400/);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("a signed payload with an odd shape does not throw", async () => {
    const { base, got } = await start();
    for (const body of ['{"entry":{}}', '{"entry":[{"changes":"x"}]}', '{"entry":[{"changes":[{"value":{"messages":7}}]}]}']) {
      expect((await post(base, body, sign(body))).status).toBe(200);
    }
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(got).toEqual([]);
  });

  it("media is only downloaded from Meta hosts over HTTPS, and only accepted types", async () => {
    const calls: string[] = [];
    const meta = (url: string, mime = "image/jpeg") =>
      (async (u: string) => {
        calls.push(u);
        return new Response(u.includes("graph.facebook.com") ? JSON.stringify({ url, mime_type: mime, file_size: 10 }) : "abc", { status: 200 });
      }) as unknown as typeof fetch;
    const ch = (url: string, mime?: string) => new CloudApiChannel({ accessToken: "TOKEN", phoneNumberId: "1", fetch: meta(url, mime) });
    await expect(ch("https://attacker.example/steal").dataUrl("m1", "image/jpeg")).rejects.toThrow(/not on a Meta host/);
    await expect(ch("http://lookaside.fbsbx.com/x").dataUrl("m1", "image/jpeg")).rejects.toThrow(/not on a Meta host/);
    await expect(ch("https://lookaside.fbsbx.com.attacker.example/x").dataUrl("m1", "image/jpeg")).rejects.toThrow(/not on a Meta host/);
    await expect(ch("https://lookaside.fbsbx.com/x", "text/html").dataUrl("m1", "text/html")).rejects.toThrow(/type not accepted/);
    expect(await ch("https://lookaside.fbsbx.com/x", "image/jpeg; charset=x").dataUrl("m1", "image/jpeg")).toMatch(/^data:image\/jpeg;base64,/);
    expect(calls.filter((u) => u.includes("attacker"))).toEqual([]);
  });

  it("a timestamp in the future does not stretch the 24-hour window", async () => {
    let now = Date.parse("2026-11-02T12:00:00Z");
    const ch = new CloudApiChannel({ accessToken: "T", phoneNumberId: "1", fetch: (async () => new Response("{}")) as unknown as typeof fetch, now: () => now });
    await ch.deliver({ id: "w", from: "15550001111", at: "2030-01-01T00:00:00Z", kind: "text", text: "hi" });
    now += 25 * 3600 * 1000;
    expect(ch.windowOpen("15550001111")).toBe(false);
  });
});

describe("privacy policy page", () => {
  it("is served at /privacy and names the operator and the controls", async () => {
    const { base } = await start();
    const r = await fetch(`${base}/privacy`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    const html = await r.text();
    expect(html).toContain("Kokorio, S.A.P.I. de C.V.");
    expect(html).toMatch(/not end-to-end encrypted/);
    expect(html).toMatch(/Delete everything/);
    expect(html).toContain(`id="delete"`); // the data deletion URL given to Meta points here
  });
});

describe("spending limits (audit Oct 26)", () => {
  it("caps messages per person per hour, media lower, and stops everything past the daily budget", async () => {
    const { Budget } = await import("../src/budget.ts");
    let now = Date.parse("2026-11-02T12:00:00Z");
    const b = new Budget({ perPersonHour: 3, mediaPerPersonHour: 1, dailyUsd: 1, now: () => now });
    expect(b.allow("a", "media")).toBe(true);
    expect(b.allow("a", "media")).toBe(false); // one photo or voice note per hour here
    expect(b.allow("a", "text")).toBe(true);
    expect(b.allow("a", "text")).toBe(true);
    expect(b.allow("a", "text")).toBe(false); // three messages in total
    expect(b.allow("b", "text")).toBe(true); // other people are not affected
    now += 3_600_001;
    expect(b.allow("a", "text")).toBe(true);
    b.spend(1.2);
    expect(b.allow("c", "text")).toBe(false);
    expect(b.why("c")).toBe("daily budget");
    now += 24 * 3_600_000;
    expect(b.allow("c", "text")).toBe(true); // a new day
  });
});

describe("replies to Mexican and Argentine mobiles (131030 on Oct 27)", () => {
  it("drop the extra mobile digit WhatsApp adds to the incoming id", async () => {
    const { sendableNumber } = await import("../src/index.ts");
    expect(sendableNumber("5215512345678")).toBe("525512345678");
    expect(sendableNumber("5491112345678")).toBe("541112345678");
    expect(sendableNumber("15550001111")).toBe("15550001111");
    expect(sendableNumber("525512345678")).toBe("525512345678");
  });
});
