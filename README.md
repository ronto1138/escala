# Escala

**A companion for your whole trip, on WhatsApp, and only for your trip.** Send your plans once, any way you
have them: flights, stays, trains, bookings. Escala keeps track of all of it, tells you and the people you
choose when something changes, answers anything about your trip in English, Spanish or French, and learns
how you like to travel, if you let it. When an answer involves rules or money, it comes with the source, and
when Escala does not know, it says so.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026), theme *Build for Your World*,
with Meta's models through the Meta Model API.

> Status: **Day 2 (Oct 27).** Escala is live on WhatsApp (Meta's test number), running on Railway. It reads an
> itinerary from a screenshot, watches flights (with the inbound-aircraft inference), decides passenger rights by
> rules across the US, Canada, Mexico, the EU, the UK and the Montreal Convention, checks every figure before it is
> sent, understands voice notes in three languages, and records the condition of a bag or a rental car from a photo.
> Privacy policy: https://escala-production-e918.up.railway.app/privacy. The trust panel comes next.

## What's inside

| Package | What it does |
|---|---|
| `meta-client` | Meta Model API over `fetch`: `store: false` on every call, model allowlist (Standard only), capped retries, one usage line per call with tokens, latency and cost |
| `rights` | Passenger rights as declarative rules with three-valued logic: an entry *applies*, *may apply* (and depends on one fact worth asking) or *does not apply* (and says why). Validity windows keep reforms out until they apply |
| `feeds` | Flight data: a replay feed of synthetic scenarios in the AeroAPI v4 shape, and a change detector that infers delays from a late inbound aircraft, always flagged as an inference |
| `channel` | WhatsApp Cloud API payloads checked against platform limits, webhook signature verification, and a simulator with the same rules, including the 24-hour window |
| `conversation` | Conversation first: people say what they need in their own words; a short first-contact introduction; the menu only on request |
| `agent` | Muse Spark with tools (flight status, rights for this trip, memory), a scope guard that keeps every answer on the trip, a deterministic verifier that blocks any amount, percentage or deadline the rules did not produce, and evidence photos read with Muse Spark and SAM 3.1 |
| `memory` | What Escala remembers, encrypted per person (AES-256-GCM), with the source of every fact, consent for anything beyond the trip, and retention enforced: trip facts expire with the trip and its claim deadlines |
| `server` | The WhatsApp service: signed webhook, Cloud API channel, voice notes through Muse Voice Transcribe, spending limits, the privacy page, and the hourly retention sweep |

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
