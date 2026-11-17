# UX unification — build status

> _Owner: Jayden Nawotka · Last reviewed: 2026-11-17 (review quarterly — POLICY.md R-5.5)_

Build tracker for [`ux-unification-2026-10.md`](./ux-unification-2026-10.md) §11. The
overseer session keeps this current and commits it with its integration commits.

**Merge rule (set 2026-11-17):** the overseer may merge a PR to `main` (merge commit)
once CI is green and its review passes; after each merge it confirms
https://flow.rvlt.app returns 200/307.

## Gate 0 — decisions

| Phase | Decisions it needs | State |
|---|---|---|
| 0 | D2, D7, D66, D67, D68, D90 | Accepted 2026-11-17 |
| 1 | D2, D39, D68, D91, D92 | Accepted 2026-11-17 |
| 2a | D39, D91 (no §7 decisions) | Accepted 2026-11-17 |
| 2b | scope amended (D3 withdrawn): Client view + case cards | Accepted 2026-11-17 |
| 2c | none | — |
| 3 | D8, D9, D10 · worker model Sonnet | Accepted 2026-11-17 |
| 5 | D4 · worker model Sonnet | Accepted 2026-11-17 |
| 6 | D1, D5, D11, D12, D13, D65, D69, D70 | Accepted 2026-11-17 |
| 4 | D6, D26, D27, D28, D29 | Accepted 2026-11-17 |
| Wave D | phases to propose (§6c, §6d, §7b, §7c, §8b, §8c, §9b–§9o) | not proposed |

Decisions PR #1377 merged 2026-11-17.

## Phases

| Phase | Worker | Branch / PR | State | Blockers |
|---|---|---|---|---|
| 0 Vocabulary + tokens | Sonnet | `claude/ux-0-vocabulary-tokens` · #1378 (draft) | in review: 4 fixes requested 2026-11-17 | CI pending |
| 1a LineRow, ActionMenu, StatusWord, StageFilter, glyphs | — | — | waiting on 0 | Phase 0 merge; shared props file |
| 1b AddBar, FooterTotals, BulkBar, RowEditorSheet, DetailHeader, ScanDock/ScanStrip | — | — | waiting on 0 | Phase 0 merge; 1a's types file |
| 2a → 2b Equipment, then Packing | — | — | waiting on 1 | Gate 0 |
| 2c Plan-honouring prep (only schema change) | — | — | waiting on 1 | Gate 0; merges last in Wave B |
| 3 Warehouse job page (L) | — | — | waiting on 1 | Gate 0; model choice |
| 5 Logistics (L) | — | — | waiting on 1 | Gate 0; model choice |
| 6 Shell | — | — | waiting on 1 | Gate 0 |
| 4 Floor + Returning mode | — | — | waiting on 3 | Gate 0 |
