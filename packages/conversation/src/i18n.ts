import type { ListSection } from "@escala/channel";

export type Lang = "en" | "es" | "fr";
export const LANGS: Lang[] = ["en", "es", "fr"];

/** Words that open the main menu from anywhere, in any of the three languages. */
export const MENU_WORDS = ["menu", "menú", "aide", "help", "ayuda"];
export const PRIVACY_WORDS = ["privacy", "privacidad", "confidentialité", "confidentialite"];
export const STOP_WORDS = ["stop", "alto", "baja", "arrêt", "arret", "unsubscribe"];

/** First-message language guess. The person can always switch; this only picks the greeting. */
export function detectLang(text: string): Lang {
  const t = ` ${text.toLowerCase()} `;
  const score = (words: string[]) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const es = score([" hola", " mi ", " vuelo", " ¿", "qué", " gracias", " viaje", " está", " sí", "ñ", " el ", " la "]);
  const fr = score([" bonjour", " mon ", " vol ", " merci", " est-ce", " voyage", " je ", " à ", " oui", "ç", " le ", " c'est"]);
  if (es > fr && es > 0) return "es";
  if (fr > es && fr > 0) return "fr";
  return "en";
}

type Texts = {
  welcome: string;
  shareQuestion: string;
  shareButtons: { trip: string; remember: string; details: string };
  shareDetails: string;
  askItinerary: string;
  itinerarySummary: (lines: string[]) => string;
  confirmButtons: { ok: string; fix: string; menu: string };
  confirmed: string;
  fixPrompt: string;
  notReadable: string;
  menuText: string;
  menuButton: string;
  menuSections: ListSection[];
  notYet: string;
  stopped: string;
};

export const T: Record<Lang, Texts> = {
  en: {
    welcome:
      "Hi, I'm Escala: an AI that keeps you company on your trip, and only your trip.\n\n" +
      "Your messages travel encrypted. To help you, Escala and the Meta service that manages this chat process them. " +
      "What I remember about you is stored encrypted, isn't used to train models or for ads, no one on our team reads it, " +
      "and you can see it, turn it off or delete it anytime by writing *privacy*. Write *menu* to see everything I can do.",
    shareQuestion: "How much do you want me to remember? Just this trip is the default; I delete it when the trip and any claim deadlines are over.",
    shareButtons: { trip: "Just this trip", remember: "Remember me", details: "More info" },
    shareDetails:
      "*Just this trip:* I keep only what this trip needs.\n*Remember me:* I also learn how you travel (connections, bags, who you tell) to suggest better next time. You can switch anytime from *privacy*.",
    askItinerary: "Send me your itinerary however you have it: forwarded email, screenshot, PDF or plain text. I won't ask you for it again.",
    itinerarySummary: (lines) => `Here's your trip:\n\n${lines.join("\n")}\n\nIs that right?`,
    confirmButtons: { ok: "Correct, alert me", fix: "Fix something", menu: "Menu" },
    confirmed: "Done. I'm watching your flights and I'll tell you as soon as something changes. Write to me anytime.",
    fixPrompt: "Tell me what to fix, in your own words.",
    notReadable: "I couldn't read a trip from that. Could you send the confirmation email, a screenshot or the flight numbers and dates?",
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
    notYet: "That part is still being built. Write your question and I'll help with it directly.",
    stopped: "Done. I won't send you any more messages. Your case file stays until the deadlines to claim run out, in case you need it; write DELETE and I'll erase it now.",
  },
  es: {
    welcome:
      "Hola, soy Escala: una IA que te acompaña en tu viaje, y solo en tu viaje.\n\n" +
      "Tus mensajes viajan cifrados. Para ayudarte, Escala y el servicio de Meta que gestiona este chat los procesan. " +
      "Lo que recuerdo de ti se guarda cifrado, no se usa para entrenar modelos ni para publicidad, nadie del equipo lo lee, " +
      "y lo ves, lo apagas o lo borras cuando quieras escribiendo *privacidad*. Escribe *menú* para ver todo lo que puedo hacer.",
    shareQuestion: "¿Cuánto quieres que recuerde? Por omisión, solo este viaje; lo borro cuando terminan el viaje y los plazos para reclamar.",
    shareButtons: { trip: "Solo este viaje", remember: "Recordarme", details: "Más información" },
    shareDetails:
      "*Solo este viaje:* guardo solo lo que este viaje necesita.\n*Recordarme:* también aprendo cómo viajas (conexiones, maletas, a quién avisas) para sugerirte mejor la próxima vez. Lo cambias cuando quieras desde *privacidad*.",
    askItinerary: "Mándame tu itinerario como lo tengas: correo reenviado, captura, PDF o texto. No te lo vuelvo a pedir.",
    itinerarySummary: (lines) => `Este es tu viaje:\n\n${lines.join("\n")}\n\n¿Está bien?`,
    confirmButtons: { ok: "Correcto, avísame", fix: "Corregir algo", menu: "Menú" },
    confirmed: "Listo. Estoy vigilando tus vuelos y te aviso en cuanto algo cambie. Escríbeme cuando quieras.",
    fixPrompt: "Dime qué corrijo, con tus palabras.",
    notReadable: "No pude leer un viaje ahí. ¿Me mandas el correo de confirmación, una captura o los números de vuelo y las fechas?",
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
    notYet: "Esa parte todavía se está construyendo. Escríbeme tu pregunta y te ayudo directamente.",
    stopped: "Listo. No te vuelvo a escribir. Tu expediente se queda hasta que venzan los plazos para reclamar, por si lo necesitas; escribe BORRAR y lo borro ahora.",
  },
  fr: {
    welcome:
      "Bonjour, je suis Escala : une IA qui vous accompagne pendant votre voyage, et seulement votre voyage.\n\n" +
      "Vos messages voyagent chiffrés. Pour vous aider, Escala et le service de Meta qui gère cette conversation les traitent. " +
      "Ce dont je me souviens sur vous est stocké chiffré, ne sert ni à entraîner des modèles ni à la publicité, personne dans notre équipe ne le lit, " +
      "et vous pouvez le voir, le désactiver ou l'effacer à tout moment en écrivant *confidentialité*. Écrivez *menu* pour voir tout ce que je peux faire.",
    shareQuestion: "Que voulez-vous que je retienne ? Par défaut, seulement ce voyage ; je l'efface quand le voyage et les délais de réclamation sont terminés.",
    shareButtons: { trip: "Ce voyage seulement", remember: "Se souvenir de moi", details: "En savoir plus" },
    shareDetails:
      "*Ce voyage seulement :* je garde seulement ce dont ce voyage a besoin.\n*Se souvenir de moi :* j'apprends aussi votre façon de voyager (correspondances, bagages, qui vous prévenez) pour mieux vous conseiller la prochaine fois. Vous changez quand vous voulez depuis *confidentialité*.",
    askItinerary: "Envoyez-moi votre itinéraire comme vous l'avez : courriel transféré, capture, PDF ou texte. Je ne vous le redemanderai pas.",
    itinerarySummary: (lines) => `Voici votre voyage :\n\n${lines.join("\n")}\n\nEst-ce correct ?`,
    confirmButtons: { ok: "Oui, alertez-moi", fix: "Corriger", menu: "Menu" },
    confirmed: "C'est fait. Je surveille vos vols et je vous préviens dès que quelque chose change. Écrivez-moi quand vous voulez.",
    fixPrompt: "Dites-moi quoi corriger, avec vos mots.",
    notReadable: "Je n'ai pas pu lire un voyage. Pouvez-vous envoyer le courriel de confirmation, une capture ou les numéros de vol et les dates ?",
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
    notYet: "Cette partie est encore en construction. Écrivez votre question et je vous aide directement.",
    stopped: "C'est fait. Je ne vous enverrai plus de messages. Votre dossier reste jusqu'à la fin des délais de réclamation, au cas où ; écrivez EFFACER et je l'efface maintenant.",
  },
};
