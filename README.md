# Escala

**A companion for your whole trip, on WhatsApp, and only for your trip.** Send your plans once, any way you
have them: flights, stays, trains, bookings. Escala keeps track of all of it, tells you and the people you
choose when something changes, answers anything about your trip in English, Spanish or French, and learns
how you like to travel, if you let it. When an answer involves rules or money, it comes with the source, and
when Escala does not know, it says so.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026), theme *Build for Your World*,
with Meta's models through the Meta Model API. **Built with Muse Spark Open**: Meta's open-weight model, served by
Baseten, is the memory that learns how each traveler likes to travel. Escala is for adults (18+).

> Status: **Day 2 (Oct 27).** Escala is live on WhatsApp, running on Railway. It reads an itinerary from text or a
> screenshot, watches flights (with the inbound-aircraft inference), decides passenger rights by rules across the US,
> Canada, Mexico, the EU, the UK and the Montreal Convention, checks every figure before it is sent, understands voice
> notes in three languages, records the condition of a bag or a rental car from a photo, and guides the trip:
> getting from the airport, transit or taxi, places, events and safety, found with Muse Spark's web search and
> always with the source and the date checked. What no source confirms, it says it could not confirm. It also
> converts currencies (European Central Bank reference rates, dated) and measures.
> Privacy policy: https://escala-production-e918.up.railway.app/privacy.

**Simulated flights.** During the hackathon, flight data comes from synthetic scenarios replayed in real time (flight
numbers ZZ1234 and ZZ567); no live flight data provider is connected. The demo trip runs on a real route, Mexico City to
Montreal through Chicago O'Hare, with a fictitious airline, example times and invented events; airports, time zones
and the border rules of the connection are real and cited.

**Following the aircraft, documents and boarding.** Escala follows the plane up to three flights back to foresee a
delay before the airline posts it, using the manufacturer's published minimum turn time for each aircraft type, and
says so when the plane is swapped or catches up. For a trip that crosses borders it asks which passport the traveler
flies with and tells what each country on the route asks, connection included, from official pages with the date read.
It reminds the traveler to head to the gate with what the airline publishes, or a typical range said as such.

**Test phase.** Escala answers only invited numbers. The Kokorio team reads test conversations to improve Escala, and
Meta may use them while the event's free credits are used. Use made-up details. Conversations are sealed with a
public key before they reach the server log; the private key is not on the server.

## What's inside

| Package | What it does |
|---|---|
| `meta-client` | Meta Model API over `fetch`: `store: false` on every call, model allowlist (Standard only), capped retries, one usage line per call with tokens, latency and cost |
| `rights` | Passenger rights as declarative rules with three-valued logic: an entry *applies*, *may apply* (and depends on one fact worth asking) or *does not apply* (and says why). Validity windows keep reforms out until they apply |
| `feeds` | Flight data: a replay feed of synthetic scenarios in the AeroAPI v4 shape, and a change detector that infers delays from a late inbound aircraft, always flagged as an inference |
| `channel` | WhatsApp Cloud API payloads checked against platform limits, webhook signature verification, and a simulator with the same rules, including the 24-hour window |
| `conversation` | Conversation first: people say what they need in their own words; a short first-contact introduction; the menu only on request |
| `agent` | Muse Spark with tools (flight status, rights for this trip, memory, trip guide with built-in web search, currency and unit conversion), a scope guard that keeps every answer on the trip, a deterministic verifier that blocks any amount, percentage or deadline that neither the rules nor a cited source produced, and evidence photos read with Muse Spark and SAM 3.1. Rights are never looked up on the web |
| `meta-client` (open) | Muse Spark Open on Baseten for structured output, synchronous only (zero data retention), usage logged with provider and cost. It is also the last fallback when the Meta Model API does not answer (Muse Spark 1.3 → 1.2 → Muse Spark Open) |
| `memory` | What Escala remembers, encrypted per person (AES-256-GCM), with the source of every fact, consent for anything beyond the trip, and retention enforced: trip facts expire with the trip and its claim deadlines |
| `server` | The WhatsApp service: signed webhook, Cloud API channel, voice notes through Muse Voice Transcribe, spending limits, the privacy page, the hourly retention sweep, and the test phase (invitation codes, sealed test conversations) |

## Run the tests

```
npm ci
npm run check
```

## What existed before the event

The hackathon requires a clear line between what was built during the event and what came before. This is it.

**Before Oct 26, 2026 (design and research, no product code):**
- Research on air passenger rights (US, Canada, EU, UK, Mexico, Montreal Convention), privacy rules and
  WhatsApp / Meta platform policies. It informs the rights base but is not included as code.
- The product design: scope, architecture, acceptance criteria.
- The **evaluation set** in `eval/` (questions, expected answers, scope attacks, itinerary specs). It is
  frozen with SHA-256 hashes in the first commit, before any code: see `eval/FROZEN.md`.
- Drafts of the user-facing copy (onboarding, menu, message templates). They are rewritten as they are
  integrated, and each one is marked in the commit that adds it.

**During the event (Oct 26 – Nov 4, 2026):** all code in this repository. The commit history starts on Day 1.

## License

Apache License 2.0. See `LICENSE`.
