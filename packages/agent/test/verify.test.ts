import { describe, expect, it } from "vitest";
import { extractClaims, parseNumber, verify } from "../src/verify.ts";

describe("number formats in three languages", () => {
  it("reads thousands and decimals the way people write them", () => {
    expect(parseNumber("1,075")).toBe(1075);
    expect(parseNumber("1 075")).toBe(1075);
    expect(parseNumber("1.075")).toBe(1075);
    expect(parseNumber("3,5")).toBe(3.5);
    expect(parseNumber("3.5")).toBe(3.5);
    expect(parseNumber("400")).toBe(400);
  });

  it("finds amounts before or after the number, percentages and durations", () => {
    const claims = extractClaims("Puedes recibir 400 CAD o €600, un 25 % del boleto; reclama en 7 días. You have 3 hours. Vous avez droit à 1 000 $.");
    expect(claims.map((c) => [c.kind, c.value, c.currency ?? ""])).toEqual(
      expect.arrayContaining([
        ["amount", 400, "CAD"],
        ["amount", 600, "EUR"],
        ["percent", 25, ""],
        ["duration", 7, ""],
        ["duration", 3, ""],
        ["amount", 1000, "$"],
      ]),
    );
  });

  it("does not read flight numbers or clock times as claims", () => {
    expect(extractClaims("ZZ 567 leaves at 10:30 from gate K14")).toEqual([]);
  });
});

describe("the demo moment: the model offers 600 euros", () => {
  const allowed = { amounts: [{ currency: "CAD", value: 400 }], percents: [], durations: [3, 6, 9, 14, 365, 30] };

  it("blocks the invented 600 euros", () => {
    const v = verify("Your flight is late, so you're entitled to €600 under EU rules.", allowed);
    expect(v.ok).toBe(false);
    expect(v.unmatched[0]).toMatchObject({ kind: "amount", value: 600, currency: "EUR" });
  });

  it("lets the cited CAD 400 and the 3-hour threshold through", () => {
    expect(verify("If ZZ caused it and you land 3 hours late or more, it's CAD 400.", allowed).ok).toBe(true);
    expect(verify("Si la causa fue de ZZ y llegas 3 h tarde o más, son 400 CAD.", allowed).ok).toBe(true);
  });

  it("blocks a duration that no rule or fact supports", () => {
    expect(verify("You have 48 hours to claim.", allowed).ok).toBe(false);
  });
});

describe("Muse Code audit (Oct 26): verifier bypasses that must stay closed", () => {
  const allowed = { amounts: [{ currency: "CAD", value: 400 }], percents: [], durations: [3, 6, 9, 14, 30] };

  it("C1: spelled-out amounts and durations fail closed", () => {
    expect(verify("You are owed four hundred dollars.", { amounts: [], percents: [], durations: [] }).ok).toBe(false);
    expect(verify("Te tocan cuatrocientos dólares canadienses.", allowed).ok).toBe(false);
    expect(verify("Tienes un año para reclamar.", allowed).ok).toBe(false);
  });

  it("C1: ordinary words like 'un' or 'una' do not trip it", () => {
    expect(verify("Es un vuelo de 3 horas y una conexión corta.", allowed).ok).toBe(true);
  });

  it("C2: both ends of a range are checked", () => {
    expect(verify("You get CAD 400-600.", allowed).ok).toBe(false);
    expect(verify("Entre 400 y 600 CAD.", allowed).ok).toBe(false);
  });

  it("C3: 'US dollars' is read as an amount", () => {
    expect(verify("That's 400 US dollars.", allowed).ok).toBe(false);
  });

  it("C4: minutes, months and years are checked", () => {
    expect(verify("It's 100 minutes late.", allowed).ok).toBe(false);
    expect(verify("Claim within 2 years.", allowed).ok).toBe(false);
  });

  it("C5: more than one space or a line break does not hide a figure", () => {
    expect(verify("CAD  600", allowed).ok).toBe(false);
    expect(verify("600\nCAD", allowed).ok).toBe(false);
  });
});
