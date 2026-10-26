# Instructions for coding agents (including Muse Code)

- This repository is the hackathon submission and will be **public**. Write nothing you would not publish.
- **Synthetic data only**: no real people, conversations, photos, flights, bookings or phone numbers.
  Airlines in fixtures are fictitious (codes `ZZ`, `ZY`, `ZX`).
- **Never write secrets** into code, docs, fixtures or logs. Keys live in `.env` (git-ignored) and are read
  from the environment. When you need to compare a key, use the first 12 hex characters of its SHA-256.
- Product models: **Meta models only, Standard mode**, `store: false` on every Responses API call.
- The rights base only states what a cited, verified source says. Never invent an amount, a deadline or an
  article. If the rules engine says a right does not apply, the product does not mention its amount.
- `eval/` is frozen (see `eval/FROZEN.md`). Do not edit frozen files; propose changes in a separate note.
- Everything reachable from the Internet requires authentication. Webhooks verify `X-Hub-Signature-256`.
