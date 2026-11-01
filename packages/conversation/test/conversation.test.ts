import { describe, expect, it } from "vitest";
import { SimChannel, validateOutbound, type OutboundMessage } from "@escala/channel";
import { Conversation, detectLang, keywordIntent, LANGS, T, type ExtractedTrip, type Person } from "../src/index.ts";

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
    // Battery 30-oct: short greetings got the English introduction.
    expect(detectLang("buenas")).toBe("es");
    expect(detectLang("Buenas tardes")).toBe("es");
    expect(detectLang("Salut")).toBe("fr");
    expect(detectLang("bonsoir")).toBe("fr");
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

  it("takes \"nomas este viaje\" without a model and starts the demo on a short \"probar demo\" (Ives' recording, 30-oct)", async () => {
    const sim = new SimChannel(() => Date.parse("2026-11-01T15:00:00Z"));
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async () => null,
      route: async () => ({ kind: "privacy" }), // the misreading
      demoTrip: () => ({ lines: ["ZZ 1234"], trip }),
    });
    await sim.userSends("8", { kind: "text", text: "hola" });
    await sim.userSends("8", { kind: "text", text: "nomas este viaje" });
    const p = conv.people.get("8")!;
    expect(p.share).toBe("trip");
    expect(p.awaiting).toBeNull();
    await sim.userSends("8", { kind: "text", text: "probar demo" });
    expect(p.pending?.lines).toEqual(["ZZ 1234"]);
  });

  it("does not change how much it remembers on a later misreading, nor replay the trip (Ives' recording, 30-oct)", async () => {
    const sim = new SimChannel(() => Date.parse("2026-11-01T15:00:00Z"));
    const answered: string[] = [];
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async (m) => (m.kind === "text" && /\bZZ\s?\d+/.test(m.text) ? trip : null),
      agent: async (m) => (answered.push(m.kind === "text" ? m.text : ""), [{ kind: "text", text: "ok" }]),
      route: async (text) => (/\bZZ\s?\d+/.test(text) ? { kind: "itinerary" } : /^yes/i.test(text) ? { kind: "confirm" } : { kind: "share", share: /aeropuerto/.test(text) ? "profile" : "trip" }),
    });
    await sim.userSends("7", { kind: "text", text: "my flights: ZZ 1234 and ZZ 567" });
    await sim.userSends("7", { kind: "text", text: "yes" });
    await sim.userSends("7", { kind: "text", text: "just this trip" });
    const p = conv.people.get("7")!;
    expect(p.share).toBe("trip");
    await sim.userSends("7", { kind: "text", text: "ok gracias, ya estoy llegando al aeropuerto, que hago" });
    expect(p.share).toBe("trip");
    expect(answered).toContain("ok gracias, ya estoy llegando al aeropuerto, que hago");
  });

  it("asks before stopping when only the model read a wish to stop (Ives' recording, 30-oct)", async () => {
    const sim = new SimChannel(() => Date.parse("2026-11-01T15:00:00Z"));
    const answered: string[] = [];
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async (m) => (m.kind === "text" && /\bZZ\s?\d+/.test(m.text) ? trip : null),
      agent: async (m) => (answered.push(m.kind === "text" ? m.text : ""), [{ kind: "text", text: "ok" }]),
      // The misreading: a request for help taken as "stop".
      route: async (text) => (/\bZZ\s?\d+/.test(text) ? { kind: "itinerary" } : /^yes/i.test(text) ? { kind: "confirm" } : /caminar/.test(text) ? { kind: "stop" } : /^just/.test(text) ? { kind: "share", share: "trip" } : { kind: "other" }),
    });
    await sim.userSends("9", { kind: "text", text: "my flights: ZZ 1234 and ZZ 567" });
    await sim.userSends("9", { kind: "text", text: "yes" });
    await sim.userSends("9", { kind: "text", text: "just this trip" });
    const p = conv.people.get("9")!;
    await sim.userSends("9", { kind: "text", text: "me cuesta caminar, me pueden ayudar?" });
    expect(p.stage).toBe("ready");
    expect(p.awaiting).toBe("stop_confirm");
    await sim.userSends("9", { kind: "text", text: "necesito una silla de ruedas" }); // not a yes: carries on
    expect(p.stage).toBe("ready");
    expect(p.awaiting).toBeNull();
    expect(answered).toContain("necesito una silla de ruedas");
    await sim.userSends("9", { kind: "text", text: "me cuesta caminar" });
    await sim.userSends("9", { kind: "text", text: "ALTO" }); // the word itself stops at once
    expect(p.stage).toBe("stopped");
  });

  it("forgets the last trip's stay, purpose and passes when a new trip is confirmed (Muse Code audit d)", async () => {
    const sim = new SimChannel(() => Date.parse("2026-11-01T15:00:00Z"));
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async (m) => (m.kind === "text" && /\bZZ\s?\d+/.test(m.text) ? trip : null),
      route: async (text) => (/\bZZ\s?\d+/.test(text) ? { kind: "itinerary" } : /^yes/i.test(text) ? { kind: "confirm" } : { kind: "share", share: "trip" }),
    });
    await sim.userSends("4", { kind: "text", text: "my flights: ZZ 1234 and ZZ 567" });
    await sim.userSends("4", { kind: "text", text: "yes" });
    await sim.userSends("4", { kind: "text", text: "just this trip" });
    const p = conv.people.get("4")!;
    expect(p.stage).toBe("ready");
    p.details = { stay: "Hotel Synthetic", purpose: "family" };
    p.boardingPasses = { ZZ1234: { boardingTime: "06:30" } };
    p.passport = "MX";
    await sim.userSends("4", { kind: "text", text: "new trip: ZZ 890" });
    await sim.userSends("4", { kind: "text", text: "yes" });
    expect(p.details).toBeUndefined();
    expect(p.boardingPasses).toBeUndefined();
    expect(p.passport).toBeUndefined(); // kept with the trip and deleted with it (Muse Code nightly audit, 30-oct)
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

  it("battery (Oct 31): 'delete everything' is confirmed in the language of that message", async () => {
    const sim = new SimChannel();
    const conv = new Conversation({ channel: sim, extractItinerary: async () => null, agent: async () => [], onDelete: async () => {} });
    await sim.userSends("31", { kind: "text", text: "Hi" });
    conv.people.get("31")!.lang = "en";
    await sim.userSends("31", { kind: "text", text: "ya no quiero que guardes nada de mí, bórralo todo" });
    expect(conv.people.has("31")).toBe(false);
    expect((sim.transcript.at(-1)!.message as { text: string }).text).toMatch(/Borré todo/);
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

describe("Oct 27 field test: read in context, across restarts", () => {
  const memoryStore = () => {
    const m = new Map<string, Person>();
    return { load: (id: string) => (m.has(id) ? structuredClone(m.get(id)!) : undefined), save: (p: Person) => void m.set(p.id, structuredClone(p)), delete: (id: string) => void m.delete(id), m };
  };

  it("an answer given after a restart still answers the question Escala asked, and the model saw that question", async () => {
    const store = memoryStore();
    const sim = new SimChannel();
    new Conversation({ channel: sim, extractItinerary: async () => null, store });
    await sim.userSends("51", { kind: "text", text: "hola" });
    expect(store.m.get("51")?.awaiting).toBe("share");

    // A deploy: a new process, the same store.
    const sim2 = new SimChannel();
    const seen: Array<{ text: string; recent: string[] }> = [];
    new Conversation({
      channel: sim2, extractItinerary: async () => null, store,
      route: async (text, p) => (seen.push({ text, recent: (p.recent ?? []).map((t) => `${t.role}: ${t.text.slice(0, 20)}`) }), { kind: "share", share: "profile" }),
    });
    await sim2.userSends("51", { kind: "text", text: "la segunda opción, por favor" }); // only the model can read this one
    const out = sim2.transcript.filter((e) => e.direction === "out").map((e) => (e.message as { text: string }).text);
    expect(out[0]).toBe(T.es.sharedProfile); // not the introduction again
    expect(seen[0]!.recent.some((r) => r.startsWith("escala: Antes de empezar"))).toBe(true);
    expect(store.m.get("51")).toMatchObject({ share: "profile", awaiting: null });
    expect(store.m.get("51")!.recent!.map((t) => t.role)).toEqual(["traveler", "escala", "escala", "traveler", "escala", "escala"]);
  });

  it("a model reading 'delete everything' only asks; the explicit word erases", async () => {
    const store = memoryStore();
    const sim = new SimChannel();
    const erased: string[] = [];
    new Conversation({ channel: sim, extractItinerary: async () => null, store, onDelete: async (id) => void erased.push(id), route: async () => ({ kind: "delete_all" }) });
    await sim.userSends("52", { kind: "text", text: "Hola" });
    await sim.userSends("52", { kind: "text", text: "olvídate de mí por completo, ya no viajo" });
    expect(erased).toEqual([]);
    expect((sim.transcript.at(-1)!.message as { text: string }).text).toMatch(/Responde BORRAR para confirmar/);
    await sim.userSends("52", { kind: "text", text: "borrar" });
    expect(erased).toEqual(["52"]);
    expect(store.m.has("52")).toBe(false);
  });

  it("when the model fails, the keyword fallback still works", async () => {
    const sim = new SimChannel();
    const conv = new Conversation({ channel: sim, extractItinerary: async () => null, route: async () => { throw new Error("model down"); } });
    await sim.userSends("53", { kind: "text", text: "hola" });
    await sim.userSends("53", { kind: "text", text: "solo este viaje" });
    expect(conv.people.get("53")).toMatchObject({ share: "trip", awaiting: null });
  });
});

describe("D42: exact shortcut before the model", () => {
  it("a whole 'sí' confirms without the model; 'sí pero…' goes to the model", async () => {
    const sim = new SimChannel();
    let routed = 0;
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async () => ({ lines: ["ZZ 1234"], trip: { legs: [] } }),
      route: async () => (routed++, { kind: "fix", correction: "el segundo es el ZZ568" }),
    });
    await sim.userSends("61", { kind: "text", text: "Mis vuelos: ZZ1234 AUS-ORD el 2 de noviembre" });
    expect(conv.people.get("61")?.awaiting).toBe("confirm");
    await sim.userSends("61", { kind: "text", text: "sí pero el segundo es el ZZ568" });
    expect(routed).toBe(1);
    expect(conv.people.get("61")?.awaiting).toBe("confirm"); // re-read with the correction, asked again
    await sim.userSends("61", { kind: "text", text: "Sí" });
    expect(routed).toBe(1); // no model for a plain yes
    expect(conv.people.get("61")?.stage).toBe("ready");
  });
});

describe("shared location", () => {
  it("is kept with the person, reaches the agent, and is dropped after two hours", async () => {
    let now = Date.parse("2026-11-02T18:00:00Z");
    const sim = new SimChannel(() => now);
    const seen: string[] = [];
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async () => null,
      agent: async (m, p) => {
        seen.push(m.kind);
        return [{ kind: "text", text: p.location ? "near you" : "where are you?" }];
      },
    });
    await sim.userSends("15550001234", { kind: "text", text: "hola" });
    await sim.userSends("15550001234", { kind: "location", latitude: 45.4706, longitude: -73.7408, name: "YUL" });
    const p = conv.people.get("15550001234")!;
    expect(p.location).toMatchObject({ lat: 45.4706, lon: -73.7408, name: "YUL" });
    expect(seen).toContain("location");
    expect(p.recent?.some((t) => t.text === "📍 YUL")).toBe(true);
    now += 2 * 60 * 60 * 1000;
    conv.evict(now, 400);
    expect(conv.people.get("15550001234")?.location).toBeUndefined();
  });
});

describe("demo trip", () => {
  function demoSetup(watching: boolean) {
    const sim = new SimChannel(() => Date.parse("2026-11-06T16:00:00Z"));
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async (m) => (m.kind === "text" && /\bAA\s?\d+/.test(m.text) ? trip : null),
      demoTrip: () => ({ lines: ["ZZ 1234 · demo"], trip: { legs: 2 } }),
      onTripConfirmed: async () => ({ watching }),
    });
    const out = () => sim.transcript.filter((e) => e.direction === "out").map((e) => e.message as OutboundMessage);
    return { sim, conv, out };
  }

  it("is offered with a button next to the itinerary request, and a tap shows it to confirm", async () => {
    const { sim, out } = demoSetup(true);
    await sim.userSends("15550004444", { kind: "text", text: "hi" });
    await sim.userSends("15550004444", { kind: "text", text: "just this trip" });
    const ask = out().at(-1)!;
    expect(ask.kind).toBe("buttons");
    expect(ask.kind === "buttons" && ask.buttons[0]!.id).toBe("demo_trip");
    await sim.userSends("15550004444", { kind: "interactive", replyId: "demo_trip", title: "Try a demo trip" });
    expect(out().at(-1)).toMatchObject({ kind: "text", text: expect.stringContaining("ZZ 1234 · demo") });
    await sim.userSends("15550004444", { kind: "text", text: "yes" });
    expect(out().at(-1)).toMatchObject({ text: T.en.confirmed });
  });

  it("says plainly that real flights cannot be followed in the test, and offers the demo", async () => {
    const { sim, out } = demoSetup(false);
    await sim.userSends("15550005555", { kind: "text", text: "hi" });
    await sim.userSends("15550005555", { kind: "text", text: "just this trip" });
    await sim.userSends("15550005555", { kind: "text", text: "AA 100 JFK to LAX tomorrow" });
    await sim.userSends("15550005555", { kind: "text", text: "yes" });
    expect(out().at(-1)).toMatchObject({ kind: "buttons", text: T.en.notWatching });
  });
});

describe("someone who switches language", () => {
  it("is followed when the message is clearly in another language, never on a short yes", async () => {
    const { clearLang } = await import("../src/index.ts");
    expect(clearLang("hey, my flight out of Austin is showing late. Am I still going to make it?")).toBe("en");
    expect(clearLang("Qu'est-ce que je peux réclamer si j'arrive à Montréal avec trois heures de retard ?")).toBe("fr");
    expect(clearLang("yes")).toBeNull();
    expect(clearLang("ok gracias")).toBeNull();
  });
});

describe("a trip that crosses borders", () => {
  function borderSetup(remembered?: string) {
    const sim = new SimChannel(() => Date.parse("2026-11-06T16:00:00Z"));
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async () => null,
      demoTrip: () => ({ lines: ["ZZ 1234 · demo"], trip: { legs: 2 } }),
      crossesBorder: () => true,
      rememberedPassport: () => remembered,
      briefDocuments: async (p) => [{ kind: "text", text: `documents for ${p.passport}` }],
    });
    const out = () => sim.transcript.filter((e) => e.direction === "out").map((e) => e.message as OutboundMessage);
    return { sim, out };
  }

  it("asks which passport they fly with once the trip is confirmed", async () => {
    const { sim, out } = borderSetup();
    await sim.userSends("15550006001", { kind: "text", text: "hi" });
    await sim.userSends("15550006001", { kind: "text", text: "just this trip" });
    await sim.userSends("15550006001", { kind: "interactive", replyId: "demo_trip", title: "Try a demo trip" });
    await sim.userSends("15550006001", { kind: "text", text: "yes" });
    expect(out().slice(-2)).toEqual([{ kind: "text", text: T.en.confirmed }, { kind: "text", text: T.en.passportQuestion }]);
  });

  it("tells the documents straight away when the passport is remembered", async () => {
    const { sim, out } = borderSetup("MX");
    await sim.userSends("15550006002", { kind: "text", text: "hi" });
    await sim.userSends("15550006002", { kind: "text", text: "just this trip" });
    await sim.userSends("15550006002", { kind: "interactive", replyId: "demo_trip", title: "Try a demo trip" });
    await sim.userSends("15550006002", { kind: "text", text: "yes" });
    expect(out().at(-1)).toEqual({ kind: "text", text: "documents for MX" });
  });
});

describe("someone speaking to the traveler", () => {
  it("is interpreted in the traveler's language, never taken as a language switch", async () => {
    const sim = new SimChannel(() => Date.parse("2026-11-06T16:00:00Z"));
    const seen: any[] = [];
    const conv = new Conversation({
      channel: sim,
      extractItinerary: async () => null,
      demoTrip: () => ({ lines: ["ZZ 1234 · demo"], trip: { legs: 2 } }),
      transcribe: async () => "What is the purpose of your trip and where are you staying?",
      whoSpeaks: async () => "other",
      agent: async (m) => (seen.push(m), [{ kind: "text", text: "ok" }]),
    });
    for (const text of ["hola", "solo este viaje"]) await sim.userSends("15550006003", { kind: "text", text });
    await sim.userSends("15550006003", { kind: "interactive", replyId: "demo_trip", title: "Probar viaje demo" });
    await sim.userSends("15550006003", { kind: "text", text: "sí" });
    await sim.userSends("15550006003", { kind: "audio", mediaId: "a", mimeType: "audio/ogg", voice: true });
    const out = sim.transcript.filter((e) => e.direction === "out").map((e) => (e.message as any).text);
    expect(out).toContain("🎙️ Te dijeron: «What is the purpose of your trip and where are you staying?»");
    expect(seen.at(-1)).toMatchObject({ kind: "text", spokenBy: "other" });
    expect(conv.people.get("15550006003")!.lang).toBe("es");
  });
});
