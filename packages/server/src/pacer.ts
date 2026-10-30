import type { OutboundMessage, ParticipantId } from "@escala/channel";

/**
 * Paces what Escala sends on its own (flight alerts, reminders, voice notes) so it never piles up on the traveler
 * (Ives' recording, 30-oct: eight messages in under a minute on top of a long answer). Per person, in order: each
 * message waits a few seconds after the previous one, and while the traveler has just written or just got an answer,
 * it waits until they have had time to read. A group (a 🔊 line and its voice note) goes out together.
 */
export interface PacerOptions {
  send(to: ParticipantId, m: OutboundMessage): Promise<unknown>;
  /** Seconds between two messages Escala sends on its own. */
  gapMs: number;
  /** How long to hold them after the traveler wrote or got an answer. */
  quietMs: number;
  /** Checked right before sending: someone who said STOP gets nothing that was waiting. */
  allowed?(to: ParticipantId): boolean;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

export function createPacer(opts: PacerOptions) {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  const lastTouch = new Map<ParticipantId, number>();
  const lastSent = new Map<ParticipantId, number>();
  const chains = new Map<ParticipantId, Promise<unknown>>();

  async function deliver(to: ParticipantId, group: OutboundMessage[]): Promise<void> {
    // The traveler may write again while this waits: check again until both pauses have passed.
    for (;;) {
      const ready = Math.max((lastTouch.get(to) ?? 0) + opts.quietMs, (lastSent.get(to) ?? 0) + opts.gapMs);
      const wait = ready - now();
      if (wait <= 0) break;
      await sleep(Math.min(wait, 5_000));
    }
    if (opts.allowed && !opts.allowed(to)) return;
    for (const m of group) await opts.send(to, m);
    lastSent.set(to, now());
  }

  return {
    /** The traveler wrote, or Escala just answered them: hold what Escala would send on its own. */
    touch(to: ParticipantId) {
      lastTouch.set(to, now());
    },
    /** Queues one message, or a group that goes out together; resolves once sent, rejects if sending failed. */
    send(to: ParticipantId, m: OutboundMessage | OutboundMessage[]): Promise<void> {
      const group = Array.isArray(m) ? m : [m];
      const job = (chains.get(to) ?? Promise.resolve()).catch(() => undefined).then(() => deliver(to, group));
      chains.set(to, job);
      void job.finally(() => chains.get(to) === job && chains.delete(to)).catch(() => undefined);
      return job;
    },
  };
}
