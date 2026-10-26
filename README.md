# Escala

**A companion for your whole trip, on WhatsApp, and only for your trip.** Send your plans once, any way you
have them: flights, stays, trains, bookings. Escala keeps track of all of it, tells you and the people you
choose when something changes, answers anything about your trip in English, Spanish or French, and learns
how you like to travel, if you let it. When an answer involves rules or money, it comes with the source, and
when Escala does not know, it says so.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026), theme *Build for Your World*,
with Meta's models through the Meta Model API.

> Status: **Day 1.** Nothing here is functional yet. This README grows as the project does.

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
