import { describe, expect, it } from "vitest";
import { SimChannel, validateOutbound, type OutboundMessage } from "@escala/channel";
import { Conversation, detectLang, LANGS, T, type ExtractedTrip } from "../src/index.ts";

const trip: ExtractedTrip = {
  lines: ["ZZ 1234 · Nov 2 · Austin 7:10 → Chicago 9:35", "ZZ 567 · Nov 2 · Chicago 10:30 → Montreal 13:40"],
  trip: { legs: 2 },
};

function setup() {
  const sim = new SimChannel();
  const confirmed: string[] = [];
  const conv = new Conversation({
    channel: sim,
    extractItinerary: async (m) => (m.kind === "image" || (m.kind === "text" && /ZZ/.test(m.text)) ? trip : null),
    onTripConfirmed: async (p) => void confirmed.push(p.id),
  });
  const out = () => sim.transcript.filter((e) => e.direction === "out").map((e) => e.message as OutboundMessage);
  return { sim, conv, out, confirmed };
}

describe("every user-facing message fits WhatsApp's limits in all three languages", () => {
  it.each(LANGS)("%s", (lang) => {
    const t = T[lang];
    const msgs: OutboundMessage[] = [
      { kind: "text", text: t.welcome },
      { kind: "buttons", text: t.shareQuestion, buttons: [{ id: "a", title: t.shareButtons.trip }, { id: "b", title: t.shareButtons.remember }, { id: "c", title: t.shareButtons.details }] },
      { kind: "buttons", text: t.itinerarySummary(trip.lines), buttons: [{ id: "a", title: t.confirmButtons.ok }, { id: "b", title: t.confirmButtons.fix }, { id: "c", title: t.confirmButtons.menu }] },
      { kind: "list", text: t.menuText, buttonLabel: t.menuButton, sections: t.menuSections },
    ];
    for (const m of msgs) expect(validateOutbound(m)).toEqual([]);
    expect(t.menuSections.flatMap((s) => s.rows)).toHaveLength(10);
  });

  it("uses the same menu row ids in every language", () => {
    const ids = (l: (typeof LANGS)[number]) => T[l].menuSections.flatMap((s) => s.rows.map((r) => r.id));
    expect(ids("es")).toEqual(ids("en"));
    expect(ids("fr")).toEqual(ids("en"));
  });
});

describe("language of the greeting", () => {
  it("guesses from the first message and defaults to English", () => {
    expect(detectLang("Hola, ¿cómo funciona?")).toBe("es");
    expect(detectLang("Bonjour, est-ce que ça marche ?")).toBe("fr");
    expect(detectLang("hi")).toBe("en");
  });
});

describe("onboarding", () => {
  it("introduces itself as an AI, asks how much to share, reads the itinerary and never asks for it twice", async () => {
    const { sim, conv, out, confirmed } = setup();
    const sam = "15550001111";

    await sim.userSends(sam, { kind: "text", text: "hi" });
    expect((out()[0] as any).text).toMatch(/I'm Escala: an AI/);
    expect((out()[0] as any).text).toMatch(/no one on our team reads it/);
    expect(out()[1]).toMatchObject({ kind: "buttons" });
    expect(conv.people.get(sam)?.share).toBe("trip"); // most private by default

    await sim.userSends(sam, { kind: "interactive", replyId: "share.remember", title: "Remember me" });
    expect(conv.people.get(sam)?.share).toBe("profile");
    expect((out().at(-1) as any).text).toMatch(/won't ask you for it again/);

    await sim.userSends(sam, { kind: "image", mediaId: "m1", mimeType: "image/png" });
    expect(out().at(-1)).toMatchObject({ kind: "buttons" });
    expect((out().at(-1) as any).text).toContain("ZZ 567");

    await sim.userSends(sam, { kind: "interactive", replyId: "confirm.ok", title: "Correct, alert me" });
    expect(conv.people.get(sam)?.stage).toBe("ready");
    expect(confirmed).toEqual([sam]);
    const asks = out().filter((m) => m.kind === "text" && m.text === T.en.askItinerary);
    expect(asks).toHaveLength(1);
  });

  it("says plainly when it cannot read a trip", async () => {
    const { sim, out } = setup();
    await sim.userSends("1", { kind: "text", text: "hola, ¿qué tal?" });
    await sim.userSends("1", { kind: "interactive", replyId: "share.trip", title: "Solo este viaje" });
    await sim.userSends("1", { kind: "text", text: "mi viaje es la próxima semana" });
    expect((out().at(-1) as any).text).toBe(T.es.notReadable);
  });
});

describe("navigation", () => {
  it("opens the main menu from anywhere, in the person's language", async () => {
    const { sim, out } = setup();
    await sim.userSends("2", { kind: "text", text: "Bonjour, mon vol" });
    await sim.userSends("2", { kind: "text", text: "Menu" });
    expect(out().at(-1)).toMatchObject({ kind: "list", buttonLabel: "Ouvrir le menu" });
  });

  it("STOP stops everything; writing again starts over", async () => {
    const { sim, conv, out } = setup();
    await sim.userSends("3", { kind: "text", text: "hi" });
    await sim.userSends("3", { kind: "text", text: "STOP" });
    expect(conv.people.get("3")?.stage).toBe("stopped");
    expect((out().at(-1) as any).text).toMatch(/won't send you any more messages/);
    await sim.userSends("3", { kind: "text", text: "hi again" });
    expect((out().at(-2) as any).text).toMatch(/I'm Escala/);
  });
});
