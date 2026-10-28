/** The privacy policy, served at /privacy. Every statement here must match what the code does (see the tests). */
export const PRIVACY_UPDATED = "2026-10-27";

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

<p><strong>During Meta's hackathon (until November 2026), this is a test version. Use made-up details only: do not
send real personal information, documents or photos of people.</strong> In this period Escala runs on free credits
from Meta, and while free credits are used, Meta may use the content sent to its AI models to improve its products.
Before Escala serves real users, the free credits will be turned off (or another account will be used) and this
policy will be updated.</p>

<h2>What Escala processes</h2>
<ul>
  <li>Your WhatsApp number and the messages you send Escala: text, and the photos, documents or voice notes you choose to share.</li>
  <li>Your itinerary, and what you ask Escala to remember.</li>
  <li>What you tell Escala about the trip around the flights (where you stay and its address, how many bags you check and
  their weight, a rental car), and what your boarding pass says if you send it (boarding time, gate, seat, group and your
  first name). Escala never keeps the barcode, the booking code or document numbers. All of it is kept with your trip and
  deleted with it.</li>
  <li>The name in your WhatsApp profile, as WhatsApp sends it, to call you by it now and then. Escala never guesses anything
  else about you from it.</li>
  <li>Flight status for the flights on your itinerary.</li>
</ul>
<p>Escala does not ask for, and you should not send, payment cards, passwords or identity documents beyond a booking confirmation.</p>

<h2>Who else handles it</h2>
<ul>
  <li><strong>Meta (WhatsApp Business Platform)</strong> carries the messages between you and Escala. Messages travel encrypted,
  but they are not end-to-end encrypted between you and Escala: Meta's service processes them to deliver them, under
  <a href="https://www.whatsapp.com/legal/business-terms">WhatsApp's business terms</a>.</li>
  <li><strong>Meta's AI models</strong> (Muse Spark through the Meta Model API) read your messages to answer them. Escala uses
  them in Standard mode with request storage turned off. During the hackathon, while Meta's free credits are used, Meta may use that content to
  improve its products (see the notice above).</li>
  <li><strong>Muse Spark Open</strong>, Meta's open-weight model, served by <strong>Baseten</strong>, reads what you write after Escala
  answers and proposes habits worth remembering (for example, that you always check a bag), with your own words as the source.
  Escala's code decides what is kept. If Meta's own service does not answer, the same model on Baseten answers your message instead.
  Baseten states that it keeps no copy of these requests and does not train on them.</li>
  <li><strong>Railway</strong> hosts the Escala server.</li>
  <li><strong>Google Maps</strong>: map links Escala sends name the place, and if you shared your location, its coordinates as
  the starting point. Opening a link sends that to Google under its own terms; Escala does not call Google itself.</li>
</ul>
<p>Escala does not sell your data and does not use it for advertising.</p>

<h2>Test phase: the team reads the conversations</h2>
<p>Escala is in a test phase. It answers only numbers the Kokorio team has enrolled, by hand or with an invitation code
(a QR) the team hands out, and each tester is told this before or when joining: <strong>the team reads the full conversations</strong> (what you write, what Escala answers,
and what a voice note was heard as) to find mistakes and improve Escala. Use made-up details only.</p>
<ul>
  <li>Each message is sealed with a public key before it is written to the server's log. The private key is not on the
  server or with the host, so only the team can open them, on its own computer.</li>
  <li>This lasts until at least November 30, 2026, and may continue while Escala is being tuned. The page will say when it ends.</li>
  <li>If you ask Escala to delete everything, your memory and conversation state are deleted, and your messages are
  removed from the team's copy the next time it is read. Sealed lines already in the host's log stay there, unreadable
  without the team's key, until the host discards its logs.</li>
</ul>

<h2>How it is kept</h2>
<ul>
  <li>What Escala remembers is stored encrypted (AES-256-GCM, with a separate key derived for each person). Your phone number is not stored in clear next to it.</li>
  <li>The last turns of the conversation (at most 12, for up to 48 hours), where you are in it and your trip are kept encrypted the same
  way, so Escala understands a reply in context, even after a restart. They expire on the same rules as below.</li>
  <li>Voice notes are converted to text (Muse Voice Transcribe) and then handled like a written message; the audio itself is not kept.</li>
  <li>If you share your location in WhatsApp, Escala uses it for directions and nearby suggestions: it goes to Meta's model with your
  question, is kept encrypted for two hours and then deleted, and is never remembered for future trips.</li>
  <li>If your trip crosses borders, Escala asks which passport you fly with, only the country, never its number, to tell you
  what each country on the route asks for. It is kept with your trip and deleted with it; if you turned on memory for future
  trips, it is remembered until you ask Escala to forget it.</li>
  <li>Server logs record that a message arrived and its type, with a keyed tag instead of your number, plus usage and error codes;
  apart from the sealed test-phase lines above, they are not meant to hold what you write, and error texts are cut short.</li>
  <li>To keep costs bounded, each person can send a limited number of messages, photos and voice notes per hour.</li>
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

<h2>Who Escala is for</h2>
<p>Escala is for adults (18 and over). Built with Muse Spark Open.</p>

<h2>Not legal advice</h2>
<p>Escala gives information about passenger rights with its sources. It is not legal advice, it does not book or pay for anything,
and it does not promise compensation.</p>

<h2>Changes</h2>
<p>If this policy changes, the date above changes.</p>
</body>
</html>
`;
