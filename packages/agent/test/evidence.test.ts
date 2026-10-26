import { describe, expect, it } from "vitest";
import { evidenceReply } from "../src/index.ts";

const reading = {
  object: "bag" as const,
  description: "Maleta rígida gris con cuatro ruedas y una etiqueta verde.",
  visibleDamage: ["rayón en la esquina inferior derecha"],
  marks: { scratch: 2, dent: 0 },
  photoSha256: "a".repeat(64),
};

describe("evidence reply", () => {
  it("records when, what and the damage, and asks to keep the original photo", () => {
    const t = evidenceReply(reading, "es", "2026-11-02T13:05:12Z");
    expect(t).toContain("2026-11-02 13:05 UTC");
    expect(t).toContain("rayón en la esquina inferior derecha");
    expect(t).toContain("2 rayones");
    expect(t).not.toContain("abolladuras"); // zero counts are not listed
    expect(t).toMatch(/foto original/);
  });

  it("compares with the earlier photo and never states a deadline itself", () => {
    const t = evidenceReply({ ...reading, newDamage: ["abolladura en el costado"] }, "en", "2026-11-02T20:00:00Z", "2026-11-02T13:05:12Z");
    expect(t).toMatch(/Compared with your photo of 2026-11-02 13:05 UTC, this is new: abolladura en el costado/);
    expect(t).not.toMatch(/\b\d+\s*(days?|hours?)\b/); // deadlines come from the rules, through the agent and its verifier
    const same = evidenceReply({ ...reading, newDamage: [] }, "fr", "2026-11-02T20:00:00Z", "2026-11-02T13:05:12Z");
    expect(same).toMatch(/je ne vois pas de nouveau dommage/);
  });
});
