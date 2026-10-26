import { randomUUID } from "node:crypto";
import type { ChannelPort, InboundMessage, OutboundMessage, ParticipantId } from "./types.ts";
import { validateOutbound } from "./whatsapp.ts";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SimEvent {
  direction: "in" | "out";
  participant: ParticipantId;
  at: string;
  message: InboundMessage | OutboundMessage;
}

/**
 * A local stand-in for WhatsApp with the same rules: the same message limits, and free-form messages only
 * inside the 24-hour customer service window that a user message opens. Outside it, only templates.
 * The clock is injected, so tests and demos control time.
 */
export class SimChannel implements ChannelPort {
  readonly transcript: SimEvent[] = [];
  private handler: ((m: InboundMessage) => Promise<void>) | undefined;
  private lastInbound = new Map<ParticipantId, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  onInbound(handler: (m: InboundMessage) => Promise<void>) {
    this.handler = handler;
  }

  /** What a person does on their phone: write, tap a button, send a photo or a voice note. */
  async userSends(from: ParticipantId, m: DistributiveOmit<InboundMessage, "id" | "from" | "at">): Promise<void> {
    const at = this.now();
    const msg = { ...m, id: `sim-${randomUUID()}`, from, at: new Date(at).toISOString() } as InboundMessage;
    this.lastInbound.set(from, at);
    this.transcript.push({ direction: "in", participant: from, at: msg.at, message: msg });
    await this.handler?.(msg);
  }

  async send(to: ParticipantId, m: OutboundMessage): Promise<{ id: string }> {
    const problems = validateOutbound(m);
    if (problems.length) throw new Error(`WhatsApp would reject this message: ${problems.join("; ")}`);
    if (m.kind !== "template" && !this.windowOpen(to)) {
      throw new Error(`outside the 24-hour window for ${to}: only an approved template can be sent`);
    }
    this.transcript.push({ direction: "out", participant: to, at: new Date(this.now()).toISOString(), message: m });
    return { id: `sim-${randomUUID()}` };
  }

  windowOpen(p: ParticipantId): boolean {
    const last = this.lastInbound.get(p);
    return last !== undefined && this.now() - last < WINDOW_MS;
  }

  /** Who opened the conversation, counted per message: the metric behind "users start the conversation". */
  openedBy(): { user: number; escala: number } {
    let user = 0;
    let escala = 0;
    for (const e of this.transcript) {
      if (e.direction === "in") user++;
      else if ((e.message as OutboundMessage).kind === "template") escala++;
    }
    return { user, escala };
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
