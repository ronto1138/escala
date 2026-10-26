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
