import { describe, expect, it } from "vitest";
import { SimChannel, validateOutbound, type OutboundMessage } from "@escala/channel";
import { Conversation, detectLang, keywordIntent, LANGS, T, type ExtractedTrip } from "../src/index.ts";

const trip: ExtractedTrip = {
  lines: ["ZZ 1234 · lun 2 nov · Austin 07:10 → Chicago 09:35", "ZZ 567 · lun 2 nov · Chicago 10:30 → Montreal 13:40"],
  trip: { legs: 2 },
};

function setup(start = Date.parse("2026-11-01T15:00:00Z")) {
  let now = start;
  const sim = new SimChannel(() => now);
  const corrections: string[] = [];
  const confirmed: string[] = [];
  const conv = new Conversation({
    channel: sim,
    extractItinerary: async (m, _p, correction) => {
      if (correction) corrections.push(correction);
      if (m.kind === "image") return trip;
      if (m.kind === "text" && (/\bZZ\s?\d+/.test(m.text) || correction)) return trip;
      return null;
    },
    onTripConfirmed: async (p) => void confirmed.push(p.id),
  });
  const out = () => sim.transcript.filter((e) => e.direction === "out").map((e) => e.message as OutboundMessage);
  const lastText = () => {
    const m = out().at(-1);
    return m && "text" in m ? m.text : "";
  };
  return { sim, conv, out, lastText, corrections, confirmed, advance: (ms: number) => void (now += ms) };
}

describe("copy fits WhatsApp in all three languages", () => {
  it.each(LANGS)("%s", (lang) => {
    const t = T[lang];
    for (const text of [t.hello, t.welcomeBack, t.shareQuestion, t.privacy, t.itinerarySummary(trip.lines), t.confirmed, t.stopped]) {
      expect(validateOutbound({ kind: "text", text })).toEqual([]);
    }
    expect(validateOutbound({ kind: "list", text: t.menuText, buttonLabel: t.menuButton, sections: t.menuSections })).toEqual([]);
  });

  it("keeps the first message short (two short paragraphs) and says it is an AI", () => {
    for (const lang of LANGS) {
      expect(T[lang].hello.length).toBeLessThan(380);
      expect(T[lang].hello).toMatch(/AI|inteligencia artificial|intelligence artificielle/);
    }
  });
});

describe("reading short answers in words", () => {
  it("understands yes, no, remember and just-this-trip without buttons", () => {
    expect(keywordIntent("Sí, está bien", "es")).toBe("yes");
    expect(keywordIntent("sí, acuérdate de mí", "es")).toBe("remember");
    expect(keywordIntent("just this trip please", "en")).toBe("trip_only");
    expect(keywordIntent("Non, ce n'est pas ça", "fr")).toBe("no");
    expect(keywordIntent("el 2 de noviembre", "es")).toBe("other"); // "no" inside "noviembre" is not a no
  });

  it("guesses the greeting language from the first message", () => {
    expect(detectLang("Hola, ¿me ayudas con mi viaje?")).toBe("es");
    expect(detectLang("Bonjour, c'est pour mon voyage")).toBe("fr");
    expect(detectLang("hey")).toBe("en");
  });
});

describe("first contact", () => {
  it("introduces itself briefly, asks in words, and never shows buttons unless asked", async () => {
    const { sim, conv, out, lastText, confirmed } = setup();
    const sam = "15550001111";

    await sim.userSends(sam, { kind: "text", text: "Hola, ¿me ayudas con mi viaje?" });
    expect(out().map((m) => m.kind)).toEqual(["text", "text"]);
    expect((out()[0] as any).text).toBe(T.es.hello);
    expect(lastText()).toBe(T.es.shareQuestion);

    await sim.userSends(sam, { kind: "text", text: "Sí, acuérdate de mí" });
    expect(conv.people.get(sam)?.share).toBe("profile");
    expect(lastText()).toBe(T.es.askItinerary);

    await sim.userSends(sam, { kind: "image", mediaId: "m1", mimeType: "image/png" });
    expect(lastText()).toContain("ZZ 567");

    await sim.userSends(sam, { kind: "text", text: "sí, está bien" });
    expect(conv.people.get(sam)?.stage).toBe("ready");
    expect(confirmed).toEqual([sam]);
    expect(out().every((m) => m.kind === "text")).toBe(true); // no buttons, no lists
  });

  it("accepts the itinerary as the very first message and asks about memory only afterwards", async () => {
    const { sim, conv, out, lastText } = setup();
    await sim.userSends("2", { kind: "image", mediaId: "m1", mimeType: "image/png" });
    expect((out()[0] as any).text).toBe(T.en.hello);
    expect(lastText()).toContain("ZZ 1234");
    await sim.userSends("2", { kind: "text", text: "yes, perfect" });
    expect(conv.people.get("2")?.stage).toBe("ready");
    expect(lastText()).toBe(T.en.shareQuestion);
  });

  it("takes a correction in the person's own words", async () => {
    const { sim, lastText, corrections } = setup();
    await sim.userSends("3", { kind: "image", mediaId: "m1", mimeType: "image/png" });
    await sim.userSends("3", { kind: "text", text: "no, el regreso es el sábado 7, no el viernes" });
    expect(corrections).toEqual(["no, el regreso es el sábado 7, no el viernes"]);
    expect(lastText()).toContain("¿Está bien?");
  });
});

describe("people Escala already knows", () => {
  it("only says hello again, with the reminder, after a day away", async () => {
    const { sim, out, advance } = setup();
    await sim.userSends("4", { kind: "text", text: "Hello" });
    await sim.userSends("4", { kind: "text", text: "just this trip" });
    advance(30 * 60 * 60 * 1000);
    await sim.userSends("4", { kind: "text", text: "hi, is my flight on time?" });
    const texts = out().map((m) => (m as any).text as string);
    expect(texts.filter((t) => t === T.en.hello)).toHaveLength(1);
    expect(texts).toContain(T.en.welcomeBack);
  });
});

describe("on request only", () => {
  it("shows the menu and the full privacy note when asked", async () => {
    const { sim, out, lastText } = setup();
    await sim.userSends("5", { kind: "text", text: "Bonjour, c'est pour mon voyage" });
    await sim.userSends("5", { kind: "text", text: "menu" });
    expect(out().at(-1)).toMatchObject({ kind: "list", buttonLabel: "Ouvrir le menu" });
    await sim.userSends("5", { kind: "text", text: "confidentialité" });
    expect(lastText()).toBe(T.fr.privacy);
  });

  it("STOP stops everything", async () => {
    const { sim, conv, lastText } = setup();
    await sim.userSends("6", { kind: "text", text: "hi" });
    await sim.userSends("6", { kind: "text", text: "STOP" });
    expect(conv.people.get("6")?.stage).toBe("stopped");
    expect(lastText()).toBe(T.en.stopped);
  });
});

describe("Muse Code audit (Oct 26): privacy promises are kept", () => {
  it("P1: DELETE / BORRAR / EFFACER erase the person, and the bot says so", async () => {
    const sim = new SimChannel();
    const erased: string[] = [];
    const conv = new Conversation({ channel: sim, extractItinerary: async () => null, onDelete: async (id) => void erased.push(id) });
    await sim.userSends("7", { kind: "text", text: "Hola" });
    await sim.userSends("7", { kind: "text", text: "Borrar" });
    expect(conv.people.has("7")).toBe(false);
    expect(erased).toEqual(["7"]);
    const last = sim.transcript.at(-1)!.message as { text: string };
    expect(last.text).toMatch(/Borré todo/);
  });

  it("battery (Oct 26): 'delete' inside a sentence does not erase everything; 'delete everything' does", async () => {
    const sim = new SimChannel();
    const erased: string[] = [];
    const conv = new Conversation({ channel: sim, extractItinerary: async () => null, agent: async () => [], onDelete: async (id) => void erased.push(id) });
    await sim.userSends("9", { kind: "text", text: "Hi" });
    await sim.userSends("9", { kind: "text", text: "Please delete the note about my bag." });
    expect(erased).toEqual([]);
    await sim.userSends("9", { kind: "text", text: "Actually, please delete everything you have on me" });
    expect(erased).toEqual(["9"]);
  });

  it("battery (Oct 26): English with 'me' is not read as Spanish", () => {
    expect(detectLang("ZX denied me boarding in Calgary. What do they owe me and when?")).toBe("en");
    expect(detectLang("Can you help me with my trip?")).toBe("en");
    expect(detectLang("¿Me ayudas con mi viaje?")).toBe("es");
    expect(detectLang("Pouvez-vous m'aider pour mon voyage ?")).toBe("fr");
  });

  it("P2: 'please stop' and 'stop,' stop the messages", async () => {
    for (const text of ["please stop", "stop,"]) {
      const sim = new SimChannel();
      const conv = new Conversation({ channel: sim, extractItinerary: async () => null });
      await sim.userSends("8", { kind: "text", text: "hi" });
      await sim.userSends("8", { kind: "text", text });
      expect(conv.people.get("8")?.stage).toBe("stopped");
    }
  });

  it("B9: English with 'el' or 'la' inside words stays English", () => {
    expect(detectLang("travel alone please")).toBe("en");
  });
});

describe("voice notes become text", () => {
  const voice = { kind: "audio" as const, mediaId: "v1", mimeType: "audio/ogg", voice: true };

  it("says what it understood, then handles it like a written message", async () => {
    const sim = new SimChannel();
    const seen: string[] = [];
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async () => null,
      transcribe: async () => "¿Cómo va mi vuelo?",
      agent: async (m) => (m.kind === "text" ? (seen.push(m.text), [{ kind: "text", text: "ok" }]) : []),
    });
    await sim.userSends("21", { kind: "text", text: "Hola" });
    await sim.userSends("21", { kind: "text", text: "solo este viaje" });
    await sim.userSends("21", voice);
    const texts = sim.transcript.filter((e) => e.direction === "out").map((e) => (e.message as { text: string }).text);
    expect(texts).toContain("🎙️ Entendí: «¿Cómo va mi vuelo?»");
    expect(seen).toEqual(["¿Cómo va mi vuelo?"]);
    expect(conv.people.get("21")?.lang).toBe("es");
  });

  it("'delete everything' said aloud erases the person", async () => {
    const sim = new SimChannel();
    const erased: string[] = [];
    const conv = new Conversation({ channel: sim, extractItinerary: async () => null, transcribe: async () => "Delete everything", onDelete: async (id) => void erased.push(id) });
    await sim.userSends("22", { kind: "text", text: "hi" });
    await sim.userSends("22", voice);
    expect(erased).toEqual(["22"]);
    expect(conv.people.has("22")).toBe(false);
  });

  it("asks again when nothing could be understood", async () => {
    const sim = new SimChannel();
    new Conversation({ channel: sim, extractItinerary: async () => null, transcribe: async () => null });
    await sim.userSends("23", { kind: "text", text: "hi" });
    await sim.userSends("23", voice);
    expect((sim.transcript.at(-1)!.message as { text: string }).text).toBe(T.en.notHeard);
  });
});

describe("audit Oct 26: state held in the process expires", () => {
  it("forgets a person after the trip and its claim window, or after 30 silent days without a trip", async () => {
    const sim = new SimChannel(() => Date.parse("2026-11-02T12:00:00Z"));
    const conv = new Conversation({ channel: sim, extractItinerary: async () => null });
    await sim.userSends("31", { kind: "text", text: "hi" });
    conv.people.get("31")!.trip = { legs: [{ date: "2026-11-02" }] };
    await sim.userSends("32", { kind: "text", text: "hola" });
    expect(conv.evict(Date.parse("2026-12-10T00:00:00Z"), 400)).toBe(1); // 32: silent 30+ days, no trip
    expect(conv.people.has("31")).toBe(true);
    expect(conv.evict(Date.parse("2027-12-10T00:00:00Z"), 400)).toBe(1); // 31: trip + 400 days passed
    expect(conv.people.size).toBe(0);
  });
});

describe("buttons and menu rows are the person's words", () => {
  it("a template button tap and a menu row reach the agent as text", async () => {
    const sim = new SimChannel();
    const seen: string[] = [];
    new Conversation({ channel: sim, extractItinerary: async () => null, agent: async (m) => (m.kind === "text" ? (seen.push(m.text), []) : []) });
    await sim.userSends("41", { kind: "text", text: "Hola" });
    await sim.userSends("41", { kind: "text", text: "solo este viaje" });
    await sim.userSends("41", { kind: "template_button", payload: "", text: "¿Qué significa?" });
    await sim.userSends("41", { kind: "interactive", replyId: "trip.status", title: "Estado del vuelo" });
    expect(seen).toEqual(["¿Qué significa?", "Estado del vuelo"]);
  });
});

describe("Oct 27 field test: 'puedes acordarte de todo'", () => {
  it("is read as 'remember' in Spanish, and the French and English equivalents too", () => {
    expect(keywordIntent("puedes acordarte de todo", "es")).toBe("remember");
    expect(keywordIntent("tu peux tout retenir", "fr")).toBe("remember");
    expect(keywordIntent("remember everything", "en")).toBe("remember");
    expect(keywordIntent("solo este viaje", "es")).toBe("trip_only");
    expect(keywordIntent("sí, está todo bien", "es")).toBe("yes"); // "todo" alone is not "remember"
  });
});
