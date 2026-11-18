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

Decisions PRs #1377 and #1379 merged 2026-11-17. Knip baseline lowered 405 → 402 after Phase 0 (#1381).

Workers run in harness-managed worktrees and write with the file tools only (user's rule, 2026-11-17).

Parallel start (2026-11-17, user asked for phases in parallel where possible): 1a and 1b build off Phase 0's branch against a shared contract commit (`claude/ux-1-contract`) before Phase 0 merges; they merge `main` once it does.

**Blocked 2026-11-18:** every PR's Hygiene fails on `pnpm audit --audit-level high` for picomatch GHSA-fc5q-39xc-vjpf, whose fix (4.0.8) is not published. Needs the user's call (a §15 exception like the braces precedent, or wait). No PR can merge until then. Small fixes waiting: #1389 (FooterTotals whole dollars).

## Phases

| Phase | Worker | Branch / PR | State | Blockers |
|---|---|---|---|---|
| 0 Vocabulary + tokens | Sonnet | `claude/ux-0-vocabulary-tokens` · #1378 | **merged 2026-11-17** (3581a386) | — |
| 1a LineRow, ActionMenu, StatusWord, StageFilter, glyphs | Sonnet | `claude/ux-1a-row-primitives` · #1382 | **merged 2026-11-17** (03dfbe1a) | — |
| 1b AddBar, FooterTotals, BulkBar, RowEditorSheet, DetailHeader, ScanDock/ScanStrip | Sonnet | `claude/ux-1b-bar-primitives` · #1383 | **merged 2026-11-17** (95d33848), code-reviewed (9 fixes) | — |
| 1c Row slots: sections, cells, wrapRow, LineRowSection (added for 2a/3) | Sonnet | `claude/ux-1c-row-slots` · #1386 | **merged 2026-11-17** (02711770) | — |
| 2a → 2b Equipment, then Client view + case cards | Sonnet | `claude/ux-2a-equipment` · #1388 (draft) | building in slices: sections, restores, AddBar done; accessories/footer/Orders/shortfall next | 2b after 2a |
| 2c Plan-honouring prep (only schema change) | Sonnet | `claude/ux-2c-plan-honouring-prep` · #1380 | **merged 2026-11-17** (a5c18a83); no schema change, code-reviewed | `Planned →` glyph moved to Phase 3 |
| 3 Warehouse job page (L) | Sonnet | `claude/ux-3-warehouse-job` · #1385 (draft) | building in slices: To pick, Prepped, Out done; Returned/De-prepped + deletion next | `scanIntake.commit` return change needs /code-review |
| 5 Logistics (L) | Sonnet | 5a `claude/ux-5-logistics` · #1387; 5b `claude/ux-5b-service-sheet` | 5a review passed, waiting on the audit gate; 5b planning (service sheet + client pick-up/drop-off) | audit gate |
| 6 Shell: 6a chrome now, 6b list pages after | Sonnet | `claude/ux-6a-shell` | 6a planning | — |
| 4 Floor + Returning mode | — | — | waiting on 3 | Gate 0 |

## Schema changes beyond 2c (user approved 2026-11-17, end of Wave A)

Each is built in its own PR with a /code-review; until then it stays listed as deferred in its phase's PR.

| Item | From | Needs | Where it lands |
|---|---|---|---|
| Client pick-up / drop-off service types | §8, Phase 5 | new enum values + fields on `projectServices` | 5b |
| Durable prep / de-prep scans | §5.7, Phase 3 | the scan-intake ops union / validators | Phase 3 follow-up PR |
| D10 "remember for the next n" shared across packers | Phase 3 | a stored field; per-device in memory for now | Phase 3 follow-up PR |
