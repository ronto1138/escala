import { describe, expect, it } from "vitest";
import { loadEntries } from "@escala/rights";
import { longestDeadlineDays, tripFactExpiry } from "../src/index.ts";

describe("retention promised in the privacy policy", () => {
  it("trip facts expire after the last flight plus the longest claim deadline in the base", () => {
    const days = longestDeadlineDays(loadEntries());
    expect(days).toBeGreaterThanOrEqual(366); // at least the one-year claim windows (Canada, Profeco)
    const trip = { bookingRef: null, legs: [{ flight: "ZZ1", date: "2026-11-02", from: "AUS", to: "ORD", dep_local: "07:10", arr_local: "09:35" }] };
    const exp = tripFactExpiry(trip, "2026-11-01T10:00:00Z", days);
    expect(Date.parse(exp)).toBe(Date.parse("2026-11-02T00:00:00Z") + (days + 1) * 86_400_000);
  });

  it("without a trip, facts expire after 30 days", () => {
    expect(tripFactExpiry(undefined, "2026-11-01T10:00:00Z", 730)).toBe("2026-12-01T10:00:00.000Z");
  });
});

describe("audit Oct 26: what may be stored", async () => {
  const { scrub } = await import("../src/agent.ts");
  it("removes e-mail addresses and phone or card numbers from statements", () => {
    expect(scrub("Escríbele a ana@example.test o al +52 55 1234 5678")).toBe("Escríbele a [email] o al [number]");
    expect(scrub("Perdí una conexión de 50 minutos en 2026")).toBe("Perdí una conexión de 50 minutos en 2026");
  });
});
