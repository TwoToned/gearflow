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
| Wave D | phases 7–18 (spec §11) | plan agreed 2026-11-19; each phase's Gate 0 still to ask |

Decisions PRs #1377 and #1379 merged 2026-11-17. Knip baseline lowered 405 → 402 after Phase 0 (#1381).

Workers run in harness-managed worktrees and write with the file tools only (user's rule, 2026-11-17).

Parallel start (2026-11-17, user asked for phases in parallel where possible): 1a and 1b build off Phase 0's branch against a shared contract commit (`claude/ux-1-contract`) before Phase 0 merges; they merge `main` once it does.

**Unblocked 2026-11-19:** the picomatch GHSA-fc5q-39xc-vjpf audit failure is covered by a time-boxed §15 exception (#1390, expires 2026-12-03, owner-approved). #1389 (FooterTotals whole dollars) merged. Worker cap raised to 6 (owner, 2026-11-19).

## Phases

| Phase | Worker | Branch / PR | State | Blockers |
|---|---|---|---|---|
| 0 Vocabulary + tokens | Sonnet | `claude/ux-0-vocabulary-tokens` · #1378 | **merged 2026-11-17** (3581a386) | — |
| 1a LineRow, ActionMenu, StatusWord, StageFilter, glyphs | Sonnet | `claude/ux-1a-row-primitives` · #1382 | **merged 2026-11-17** (03dfbe1a) | — |
| 1b AddBar, FooterTotals, BulkBar, RowEditorSheet, DetailHeader, ScanDock/ScanStrip | Sonnet | `claude/ux-1b-bar-primitives` · #1383 | **merged 2026-11-17** (95d33848), code-reviewed (9 fixes) | — |
| 1c Row slots: sections, cells, wrapRow, LineRowSection (added for 2a/3) | Sonnet | `claude/ux-1c-row-slots` · #1386 | **merged 2026-11-17** (02711770) | — |
| 2a → 2b Equipment, then Client view + case cards | Sonnet | `claude/ux-2a-equipment` · #1388 (draft) | final slice: coverage-field undo, phone row editor, gate, docs, screenshots | 2b after 2a |
| 2c Plan-honouring prep (only schema change) | Sonnet | `claude/ux-2c-plan-honouring-prep` · #1380 | **merged 2026-11-17** (a5c18a83); no schema change, code-reviewed | `Planned →` glyph moved to Phase 3 |
| 3 Warehouse job page (L) | Sonnet | #1385 **merged 2026-11-19** (e78d5c8d) | done; /code-review: 6 findings + 1 security follow-up, all fixed | — |
| 5 Logistics (L) | Sonnet | 5a #1387 **merged 2026-11-19** (2b2f109c); 5b #1392 **merged 2026-11-19** (6a2ace4d) | Phase 5 done; deployed (prod 307) | — |
| 6 Shell: 6a chrome, 6b list pages | Sonnet | 6a `claude/ux-6a-shell` · #1391; 6b `claude/ux-6b-list-pages` · #1393 | 6a: gate + screenshots; 6b: slice 1 (LineRowList props, ListPage, read queries, Jobs) building | — |
| 4 Floor + Returning mode | default | `claude/ux-4-floor` | plan run (Gate 0 accepted 2026-11-17: D6, D26–D29; carries §9c.5, §9c.8) | plan review |

## Schema changes beyond 2c (user approved 2026-11-17, end of Wave A)

Each is built in its own PR with a /code-review; until then it stays listed as deferred in its phase's PR. The `coverage` row was approved 2026-11-19.

| Item | From | Needs | Where it lands |
|---|---|---|---|
| Client pick-up / drop-off service types | §8, Phase 5 | new enum values + fields on `projectServices` | 5b |
| Durable prep / de-prep scans | §5.7, Phase 3 | the scan-intake ops union / validators | Phase 3 follow-up PR |
| D10 "remember for the next n" shared across packers | Phase 3 | a stored field; per-device in memory for now | Phase 3 follow-up PR |
| `subHireItems.coverage` (what a shortfall cover changed, so Undo restores exactly that) | Phase 2a | one optional object field | 2a (#1388) |

## Wave D (agreed 2026-11-19, spec §11 rows 7–18)

| Wave | Phases | Starts after |
|---|---|---|
| D1 | 7 Job header + Overview, 8 Packing + Versions, 11 Home + palette + More counts, 15 Crew planner, 16 Scan check | 6a, 6b, 2b merged |
| D2 | 9 Wizard + edit sheet, 10 Finance + Tasks tabs, 12 Assets, 13 People, 14 Gear | 7, 16, 6b merged |
| D3 | 17 Finance hub + Settings, 18 Schedule | 10, 11 merged |
