/** A person's WhatsApp id (digits only, as WhatsApp sends it in `wa_id`). */
export type ParticipantId = string;

export type InboundMessage = {
  id: string;
  from: ParticipantId;
  at: string;
  /** The name the person set in their WhatsApp profile, when WhatsApp sends it (may be a nickname). */
  profileName?: string;
} & (
  | { kind: "text"; text: string }
  | { kind: "image" | "audio" | "video" | "document"; mediaId: string; mimeType: string; caption?: string; voice?: boolean }
  | { kind: "location"; latitude: number; longitude: number; name?: string }
  /** A tap on a reply button or a list row we sent. */
  | { kind: "interactive"; replyId: string; title: string }
  /** A tap on a quick-reply button of a template we sent (this is what reopens the 24-hour window). */
  | { kind: "template_button"; payload: string; text: string }
);

export interface Button {
  id: string;
  title: string; // max 20 characters
}

export interface ListRow {
  id: string;
  title: string; // max 24
  description?: string; // max 72
}

export interface ListSection {
  title: string; // max 24
  rows: ListRow[];
}

export type OutboundMessage =
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: Button[]; header?: string; footer?: string }
  | { kind: "list"; text: string; buttonLabel: string; sections: ListSection[]; header?: string; footer?: string }
  /** Approved message template: the only kind allowed outside the 24-hour customer service window. */
  | { kind: "template"; name: string; language: string; bodyParams?: string[] };

export interface ChannelPort {
  onInbound(handler: (m: InboundMessage) => Promise<void>): void;
  send(to: ParticipantId, m: OutboundMessage): Promise<{ id: string }>;
}
