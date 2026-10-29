import type { ListSection } from "@escala/channel";

export type Lang = "en" | "es" | "fr";
export const LANGS: Lang[] = ["en", "es", "fr"];

/** Words that open the main menu from anywhere, in any of the three languages. */
export const MENU_WORDS = ["menu", "menú", "aide", "help", "ayuda"];
export const PRIVACY_WORDS = ["privacy", "privacidad", "confidentialité", "confidentialite"];
export const STOP_WORDS = ["stop", "alto", "baja", "arrêt", "arret", "unsubscribe"];
/**
 * Whole-message answers that need no model when they fit the pending question (decision D42, measured on 50 cases:
 * same accuracy as the model alone, 30 % fewer model calls). Only the entire message counts: "sí pero el segundo es
 * el ZZ568" is not a "sí" and goes to the model.
 */
export const EXACT_YES = ["sí", "si", "ok", "okay", "va", "perfecto", "correcto", "exacto", "así es", "claro", "yes", "yep", "yeah", "sure", "correct", "oui", "d'accord", "parfait", "c'est bon", "👍"];
export const EXACT_NO = ["no", "nope", "non", "nop"];

export const DELETE_WORDS = ["delete", "borrar", "bórralo", "borra todo", "effacer", "efface", "supprimer"];
/** Erase everything even inside a longer sentence. A lone delete word inside a sentence ("delete the note about my
 * bag") is a request about one thing and goes to the agent, which forgets just that. */
export const DELETE_ALL_PHRASES = [
  "delete everything", "delete all", "delete my data", "erase everything", "erase all",
  "borra todo", "bórralo todo", "borra mis datos", "borrar todo", "borrar mis datos",
  "efface tout", "effacez tout", "supprime tout", "supprimez tout", "supprimer mes données", "effacer mes données",
];

/** First-message language guess. The person can always switch; this only picks the greeting. */
const EN_WORDS = ["hi", "hello", "the", "my", "flight", "what", "is", "are", "i", "i'm", "you", "and", "thanks", "yes", "can", "do", "how", "of", "with", "will", "late"];
const ES_WORDS = ["hola", "mi", "vuelo", "qué", "gracias", "viaje", "está", "sí", "el", "la", "los", "las", "por", "para", "que", "es", "y", "tengo", "puedes"];
const FR_WORDS = ["bonjour", "mon", "vol", "merci", "est-ce", "voyage", "je", "à", "oui", "le", "les", "c'est", "vous", "pour", "et", "est", "j'ai", "pouvez-vous"];

/** Words as typed, plus the same word without stretched letters ("holaa", "graciasss") when the typed one is unknown. */
function tokensOf(lower: string): Set<string> {
  const known = new Set([...EN_WORDS, ...ES_WORDS, ...FR_WORDS]);
  const out = new Set<string>();
  for (const t of lower.split(/[^\p{L}'-]+/u).filter(Boolean)) {
    out.add(t);
    const short = t.replace(/(\p{L})\1+/gu, "$1");
    if (!known.has(t) && known.has(short)) out.add(short);
  }
  return out;
}

/** The language a message points to, or null when nothing in it belongs to one language ("ok", "👍", a name). */
export function detectLangOrNull(text: string): Lang | null {
  const lower = text.toLowerCase();
  const tokens = tokensOf(lower);
  const score = (words: string[], chars: string[]) =>
    words.reduce((n, w) => n + (tokens.has(w) ? 1 : 0), 0) + chars.reduce((n, c) => n + (lower.includes(c) ? 1 : 0), 0);
  // Only words that belong to one language; "me", "a", "no" and the like are shared and decide nothing.
  const en = score(EN_WORDS, []);
  const es = score(ES_WORDS, ["¿", "ñ"]);
  const fr = score(FR_WORDS, ["ç"]);
  if (es > fr && es > en) return "es";
  if (fr > es && fr > en) return "fr";
  if (en > 0 && en >= es && en >= fr) return "en";
  return null;
}

export function detectLang(text: string): Lang {
  return detectLangOrNull(text) ?? "en";
}

/**
 * The language of a message only when it is clear (at least three of its words, two more than any other language):
 * enough to follow someone who switches language, never on a short "yes" or "ok".
 */
export function clearLang(text: string): Lang | null {
  const lower = text.toLowerCase();
  const tokens = new Set(lower.split(/[^\p{L}'-]+/u).filter(Boolean));
  const score = (words: string[], chars: string[]) =>
    words.reduce((n, w) => n + (tokens.has(w) ? 1 : 0), 0) + chars.reduce((n, c) => n + (lower.includes(c) ? 1 : 0), 0);
  const all: Record<Lang, number> = {
    en: score([...EN_WORDS, "we", "our", "about", "there", "going", "it", "to", "tell", "that", "this", "out", "still", "where", "when", "quick", "question", "bag", "please"], []),
    es: score([...ES_WORDS, "ya", "dónde", "cómo", "nos", "estoy", "salió", "hago", "hoy", "tus", "dime", "cuéntame", "quiero", "cuánto", "cuándo", "maleta", "aeropuerto", "olvida", "mis", "del"], ["¿", "ñ"]),
    fr: score([...FR_WORDS, "ce", "qu'est-ce", "nous", "mes", "du", "avec", "retour", "toujours", "où", "quand", "bagage", "aéroport", "dites", "s'il"], ["ç"]),
  };
  const ranked = (Object.entries(all) as Array<[Lang, number]>).sort((a, b) => b[1] - a[1]);
  return ranked[0]![1] >= 3 && ranked[0]![1] - ranked[1]![1] >= 2 ? ranked[0]![0] : null;
}

type Texts = {
  /** First contact ever: who Escala is, that it is an AI, and the privacy essentials, short and warm. */
  hello: string;
  /** Someone Escala already knows. */
  welcomeBack: string;
  /** Asked once, in words; answered in words. */
  shareQuestion: string;
  sharedTrip: string;
  sharedProfile: string;
  askItinerary: string;
  itinerarySummary: (lines: string[]) => string;
  confirmed: string;
  passportQuestion: string;
  /** Button under the itinerary request: a demo trip whose simulated flights play out in minutes. Max 20 characters. */
  demoButton: string;
  /** After confirming a trip whose flights Escala cannot follow (flight data is simulated during the test). */
  notWatching: string;
  fixPrompt: string;
  notReadable: string;
  /** What Escala understood from a voice note, so a misheard word can be corrected at once. */
  heard: (text: string) => string;
  /** A voice note of someone else speaking to the traveler, in another language. */
  heardOther: (text: string) => string;
  notHeard: string;
  /** Full privacy note, only when asked. */
  privacy: string;
  menuText: string;
  menuButton: string;
  menuSections: ListSection[];
  notYet: string;
  stopped: string;
  /** Words that mean yes / no / remember me / just this trip, for answers given in words. */
  words: { yes: string[]; no: string[]; remember: string[]; tripOnly: string[] };
};

export const T: Record<Lang, Texts> = {
  en: {
    hello:
      "Hi! I'm Escala, your travel companion. I'm an AI, here only for your trip: flights, connections, bags, plans, whatever comes up on the way.\n\n" +
      "This is a test version for Meta's hackathon: please use made-up details. What you tell me is stored encrypted, and you can see or delete it anytime.",
    welcomeBack: "Hi again! How can I help with your trip? You can always ask me what I keep about you, or to delete it.",
    shareQuestion: "One thing before we start: should I remember only this trip, or also learn how you like to travel so I can help you better next time?",
    sharedTrip: "Got it, just this trip. I'll delete it when the trip and any claim deadlines are over.",
    sharedProfile: "Got it, I'll learn how you travel. You can tell me to forget anything, anytime.",
    askItinerary: "Send me your trip however you have it: the confirmation email, a screenshot, a PDF, or just the flight numbers.",
    itinerarySummary: (lines) => `This is what I have:\n\n${lines.join("\n")}\n\nDid I get it right?`,
    confirmed: "Perfect. I'm keeping an eye on your flights and I'll tell you the moment something changes. Ask me anything about your trip.",
    passportQuestion: "This trip crosses borders: which passport are you flying with? With that I'll tell you what each country on the way asks for, the connection included.",
    demoButton: "Try a demo trip",
    notWatching: "Saved. One thing: in this test, flight data is simulated, so I can't follow real flights. I can still help with anything about your trip. To see live flight alerts, try the demo trip.",
    fixPrompt: "No problem. What should I fix?",
    notReadable: "I couldn't find a trip there. Could you send me the confirmation email, a screenshot, or the flight numbers and dates?",
    heard: (t) => `🎙️ I heard: "${t}"`,
    heardOther: (t) => `🎙️ Someone told you: "${t}"`,
    notHeard: "I couldn't make out that voice note. Could you say it again, or write it?",
    privacy:
      "Your messages travel encrypted. To help you, Escala and the Meta service that manages this chat process them. " +
      "During Meta's hackathon, Escala runs on free credits from Meta, and while it does, Meta may use what is sent to its AI models to improve its products: please use made-up details only. " +
      "What I remember about you is stored encrypted, is never used for ads, and no one on our team reads it. " +
      "Ask me what I know about you, or tell me to forget something or everything. Escala is for adults; built with Muse Spark Open.",
    menuText: "What do you need?",
    menuButton: "Open menu",
    menuSections: [
      {
        title: "My trip",
        rows: [
          { id: "trip.status", title: "Flight status", description: "Times, gates and changes, flight by flight" },
          { id: "trip.itinerary", title: "Itinerary", description: "Your whole trip on one timeline" },
          { id: "trip.add", title: "Add a trip", description: "Send it however you have it: email, screenshot, PDF or text" },
        ],
      },
      {
        title: "Help on the way",
        rows: [
          { id: "help.rights", title: "My rights", description: "What you're entitled to, with the rule it comes from" },
          { id: "help.baggage", title: "Baggage", description: "A bag that didn't arrive, arrived damaged or was charged" },
          { id: "help.case", title: "Case file & deadlines", description: "Your evidence, the deadlines running and a draft you send" },
        ],
      },
      {
        title: "Account",
        rows: [
          { id: "acct.companions", title: "Companions", description: "Who gets your flight updates, and inviting someone new" },
          { id: "acct.privacy", title: "Privacy & memory", description: "See, delete or limit what I keep about you" },
          { id: "acct.features", title: "Alerts & features", description: "Turn each feature on ✅ or off ⛔" },
          { id: "acct.person", title: "Talk to a person", description: "How to reach the Escala team" },
        ],
      },
    ],
    words: { yes: ["yes", "yeah", "yep", "correct", "right", "ok", "okay", "sure", "perfect", "that's right"], no: ["no", "nope", "wrong", "fix", "not right"], remember: ["remember", "learn", "both", "next time", "remember everything", "keep it all"], tripOnly: ["just this", "only this", "this trip", "just the trip"] },
    notYet: "That part is still being built. Write your question and I'll help with it directly.",
    stopped: "Done. I won't send you any more messages. Your case file stays until the deadlines to claim run out, in case you need it; write DELETE and I'll erase it now.",
  },
  es: {
    hello:
      "¡Hola! Soy Escala, tu compañero de viaje. Soy una inteligencia artificial y estoy aquí solo para tu viaje: vuelos, conexiones, maletas, planes, lo que se te ofrezca en el camino.\n\n" +
      "Es una versión de prueba del hackathon de Meta: usa datos inventados. Lo que me cuentes se guarda cifrado y puedes verlo o borrarlo cuando quieras.",
    welcomeBack: "¡Hola de nuevo! ¿En qué te ayudo con tu viaje? Recuerda que puedes preguntarme qué guardo de ti o pedirme que lo borre cuando quieras.",
    shareQuestion: "Antes de empezar, una pregunta: ¿me acuerdo solo de este viaje, o también aprendo cómo te gusta viajar para ayudarte mejor la próxima vez?",
    sharedTrip: "Va, solo este viaje. Lo borro cuando terminen el viaje y los plazos para reclamar.",
    sharedProfile: "Va, voy a aprender cómo viajas. Puedes pedirme que olvide lo que sea, cuando quieras.",
    askItinerary: "Mándame tu viaje como lo tengas: el correo de confirmación, una captura, un PDF o solo los números de vuelo.",
    itinerarySummary: (lines) => `Esto es lo que tengo:\n\n${lines.join("\n")}\n\n¿Está bien?`,
    confirmed: "Perfecto. Ya estoy al pendiente de tus vuelos y te aviso en cuanto algo cambie. Pregúntame lo que quieras de tu viaje.",
    passportQuestion: "Este viaje cruza fronteras: ¿con qué pasaporte vas a volar? Con eso te digo qué te pide cada país de la ruta, incluida la escala.",
    demoButton: "Probar viaje demo",
    notWatching: "Listo, lo guardé. Un detalle: en esta prueba los datos de vuelo son simulados, así que no puedo seguir vuelos reales. Igual te ayudo con todo lo de tu viaje. Para ver avisos de vuelo en vivo, prueba el viaje demo.",
    fixPrompt: "Claro. ¿Qué corrijo?",
    notReadable: "No encontré un viaje ahí. ¿Me mandas el correo de confirmación, una captura o los números de vuelo y las fechas?",
    heard: (t) => `🎙️ Entendí: «${t}»`,
    heardOther: (t) => `🎙️ Te dijeron: «${t}»`,
    notHeard: "No alcancé a entender la nota de voz. ¿Me la repites o me la escribes?",
    privacy:
      "Tus mensajes viajan cifrados. Para ayudarte, Escala y el servicio de Meta que gestiona este chat los procesan. " +
      "Durante el hackathon de Meta, Escala funciona con créditos gratuitos de Meta y, mientras sea así, Meta puede usar lo que se envía a sus modelos de IA para mejorar sus productos: usa solo datos inventados. " +
      "Lo que recuerdo de ti se guarda cifrado, no se usa para publicidad y nadie del equipo lo lee. " +
      "Pregúntame qué sé de ti, o pídeme que olvide algo o todo. Escala es para mayores de edad; built with Muse Spark Open.",
    menuText: "¿Qué necesitas?",
    menuButton: "Ver menú",
    menuSections: [
      {
        title: "Mi viaje",
        rows: [
          { id: "trip.status", title: "Estado de vuelos", description: "Horarios, puertas y cambios, vuelo por vuelo" },
          { id: "trip.itinerary", title: "Itinerario", description: "Todo tu viaje en una sola línea de tiempo" },
          { id: "trip.add", title: "Agregar viaje", description: "Mándamelo como lo tengas: correo, captura, PDF o texto" },
        ],
      },
      {
        title: "Ayuda en el viaje",
        rows: [
          { id: "help.rights", title: "Mis derechos", description: "Lo que te corresponde, con la norma de donde sale" },
          { id: "help.baggage", title: "Equipaje", description: "Maleta que no llegó, que llegó dañada o que te cobraron" },
          { id: "help.case", title: "Expediente y plazos", description: "Tu evidencia, los plazos que corren y un borrador que tú envías" },
        ],
      },
      {
        title: "Cuenta",
        rows: [
          { id: "acct.companions", title: "Acompañantes", description: "Quién recibe los avisos de tu vuelo, e invitar a alguien" },
          { id: "acct.privacy", title: "Privacidad y memoria", description: "Ve, borra o limita lo que guardo de ti" },
          { id: "acct.features", title: "Avisos y funciones", description: "Prende ✅ o apaga ⛔ cada función" },
          { id: "acct.person", title: "Hablar con una persona", description: "Cómo llegar al equipo de Escala" },
        ],
      },
    ],
    words: { yes: ["sí", "si", "claro", "correcto", "está bien", "esta bien", "ok", "va", "perfecto", "exacto", "así es"], no: ["no", "corrige", "corregir", "mal", "está mal"], remember: ["acuérdate", "acuerdate", "acordarte", "acuerdes", "recuérdame", "recuerdame", "recuerda", "aprende", "aprender", "las dos", "ambas", "próxima"], tripOnly: ["solo este", "sólo este", "nada más este", "solo el viaje"] },
    notYet: "Esa parte todavía se está construyendo. Escríbeme tu pregunta y te ayudo directamente.",
    stopped: "Listo. No te vuelvo a escribir. Tu expediente se queda hasta que venzan los plazos para reclamar, por si lo necesitas; escribe BORRAR y lo borro ahora.",
  },
  fr: {
    hello:
      "Bonjour ! Je suis Escala, votre compagnon de voyage. Je suis une intelligence artificielle, là seulement pour votre voyage : vols, correspondances, bagages, projets, tout ce qui arrive en route.\n\n" +
      "Version de test pour le hackathon de Meta : utilisez des données inventées. Ce que vous me confiez est stocké chiffré, et vous pouvez le consulter ou l'effacer à tout moment.",
    welcomeBack: "Re-bonjour ! Comment puis-je vous aider pour votre voyage ? Vous pouvez toujours me demander ce que je garde sur vous, ou de l'effacer.",
    shareQuestion: "Une question avant de commencer : je retiens seulement ce voyage, ou j'apprends aussi votre façon de voyager pour mieux vous aider la prochaine fois ?",
    sharedTrip: "Entendu, seulement ce voyage. Je l'efface quand le voyage et les délais de réclamation sont terminés.",
    sharedProfile: "Entendu, j'apprends votre façon de voyager. Vous pouvez me demander d'oublier quoi que ce soit, à tout moment.",
    askItinerary: "Envoyez-moi votre voyage comme vous l'avez : le courriel de confirmation, une capture, un PDF ou simplement les numéros de vol.",
    itinerarySummary: (lines) => `Voici ce que j'ai :\n\n${lines.join("\n")}\n\nC'est bien ça ?`,
    confirmed: "Parfait. Je surveille vos vols et je vous préviens dès que quelque chose change. Demandez-moi ce que vous voulez sur votre voyage.",
    passportQuestion: "Ce voyage passe des frontières : avec quel passeport voyagez-vous ? Je vous dirai ce que demande chaque pays du trajet, correspondance comprise.",
    demoButton: "Voyage de démo",
    notWatching: "C'est noté. Une précision : dans ce test, les données de vol sont simulées, je ne peux donc pas suivre de vrais vols. Je peux quand même vous aider pour tout votre voyage. Pour voir des alertes de vol en direct, essayez le voyage de démo.",
    fixPrompt: "Bien sûr. Qu'est-ce que je corrige ?",
    notReadable: "Je n'ai pas trouvé de voyage. Pouvez-vous m'envoyer le courriel de confirmation, une capture ou les numéros de vol et les dates ?",
    heard: (t) => `🎙️ J'ai compris : « ${t} »`,
    heardOther: (t) => `🎙️ On vous a dit : « ${t} »`,
    notHeard: "Je n'ai pas bien compris le message vocal. Pouvez-vous le répéter ou l'écrire ?",
    privacy:
      "Vos messages voyagent chiffrés. Pour vous aider, Escala et le service de Meta qui gère cette conversation les traitent. " +
      "Pendant le hackathon de Meta, Escala fonctionne avec des crédits gratuits de Meta et, tant que c'est le cas, Meta peut utiliser ce qui est envoyé à ses modèles d'IA pour améliorer ses produits : utilisez uniquement des données inventées. " +
      "Ce dont je me souviens sur vous est stocké chiffré, ne sert pas à la publicité, et personne dans notre équipe ne le lit. " +
      "Demandez-moi ce que je sais de vous, ou d'oublier une chose ou tout. Escala est réservé aux adultes ; built with Muse Spark Open.",
    menuText: "De quoi avez-vous besoin ?",
    menuButton: "Ouvrir le menu",
    menuSections: [
      {
        title: "Mon voyage",
        rows: [
          { id: "trip.status", title: "État des vols", description: "Horaires, portes et changements, vol par vol" },
          { id: "trip.itinerary", title: "Itinéraire", description: "Tout votre voyage sur une seule ligne du temps" },
          { id: "trip.add", title: "Ajouter un voyage", description: "Envoyez-le comme vous l'avez : courriel, capture, PDF ou texte" },
        ],
      },
      {
        title: "Aide en route",
        rows: [
          { id: "help.rights", title: "Mes droits", description: "Ce à quoi vous avez droit, avec la règle qui le dit" },
          { id: "help.baggage", title: "Bagages", description: "Bagage pas arrivé, arrivé abîmé ou facturé" },
          { id: "help.case", title: "Dossier et délais", description: "Vos preuves, les délais qui courent et un brouillon à envoyer" },
        ],
      },
      {
        title: "Compte",
        rows: [
          { id: "acct.companions", title: "Accompagnants", description: "Qui reçoit les nouvelles de vos vols, et inviter quelqu'un" },
          { id: "acct.privacy", title: "Vie privée et mémoire", description: "Voir, effacer ou limiter ce que je garde sur vous" },
          { id: "acct.features", title: "Alertes et fonctions", description: "Activez ✅ ou désactivez ⛔ chaque fonction" },
          { id: "acct.person", title: "Parler à une personne", description: "Comment joindre l'équipe Escala" },
        ],
      },
    ],
    words: { yes: ["oui", "c'est bon", "c'est ça", "exact", "correct", "parfait", "d'accord", "ok"], no: ["non", "corriger", "erreur", "pas ça"], remember: ["souviens", "souvenir", "apprends", "retiens", "retenir", "les deux", "prochaine"], tripOnly: ["seulement ce", "juste ce", "ce voyage seulement"] },
    notYet: "Cette partie est encore en construction. Écrivez votre question et je vous aide directement.",
    stopped: "C'est fait. Je ne vous enverrai plus de messages. Votre dossier reste jusqu'à la fin des délais de réclamation, au cas où ; écrivez EFFACER et je l'efface maintenant.",
  },
};

/** The whole message asks for the demo trip (also the id of its button). */
export const DEMO_TRIP_ID = "demo_trip";
export const DEMO_WORDS = ["demo", "demo trip", "try a demo trip", "viaje demo", "probar viaje demo", "viaje de prueba", "viaje de demostración", "voyage de démo", "démo", "voyage démo"];

