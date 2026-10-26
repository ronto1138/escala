import { describe, expect, it } from "vitest";
import { costUsd, createMetaClient, memorySink, MetaApiError, outputText } from "../src/index.ts";

const okBody = {
  output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }],
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 100 },
};

function fakeFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: "no more responses" };
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers ?? {},
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const noSleep = async () => {};

describe("meta-client", () => {
  it("always sends store:false and logs usage with cost", async () => {
    const usage = memorySink();
    const { fn, calls } = fakeFetch([{ status: 200, body: okBody }]);
    const client = createMetaClient({ apiKey: "k", usage, fetch: fn, sleep: noSleep });
    const res = await client.responses({ model: "muse-spark-1.3", input: "hi", store: true }, { caller: "test" });

    expect(outputText(res)).toBe("hello");
    expect(JSON.parse(String(calls[0]!.init.body)).store).toBe(false);
    expect(usage.lines).toHaveLength(1);
    expect(usage.lines[0]).toMatchObject({ ok: true, model: "muse-spark-1.3", cached_tokens: 800, caller: "test" });
    // 200 fresh * 1.25 + 800 cached * 0.15 + 100 out * 4.25, per million
    expect(usage.lines[0]!.cost_usd).toBeCloseTo((200 * 1.25 + 800 * 0.15 + 100 * 4.25) / 1e6, 9);
  });

  it("rejects models outside the allowlist", async () => {
    const client = createMetaClient({ apiKey: "k", usage: memorySink(), fetch: fakeFetch([]).fn });
    await expect(client.responses({ model: "muse-spark-1.3-contributor", input: "x" }, { caller: "t" })).rejects.toThrow(
      /not allowed/,
    );
  });

  it("retries 429 using Retry-After, then succeeds", async () => {
    const waits: number[] = [];
    const { fn, calls } = fakeFetch([
      { status: 429, body: "slow down", headers: { "retry-after": "2" } },
      { status: 200, body: okBody },
    ]);
    const client = createMetaClient({ apiKey: "k", usage: memorySink(), fetch: fn, sleep: async (ms) => void waits.push(ms) });
    await client.responses({ model: "muse-spark-1.3", input: "x" }, { caller: "t" });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it("does not retry a 400 and logs the failure", async () => {
    const usage = memorySink();
    const { fn, calls } = fakeFetch([{ status: 400, body: "bad request" }]);
    const client = createMetaClient({ apiKey: "k", usage, fetch: fn, sleep: noSleep });
    await expect(client.responses({ model: "muse-spark-1.3", input: "x" }, { caller: "t" })).rejects.toBeInstanceOf(
      MetaApiError,
    );
    expect(calls).toHaveLength(1);
    expect(usage.lines[0]).toMatchObject({ ok: false, cost_usd: 0 });
  });

  it("prices SAM 3.1 per image", () => {
    expect(costUsd("sam-3.1", { inputTokens: 0, cachedTokens: 0, outputTokens: 0, images: 4 })).toBeCloseTo(0.01, 9);
  });
});
