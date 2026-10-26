# Frozen evaluation set (D1, 2026-10-26T12:41Z)

These SHA-256 hashes were committed **before any product code**, so anyone can check that the
evaluation questions were not tuned to the implementation afterwards.

- The **open set** files are in this folder; their hashes must match.
- The **held-out set** (about 25 % of each set, drawn with seed 20261025) is not published yet. It is
  added on Day 8, when it is run for the first time; its hashes below prove it did not change.
- The questions, expected answers and attack messages were **designed before the event** as part of the
  research and design work (see "What existed before the event" in the README). All code is new.
- Any later correction to a frozen file is logged here with the new hash and the reason.

| File | Set | SHA-256 |
|---|---|---|
| `derechos.jsonl` | open | `685bb0236ec29606918c38e68d78b800775a6666c33c432874a3b00fc7051c0e` |
| `alcance.jsonl` | open | `be2b670d86b12ddc21df3544b0c3b747c96377122b634eae03d7cbc26ed06209` |
| `itinerarios.md` | open | `a0d9763be901eb893414e3fea3ee0103fcdce90a8b32dc22990dc5652743e8de` |
| `catalogo-entradas.jsonl` | open | `dc59879ec8b692aab1823e9dc2b7313a590ec7e65572ecb9ccbb0f4581e2aadc` |
| `derechos-retenido.jsonl` | held-out | `1f6be7ee539841d06fde87b08de5f1a98dc4ba9bfd17cbd0e6ea1dfb8a82bae8` |
| `alcance-retenido.jsonl` | held-out | `f83fe8e97ee94c85a52a174deb761bbd0cb4747a30a74dd31cb11b2a9d27eaff` |
| `itinerarios-retenido.md` | held-out | `2ed423ab7d680c2717139f7d37505e392e26577166ec78110f24dd44b8054818` |

## Corrections

| Date | File | Old SHA-256 | New SHA-256 | Reason |
|---|---|---|---|---|
| 2026-10-26 | `alcance.jsonl` | `be2b670d86b12ddc21df3544b0c3b747c96377122b634eae03d7cbc26ed06209` | `0575bce90c50528eab864951ae8d8a49ce88a8327ecc91972a7cfe230892b1c2` | Product scope widened by the founder: Escala also suggests what to do **when asked, about places on the user's own trip** (destinations and layovers). A-EN-06, A-FR-06 and the second part of A-FR-02 move from out of scope to in scope. Suggestions must be labeled as such and state no hours or prices without a source. The same rule is applied to the held-out set when it is first run (Day 8), and logged here. Suggestions about places outside the trip remain out of scope. |

## Grading clarifications

These change how answers are graded, not the frozen files, so the hashes stay the same.

| Date | Rule | Clarification |
|---|---|---|
| 2026-10-26 | Figures (`cifras_permitidas`, README §2.2 rule 2) | Decided by the founder: besides the listed figures, a figure is allowed if it is a fact of the case's own trip (hours late, connection minutes, days of notice) or a threshold or deadline of a rule the engine returned for that trip (for example "14 days" of notice in APPR s. 19). Money amounts are still allowed only from the list, and only from a rule that applies. |
| 2026-10-26 | Rules that do not apply (`aplica` with a threshold, e.g. US-260-INTL in D01 and D08) | Decided by the founder: a rule that fails only because the trip falls short of its threshold is mentioned with its threshold and source ("the US refund rule needs 6 hours on an international itinerary"). The engine returns these rules separately (`belowThreshold`), without amounts, and they count as returned for grading. |

