/** The privacy policy, served at /privacy. Every statement here must match what the code does (see the tests). */
export const PRIVACY_UPDATED = "2026-10-26";

export const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Escala · Privacy</title>
<style>
  body { font: 16px/1.55 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #1d1d1f; background: #fff; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 1.8rem; }
  .muted { color: #555; }
</style>
</head>
<body>
<h1>Escala privacy policy</h1>
<p class="muted">Last updated ${PRIVACY_UPDATED}. Escala is operated by Kokorio, S.A.P.I. de C.V. (Mexico). Contact: ives.laurent@kokorio.com</p>

<p>Escala is an AI travel companion on WhatsApp. It helps with one trip at a time: your itinerary, flight changes,
your rights as a passenger, and plans on the way. It is in an early test phase.</p>

<h2>What Escala processes</h2>
<ul>
  <li>Your WhatsApp number and the messages you send Escala: text, and the photos, documents or voice notes you choose to share.</li>
  <li>Your itinerary, and what you ask Escala to remember.</li>
  <li>Flight status for the flights on your itinerary.</li>
</ul>
<p>Escala does not ask for, and you should not send, payment cards, passwords or identity documents beyond a booking confirmation.</p>

<h2>Who else handles it</h2>
<ul>
  <li><strong>Meta (WhatsApp Business Platform)</strong> carries the messages between you and Escala. Messages travel encrypted,
  but they are not end-to-end encrypted between you and Escala: Meta's service processes them to deliver them, under
  <a href="https://www.whatsapp.com/legal/business-terms">WhatsApp's business terms</a>.</li>
  <li><strong>Meta's AI models</strong> (Muse Spark through the Meta Model API) read your messages to answer them. Escala uses
  them in Standard mode, without storing the requests on Meta's side, and never in the mode where Meta trains on the data.</li>
  <li><strong>Railway</strong> hosts the Escala server.</li>
</ul>
<p>Escala does not sell your data, does not use it for advertising, and nobody on our team reads your conversations.</p>

<h2>How it is kept</h2>
<ul>
  <li>What Escala remembers is stored encrypted (AES-256-GCM, with a separate key derived for each person). Your phone number is not stored in clear next to it.</li>
  <li>The last few turns of a conversation are kept in the server's memory for up to 24 hours, so a reply can build on what you just said.</li>
  <li>Voice notes are converted to text (Muse Voice Transcribe) and then handled like a written message; the audio itself is not kept.</li>
  <li>Server logs record only that a message arrived and its type, with a one-way tag instead of your number; never the content.</li>
</ul>

<h2>How long</h2>
<ul>
  <li><strong>Trip information</strong> is kept until your trip ends plus the longest deadline to claim your passenger rights, then deleted.
  If you have not shared a trip, what you told Escala is deleted after 30 days.</li>
  <li><strong>Preferences for future trips</strong> are kept only if you ask Escala to remember you, and are deleted if you change your mind.</li>
</ul>

<h2 id="delete">Your controls: see, correct or delete your data</h2>
<ul>
  <li>Ask <em>"What do you know about me?"</em> to see what Escala keeps and where each fact came from.</li>
  <li>Say <em>"Forget …"</em> to delete one thing, or <em>"Delete everything"</em> (<em>"Borra todo"</em>, <em>"Efface tout"</em>) to delete all of it.</li>
  <li>Send <em>STOP</em> to stop messages.</li>
  <li>Or write to ives.laurent@kokorio.com.</li>
</ul>

<h2>Not legal advice</h2>
<p>Escala gives information about passenger rights with its sources. It is not legal advice, it does not book or pay for anything,
and it does not promise compensation.</p>

<h2>Changes</h2>
<p>If this policy changes, the date above changes. Material changes will also be announced in the chat.</p>
</body>
</html>
`;
