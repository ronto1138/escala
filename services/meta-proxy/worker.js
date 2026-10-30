// Egress proxy for the Meta Model API, on Cloudflare Workers (30-oct-2026: the API answered 404 model_not_found to every
// call from Railway's network while the same key worked elsewhere; Meta's support pointed at how that network's IPs
// are classified). Escala calls it with META_BASE_URL and a shared secret; it forwards only the paths Escala uses and
// keeps nothing: no logs, no storage. The Meta key passes through in the Authorization header, over TLS.
const ALLOWED = new Set(["/v1/responses", "/v1/asr/transcribe", "/v1/models"]);

export default {
  async fetch(request, env) {
    const given = request.headers.get("x-escala-proxy") ?? "";
    if (!env.PROXY_TOKEN || !(await same(given, env.PROXY_TOKEN))) return new Response("forbidden", { status: 403 });
    const url = new URL(request.url);
    if (!ALLOWED.has(url.pathname)) return new Response("not found", { status: 404 });
    const headers = new Headers();
    for (const h of ["authorization", "content-type", "accept"]) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const upstream = await fetch(`https://api.meta.ai${url.pathname}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  },
};

/** Constant-time comparison of the shared secret. */
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
