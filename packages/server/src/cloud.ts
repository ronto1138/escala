import type { ChannelPort, InboundMessage, OutboundMessage, ParticipantId } from "@escala/channel";
import { toCloudApi } from "@escala/channel";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export interface CloudApiOptions {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** A Cloud API error, without the token or the message content. */
export class CloudApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  constructor(status: number, code: number | undefined, message: string) {
    super(`WhatsApp Cloud API ${status}${code ? ` (code ${code})` : ""}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

/**
 * The real WhatsApp channel. Same contract as the simulator: free-form messages only inside the 24-hour window a
 * user message opens (checked here, before Meta charges or rejects it); outside it, only approved templates.
 */
export class CloudApiChannel implements ChannelPort {
  private handler: ((m: InboundMessage) => Promise<void>) | undefined;
  private readonly lastInbound = new Map<ParticipantId, number>();
  private readonly opts: Required<Omit<CloudApiOptions, "fetch" | "now">> & { fetch: typeof fetch; now: () => number };

  constructor(opts: CloudApiOptions) {
    if (!opts.accessToken || !opts.phoneNumberId) throw new Error("WhatsApp access token and phone number id are required");
    this.opts = { graphVersion: "v25.0", fetch: globalThis.fetch, now: Date.now, ...opts } as typeof this.opts;
  }

  onInbound(handler: (m: InboundMessage) => Promise<void>) {
    this.handler = handler;
  }

  /** Called by the webhook for each verified, new message. */
  async deliver(m: InboundMessage): Promise<void> {
    const at = Date.parse(m.at);
    this.lastInbound.set(m.from, Number.isFinite(at) ? Math.max(at, this.lastInbound.get(m.from) ?? 0) : this.opts.now());
    await this.handler?.(m);
  }

  windowOpen(p: ParticipantId): boolean {
    const last = this.lastInbound.get(p);
    return last !== undefined && this.opts.now() - last < WINDOW_MS;
  }

  async send(to: ParticipantId, m: OutboundMessage): Promise<{ id: string }> {
    if (m.kind !== "template" && !this.windowOpen(to)) {
      throw new Error("outside the 24-hour window: only an approved template can be sent");
    }
    const body = toCloudApi(to, m); // validates WhatsApp's limits first
    const r = await this.graph(`${this.opts.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify(body) });
    const id = (r as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
    if (!id) throw new CloudApiError(200, undefined, "no message id in the response");
    return { id };
  }

  /** Downloads a photo, document or voice note as a data URL, for the models. */
  async dataUrl(mediaId: string, mimeType: string): Promise<string> {
    const meta = (await this.graph(encodeURIComponent(mediaId), { method: "GET" })) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) throw new CloudApiError(200, undefined, "media has no download url");
    if ((meta.file_size ?? 0) > MAX_MEDIA_BYTES) throw new CloudApiError(413, undefined, "media is larger than 16 MB");
    const res = await this.opts.fetch(meta.url, { headers: { Authorization: `Bearer ${this.opts.accessToken}` } });
    if (!res.ok) throw new CloudApiError(res.status, undefined, "media download failed");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_MEDIA_BYTES) throw new CloudApiError(413, undefined, "media is larger than 16 MB");
    return `data:${meta.mime_type ?? mimeType};base64,${bytes.toString("base64")}`;
  }

  private async graph(path: string, init: { method: string; body?: string }): Promise<unknown> {
    const res = await this.opts.fetch(`https://graph.facebook.com/${this.opts.graphVersion}/${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${this.opts.accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      ...(init.body ? { body: init.body } : {}),
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok || json.error) {
      // Meta's error message never contains the token; it is kept short in case it echoes anything else.
      throw new CloudApiError(res.status, json.error?.code, String(json.error?.message ?? "request failed").slice(0, 200));
    }
    return json;
  }
}
