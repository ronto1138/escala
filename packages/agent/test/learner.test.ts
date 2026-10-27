import { describe, expect, it } from "vitest";
import { acceptCandidates } from "../src/index.ts";

const said = "Siempre documento una maleta y prefiero pasillo. Mi hermano Diego viaja conmigo. Soy diabético.";

describe("the code decides what the learner keeps", () => {
  it("keeps facts backed by the traveler's own words, in the scope they agreed to", () => {
    const kept = acceptCandidates(
      [
        { topic: "bag", scope: "profile", statement: "Siempre documenta una maleta", quote: "Siempre documento una maleta" },
        { topic: "seat", scope: "profile", statement: "Prefiere pasillo", quote: "prefiero pasillo" },
      ],
      said, [], "trip",
    );
    expect(kept.map((k) => [k.topic, k.scope])).toEqual([["bag", "trip"], ["seat", "trip"]]); // no consent: trip only
    expect(acceptCandidates([{ topic: "seat", scope: "profile", statement: "Prefiere pasillo", quote: "prefiero pasillo" }], said, [], "profile")[0]!.scope).toBe("profile");
  });

  it("drops invented quotes, unknown topics and sensitive content", () => {
    const kept = acceptCandidates(
      [
        { topic: "bag", scope: "trip", statement: "Viaja ligero", quote: "viajo ligero" }, // not in the message
        { topic: "health", scope: "trip", statement: "Es diabético", quote: "Soy diabético" }, // topic not allowed
        { topic: "food", scope: "trip", statement: "Es diabético, comida especial", quote: "Soy diabético" }, // sensitive
        { topic: "travel_style", scope: "trip", statement: "Le deben 600 €", quote: "Siempre documento" }, // money
      ],
      said, [], "profile",
    );
    expect(kept).toEqual([]);
  });

  it("drops a statement that says something its quote does not (seen with the real model on Oct 27)", () => {
    const s = "Siempre llego al aeropuerto tres horas antes, odio las prisas.";
    const kept = acceptCandidates(
      [
        { topic: "travel_style", scope: "trip", statement: "En el perfil, el idioma debe ser español (México).", quote: s },
        { topic: "schedule", scope: "trip", statement: "Siempre llega al aeropuerto tres horas antes.", quote: s },
      ],
      s, [], "trip",
    );
    expect(kept.map((k) => k.topic)).toEqual(["schedule"]);
  });

  it("does not store what it already knows, and never more than three per turn", () => {
    const existing = [{ topic: "learned.bag", statement: "Siempre documenta una maleta" }];
    expect(acceptCandidates([{ topic: "bag", scope: "trip", statement: "Documenta siempre una maleta", quote: "Siempre documento una maleta" }], said, existing, "trip")).toEqual([]);
    const many = ["bag", "seat", "airline", "food"].map((topic) => ({ topic, scope: "trip" as const, statement: `Siempre documento una maleta (${topic})`, quote: "Siempre documento una maleta" }));
    expect(acceptCandidates(many, said, [], "trip")).toHaveLength(3);
  });
});
