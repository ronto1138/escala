import type { ChannelPort, InboundMessage, OutboundMessage, ParticipantId } from "@escala/channel";
import { DELETE_ALL_PHRASES, DELETE_WORDS, detectLang, MENU_WORDS, PRIVACY_WORDS, STOP_WORDS, T, type Lang } from "./i18n.ts";

export type Stage = "new" | "onboarding" | "ready" | "stopped";
export type ShareLevel = "trip" | "profile";
/** What Escala is waiting for, if anything. People can always say something else instead. */
export type Awaiting = "share" | "confirm" | "fix" | null;
export type Intent = "yes" | "no" | "remember" | "trip_only" | "other";

export interface ExtractedTrip {
  /** One line per leg, already worded for the person in their language. */
  lines: string[];
  /** Structured trip, opaque to the conversation. */
  trip: unknown;
}

export interface Person {
  id: ParticipantId;
  lang: Lang;
  stage: Stage;
  share: ShareLevel;
  shareAsked: boolean;
  /** False until the language was read from something the person wrote (not just a photo). */
  langFromText: boolean;
  awaiting: Awaiting;
  lastSeen?: number;
  pending?: ExtractedTrip;
  trip?: unknown;
}

export interface ConversationDeps {
  channel: ChannelPort;
  /** Reads a trip from a message (text, image or document). Null when there is no trip in it. */
  extractItinerary(m: InboundMessage, person: Person, correction?: string): Promise<ExtractedTrip | null>;
  /** How a free-text answer should be read when Escala asked something. Defaults to keyword matching. */
  understand?(text: string, person: Person): Promise<Intent>;
  /** Everything else: the trip agent. Optional while it is being built. */
  agent?(m: InboundMessage, person: Person): Promise<OutboundMessage[]>;
  onTripConfirmed?(person: Person): Promise<void>;
  /** Erase everything kept about this person (memory, trips, case files). */
  onDelete?(id: ParticipantId): Promise<void>;
  /** Voice note to text (Muse Voice Transcribe). Null when nothing could be understood. Without it, voice goes to the agent. */
  transcribe?(m: Extract<InboundMessage, { mediaId: string }>, person: Person | undefined): Promise<string | null>;
  /** The person chose how much to remember: "trip" (default) or "profile". */
  onShareChanged?(person: Person): Promise<void>;
}

const DELETED: Record<Lang, string> = {
  en: "Done. I've deleted everything I kept about you. If you write again, we start from zero.",
  es: "Listo. Borré todo lo que guardaba de ti. Si me vuelves a escribir, empezamos de cero.",
  fr: "C'est fait. J'ai effacé tout ce que je gardais sur vous. Si vous m'écrivez de nouveau, on repart de zéro.",
};

const SESSION_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * Conversation first: people say what they need in their own words and Escala acts on it. The menu exists
 * for whoever asks for it ("menu", "menú", "aide") but nothing depends on tapping. The first contact gets a
 * short, warm introduction; people Escala already knows just get a greeting.
 */
export class Conversation {
  readonly people = new Map<ParticipantId, Person>();
  private readonly deps: ConversationDeps;

  constructor(deps: ConversationDeps) {
    this.deps = deps;
    deps.channel.onInbound((m) => this.handle(m));
  }

  async handle(incoming: InboundMessage): Promise<void> {
    let m = incoming;
    // A tap on a template button or a menu row is what the person chose to say: it is handled as their words.
    if (m.kind === "template_button" || m.kind === "interactive") {
      const said = (m.kind === "template_button" ? m.text || m.payload : m.title || m.replyId).trim();
      m = { id: m.id, from: m.from, at: m.at, kind: "text", text: said };
    }
    // A voice note becomes the words it carries, and from here on it is handled exactly like text: "delete
    // everything" or "stop" said aloud work too. Escala repeats what it understood, so a misheard word shows at once.
    if (m.kind === "audio" && this.deps.transcribe) {
      const known = this.people.get(m.from);
      const said = (await this.deps.transcribe(m, known))?.trim();
      const lang = known?.langFromText ? known.lang : said ? detectLang(said) : (known?.lang ?? "en");
      if (!said) return void (await this.deps.channel.send(m.from, { kind: "text", text: T[lang].notHeard }));
      await this.deps.channel.send(m.from, { kind: "text", text: T[lang].heard(said.length > 300 ? `${said.slice(0, 300)}…` : said) });
      m = { id: m.id, from: m.from, at: m.at, kind: "text", text: said };
    }
    const text = m.kind === "text" ? m.text.trim() : "";
    const word = normalize(text);
    const parsed = Date.parse(m.at);
    const at = Number.isFinite(parsed) ? parsed : Date.now();
    let p = this.people.get(m.from);
    const tokens = new Set(word.split(/[^\p{L}'-]+/u).filter(Boolean));

    const deleteAll =
      DELETE_ALL_PHRASES.some((w) => word.includes(w)) ||
      (words(text).length <= 3 && DELETE_WORDS.some((w) => (w.includes(" ") ? word.includes(w) : tokens.has(w))));
    if (deleteAll) {
      const lang = p?.lang ?? detectLang(text);
      this.people.delete(m.from);
      await this.deps.onDelete?.(m.from);
      return void (await this.deps.channel.send(m.from, { kind: "text", text: DELETED[lang] }));
    }

    if (STOP_WORDS.includes(word) || (words(text).length <= 3 && STOP_WORDS.some((w) => tokens.has(w)))) {
      p ??= this.newPerson(m.from, detectLang(text));
      p.stage = "stopped";
      p.awaiting = null;
      return this.say(p, T[p.lang].stopped);
    }

    if (!p) {
      p = this.newPerson(m.from, detectLang(text));
      p.langFromText = text.length > 0;
      p.stage = "onboarding";
      p.lastSeen = at;
      await this.say(p, T[p.lang].hello);
      if (this.mayHoldTrip(m) && (await this.readItinerary(m, p))) return;
      p.awaiting = "share";
      p.shareAsked = true;
      return this.say(p, T[p.lang].shareQuestion);
    }

    if (!p.langFromText && text) {
      p.lang = detectLang(text);
      p.langFromText = true;
    }

    const returning = p.stage === "stopped" || (p.lastSeen !== undefined && at - p.lastSeen > SESSION_GAP_MS);
    p.lastSeen = at;
    if (p.stage === "stopped") p.stage = p.trip ? "ready" : "onboarding";
    if (returning && !text.match(/^\s*$/)) await this.say(p, T[p.lang].welcomeBack);

    if (MENU_WORDS.includes(word)) return this.mainMenu(p);
    if (PRIVACY_WORDS.includes(word)) return this.say(p, T[p.lang].privacy);

    if (p.awaiting === "share" && m.kind === "text") {
      const intent = await this.understand(text, p);
      if (intent === "remember" || intent === "trip_only" || intent === "no") {
        p.share = intent === "remember" ? "profile" : "trip";
        p.awaiting = null;
        await this.deps.onShareChanged?.(p);
        await this.say(p, p.share === "profile" ? T[p.lang].sharedProfile : T[p.lang].sharedTrip);
        if (!p.trip && !p.pending) return this.say(p, T[p.lang].askItinerary);
        return;
      }
    }

    if (p.awaiting === "confirm" && m.kind === "text") {
      const intent = await this.understand(text, p);
      if (intent === "yes") return this.confirm(p);
      if (intent === "no" && words(text).length <= 2) {
        p.awaiting = "fix";
        return this.say(p, T[p.lang].fixPrompt);
      }
      if (await this.readItinerary(m, p, text)) return; // a correction in their own words
    }

    if (p.awaiting === "fix" && (await this.readItinerary(m, p, text))) return;

    if (!p.trip && this.mayHoldTrip(m) && (await this.readItinerary(m, p))) return;

    if (this.deps.agent) {
      for (const out of await this.deps.agent(m, p)) await this.deps.channel.send(p.id, out);
      return;
    }
    if (!p.trip && m.kind !== "text") return this.say(p, T[p.lang].notReadable);
    return this.say(p, T[p.lang].notYet);
  }

  /**
   * Forgets people whose state has expired: the trip ended and its claim window closed, or nothing was shared and
   * they have been silent for 30 days. Run on a schedule; returns how many were forgotten.
   */
  evict(now: number, claimDays: number): number {
    let n = 0;
    for (const [id, p] of this.people) {
      const lastFlight = (p.trip as { legs?: Array<{ date: string }> } | undefined)?.legs?.map((l) => l.date).sort().at(-1);
      const until = lastFlight ? Date.parse(`${lastFlight}T00:00:00Z`) + (claimDays + 1) * 86_400_000 : (p.lastSeen ?? now) + 30 * 86_400_000;
      if (now >= until) {
        this.people.delete(id);
        n++;
      }
    }
    return n;
  }

  private async readItinerary(m: InboundMessage, p: Person, correction?: string): Promise<boolean> {
    const got = await this.deps.extractItinerary(m, p, correction);
    if (!got || got.lines.length === 0) return false;
    p.pending = got;
    p.awaiting = "confirm";
    await this.say(p, T[p.lang].itinerarySummary(got.lines));
    return true;
  }

  private async confirm(p: Person) {
    if (!p.pending) return this.say(p, T[p.lang].askItinerary);
    p.trip = p.pending.trip;
    delete p.pending;
    p.stage = "ready";
    p.awaiting = null;
    await this.say(p, T[p.lang].confirmed);
    await this.deps.onTripConfirmed?.(p);
    if (!p.shareAsked) {
      p.shareAsked = true;
      p.awaiting = "share";
      await this.say(p, T[p.lang].shareQuestion);
    }
  }

  private understand(text: string, p: Person): Promise<Intent> {
    return this.deps.understand ? this.deps.understand(text, p) : Promise.resolve(keywordIntent(text, p.lang));
  }

  /** Images, documents and texts with something that looks like a flight number may carry a trip. */
  private mayHoldTrip(m: InboundMessage) {
    return m.kind === "image" || m.kind === "document" || (m.kind === "text" && /\b[a-z][a-z0-9]\s?\d{2,4}\b/i.test(m.text) && /\d{2,4}/.test(m.text));
  }

  private mainMenu(p: Person) {
    const t = T[p.lang];
    return this.deps.channel.send(p.id, { kind: "list", text: t.menuText, buttonLabel: t.menuButton, sections: t.menuSections }).then(() => {});
  }

  private newPerson(id: ParticipantId, lang: Lang): Person {
    const person: Person = { id, lang, stage: "new", share: "trip", shareAsked: false, langFromText: false, awaiting: null }; // most private by default
    this.people.set(id, person);
    return person;
  }

  private async say(p: Person, text: string): Promise<void> {
    await this.deps.channel.send(p.id, { kind: "text", text });
  }
}

/** Keyword reading of a short answer, in the person's language. A stand-in until the model reads intent. */
export function keywordIntent(text: string, lang: Lang): Intent {
  const w = T[lang].words;
  const t = ` ${normalize(text)} `;
  const has = (list: string[]) => list.some((x) => t.includes(` ${normalize(x)} `) || t.includes(` ${normalize(x)},`));
  if (has(w.remember)) return "remember";
  if (has(w.tripOnly)) return "trip_only";
  if (has(w.no)) return "no";
  if (has(w.yes)) return "yes";
  return "other";
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[¡!¿?.,;:]/g, " ").replace(/\s+/g, " ").trim();
}

function words(s: string) {
  return normalize(s).split(" ").filter(Boolean);
}
