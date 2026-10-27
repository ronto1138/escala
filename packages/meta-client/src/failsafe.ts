import type { ResponsesRequest } from "./index.ts";
import type { OpenModelClient } from "./open.ts";

/**
 * The last line of the failsafe: a Responses API request served by Muse Spark Open (Meta's open-weight model, on
 * Baseten) when the Meta Model API itself does not answer. It translates the request (instructions, history, images,
 * tools and their results, structured output) to a chat completion and the answer back, so callers do not change.
 * PDFs are not supported there: such a request fails, and the caller handles it as any other failure.
 */
export function responsesViaOpen(open: OpenModelClient) {
  return async function (req: ResponsesRequest, call: { caller: string }): Promise<any> {
    const messages: any[] = [];
    if (req.instructions) messages.push({ role: "system", content: req.instructions });
    const items: any[] = typeof req.input === "string" ? [{ role: "user", content: req.input }] : ((req.input as any[]) ?? []);
    for (const it of items) {
      if (it?.type === "function_call") {
        const last = messages.at(-1);
        const tc = { id: it.call_id, type: "function", function: { name: it.name, arguments: it.arguments ?? "{}" } };
        if (last?.role === "assistant" && Array.isArray(last.tool_calls)) last.tool_calls.push(tc);
        else messages.push({ role: "assistant", content: "", tool_calls: [tc] });
      } else if (it?.type === "function_call_output") {
        messages.push({ role: "tool", tool_call_id: it.call_id, content: String(it.output ?? "") });
      } else if (it?.type === "message") {
        const text = (it.content ?? []).filter((c: any) => c?.type === "output_text").map((c: any) => c.text).join("");
        if (text) messages.push({ role: "assistant", content: text });
      } else if (it?.type === "reasoning") {
        continue;
      } else if (it?.role) {
        messages.push({ role: it.role, content: typeof it.content === "string" ? it.content : (it.content ?? []).map(part) });
      }
    }
    const fmt = (req.text as any)?.format;
    const body: Record<string, unknown> = {
      messages,
      max_tokens: Math.max(2500, 2 * (req.max_output_tokens ?? 0)), // it reasons more than Muse Spark
      reasoning_effort: req.reasoning?.effort === "minimal" || !req.reasoning?.effort ? "low" : req.reasoning.effort,
      ...(req.tools?.length
        ? { tools: (req.tools as any[]).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
      ...(fmt?.type === "json_schema" ? { response_format: { type: "json_schema", json_schema: { name: fmt.name, schema: fmt.schema, strict: true } } } : {}),
    };
    const j = await open.chat(body, { caller: `${call.caller}+failsafe` });
    const msg = j.choices?.[0]?.message ?? {};
    const output: any[] = [];
    if (typeof msg.content === "string" && msg.content) output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: msg.content }] });
    for (const tc of msg.tool_calls ?? []) output.push({ type: "function_call", call_id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments ?? "{}" });
    return { output, output_text: typeof msg.content === "string" ? msg.content : "", served_by: "muse-spark-open" };
  };
}

function part(p: any) {
  if (p?.type === "input_text") return { type: "text", text: p.text };
  if (p?.type === "input_image") return { type: "image_url", image_url: { url: p.image_url } };
  throw new Error(`not supported by the failsafe model: ${p?.type}`);
}
