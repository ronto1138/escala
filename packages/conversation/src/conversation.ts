import type { ChannelPort, InboundMessage, OutboundMessage, ParticipantId } from "@escala/channel";
import { clearLang, DELETE_ALL_PHRASES, DELETE_WORDS, DEMO_TRIP_ID, DEMO_WORDS, detectLang, detectLangOrNull, EXACT_NO, EXACT_YES, MENU_WORDS, PRIVACY_WORDS, STOP_WORDS, T, type Lang } from "./i18n.ts";

export type Stage = "new" | "onboarding" | "ready" | "stopped";
export type ShareLevel = "trip" | "profile";
/** What Escala is waiting for, if anything. People can always say something else instead. */
export type Awaiting = "share" | "confirm" | "fix" | "delete_confirm" | null;
export type Intent = "yes" | "no" | "remember" | "trip_only" | "other";

/** One line of the conversation, kept (encrypted) so the next message is read in context. */
export interface Turn {
  role: "traveler" | "escala";
  text: string;
  at: string;
}

/**
 * What a message is, decided by a model that sees the conversation (the question Escala asked, the last turns, the
 * trip). The code acts on it. "delete_all" from a model is only a request: it is confirmed before anything is erased.
 */
export type Route =
  | { kind: "share"; share: "trip" | "profile" }
  | { kind: "confirm" }
  | { kind: "fix"; correction: string | null }
  | { kind: "itinerary" }
  | { kind: "stop" }
  | { kind: "delete_all" }
  | { kind: "menu" }
  | { kind: "privacy" }
  | { kind: "other" };

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
  /** The last turns, newest last (at most 12, at most 48 hours old). */
  recent?: Turn[];
  /** Where the person said they are, for directions and nearby suggestions. Kept for two hours, never remembered. */
  location?: SharedLocation;
  /** Their WhatsApp profile name, to call them by it now and then; never used to guess anything else about them. */
  name?: string;
  /** When Escala last called them by name: it does so as rarely as possible. */
  nameUsedAt?: number;
  /** What they told about the trip around the flights: where they stay, why they travel, checked bags, a rental car. */
  details?: TripDetails;
  /** What their boarding passes say, by flight ("ZZ1234"): boarding time and gate as printed, seat, group. */
  boardingPasses?: Record<string, { boardingTime?: string; gate?: string; seat?: string; group?: string; date?: string }>;
  /** How they travel, for the style of every answer: step by step for someone new to it, straight to the point for someone who flies often. */
  style?: "novice" | "frequent";
  /** The country of the passport they fly with (ISO 3166-1 alpha-2), as they said it. Kept like the rest of the trip, or remembered if they turned memory on. */
  passport?: string;
}

export interface TripDetails {
  /** Name of the hotel or place they stay at the destination. */
  stay?: string;
  /** Its address, as they gave it (for immigration forms and directions). */
  stayAddress?: string;
  /** A private home instead of a named place: with friends, with family, or a rental. The card says it in the officer's language. */
  stayWith?: "friends" | "family" | "rental";
  /** Checked bags: 0 means carry-on only. */
  checkedBags?: number;
  /** Weight of the checked bag(s) in kg, as they said it. */
  bagKg?: number;
  /** Rental car company at the destination; "" when they rent one without saying which; null when they don't. */
  rentalCar?: string | null;
  /** Why they travel, as an immigration officer may ask it: tourism, family, friends, business, study, event. */
  purpose?: string;
  /** The place whose address Escala already looked up, so it is not searched again. */
  addressLookedUp?: string;
}

export interface SharedLocation {
  lat: number;
  lon: number;
  /** The place the person picked in WhatsApp, if any. */
  name?: string;
  at: string;
}

const LOCATION_KEEP_MS = 2 * 60 * 60 * 1000;

/** Persistence for people's state, so a deploy or restart does not forget a question Escala asked. */
export interface PersonStore {
  load(id: ParticipantId): Person | undefined;
  save(p: Person): void;
  delete(id: ParticipantId): void;
}

export interface ConversationDeps {
  channel: ChannelPort;
  /** Reads a trip from a message (text, image or document). Null when there is no trip in it. */
  extractItinerary(m: InboundMessage, person: Person, correction?: string): Promise<ExtractedTrip | null>;
  /** How a free-text answer should be read when Escala asked something. Defaults to keyword matching. */
  understand?(text: string, person: Person): Promise<Intent>;
  /**
   * Reads what a message is, with the conversation as context (`person.recent`, the question Escala asked). When it
   * is present it decides; keywords are only the fallback if it fails. The current message is not in `recent` yet.
   */
  route?(text: string, person: Person): Promise<Route>;
  /** Where people's state lives between messages and across restarts. Without it, only in this process. */
  store?: PersonStore;
  /** Everything else: the trip agent. Optional while it is being built. */
  agent?(m: InboundMessage, person: Person): Promise<OutboundMessage[]>;
  /** After a trip is confirmed. `watching: false` means its flights cannot be followed (not in the simulated data). */
  onTripConfirmed?(person: Person): Promise<void | { watching: boolean }>;
  /** Whether a voice note is the traveler talking to Escala or someone else speaking to them (to interpret). */
  whoSpeaks?(said: string, person: Person): Promise<"traveler" | "other">;
  /** True when the trip lands in a country other than where it starts: entry and transit documents matter. */
  crossesBorder?(person: Person): boolean;
  /** The passport remembered from an earlier trip, when they turned memory on. */
  rememberedPassport?(person: Person): string | undefined;
  /** What each country on the route asks of this passport, as messages. Used when the passport is already known. */
  briefDocuments?(person: Person): Promise<OutboundMessage[]>;
  /** A ready-made trip whose simulated flights play out in minutes, offered with a button next to the itinerary request. */
  demoTrip?(person: Person): ExtractedTrip | null;
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
const RECENT_TURNS = 12;
const RECENT_MS = 48 * 60 * 60 * 1000;

const CONFIRM_DELETE: Record<Lang, string> = {
  en: "Do you want me to delete everything I keep about you? This can't be undone. Reply DELETE to confirm.",
  es: "¿Quieres que borre todo lo que guardo de ti? No se puede deshacer. Responde BORRAR para confirmar.",
  fr: "Voulez-vous que j'efface tout ce que je garde sur vous ? C'est irréversible. Répondez EFFACER pour confirmer.",
};

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
    const demoTap = m.kind === "interactive" && m.replyId === DEMO_TRIP_ID;
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
      // Someone speaking to the traveler (an officer, a flight attendant) is interpreted, not taken as the traveler's words.
      const other = Boolean(said && known?.trip && this.deps.whoSpeaks && (await this.deps.whoSpeaks(said, known).catch(() => "traveler")) === "other");
      const lang = other ? known!.lang : (said && clearLang(said)) || (known?.langFromText ? known.lang : said ? detectLang(said) : (known?.lang ?? "en"));
      if (!said) return void (await this.deps.channel.send(m.from, { kind: "text", text: T[lang].notHeard }));
      const shown = said.length > 300 ? `${said.slice(0, 300)}…` : said;
      await this.deps.channel.send(m.from, { kind: "text", text: other ? T[lang].heardOther(shown) : T[lang].heard(shown) });
      m = { id: m.id, from: m.from, at: m.at, kind: "text", text: said, ...(other ? { spokenBy: "other" as const } : {}) };
    }
    const text = m.kind === "text" ? m.text.trim() : "";
    const word = normalize(text);
    const parsed = Date.parse(m.at);
    const at = Number.isFinite(parsed) ? parsed : Date.now();
    let p = this.people.get(m.from) ?? this.deps.store?.load(m.from);
    if (p) this.people.set(m.from, p);
    if (p && m.kind === "location" && Math.abs(m.latitude) <= 90 && Math.abs(m.longitude) <= 180) {
      p.location = { lat: m.latitude, lon: m.longitude, ...(m.name ? { name: m.name.slice(0, 100) } : {}), at: m.at };
    }
    const before = p?.recent?.length ?? 0; // the replies to this message are added after this point
    try {
      await this.process(m, text, word, at, p, demoTap);
    } finally {
      const after = this.people.get(m.from);
      if (after) {
        // A shared location is remembered as a turn by its place name only, so a later "how do I get there" has context.
        // Someone else's recorded words are kept as theirs, never as something the traveler said.
        const other = m.kind === "text" && m.spokenBy === "other";
        const said = other ? `(recorded: someone else told the traveler) ${text}` : text || (m.kind === "location" ? `📍 ${m.name ?? "(location shared)"}` : "");
        if (said) this.rememberInbound(after, said, m.at, after === p ? before : 0);
        else after.recent = (after.recent ?? []).filter((t) => Date.parse(t.at) >= Date.now() - RECENT_MS).slice(-RECENT_TURNS);
        this.deps.store?.save(after);
      }
    }
  }

  private async process(m: InboundMessage, text: string, word: string, at: number, p: Person | undefined, demoTap = false): Promise<void> {
    const tokens = new Set(word.split(/[^\p{L}'-]+/u).filter(Boolean));

    const deleteAll =
      DELETE_ALL_PHRASES.some((w) => word.includes(w)) ||
      (words(text).length <= 3 && DELETE_WORDS.some((w) => (w.includes(" ") ? word.includes(w) : tokens.has(w))));
    if (deleteAll || (p?.awaiting === "delete_confirm" && words(text).length <= 3 && DELETE_WORDS.some((w) => tokens.has(w)))) {
      return this.erase(m.from, p?.lang ?? detectLang(text));
    }

    if (STOP_WORDS.includes(word) || (words(text).length <= 3 && STOP_WORDS.some((w) => tokens.has(w)))) {
      p ??= this.newPerson(m.from, detectLang(text));
      p.stage = "stopped";
      p.awaiting = null;
      return this.say(p, T[p.lang].stopped);
    }

    if (!p) {
      // A first message with nothing of one language in it ("ok", a name) leaves the language open for the next one.
      const sure = text ? detectLangOrNull(text) : null;
      p = this.newPerson(m.from, sure ?? "en");
      p.langFromText = sure !== null;
      p.stage = "onboarding";
      p.lastSeen = at;
      if (m.profileName) p.name = m.profileName;
      await this.say(p, T[p.lang].hello);
      if (this.mayHoldTrip(m) && (await this.readItinerary(m, p))) return;
      p.awaiting = "share";
      p.shareAsked = true;
      return this.say(p, T[p.lang].shareQuestion);
    }

    // Someone who switches language is answered in the new one, once the message makes it clear.
    const switched = text && !(m.kind === "text" && m.spokenBy === "other") ? clearLang(text) : null;
    if (switched && p.langFromText && switched !== p.lang) p.lang = switched;
    if (!p.langFromText && text && !(m.kind === "text" && m.spokenBy === "other")) {
      const sure = detectLangOrNull(text);
      if (sure) {
        p.lang = sure;
        p.langFromText = true;
      }
    }

    if (m.profileName) p.name = m.profileName; // they may change it in WhatsApp
    const returning = p.stage === "stopped" || (p.lastSeen !== undefined && at - p.lastSeen > SESSION_GAP_MS);
    p.lastSeen = at;
    if (p.stage === "stopped") p.stage = p.trip ? "ready" : "onboarding";
    if (returning && !text.match(/^\s*$/)) await this.say(p, T[p.lang].welcomeBack);

    if (MENU_WORDS.includes(word)) return this.mainMenu(p);
    if (PRIVACY_WORDS.includes(word)) return this.say(p, T[p.lang].privacy);

    // The demo trip, by its button or by asking for it in so many words: shown like any itinerary, to confirm.
    if (this.deps.demoTrip && (demoTap || DEMO_WORDS.includes(word))) {
      const demo = this.deps.demoTrip(p);
      if (demo) {
        p.pending = demo;
        p.awaiting = "confirm";
        return this.say(p, T[p.lang].itinerarySummary(demo.lines));
      }
    }

    // Exact shortcut (D42): a whole-message "sí" / "no" that answers the itinerary Escala just showed needs no model.
    if (this.deps.route && m.kind === "text" && p.awaiting === "confirm" && p.pending) {
      if (EXACT_YES.includes(word)) return this.confirm(p);
      if (EXACT_NO.includes(word)) {
        p.awaiting = "fix";
        return this.say(p, T[p.lang].fixPrompt);
      }
    }

    // A model that sees the conversation decides what the message is; keywords below are only the fallback.
    if (this.deps.route && m.kind === "text" && text) {
      let route: Route | undefined;
      try {
        route = await this.deps.route(text, p);
      } catch {
        route = undefined;
      }
      if (route && (await this.act(route, m, text, p))) return;
    }

    if (p.awaiting === "share" && m.kind === "text") {
      const intent = await this.understand(text, p);
      if (intent === "remember" || intent === "trip_only" || intent === "no") {
        p.share = intent === "remember" ? "profile" : "trip";
        p.awaiting = null;
        await this.deps.onShareChanged?.(p);
        await this.say(p, p.share === "profile" ? T[p.lang].sharedProfile : T[p.lang].sharedTrip);
        if (!p.trip && !p.pending) return this.askForTrip(p);
        if (p.trip) await this.afterTrip(p);
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
      for (const out of await this.deps.agent(m, p)) {
        await this.deps.channel.send(p.id, out);
        if ("text" in out && out.kind === "text") this.remember(p, "escala", out.text, new Date().toISOString());
      }
      return;
    }
    if (!p.trip && m.kind !== "text") return this.say(p, T[p.lang].notReadable);
    return this.say(p, T[p.lang].notYet);
  }

  /** Acts on what the model read. Returns false when the message should go on to the usual path (the agent). */
  private async act(route: Route, m: InboundMessage, text: string, p: Person): Promise<boolean> {
    if (p.awaiting === "delete_confirm" && route.kind !== "delete_all") p.awaiting = null; // they moved on
    switch (route.kind) {
      case "stop":
        p.stage = "stopped";
        p.awaiting = null;
        await this.say(p, T[p.lang].stopped);
        return true;
      case "delete_all":
        p.awaiting = "delete_confirm";
        await this.say(p, CONFIRM_DELETE[p.lang]);
        return true;
      case "menu":
        await this.mainMenu(p);
        return true;
      case "privacy":
        await this.say(p, T[p.lang].privacy);
        return true;
      case "share":
        p.share = route.share;
        p.shareAsked = true;
        if (p.awaiting === "share") p.awaiting = null;
        await this.deps.onShareChanged?.(p);
        await this.say(p, p.share === "profile" ? T[p.lang].sharedProfile : T[p.lang].sharedTrip);
        if (!p.trip && !p.pending) await this.askForTrip(p);
        else if (p.trip) await this.afterTrip(p);
        return true;
      case "confirm":
        if (!p.pending) return false;
        await this.confirm(p);
        return true;
      case "fix":
        if (!p.pending && !p.trip) return false;
        if (!route.correction) {
          p.awaiting = "fix";
          await this.say(p, T[p.lang].fixPrompt);
          return true;
        }
        if (await this.readItinerary(m, p, route.correction)) return true;
        return false;
      case "itinerary":
        return this.readItinerary(m, p);
      case "other":
        return false;
    }
  }

  private async erase(id: ParticipantId, lang: Lang) {
    this.people.delete(id);
    this.deps.store?.delete(id);
    await this.deps.onDelete?.(id);
    await this.deps.channel.send(id, { kind: "text", text: DELETED[lang] });
  }

  /** Adds one of Escala's turns (newest last). Trimming happens once, when the traveler's message is recorded. */
  private remember(p: Person, role: Turn["role"], text: string, at: string) {
    p.recent = [...(p.recent ?? []), { role, text: text.slice(0, 1000), at }];
  }

  /** The traveler's message is recorded after the replies to it were sent, so it goes in front of them. */
  private rememberInbound(p: Person, text: string, at: string, index: number) {
    const all = p.recent ?? [];
    const replies = all.slice(index);
    const earlier = all.slice(0, index).filter((t) => Date.parse(t.at) >= Date.now() - RECENT_MS);
    p.recent = [...earlier, { role: "traveler" as const, text: text.slice(0, 1000), at }, ...replies].slice(-RECENT_TURNS);
  }

  /**
   * Forgets people whose state has expired: the trip ended and its claim window closed, or nothing was shared and
   * they have been silent for 30 days. Run on a schedule; returns how many were forgotten.
   */
  evict(now: number, claimDays: number): number {
    let n = 0;
    for (const [id, p] of this.people) {
      if (p.location && now - Date.parse(p.location.at) >= LOCATION_KEEP_MS) {
        delete p.location;
        this.deps.store?.save(p);
      }
      const lastFlight = (p.trip as { legs?: Array<{ date: string }> } | undefined)?.legs?.map((l) => l.date).sort().at(-1);
      const until = lastFlight ? Date.parse(`${lastFlight}T00:00:00Z`) + (claimDays + 1) * 86_400_000 : (p.lastSeen ?? now) + 30 * 86_400_000;
      if (now >= until) {
        this.people.delete(id);
        this.deps.store?.delete(id);
        n++;
      }
    }
    return n;
  }

  private async readItinerary(m: InboundMessage, p: Person, correction?: string): Promise<boolean> {
    let got: ExtractedTrip | null;
    try {
      got = await this.deps.extractItinerary(m, p, correction);
    } catch {
      // A model that fails here must not leave the person without an answer.
      await this.say(p, T[p.lang].notReadable);
      return true;
    }
    if (!got || got.lines.length === 0) return false;
    p.pending = got;
    p.awaiting = "confirm";
    await this.say(p, T[p.lang].itinerarySummary(got.lines));
    return true;
  }

  private async confirm(p: Person) {
    if (!p.pending) return this.askForTrip(p);
    // A new trip without memory for future trips starts fresh: how they traveled last time is not kept.
    if (p.trip && p.share !== "profile") delete p.style;
    // What they told about the last trip (stay, purpose, bags, passes) belongs to it: the next card must not repeat it.
    if (p.trip) {
      delete p.details;
      delete p.boardingPasses;
    }
    p.trip = p.pending.trip;
    delete p.pending;
    p.stage = "ready";
    p.awaiting = null;
    const after = await this.deps.onTripConfirmed?.(p);
    if (after && after.watching === false) await this.offerDemo(p, T[p.lang].notWatching);
    else await this.say(p, T[p.lang].confirmed);
    if (!p.shareAsked) {
      p.shareAsked = true;
      p.awaiting = "share";
      await this.say(p, T[p.lang].shareQuestion);
      return; // documents come after that answer
    }
    await this.afterTrip(p);
  }

  /** Once the trip is set: if it crosses borders, the documents each country asks for, or the question that unlocks them. */
  private async afterTrip(p: Person) {
    if (!this.deps.crossesBorder?.(p)) return;
    const remembered = p.passport ? undefined : this.deps.rememberedPassport?.(p);
    if (remembered) p.passport = remembered;
    if (!p.passport || !this.deps.briefDocuments) return this.say(p, T[p.lang].passportQuestion);
    for (const out of await this.deps.briefDocuments(p)) {
      await this.deps.channel.send(p.id, out);
      if (out.kind === "text") this.remember(p, "escala", out.text, new Date().toISOString());
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

  /** Asks for the itinerary; with a demo trip available, a button offers it. */
  private async askForTrip(p: Person) {
    return this.offerDemo(p, T[p.lang].askItinerary);
  }

  private async offerDemo(p: Person, text: string) {
    if (!this.deps.demoTrip) return this.say(p, text);
    await this.deps.channel.send(p.id, { kind: "buttons", text, buttons: [{ id: DEMO_TRIP_ID, title: T[p.lang].demoButton }] });
    this.remember(p, "escala", text, new Date().toISOString());
  }

  private async say(p: Person, text: string): Promise<void> {
    await this.deps.channel.send(p.id, { kind: "text", text });
    this.remember(p, "escala", text, new Date().toISOString());
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
