import { cityName, type Leg, type Trip } from "./trip.ts";

type Lang = "en" | "es" | "fr";

export const BAG_PROBLEMS = ["bag_delayed", "bag_lost", "bag_damaged"] as const;
export type BagProblem = (typeof BAG_PROBLEMS)[number];

/** A rule that applies to this bag, as the rights engine found it. */
export interface ClaimRule {
  id: string;
  instrument: string;
  article: string;
  source: string;
  deadlines?: Record<string, number>;
}

export interface ClaimInput {
  trip: Trip;
  leg: Leg;
  problem: BagProblem;
  rules: ClaimRule[];
  /** The airline's file number for the bag report (PIR), as the traveler gave it. */
  reportRef?: string | undefined;
  /** When the airline handed the bag over (YYYY-MM-DD): starts the delayed or damaged deadline. */
  deliveredOn?: string | undefined;
  /** What they spent because of it, in their own words and amounts. */
  expenses: Array<{ what: string; amount: number; currency: string }>;
  /** What Escala kept as evidence: the photo descriptions and the tag, with when they were taken. */
  evidence: Array<{ what: "bag" | "bag_tag"; at: string; tagNumber?: string | undefined }>;
  lang: Lang;
  /** Time zone where the evidence photos were taken (the trip's first airport), for their time stamps. */
  tz?: string | undefined;
  /** Today (YYYY-MM-DD), to tell a deadline that already passed. */
  today?: string | undefined;
}

export interface Claim {
  letter: string;
  /** The last day to send it, and the rule that sets it. Null until the date that starts it is known. */
  deadline: { date: string; days: number; rule: string; passed: boolean } | null;
  /** What the letter still leaves as a blank for the traveler to fill in. */
  missing: Array<"booking_ref" | "report_ref" | "delivered_on" | "receipts">;
}

/** Which deadline in each rule counts, by problem. */
const DEADLINE_KEY: Record<BagProblem, string[]> = {
  bag_damaged: ["damaged_bag_protest_days", "damaged_claim_days", "claim_to_airline_days"],
  bag_delayed: ["delayed_bag_protest_days", "delayed_claim_days", "claim_to_airline_days"],
  // Mexico counts a lost bag from the day it should have arrived.
  bag_lost: ["claim_to_airline_days"],
};

const date = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat({ en: "en-US", es: "es-MX", fr: "fr-CA" }[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const pretty = (ident: string) => ident.replace(/^([A-Z0-9]{2})(\d+)$/, "$1 $2");
const money = (amount: number, currency: string, lang: Lang) => `${currency.toUpperCase()} ${amount.toLocaleString({ en: "en-US", es: "es-MX", fr: "fr-CA" }[lang], { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

const T = {
  en: {
    subject: (f: string, d: string, r: string) => `Subject: Baggage claim, flight ${f}, ${d}, ${r}`,
    to: "To the airline's baggage claims department:",
    what: { bag_delayed: "did not arrive with me", bag_lost: "has not been delivered and I consider it lost", bag_damaged: "was handed to me damaged" },
    intro: (w: string, f: string, d: string, r: string) => `I am writing to file a written claim for my checked bag, which ${w} on flight ${f} on ${d}, ${r}.`,
    booking: (b: string) => `Booking reference: ${b}.`,
    bookingBlank: "[booking reference]",
    tag: (t: string) => `Bag tag: ${t}.`,
    report: (r: string) => `Baggage report (file number): ${r}.`,
    reportBlank: "Baggage report (file number): [the number on the report the airline gave you].",
    delivered: (d: string) => `The bag was delivered to me on ${d}.`,
    under: "Under the rules that apply to this trip:",
    request: "I request:",
    expenses: "reimbursement of these expenses, which I incurred because of it (receipts attached):",
    damage: "payment of the cost of repairing the bag or, if it cannot be repaired, of replacing it (estimate or receipts attached);",
    lostValue: "payment of the value of the bag and its contents (list and receipts attached);",
    fee: "refund of the fee I paid for this bag;",
    evidence: "Evidence:",
    photoBefore: (d: string) => `photo of the bag taken before check-in, ${d};`,
    photoTag: (d: string) => `photo of the bag tag, ${d};`,
    within: (n: number, rule: string) => `I am sending this claim within the ${n} days set by ${rule}.`,
    close: "Please confirm that you received this claim and reply in writing.",
    sign: "[Your full name] · [Phone or email]",
  },
  es: {
    subject: (f: string, d: string, r: string) => `Asunto: Reclamación de equipaje, vuelo ${f}, ${d}, ${r}`,
    to: "Al departamento de reclamaciones de equipaje de la aerolínea:",
    what: { bag_delayed: "no llegó conmigo", bag_lost: "no me ha sido entregada y la considero perdida", bag_damaged: "me fue entregada dañada" },
    intro: (w: string, f: string, d: string, r: string) => `Presento por escrito mi reclamación por mi maleta documentada, que ${w} en el vuelo ${f} del ${d}, ${r}.`,
    booking: (b: string) => `Clave de reservación: ${b}.`,
    bookingBlank: "[clave de reservación]",
    tag: (t: string) => `Etiqueta de la maleta: ${t}.`,
    report: (r: string) => `Reporte de equipaje (número de expediente): ${r}.`,
    reportBlank: "Reporte de equipaje (número de expediente): [el número del reporte que te dio la aerolínea].",
    delivered: (d: string) => `La maleta me fue entregada el ${d}.`,
    under: "Conforme a las reglas que aplican a este viaje:",
    request: "Solicito:",
    expenses: "el reembolso de estos gastos, que hice por esta causa (anexo los comprobantes):",
    damage: "el pago de la reparación de la maleta o, si no tiene reparación, de su reposición (anexo presupuesto o comprobantes);",
    lostValue: "el pago del valor de la maleta y su contenido (anexo la lista y los comprobantes);",
    fee: "el reembolso del cargo que pagué por esta maleta;",
    evidence: "Evidencia:",
    photoBefore: (d: string) => `foto de la maleta tomada antes de documentarla, ${d};`,
    photoTag: (d: string) => `foto de la etiqueta de la maleta, ${d};`,
    within: (n: number, rule: string) => `Envío esta reclamación dentro de los ${n} días que fija ${rule}.`,
    close: "Les pido confirmar que recibieron esta reclamación y responderme por escrito.",
    sign: "[Tu nombre completo] · [Teléfono o correo]",
  },
  fr: {
    subject: (f: string, d: string, r: string) => `Objet : Réclamation bagage, vol ${f}, ${d}, ${r}`,
    to: "Au service des réclamations bagages de la compagnie :",
    what: { bag_delayed: "n'est pas arrivé avec moi", bag_lost: "ne m'a pas été livré et que je considère comme perdu", bag_damaged: "m'a été remis endommagé" },
    intro: (w: string, f: string, d: string, r: string) => `Je dépose par écrit une réclamation pour mon bagage enregistré, qui ${w} sur le vol ${f} du ${d}, ${r}.`,
    booking: (b: string) => `Référence de réservation : ${b}.`,
    bookingBlank: "[référence de réservation]",
    tag: (t: string) => `Étiquette du bagage : ${t}.`,
    report: (r: string) => `Déclaration de bagage (numéro de dossier) : ${r}.`,
    reportBlank: "Déclaration de bagage (numéro de dossier) : [le numéro de la déclaration remise par la compagnie].",
    delivered: (d: string) => `Le bagage m'a été remis le ${d}.`,
    under: "En vertu des règles qui s'appliquent à ce voyage :",
    request: "Je demande :",
    expenses: "le remboursement de ces dépenses, engagées pour cette raison (reçus joints) :",
    damage: "le paiement de la réparation du bagage ou, s'il n'est pas réparable, de son remplacement (devis ou reçus joints) ;",
    lostValue: "le paiement de la valeur du bagage et de son contenu (liste et reçus joints) ;",
    fee: "le remboursement des frais payés pour ce bagage ;",
    evidence: "Preuves :",
    photoBefore: (d: string) => `photo du bagage prise avant l'enregistrement, ${d} ;`,
    photoTag: (d: string) => `photo de l'étiquette du bagage, ${d} ;`,
    within: (n: number, rule: string) => `J'envoie cette réclamation dans les ${n} jours prévus par ${rule}.`,
    close: "Merci de confirmer la réception de cette réclamation et de me répondre par écrit.",
    sign: "[Votre nom complet] · [Téléphone ou courriel]",
  },
} as const;

/** Where to complain if the airline does not answer: next steps, not grounds to ask the airline for something. */
export const ESCALATION = new Set(["mx-profeco", "us-dot-complaint"]);

/** Rules whose text gives back the bag fee. */
const FEE_RULES = new Set(["us-260-bag-fee", "ca-appr-23-baggage"]);
/** Rules that make the airline pay for the damage (expenses, repair, value), up to a limit. */
const LIABILITY_RULES = new Set(["mc-baggage", "ca-appr-23-baggage", "us-254-baggage", "mx-lac-62-baggage"]);
/** Currencies an expense may be written in. */
const CURRENCIES = new Set(["USD", "CAD", "MXN", "EUR", "GBP", "CHF", "JPY", "AUD", "BRL", "COP", "ARS", "CLP", "PEN"]);

/**
 * The written claim for a bag, built only from the trip, the rules that apply, what the traveler said and what Escala
 * kept as evidence. Nothing is invented: a fact that is missing is left as a bracketed blank and reported in `missing`.
 */
export function draftClaim(c: ClaimInput): Claim {
  const t = T[c.lang];
  const lang = c.lang;
  const flight = pretty(c.leg.flight);
  const day = date(c.leg.date, lang);
  const route = `${cityName(c.leg.from, lang)} (${c.leg.from}) → ${cityName(c.leg.to, lang)} (${c.leg.to})`;
  // Everything that comes from the traveler or a model goes in as one short line, without links or markup.
  const flat = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/[*_`#<>|]/g, "").replace(/\s+/g, " ").trim();
  // A file number or a bag tag is a code, not a sentence: letters and digits, with at least a few digits.
  const code = (v: string | undefined, digits: number) => {
    const x = v?.replace(/[\s-]+/g, "").toUpperCase();
    return x && /^[A-Z0-9]{4,20}$/.test(x) && (x.match(/\d/g)?.length ?? 0) >= digits ? x : undefined;
  };
  const reportRef = code(c.reportRef, 3);
  // A delivery in the future is a mistake, not a date to count from.
  const deliveredOn = c.deliveredOn && /^\d{4}-\d{2}-\d{2}$/.test(c.deliveredOn) && !(c.today && c.deliveredOn > c.today) ? c.deliveredOn : undefined;
  const tagRaw = c.evidence.find((e) => e.tagNumber)?.tagNumber;
  const tag = code(tagRaw, 4);
  const missing: Claim["missing"] = [];

  const lines: string[] = [t.subject(flight, day, route), "", t.to, "", t.intro(t.what[c.problem], flight, day, route)];
  // The booking code is never kept (privacy.ts): the traveler writes it in.
  const ids = [t.booking(t.bookingBlank), tag ? t.tag(tag) : "", reportRef ? t.report(reportRef) : t.reportBlank].filter(Boolean);
  missing.push("booking_ref");
  if (!reportRef) missing.push("report_ref");
  lines.push(ids.join(" "));
  if (c.problem !== "bag_lost") {
    if (deliveredOn) lines.push(t.delivered(date(deliveredOn, lang)));
    else if (c.problem === "bag_damaged") missing.push("delivered_on");
  }

  // The rule and article are what a claims desk checks; the links go to the traveler in the chat, not in the letter.
  lines.push("", t.under, ...c.rules.map((r) => `• ${r.instrument}, art. ${r.article}`));

  const asks: string[] = [];
  const liable = c.rules.some((r) => LIABILITY_RULES.has(r.id));
  const expenses = liable ? c.expenses.filter((e) => Number.isFinite(e.amount) && e.amount > 0 && e.amount < 100_000 && CURRENCIES.has(e.currency) && flat(e.what)).slice(0, 12) : [];
  if (expenses.length) asks.push(`${t.expenses}\n${expenses.map((e) => `   – ${flat(e.what).slice(0, 80)}: ${money(e.amount, e.currency, lang)}`).join("\n")}`);
  else if (c.problem === "bag_delayed" && liable) missing.push("receipts");
  if (c.problem === "bag_damaged" && liable) asks.push(t.damage);
  if (c.problem === "bag_lost" && liable) asks.push(t.lostValue);
  if (c.rules.some((r) => FEE_RULES.has(r.id))) asks.push(t.fee);
  if (asks.length) lines.push("", t.request, ...asks.map((a) => `• ${a}`));

  const photos = [
    ...c.evidence.filter((e) => e.what === "bag").slice(0, 1).map((e) => t.photoBefore(stamp(e.at, lang, c.tz))),
    ...c.evidence.filter((e) => e.what === "bag_tag").slice(0, 1).map((e) => t.photoTag(stamp(e.at, lang, c.tz))),
  ];
  if (photos.length) lines.push("", t.evidence, ...photos.map((p) => `• ${p}`));

  // The shortest deadline among the rules that apply, counted from the day the bag was handed over.
  const keys = DEADLINE_KEY[c.problem];
  const options = c.rules.flatMap((r) => keys.filter((k) => r.deadlines?.[k]).map((k) => ({ days: r.deadlines![k]!, rule: `${r.instrument}, art. ${r.article}` })));
  const shortest = options.sort((a, b) => a.days - b.days)[0];
  // A lost bag counts from the day it should have arrived: the flight's arrival day, the next one for an overnight flight.
  const hhmm = (t: string) => /^\d{2}:\d{2}$/.test(t);
  const arrives = hhmm(c.leg.arr_local) && hhmm(c.leg.dep_local) && c.leg.arr_local < c.leg.dep_local ? new Date(Date.parse(`${c.leg.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : c.leg.date;
  const startsOn = c.problem === "bag_lost" ? arrives : deliveredOn;
  const due = shortest && startsOn ? new Date(Date.parse(`${startsOn}T12:00:00Z`) + shortest.days * 86_400_000).toISOString().slice(0, 10) : null;
  const deadline = shortest && due ? { date: due, days: shortest.days, rule: shortest.rule, passed: Boolean(c.today && c.today > due) } : null;
  // "Within the N days" only when the day that starts them is known and they have not run out.
  if (deadline && !deadline.passed) lines.push("", t.within(deadline.days, deadline.rule));
  lines.push("", t.close, "", t.sign);
  return { letter: lines.join("\n"), deadline, missing };
}

function stamp(at: string, lang: Lang, tz = "UTC"): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat({ en: "en-US", es: "es-MX", fr: "fr-CA" }[lang], { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(d);
}
