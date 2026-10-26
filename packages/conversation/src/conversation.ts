import type { ChannelPort, InboundMessage, OutboundMessage, ParticipantId } from "@escala/channel";
import { detectLang, MENU_WORDS, STOP_WORDS, T, type Lang } from "./i18n.ts";

export type Stage = "new" | "share" | "itinerary" | "confirm" | "ready" | "stopped";
export type ShareLevel = "trip" | "profile";

export interface ExtractedTrip {
  /** One line per leg, already worded for the person (e.g. "ZZ 1234 · Mon Nov 2 · Austin 7:10 → Chicago 9:35"). */
  lines: string[];
  /** Structured trip, opaque to the conversation. */
  trip: unknown;
}

export interface Person {
  id: ParticipantId;
  lang: Lang;
  stage: Stage;
  share: ShareLevel;
  pending?: ExtractedTrip;
  trip?: unknown;
}

export interface ConversationDeps {
  channel: ChannelPort;
  /** Reads a trip from a text, image or document message. Returns null when there is no trip in it. */
  extractItinerary(m: InboundMessage, person: Person, correction?: string): Promise<ExtractedTrip | null>;
  /** Everything that is not onboarding or navigation: the trip agent. Optional while it is being built. */
  agent?(m: InboundMessage, person: Person): Promise<OutboundMessage[]>;
  onTripConfirmed?(person: Person): Promise<void>;
}

/**
 * Onboarding and navigation on top of any ChannelPort. The menu opens from anywhere with "menu" / "menú" /
 * "aide"; STOP stops all messages; everything else goes to the trip agent.
 */
export class Conversation {
  readonly people = new Map<ParticipantId, Person>();
  private readonly deps: ConversationDeps;

  constructor(deps: ConversationDeps) {
    this.deps = deps;
    deps.channel.onInbound((m) => this.handle(m));
  }

  async handle(m: InboundMessage): Promise<void> {
    const text = m.kind === "text" ? m.text.trim() : "";
    const word = text.toLowerCase();
    let p = this.people.get(m.from);

    if (p?.stage === "stopped" && !STOP_WORDS.includes(word)) p.stage = "new"; // writing again starts over
    if (STOP_WORDS.includes(word)) {
      const person = p ?? this.newPerson(m.from, "en");
      person.stage = "stopped";
      return void (await this.send(person, { kind: "text", text: T[person.lang].stopped }));
    }

    if (!p || p.stage === "new") {
      p = this.newPerson(m.from, p?.lang ?? detectLang(text));
      p.stage = "share";
      await this.send(p, { kind: "text", text: T[p.lang].welcome });
      return this.askShare(p);
    }

    if (MENU_WORDS.includes(word)) return this.mainMenu(p);

    if (m.kind === "interactive") return this.onTap(m.replyId, m, p);

    if (p.stage === "itinerary" || p.stage === "confirm") {
      const correction = p.stage === "confirm" ? text : undefined;
      return this.readItinerary(m, p, correction);
    }

    if (this.deps.agent) {
      for (const out of await this.deps.agent(m, p)) await this.send(p, out);
      return;
    }
    await this.send(p, { kind: "text", text: T[p.lang].notYet });
  }

  private async onTap(id: string, m: InboundMessage, p: Person) {
    const t = T[p.lang];
    switch (id) {
      case "share.trip":
      case "share.remember":
        p.share = id === "share.remember" ? "profile" : "trip";
        p.stage = "itinerary";
        return this.send(p, { kind: "text", text: t.askItinerary });
      case "share.details":
        await this.send(p, { kind: "text", text: t.shareDetails });
        return this.askShare(p);
      case "confirm.ok":
        if (!p.pending) return this.send(p, { kind: "text", text: t.askItinerary });
        p.trip = p.pending.trip;
        delete p.pending;
        p.stage = "ready";
        await this.send(p, { kind: "text", text: t.confirmed });
        return this.deps.onTripConfirmed?.(p);
      case "confirm.fix":
        p.stage = "confirm";
        return this.send(p, { kind: "text", text: t.fixPrompt });
      case "menu.open":
        return this.mainMenu(p);
      case "trip.add":
        p.stage = "itinerary";
        return this.send(p, { kind: "text", text: t.askItinerary });
    }
    if (this.deps.agent) {
      for (const out of await this.deps.agent(m, p)) await this.send(p, out);
      return;
    }
    return this.send(p, { kind: "text", text: t.notYet });
  }

  private async readItinerary(m: InboundMessage, p: Person, correction?: string) {
    const t = T[p.lang];
    const got = await this.deps.extractItinerary(m, p, correction);
    if (!got || got.lines.length === 0) return this.send(p, { kind: "text", text: t.notReadable });
    p.pending = got;
    p.stage = "confirm";
    return this.send(p, {
      kind: "buttons",
      text: t.itinerarySummary(got.lines),
      buttons: [
        { id: "confirm.ok", title: t.confirmButtons.ok },
        { id: "confirm.fix", title: t.confirmButtons.fix },
        { id: "menu.open", title: t.confirmButtons.menu },
      ],
    });
  }

  private askShare(p: Person) {
    const t = T[p.lang];
    return this.send(p, {
      kind: "buttons",
      text: t.shareQuestion,
      buttons: [
        { id: "share.trip", title: t.shareButtons.trip },
        { id: "share.remember", title: t.shareButtons.remember },
        { id: "share.details", title: t.shareButtons.details },
      ],
    });
  }

  private mainMenu(p: Person) {
    const t = T[p.lang];
    return this.send(p, { kind: "list", text: t.menuText, buttonLabel: t.menuButton, sections: t.menuSections });
  }

  private newPerson(id: ParticipantId, lang: Lang): Person {
    const person: Person = { id, lang, stage: "new", share: "trip" }; // most private by default
    this.people.set(id, person);
    return person;
  }

  private async send(p: Person, m: OutboundMessage): Promise<void> {
    await this.deps.channel.send(p.id, m);
  }
}
