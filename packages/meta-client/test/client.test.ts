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

describe("speech to text", () => {
  it("sends multipart WAV with keywords, logs the audio cost and returns the transcript", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchFake = (async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ transcript: " Mi vuelo a Montreal ", audioDurationMs: 7200 }), { status: 200 });
    }) as unknown as typeof fetch;
    const usage = memorySink();
    const client = createMetaClient({ apiKey: "k", usage, fetch: fetchFake });
    const r = await client.transcribe(new Uint8Array([1, 2, 3]), { keywords: ["Montreal"] }, { caller: "voice/test" });
    expect(r).toEqual({ text: "Mi vuelo a Montreal", seconds: 8 });
    expect(calls[0]!.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    const req = JSON.parse(await ((calls[0]!.init.body as FormData).get("request") as Blob).text());
    expect(req).toMatchObject({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", keywords: ["Montreal"] });
    expect(usage.lines[0]).toMatchObject({ model: "muse-voice-transcribe-1.0", ok: true, cost_usd: costUsd("muse-voice-transcribe-1.0", { inputTokens: 0, cachedTokens: 0, outputTokens: 0, images: 0, audioSeconds: 8 }) });
    expect(usage.lines[0]!.cost_usd).toBeCloseTo((8 / 3600) * 0.18, 6);
  });
});

describe("Muse Spark Open on Baseten", async () => {
  const { createOpenModelClient, OPEN_MODEL } = await import("../src/index.ts");
  it("asks for structured output, logs provider baseten with its cost, and parses the answer", async () => {
    const calls: any[] = [];
    const fetchFake = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[]}' } }], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 0 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const usage = memorySink();
    const open = createOpenModelClient({ apiKey: "k", usage, fetch: fetchFake });
    expect(await open.json({ instructions: "i", input: "x", schemaName: "s", schema: { type: "object" } }, { caller: "memory/learn" })).toEqual({ facts: [] });
    expect(calls[0].url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(calls[0].body).toMatchObject({ model: OPEN_MODEL, response_format: { type: "json_schema" } });
    expect(usage.lines[0]).toMatchObject({ provider: "baseten", model: OPEN_MODEL, ok: true });
    expect(usage.lines[0]!.cost_usd).toBeCloseTo((1000 * 1.25 + 200 * 4.25) / 1e6, 6);
  });
});

describe("model fallback (Oct 27: muse-spark-1.3 answered model_not_found)", () => {
  it("retries once with muse-spark-1.2 and skips 1.3 for a while", async () => {
    const asked: string[] = [];
    const fetchFake = (async (_url: string, init: any) => {
      const m = JSON.parse(init.body).model;
      asked.push(m);
      return m === "muse-spark-1.3"
        ? new Response(JSON.stringify({ error: { code: "model_not_found" } }), { status: 404 })
        : new Response(JSON.stringify({ output_text: "ok", usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const usage = memorySink();
    const client = createMetaClient({ apiKey: "k", usage, fetch: fetchFake, sleep: async () => {} });
    expect(outputText(await client.responses({ model: "muse-spark-1.3", input: "x" }, { caller: "t" }))).toBe("ok");
    await client.responses({ model: "muse-spark-1.3", input: "y" }, { caller: "t" });
    // Retried like a busy server first (Meta returns it now and then for a working model), then 1.2.
    expect(asked).toEqual(["muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.2"]);
    expect(usage.lines.filter((l) => l.ok).map((l) => [l.model, l.caller])).toEqual([["muse-spark-1.2", "t+fallback"], ["muse-spark-1.2", "t+fallback"]]);
  });
});

describe("a one-off model_not_found from Meta (30-oct: 2 in 6 calls a minute apart)", () => {
  it("stays on muse-spark-1.3 when the retry works", async () => {
    const asked: string[] = [];
    let n = 0;
    const fetchFake = (async (_url: string, init: any) => {
      asked.push(JSON.parse(init.body).model);
      return n++ === 0
        ? new Response(JSON.stringify({ error: { code: "model_not_found" } }), { status: 404 })
        : new Response(JSON.stringify({ output_text: "ok", usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createMetaClient({ apiKey: "k", usage: memorySink(), fetch: fetchFake, sleep: async () => {} });
    expect(outputText(await client.responses({ model: "muse-spark-1.3", input: "x" }, { caller: "t" }))).toBe("ok");
    expect(asked).toEqual(["muse-spark-1.3", "muse-spark-1.3"]);
  });
});

describe("failsafe: Muse Spark Open when the Meta Model API does not answer", async () => {
  const { responsesViaOpen } = await import("../src/index.ts");
  const fakeOpen = (reply: any, seen: any[]) => ({
    json: async () => ({}),
    chat: async (body: any, call: any) => (seen.push({ body, call }), { choices: [{ message: reply }] }),
  });

  it("takes over on an outage, not on our own bad request, and never for SAM", async () => {
    const seen: any[] = [];
    let status = 503;
    const fetchFake = (async () => new Response(JSON.stringify({ error: { code: "x" } }), { status })) as unknown as typeof fetch;
    const client = createMetaClient({
      apiKey: "k", usage: memorySink(), fetch: fetchFake, sleep: async () => {}, maxRetries: 0,
      failsafe: responsesViaOpen(fakeOpen({ content: "from the open model" }, seen) as any),
    });
    expect(outputText(await client.responses({ model: "muse-spark-1.3", input: "hi" }, { caller: "agent/loop" }))).toBe("from the open model");
    expect(seen[0].call.caller).toBe("agent/loop+failsafe");
    status = 400;
    const c2 = createMetaClient({ apiKey: "k", usage: memorySink(), fetch: fetchFake, sleep: async () => {}, maxRetries: 0, failsafe: responsesViaOpen(fakeOpen({ content: "x" }, []) as any) });
    await expect(c2.responses({ model: "muse-spark-1.3", input: "hi" }, { caller: "t" })).rejects.toThrow(/400/);
    status = 503;
    await expect(c2.responses({ model: "sam-3.1", input: "scratch" }, { caller: "t" })).rejects.toThrow(/503/);
  });

  it("translates tools, their results, images and structured output both ways", async () => {
    const seen: any[] = [];
    const fs = responsesViaOpen(fakeOpen({ content: null, tool_calls: [{ id: "c2", function: { name: "get_flight_status", arguments: '{"flight":"ZZ1"}' } }] }, seen) as any);
    const r = await fs(
      {
        model: "muse-spark-1.3",
        instructions: "be brief",
        input: [
          { role: "user", content: [{ type: "input_text", text: "status?" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] },
          { type: "function_call", call_id: "c1", name: "get_flight_status", arguments: "{}" },
          { type: "function_call_output", call_id: "c1", output: '{"ok":true}' },
        ],
        tools: [{ type: "function", name: "get_flight_status", description: "d", parameters: { type: "object" } }],
        text: { format: { type: "json_schema", name: "s", schema: { type: "object" }, strict: true } },
        reasoning: { effort: "minimal" },
      },
      { caller: "agent/loop" },
    );
    const b = seen[0].body;
    expect(b.messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(b.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AA" } });
    expect(b.messages[2].tool_calls[0]).toMatchObject({ id: "c1", function: { name: "get_flight_status" } });
    expect(b.tools[0]).toMatchObject({ type: "function", function: { name: "get_flight_status" } });
    expect(b.response_format.type).toBe("json_schema");
    expect(b.reasoning_effort).toBe("low");
    expect(r.output).toEqual([{ type: "function_call", call_id: "c2", name: "get_flight_status", arguments: '{"flight":"ZZ1"}' }]);
  });
});
