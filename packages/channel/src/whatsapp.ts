import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage, OutboundMessage } from "./types.ts";

/** Platform limits for interactive messages (WhatsApp Cloud API). */
export const LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  headerText: 60,
  footerText: 60,
  buttons: 3,
  buttonTitle: 20,
  listButtonLabel: 20,
  listRowsTotal: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  replyId: 200,
} as const;

/** Returns the reasons a message would be rejected by WhatsApp. Empty means it can be sent. */
export function validateOutbound(m: OutboundMessage): string[] {
  const p: string[] = [];
  const max = (what: string, s: string | undefined, n: number) => {
    // Never the text itself: errors end up in logs, and messages carry personal data.
    if (s !== undefined && [...s].length > n) p.push(`${what} is ${[...s].length} characters (max ${n})`);
  };
  const required = (what: string, s: string | undefined) => {
    if (!s || !s.trim()) p.push(`${what} is empty`);
  };
  switch (m.kind) {
    case "text":
      required("text", m.text);
      max("text", m.text, LIMITS.textBody);
      break;
    case "buttons": {
      required("body", m.text);
      max("body", m.text, LIMITS.interactiveBody);
      max("header", m.header, LIMITS.headerText);
      max("footer", m.footer, LIMITS.footerText);
      if (m.buttons.length < 1 || m.buttons.length > LIMITS.buttons) p.push(`buttons: ${m.buttons.length} (1 to ${LIMITS.buttons})`);
      const ids = new Set<string>();
      for (const b of m.buttons) {
        required("button title", b.title);
        max("button title", b.title, LIMITS.buttonTitle);
        max("button id", b.id, LIMITS.replyId);
        if (ids.has(b.id)) p.push(`duplicate button id ${b.id}`);
        ids.add(b.id);
      }
      break;
    }
    case "list": {
      required("body", m.text);
      max("body", m.text, LIMITS.interactiveBody);
      max("list button label", m.buttonLabel, LIMITS.listButtonLabel);
      max("header", m.header, LIMITS.headerText);
      max("footer", m.footer, LIMITS.footerText);
      const rows = m.sections.flatMap((s) => s.rows);
      if (rows.length < 1 || rows.length > LIMITS.listRowsTotal) p.push(`list rows: ${rows.length} (1 to ${LIMITS.listRowsTotal} in total)`);
      const ids = new Set<string>();
      for (const s of m.sections) {
        if (m.sections.length > 1) required("section title", s.title);
        max("section title", s.title, LIMITS.sectionTitle);
        for (const r of s.rows) {
          required("row title", r.title);
          max("row title", r.title, LIMITS.rowTitle);
          max("row description", r.description, LIMITS.rowDescription);
          max("row id", r.id, LIMITS.replyId);
          if (ids.has(r.id)) p.push(`duplicate row id ${r.id}`);
          ids.add(r.id);
        }
      }
      break;
    }
    case "template":
      required("template name", m.name);
      required("template language", m.language);
      break;
  }
  return p;
}

/** Builds the JSON body for POST /{phone-number-id}/messages. Throws if WhatsApp would reject it. */
export function toCloudApi(to: string, m: OutboundMessage): Record<string, unknown> {
  const problems = validateOutbound(m);
  if (problems.length) throw new Error(`invalid WhatsApp message: ${problems.join("; ")}`);
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  const decorate = (x: { header?: string; footer?: string }) => ({
    ...(x.header ? { header: { type: "text", text: x.header } } : {}),
    ...(x.footer ? { footer: { text: x.footer } } : {}),
  });
  switch (m.kind) {
    case "text":
      return { ...base, type: "text", text: { body: m.text, preview_url: false } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          ...decorate(m),
          body: { text: m.text },
          action: { buttons: m.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          ...decorate(m),
          body: { text: m.text },
          action: {
            button: m.buttonLabel,
            sections: m.sections.map((s) => ({
              title: s.title,
              rows: s.rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })),
            })),
          },
        },
      };
    case "template":
      return {
        ...base,
        type: "template",
        template: {
          name: m.name,
          language: { code: m.language },
          ...(m.bodyParams?.length
            ? { components: [{ type: "body", parameters: m.bodyParams.map((text) => ({ type: "text", text })) }] }
            : {}),
        },
      };
  }
}

/**
 * Verifies the X-Hub-Signature-256 header of a webhook call against the app secret, over the raw body.
 * Constant-time comparison; any malformed header is a rejection.
 */
export function verifySignature(appSecret: string, rawBody: string | Buffer, header: string | undefined | null): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Extracts the user messages from a webhook payload. Status updates and unknown types are ignored. */
export function fromWebhook(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  const list = (x: unknown): any[] => (Array.isArray(x) ? x : []); // a signed but odd payload must not throw
  for (const entry of list(payload?.entry)) {
    for (const change of list(entry?.changes)) {
      const names = new Map<string, string>();
      for (const c of list(change?.value?.contacts)) {
        const name = typeof c?.profile?.name === "string" ? c.profile.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) : "";
        if (typeof c?.wa_id === "string" && name) names.set(c.wa_id, name);
      }
      for (const m of list(change?.value?.messages)) {
        // Skip anything malformed instead of crashing the whole batch.
        const ts = Number(m?.timestamp);
        if (typeof m?.id !== "string" || typeof m?.from !== "string" || !/^\d{6,15}$/.test(m.from) || !Number.isFinite(ts)) continue;
        const profileName = names.get(m.from);
        const base = { id: m.id, from: m.from, at: new Date(ts * 1000).toISOString(), ...(profileName ? { profileName } : {}) };
        switch (m.type) {
          case "text":
            out.push({ ...base, kind: "text", text: String(m.text?.body ?? "") });
            break;
          case "image":
          case "audio":
          case "video":
          case "document": {
            const media = m[m.type] ?? {};
            if (typeof media.id !== "string") break;
            out.push({
              ...base,
              kind: m.type,
              mediaId: String(media.id),
              mimeType: String(media.mime_type ?? ""),
              ...(media.caption ? { caption: String(media.caption) } : {}),
              ...(m.type === "audio" ? { voice: Boolean(media.voice) } : {}),
            });
            break;
          }
          case "location":
            out.push({
              ...base,
              kind: "location",
              latitude: Number(m.location?.latitude),
              longitude: Number(m.location?.longitude),
              ...(m.location?.name ? { name: String(m.location.name) } : {}),
            });
            break;
          case "interactive": {
            const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
            if (r) out.push({ ...base, kind: "interactive", replyId: String(r.id), title: String(r.title ?? "") });
            break;
          }
          case "button":
            out.push({ ...base, kind: "template_button", payload: String(m.button?.payload ?? ""), text: String(m.button?.text ?? "") });
            break;
        }
      }
    }
  }
  return out;
}
