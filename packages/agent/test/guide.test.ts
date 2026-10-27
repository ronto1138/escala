import { describe, expect, it } from "vitest";
import { convertUnits, createRates, parseEcb, RIGHTS_TOPIC, searchTravel } from "../src/guide.ts";

const ECB = `<gesmes:Envelope><Cube><Cube time='2026-10-27'>
<Cube currency='USD' rate='1.1000'/><Cube currency='CAD' rate='1.5000'/><Cube currency='MXN' rate='20.0000'/>
<Cube currency='GBP' rate='0.8500'/></Cube></Cube></gesmes:Envelope>`;

function fakeClient(output: unknown[]) {
  return { responses: async () => ({ output }), transcribe: async () => ({ text: "" }) } as any;
}

describe("units", () => {
  it("converts exactly and refuses mixed dimensions", () => {
    expect(convertUnits(23, "kg", "lb")).toEqual({ value: 50.71, from: "kg", to: "lb" });
    expect(convertUnits(72, "F", "C")).toMatchObject({ value: 22.22 });
    expect(convertUnits(10, "km", "kg")).toHaveProperty("error");
  });
});

describe("currency", () => {
  it("reads the ECB file and converts across the euro with the rate date", async () => {
    expect(parseEcb(ECB).perEuro.MXN).toBe(20);
    const convert = createRates(async () => ECB);
    expect(await convert(100, "USD", "MXN")).toMatchObject({ amount: 1818.18, currency: "MXN", rate_date: "2026-10-27" });
    expect(await convert(100, "USD", "XYZ")).toHaveProperty("error");
  });
});

describe("web guide", () => {
  const q = { query: "YUL to downtown", place: "Montreal", lang: "en" as const, profile: [], today: "2026-10-27" };

  it("keeps only the final report and its sources", async () => {
    const r = await searchTravel(
      fakeClient([
        { type: "message", content: [{ text: "Checking fares…" }] },
        { type: "web_search_call" },
        { type: "message", content: [{ text: "Bus 747, per STM.", annotations: [{ url: "https://www.stm.info/en/info/networks/bus-shuttle-airport" }] }] },
      ]),
      q,
    );
    expect(r.findings).toBe("Bus 747, per STM.");
    expect(r.sources).toEqual(["https://www.stm.info/en/info/networks/bus-shuttle-airport"]);
    expect(r.unconfirmed).toBe(false);
  });

  it("marks as unconfirmed what no search or no source backs (for example on the failsafe model)", async () => {
    const r = await searchTravel(fakeClient([{ type: "message", content: [{ text: "Take the bus." }] }]), q);
    expect(r.unconfirmed).toBe(true);
  });

  it("never looks up rights on the web", () => {
    expect(RIGHTS_TOPIC.test("compensación por retraso")).toBe(true);
    expect(RIGHTS_TOPIC.test("best poutine near the hotel")).toBe(false);
  });
});

describe("maps links", () => {
  it("opens directions from the shared location, or a place search, encoded", async () => {
    const { mapsLink } = await import("../src/guide.ts");
    expect(mapsLink({ destination: "La Capital Tacos, Montreal", origin: { lat: 45.5048, lon: -73.5772 }, mode: "walking", directions: true })).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=45.50480%2C-73.57720&destination=La%20Capital%20Tacos%2C%20Montreal&travelmode=walking",
    );
    expect(mapsLink({ destination: "YUL", directions: true })).toBe("https://www.google.com/maps/dir/?api=1&destination=YUL");
    expect(mapsLink({ destination: "Théâtre St-Denis", directions: false })).toBe("https://www.google.com/maps/search/?api=1&query=Th%C3%A9%C3%A2tre%20St-Denis");
  });
});

describe("WhatsApp formatting", () => {
  it("turns Markdown links and bold into what WhatsApp shows", async () => {
    const { forWhatsApp } = await import("../src/format.ts");
    expect(forWhatsApp("* **Escondite** - tacos\n[Cómo llegar](https://www.google.com/maps/dir/?api=1&destination=X)")).toBe(
      "* *Escondite* - tacos\nCómo llegar: https://www.google.com/maps/dir/?api=1&destination=X",
    );
    expect(forWhatsApp("## Para cenar\nok")).toBe("Para cenar\nok");
  });
});
