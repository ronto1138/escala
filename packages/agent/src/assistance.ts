import { AIRPORTS, type Trip } from "./trip.ts";
import { EU_COUNTRIES } from "./documents.ts";

/**
 * Free help at airports for people who have trouble walking long distances, need a wheelchair or an escort through
 * security, immigration and connections: what each jurisdiction's own text says (read 2026-10-28), with its source.
 */
export interface AssistanceRule {
  id: string;
  /** ISO country, or "EU" for any EU member state's airports. */
  where: string;
  rule: string;
  howToAsk: string;
  covers: string;
  url: string;
  quote: string;
  checked_on: string;
  status: "VERIFICADO" | "NO_VERIFICADO";
}

export const ASSISTANCE: AssistanceRule[] = [
  {
    id: "us-382", where: "US",
    rule: "On flights that begin or end in the US (US or foreign airline), the airline must give free help from the terminal entrance to the gate, between gates to make a connection, and from the gate to the exit, with a wheelchair if needed.",
    howToAsk: "Ask the airline when booking or at check-in; it may not require advance notice for wheelchair or escort help. If staff refuse, ask for the Complaints Resolution Official (CRO), who can overrule them.",
    covers: "Passengers with a disability, which includes trouble walking long distances; the passenger says they need it. Age alone is not named.",
    url: "https://www.ecfr.gov/current/title-14/chapter-II/subchapter-D/part-382", quote: "in transportation between gates to make a connection to another flight", checked_on: "2026-10-28", status: "VERIFICADO",
  },
  {
    id: "eu-1107", where: "EU",
    rule: "At EU airports (departure, transit and arrival) the airport must give free assistance to people with reduced mobility, including because of age.",
    howToAsk: "Tell the airline, ticket seller or tour operator at least 48 hours before departure; without notice they must still make all reasonable efforts.",
    covers: "Anyone whose mobility is reduced, including due to age.",
    url: "https://europa.eu/youreurope/citizens/travel/transport-disability/reduced-mobility/index_en.htm", quote: "When you travel by plane, you have the right to assistance, free of charge.", checked_on: "2026-10-28", status: "VERIFICADO",
  },
  {
    id: "ie-dublin", where: "IE",
    rule: "At Dublin Airport the airport's assistance service helps through security all the way to boarding.",
    howToAsk: "Notify at least 48 hours ahead with the PRMAssist app or through the airline or travel agent; on the day, go to the Reduced Mobility Assistance desks on the departures floor of Terminal 1 or 2.",
    covers: "People with reduced mobility (EU rule).",
    url: "https://www.dublinairport.com/accessibility/requesting-assistance", quote: "notify us at least 48 hours ahead of your departure time", checked_on: "2026-10-28", status: "VERIFICADO",
  },
  {
    id: "ca-atpdr", where: "CA",
    rule: "Large airlines flying within, to or from Canada must, on request and free of charge, help through security, to the boarding area, through border clearance and with a transfer at the same terminal.",
    howToAsk: "Request it at least 48 hours before departure to guarantee it (with less notice they must make every reasonable effort); get written confirmation when booking.",
    covers: "Persons with disabilities who request it.",
    url: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2019-244/FullText.html", quote: "assisting the person in proceeding through border clearance", checked_on: "2026-10-28", status: "VERIFICADO",
  },
  {
    id: "mx-lac-33", where: "MX",
    rule: "Mexican law obliges airlines and airports to adopt the measures needed to attend people with disabilities and older adults, with no extra charges to board them.",
    howToAsk: "Ask the airline when booking or at check-in for a wheelchair or an escort.",
    covers: "People with disabilities and older adults (\"de edad avanzada\").",
    url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LAC.pdf", quote: "atender de manera adecuada a las personas con discapacidad, así como a las de edad avanzada", checked_on: "2026-10-28", status: "VERIFICADO",
  },
  {
    id: "mx-co-2013", where: "MX",
    rule: "A 2013 aviation circular says the support (wheelchairs included) is free, available on request, with escort to boarding through security and help on arrival with immigration, customs and connections.",
    howToAsk: "Ask the airline at the moment you need it.",
    covers: "Passengers with disabilities or reduced mobility, including due to age.",
    url: "https://dof.gob.mx/nota_detalle.php?codigo=5322735&fecha=20/11/2013", quote: "Acompañamiento a la zona de embarque, incluso a través de los controles de seguridad", checked_on: "2026-10-28", status: "NO_VERIFICADO",
  },
];

/** The rules for the airports of this trip: where it leaves, connects and arrives. */
export function assistanceFor(trip: Trip | undefined, rules: AssistanceRule[] = ASSISTANCE) {
  const countries = [...new Set((trip?.legs ?? []).flatMap((l) => [l.from, l.to]).map((c) => AIRPORTS[c]?.country).filter((c): c is string => Boolean(c)))];
  return countries.map((country) => ({
    country,
    rules: rules
      .filter((r) => r.where === country || (r.where === "EU" && EU_COUNTRIES.has(country)))
      .map(({ rule, howToAsk, covers, url, quote, checked_on, status }) => ({ rule, how_to_ask: howToAsk, covers, url, quote, checked_on, status })),
  }));
}
