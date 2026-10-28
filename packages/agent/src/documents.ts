import { AIRPORTS, type Trip } from "./trip.ts";
import { legInstant } from "./whereabouts.ts";

/**
 * Entry and transit documents by passport and country. Every rule carries the official page it comes from, the words
 * that support it and the day it was read; Escala never states a requirement that is not here. A pair that is not
 * covered is said to be not covered, with the country's official page.
 */
export interface DocRule {
  id: string;
  /** Passport countries (ISO 3166-1 alpha-2, space-separated); "EU" any EU passport, "NON_EU" any other, "*" any. */
  passport: string;
  /** Countries where it applies (ISO 3166-1 alpha-2, space-separated). */
  country: string;
  /** "exit": leaving the country where the trip starts. */
  role: "entry" | "transit" | "both" | "exit";
  requirement: string;
  conditions?: string;
  url: string;
  quote: string;
  checked_on: string;
  status: "VERIFICADO" | "NO_VERIFICADO";
  /** Announced but not in force yet: from this date. */
  in_force_from?: string;
}

export const DOC_RULES: DocRule[] = [
  // United States
  { id: "us-vwp", passport: "FR ES GB", country: "US", role: "both", requirement: "No visa needed: an approved ESTA (Visa Waiver Program) before flying, also just to connect; stays up to 90 days; an e-Passport is required. ESTA can be requested any time before travel.", conditions: "UK: British citizens with unrestricted right of abode.", url: "https://www.dhs.gov/visa-waiver-program", quote: "You must have an e-Passport to use the VWP", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "us-visa", passport: "MX AR BR CO", country: "US", role: "both", requirement: "A US visitor visa (B-1/B-2) is required to fly into the US, and also just to connect there: the country is not in the Visa Waiver Program.", conditions: "Mexican citizens: the Border Crossing Card is itself a B-1/B-2 visa; the waiver without a visa applies only at land ports or by ferry, not by air.", url: "https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-212/section-212.1", quote: "Form DSP-150, B-1/B-2 Visa and Border Crossing Card", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "us-ca", passport: "CA", country: "US", role: "both", requirement: "No visa: a Canadian passport (or a NEXUS card at kiosks) by air, also just to transit.", conditions: "Stays over 30 days must be registered with the US government.", url: "https://travel.gc.ca/destinations/united-states", quote: "travelling by air to or even just transiting through the United States", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "us-no-airside-transit", passport: "*", country: "US", role: "transit", requirement: "There is no airside transit in the US: at the first US airport you go through immigration and customs, and you need whatever you would need to enter (visa or ESTA). Transit Without Visa is suspended.", url: "https://www.dhs.gov/travel-overseas", quote: "CBP processing that must be completed at your first port of entry", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "us-bag-recheck", passport: "*", country: "US", role: "transit", requirement: "Checked bags are normally collected and checked in again after US customs at the connection; CBP only skips that on its remote baggage screening pilot routes.", url: "https://www.cbp.gov/newsroom/national-media-release", quote: "without the need to re-check their bags", checked_on: "2026-10-28", status: "NO_VERIFICADO" },
  { id: "us-6059b", passport: "*", country: "US", role: "both", requirement: "On arrival, the CBP customs declaration (Form 6059B), one per family; it asks for your US street address (hotel name or destination). The I-94 is no longer on paper: CBP records it electronically. Mobile Passport Control replaces the paper declaration only for US citizens, permanent residents, Canadian visitors and returning ESTA travelers, up to 4 hours before landing.", conditions: "Only connecting: CBP tells ESTA applicants to write 'In Transit' and the final destination as their US address; for the customs form we found no official instruction.", url: "https://www.cbp.gov/travel/clearing-cbp/traveler-entry-form", quote: "You must complete the CBP Declaration Form 6059B.", checked_on: "2026-10-28", status: "VERIFICADO" },
  // Canada
  { id: "ca-eta", passport: "FR ES GB EU", country: "CA", role: "both", requirement: "An eTA (CA$7, valid up to 5 years or until the passport expires) to fly into Canada or connect at a Canadian airport.", conditions: "Romania: only e-passport holders.", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html", quote: "an eTA and a valid passport to board your flight to Canada", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "ca-us", passport: "US", country: "CA", role: "both", requirement: "No visa and no eTA; a passport is recommended.", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/transit.html", quote: "US citizens and lawful permanent residents of the U.S. can transit through Canada without a visa", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "ca-eta-conditional", passport: "MX AR BR", country: "CA", role: "both", requirement: "By air, an eTA only if you held a Canadian visitor visa in the past 10 years or hold a valid US non-immigrant visa when you apply; otherwise a Canadian visitor visa (CA$100 plus CA$85 for biometrics). Connecting at a Canadian airport counts too.", conditions: "A previous eTA is not the same as a previous Canadian visa. Temporary stay, normally up to 6 months.", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility/eta-x.html", quote: "Having held an eTA in the past 10 years is not the same as having held a Canadian visitor visa", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "ca-co", passport: "CO", country: "CA", role: "both", requirement: "A Canadian visitor visa to enter by any means; a transit visa to connect if the transit is 48 hours or less.", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/transit.html", quote: "You need a transit visa if you're from a visa-required country", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "ca-advance-declaration", passport: "*", country: "CA", role: "entry", requirement: "Optional: the customs and immigration declaration can be made in advance in ArriveCAN (Advance Declaration) up to 72 hours before the flight, and confirmed at a kiosk on arrival (Montréal-Trudeau has kiosks).", url: "https://www.canada.ca/en/border-services-agency/services/arrivecan.html", quote: "You can make your customs and immigration declaration using Advance Declaration", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "ca-transit-no-inspection", passport: "*", country: "CA", role: "transit", requirement: "Since June 2026, travelers connecting from one international flight to another at Vancouver, Toronto Pearson T1 or Montréal-Trudeau no longer meet a border officer or use a kiosk.", url: "https://www.canada.ca/en/border-services-agency/news/2026/06/the-cbsa-is-making-it-quicker-and-easier-for-international-travellers-to-catch-connecting-flights-at-canadian-airports.html", quote: "no longer need to physically meet with a border services officer or check in via a kiosk", checked_on: "2026-10-28", status: "VERIFICADO" },
  // Mexico
  { id: "mx-fem", passport: "MX", country: "MX", role: "exit", requirement: "Leaving Mexico by air, Mexicans fill the Formato Estadístico para Mexicanos (FEM): online at https://www.inm.gob.mx/fem/ (with Llave MX it comes pre-filled) or on paper while both exist. It asks the airline, flight number, ID document type and number, final destination country and reason for travel; download the receipt and show it before boarding.", conditions: "The INM notice does not say whether it is mandatory.", url: "https://www.gob.mx/atdt/comunicacion/inm-y-atdt-digitalizan-formato-de-migracion-para-personas-mexicanas-que-viajan-al-extranjero", quote: "descargar el comprobante digital para presentarlo antes de abordar su vuelo", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "mx-ca", passport: "CA", country: "MX", role: "entry", requirement: "No tourist visa for stays up to 180 days (the officer sets the days); passport valid for the whole stay; digital immigration form (FMMd) on arrival by air.", url: "https://travel.gc.ca/destinations/mexico", quote: "Tourist visa: not required for stays of up to 180 days", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "mx-gb", passport: "GB", country: "MX", role: "entry", requirement: "No visa as a tourist; passport valid for the stay; the entry stamp sets the days.", url: "https://www.gov.uk/foreign-travel-advice/mexico/entry-requirements", quote: "If you're visiting Mexico as a tourist, you do not need a visa", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "mx-fr", passport: "FR", country: "MX", role: "entry", requirement: "No short-stay visa, up to 180 days; keep the entry stamp, e-gate ticket or digital FMM.", url: "https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/mexique/", quote: "ne sont pas soumis à l'obligation de visa de court séjour", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "mx-es", passport: "ES", country: "MX", role: "entry", requirement: "No visa for tourism; 1 to 180 days set at entry; passport valid for the whole stay. Be ready to show the purpose of the trip.", conditions: "Spanish-Mexican dual nationals enter and leave Mexico with the Mexican passport.", url: "https://www.exteriores.gob.es/es/ServiciosAlCiudadano/Paginas/Detalle-recomendaciones-de-viaje.aspx?trc=mexico", quote: "No se requiere visado para entrar en México siempre y cuando el objeto del viaje sea", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "mx-br", passport: "BR", country: "MX", role: "both", requirement: "A Mexican visa: an electronic visa for arrivals by air under 180 days, one per entry, including a connection to a third country.", url: "https://visaelectronica.sre.gob.mx", quote: "Brazilian nationals transiting to a third country must have a valid electronic visa for each entry into Mexico", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "mx-fmmd", passport: "*", country: "MX", role: "entry", requirement: "The digital immigration form (FMMd) for arrivals by air is downloaded once, after entering, from the INM site; it is not needed before the flight.", url: "https://www.gob.mx/inm/articulos/forma-migratoria-multiple-digital-fmmd", quote: "podrá descargar su FMMd después de su ingreso al país", checked_on: "2026-10-28", status: "VERIFICADO" },
  // Spain and the Schengen area
  { id: "es-mx", passport: "MX", country: "ES", role: "entry", requirement: "No Schengen visa for a short stay.", url: "https://www.exteriores.gob.es/Consulados/mexico/es/ServiciosConsulares/Paginas/Consular/TasasVisados.aspx", quote: "no aplicable consecuentemente a ciudadanos mexicanos", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "es-us", passport: "US", country: "ES", role: "entry", requirement: "No visa, up to 90 days in any 180; passport valid at least 3 months after leaving the Schengen area and issued within the last 10 years.", url: "https://www.exteriores.gob.es/Consulados/washington/en/ServiciosConsulares/Paginas/Consular/Condiciones-de-entrada-en-Espana.aspx", quote: "valid until at least three months after the planned date of departure from the Schengen territory", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "es-gb", passport: "GB", country: "ES", role: "entry", requirement: "No visa, up to 90 days in any 180.", url: "https://www.gov.uk/foreign-travel-advice/spain/entry-requirements", quote: "up to 90 days in any 180-day period", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "es-co", passport: "CO", country: "ES", role: "entry", requirement: "No visa, up to 90 days in any 180; passport valid 3 months after leaving.", url: "https://www.exteriores.gob.es/Consulados/bogota/es/ServiciosConsulares/Paginas/Consular/Visados.aspx", quote: "no necesitan visado para entrar y permanecer en España", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "es-ar", passport: "AR", country: "ES", role: "entry", requirement: "No visa for stays under 90 days, unless the trip is for temporary work.", url: "https://www.exteriores.gob.es/Consulados/buenosaires/es/ServiciosConsulares/Paginas/index.aspx", quote: "los argentinos no necesitan en general visado", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "schengen-ees", passport: "NON_EU", country: "ES FR", role: "entry", requirement: "At the first entry, the Entry/Exit System (EES) records fingerprints and a photo at the border; fully operational since April 10, 2026.", url: "https://home-affairs.ec.europa.eu/policies/schengen/smart-borders_en", quote: "became fully operational on 10 April 2026", checked_on: "2026-10-28", status: "VERIFICADO" },
  { id: "schengen-etias", passport: "NON_EU", country: "ES FR", role: "entry", requirement: "ETIAS, the future travel authorization, is not in operation yet and takes no applications; the EU plans it for the last quarter of 2026, date to be announced.", url: "https://home-affairs.ec.europa.eu/policies/schengen/smart-borders_en", quote: "currently not in operation and no applications for travel authorisations are collected at this point", checked_on: "2026-10-28", status: "VERIFICADO" },
];

const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

/** Where each country publishes its entry rules, for pairs the table does not cover. */
export const OFFICIAL_PAGES: Record<string, string> = {
  US: "https://travel.state.gov/content/travel/en/us-visas.html",
  CA: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html",
  MX: "https://www.gob.mx/inm",
  ES: "https://www.exteriores.gob.es/es/ServiciosAlCiudadano/Paginas/Recomendaciones-de-viaje.aspx",
  FR: "https://france-visas.gouv.fr",
};

/** A trip crosses borders when any flight lands in a country other than where the trip starts. */
export function tripCountries(trip: Trip | undefined): { start: string | null; touched: Array<{ country: string; role: "entry" | "transit" | "exit"; airport: string }> } {
  const legs = trip?.legs ?? [];
  const country = (iata: string) => AIRPORTS[iata]?.country ?? null;
  const start = legs[0] ? country(legs[0].from) : null;
  const touched: Array<{ country: string; role: "entry" | "transit" | "exit"; airport: string }> = [];
  legs.forEach((l, i) => {
    const c = country(l.to);
    if (!c || c === start) return;
    const next = legs[i + 1];
    // A connection: the next flight leaves from the same airport within a day of landing.
    const landed = legInstant(l.date, l.arr_local, l.to);
    const leaves = next ? legInstant(next.date, next.dep_local, next.from) : NaN;
    const transit = Boolean(next && next.from === l.to && Number.isFinite(landed) && leaves - landed >= 0 && leaves - landed < 24 * 3600_000 && country(next.to) !== c);
    if (!touched.some((t) => t.country === c && t.role === (transit ? "transit" : "entry"))) touched.push({ country: c, role: transit ? "transit" : "entry", airport: l.to });
  });
  // Leaving the country where the trip starts has its own forms (Mexico's FEM for Mexicans).
  if (start && touched.length) touched.unshift({ country: start, role: "exit", airport: legs[0]!.from });
  return { start, touched };
}

export function crossesBorder(trip: Trip | undefined): boolean {
  return tripCountries(trip).touched.some((t) => t.role !== "exit");
}

/** What the table says for this passport in each country the trip touches. */
export function documentsFor(passport: string, trip: Trip | undefined, rules: DocRule[] = DOC_RULES) {
  const pp = passport.toUpperCase();
  return tripCountries(trip).touched.map(({ country, role, airport }) => {
    const own = country === pp;
    const holds = (r: DocRule) =>
      r.passport.split(" ").some((x) => x === pp || x === "*" || (x === "EU" && EU.has(pp)) || (x === "NON_EU" && !EU.has(pp)));
    // In their own country only what their country asks on the way out applies (the FEM); entry rules are for foreigners.
    const found = rules.filter((r) => r.country.split(" ").includes(country) && holds(r) && (r.role === role || (r.role === "both" && role !== "exit")) && (!own || r.role === "exit"));
    // A rule for everyone (the US has no airside transit) does not mean this passport is covered.
    const specific = own || found.some((r) => !/^(\*|NON_EU)$/.test(r.passport));
    return {
      country,
      role,
      airport,
      own_country: own,
      covered: specific,
      rules: found.map(({ requirement, conditions, url, quote, checked_on, status, in_force_from }) => ({ requirement, conditions, url, quote, checked_on, status, in_force_from })),
      official_page: specific ? undefined : OFFICIAL_PAGES[country],
    };
  });
}

/** The passport written down by set_passport, as kept in memory ("passport: MX"). */
export function passportFromStatement(statement: string): string | null {
  return statement.match(/passport:\s*([A-Z]{2})\b/)?.[1] ?? null;
}
