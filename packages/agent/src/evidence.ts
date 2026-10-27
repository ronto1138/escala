import { createHash } from "node:crypto";
import type { Lang } from "@escala/conversation";
import { outputText, type MetaClient } from "@escala/meta-client";
import { scrub } from "./agent.ts";

/**
 * Evidence photos: the state of a checked bag or a rental car, recorded when the traveler sends a photo. Muse Spark
 * says what the object is and describes visible damage; SAM 3.1 counts the marks it can segment. What is kept is the
 * description, the time the message arrived and a SHA-256 of the photo (to show later that it is the same photo);
 * the photo itself is not stored, so the traveler is asked to keep the original.
 */

export type EvidenceObject = "bag" | "car";

export interface EvidenceReading {
  object: EvidenceObject | "other";
  description: string;
  visibleDamage: string[];
  /** Only when compared with an earlier photo of the same object. */
  newDamage?: string[];
  /** Marks SAM 3.1 segmented, by concept ("scratch": 2). */
  marks: Record<string, number>;
  /** SAM 3.1 could not be reached; the marks were not counted this time. */
  marksUnavailable?: boolean;
  photoSha256: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["object", "description", "visible_damage", "new_damage"],
  properties: {
    object: { type: "string", enum: ["bag", "car", "other"], description: "bag = suitcase or checked bag; car = a vehicle" },
    description: { type: "string", description: "One sentence: color, type, material and distinguishing marks. Only what is visible." },
    visible_damage: { type: "array", items: { type: "string" }, description: "Each visible damage, short, with where it is" },
    new_damage: { type: "array", items: { type: "string" }, description: "Damage not present in the earlier description; empty if there is none or no earlier description" },
  },
} as const;

const LANG_NAME: Record<Lang, string> = { en: "English", es: "Spanish (Mexico)", fr: "French" };
const MARK_CONCEPTS = ["scratch", "dent"];

export async function readEvidence(
  client: MetaClient,
  imageDataUrl: string,
  lang: Lang,
  earlier: Partial<Record<EvidenceObject, { description: string; visibleDamage: string[] }>> = {},
): Promise<EvidenceReading> {
  const photoSha256 = createHash("sha256").update(imageDataUrl.slice(imageDataUrl.indexOf(",") + 1)).digest("hex");
  const r = await client.responses(
    {
      model: "muse-spark-1.3",
      reasoning: { effort: "low" },
      max_output_tokens: 2000,
      instructions:
        `Describe this photo as evidence of the condition of a checked bag or a rental car, in ${LANG_NAME[lang]}. ` +
        "Only what is visible; never guess hidden damage, value, brand or contents. Do not transcribe names, addresses, " +
        "phone numbers, plates or any personal data you see. No amounts of money, no legal advice. " +
        (Object.keys(earlier).length
          ? `Earlier photos of this trip: ${JSON.stringify(earlier)}. description and visible_damage must describe only THIS photo, from what you see in it; never copy the earlier text. Then compare with the earlier photo of the same object (bag with bag, car with car) and list in new_damage only damage you see now that is not in its list; a side that was not visible before is not new damage. If there is no earlier photo of this object, leave new_damage empty.`
          : "There is no earlier photo: leave new_damage empty."),
      input: [{ role: "user", content: [{ type: "input_image", image_url: imageDataUrl }] }],
      text: { format: { type: "json_schema", name: "evidence", schema: SCHEMA, strict: true } },
    },
    { caller: "evidence/describe" },
  );
  const j = JSON.parse(outputText(r));
  const reading: EvidenceReading = {
    object: j.object,
    description: scrub(String(j.description ?? "")).slice(0, 300),
    visibleDamage: (j.visible_damage ?? []).slice(0, 10).map((x: unknown) => scrub(String(x)).slice(0, 160)),
    marks: {},
    photoSha256,
    ...(j.object !== "other" && earlier[j.object as EvidenceObject]
      ? { newDamage: (j.new_damage ?? []).slice(0, 10).map((x: unknown) => scrub(String(x)).slice(0, 160)) }
      : {}),
  };
  if (reading.object === "other") return reading;
  // SAM 3.1 has no substitute: if it is down, the evidence is still recorded and answered, only without the count.
  for (const concept of MARK_CONCEPTS) {
    try {
      reading.marks[concept] = await countMarks(client, imageDataUrl, concept);
    } catch {
      reading.marks = {};
      reading.marksUnavailable = true;
      break;
    }
  }
  return reading;
}

/** How many instances of a concept SAM 3.1 segments in the image. */
async function countMarks(client: MetaClient, imageDataUrl: string, concept: string): Promise<number> {
  const r = await client.responses(
    { model: "sam-3.1", input: [{ role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageDataUrl }] }] },
    { caller: "evidence/sam", images: 1 },
  );
  return [...outputText(r).matchAll(/<\|box;[^|]*\|>/g)].length;
}

const OBJECT: Record<Lang, Record<EvidenceObject, string>> = {
  en: { bag: "your bag", car: "the car" },
  es: { bag: "tu maleta", car: "el auto" },
  fr: { bag: "votre bagage", car: "la voiture" },
};
const MARK: Record<Lang, Record<string, [string, string]>> = {
  en: { scratch: ["scratch mark", "scratch marks"], dent: ["dent", "dents"] },
  es: { scratch: ["rayón", "rayones"], dent: ["abolladura", "abolladuras"] },
  fr: { scratch: ["rayure", "rayures"], dent: ["bosse", "bosses"] },
};

/** The reply, written by code from the reading: no figures beyond the marks counted and the time of the photo. */
export function evidenceReply(r: EvidenceReading & { object: EvidenceObject }, lang: Lang, at: string, earlierAt?: string): string {
  const when = at.slice(0, 16).replace("T", " ") + " UTC";
  const what = OBJECT[lang][r.object];
  const marks = Object.entries(r.marks)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${MARK[lang][k]?.[n === 1 ? 0 : 1] ?? k}`)
    .join(", ");
  const damage = r.visibleDamage.length ? r.visibleDamage.join("; ") : { en: "none I can see", es: "ninguno que se vea", fr: "aucun visible" }[lang];
  const lines: Record<Lang, string[]> = {
    en: [
      `📸 Saved as evidence of how ${what} looked (${when}).`,
      `What I see: ${r.description}`,
      `Visible damage: ${damage}.${marks ? ` Marked by SAM: ${marks}.` : ""}`,
    ],
    es: [
      `📸 La guardé como evidencia de cómo estaba ${what} (${when}).`,
      `Lo que veo: ${r.description}`,
      `Daño visible: ${damage}.${marks ? ` Marcas que detectó SAM: ${marks}.` : ""}`,
    ],
    fr: [
      `📸 Je l'ai gardée comme preuve de l'état de ${what} (${when}).`,
      `Ce que je vois : ${r.description}`,
      `Dommages visibles : ${damage}.${marks ? ` Marques détectées par SAM : ${marks}.` : ""}`,
    ],
  };
  const out = lines[lang];
  if (r.newDamage && earlierAt) {
    const before = earlierAt.slice(0, 16).replace("T", " ") + " UTC";
    out.push(
      r.newDamage.length
        ? {
            en: `⚠️ Compared with your photo of ${before}, this is new: ${r.newDamage.join("; ")}. Report it at the airline or rental desk before you leave, and ask me what deadline applies.`,
            es: `⚠️ Comparada con tu foto de ${before}, esto es nuevo: ${r.newDamage.join("; ")}. Repórtalo en el mostrador de la aerolínea o de la arrendadora antes de irte, y pregúntame qué plazo te aplica.`,
            fr: `⚠️ Par rapport à votre photo de ${before}, ceci est nouveau : ${r.newDamage.join(" ; ")}. Signalez-le au comptoir de la compagnie ou du loueur avant de partir, et demandez-moi quel délai s'applique.`,
          }[lang]
        : { en: `Compared with your photo of ${before}, I see no new damage.`, es: `Comparada con tu foto de ${before}, no veo daño nuevo.`, fr: `Par rapport à votre photo de ${before}, je ne vois pas de nouveau dommage.` }[lang],
    );
  }
  out.push({ en: "Keep the original photo on your phone too: I keep the description, not the photo.", es: "Guarda también la foto original en tu teléfono: yo guardo la descripción, no la foto.", fr: "Gardez aussi la photo originale sur votre téléphone : je garde la description, pas la photo." }[lang]);
  return out.join("\n");
}
