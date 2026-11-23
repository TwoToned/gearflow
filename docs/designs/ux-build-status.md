# UX unification — build status

> _Owner: Jayden Nawotka · Last reviewed: 2026-11-21 (review quarterly — POLICY.md R-5.5)_

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
| 7 | none | — |
| 8 | D19, D20, D21 · worker model Sonnet (L) | Accepted 2026-11-21 |
| 11 | D85, D86, D87, D88, D89 | Accepted 2026-11-21 |
| 15 | D46, D47, D48, D49 | Accepted 2026-11-21 |
| 16 | D50, D51, D52, D53 | Accepted 2026-11-21 |
| Wave D2, D3 | phases 9, 10, 12, 13, 14, 17, 18 (spec §11) | plan agreed 2026-11-19; each phase's Gate 0 still to ask |

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
| 2a → 2b Equipment, then Client view + case cards | Sonnet (2a) · default (2b) | 2a #1388 **merged 2026-11-19** (07cad15c); 2b #1395 **merged 2026-11-19** (4180affa) | Phase 2 done | Follow-up: `setPlannedContainerNative` doesn't check the line and the target case are on the same job (pre-existing; same-org only) |
| 2c Plan-honouring prep (only schema change) | Sonnet | `claude/ux-2c-plan-honouring-prep` · #1380 | **merged 2026-11-17** (a5c18a83); no schema change, code-reviewed | `Planned →` glyph moved to Phase 3 |
| 3 Warehouse job page (L) | Sonnet | #1385 **merged 2026-11-19** (e78d5c8d) | done; /code-review: 6 findings + 1 security follow-up, all fixed | — |
| 5 Logistics (L) | Sonnet | 5a #1387 **merged 2026-11-19** (2b2f109c); 5b #1392 **merged 2026-11-19** (6a2ace4d) | Phase 5 done; deployed (prod 307) | — |
| 6 Shell: 6a chrome, 6b list pages | Sonnet | 6a #1391 **merged 2026-11-19** (4c922ecd); 6b #1393 **merged 2026-11-19** (3f0f8ed5) | Phase 6 done. Open: desktop BulkBar is inline at the list footer (needs a shell-level sticky to pin) | Follow-up: Logistics "+ Add service" sticky bar sits ~80 px above the new phone nav (5a offset stacked on the 6a shell) |
| 4 Floor + Returning mode | default | #1394 **merged 2026-11-19** (9d3ab254) | done, incl. §9c.5 pull sheet, §9c.8 shared `warehouseStage`, packer field. Deviation: Returning rows show no tag ranges or shelf (the board read doesn't carry them) | — |

## Schema changes beyond 2c (user approved 2026-11-17, end of Wave A)

Each is built in its own PR with a /code-review; until then it stays listed as deferred in its phase's PR. The `coverage` row was approved 2026-11-19.

| Item | From | Needs | Where it lands |
|---|---|---|---|
| Client pick-up / drop-off service types | §8, Phase 5 | new enum values + fields on `projectServices` | 5b |
| Job packer (approved 2026-11-19) | §9c.2, Phase 4 | optional `projects.packerUserId` + `setPackerNative` | 4 |
| Durable prep / de-prep scans | §5.7, Phase 3 | the scan-intake ops union / validators | Phase 3 follow-up PR |
| D10 "remember for the next n" shared across packers | Phase 3 | a stored field; per-device in memory for now | Phase 3 follow-up PR |
| `subHireItems.coverage` (what a shortfall cover changed, so Undo restores exactly that) | Phase 2a | one optional object field | 2a (#1388) |
| Seal case (approved 2026-11-21, D21) | §7b, Phase 8 | optional `projectContainers.sealedAt` | 8 |
| Timesheet query reason (approved 2026-11-21, D47) | §9h.4, Phase 15 | optional `crewTimeEntries.queryReason`, cleared on resubmit/approve | 15 |

| T&T readings that are entered but never stored (approved 2026-11-21) | §9i, Phase 16 | three optional `testTagRecords` fields: RCD trip current, RCD push-button, microwave leakage | 16 |

Not a schema change (2026-11-21, D50): an ad-hoc check's condition writes the existing `assets.condition` plus an activity row. `FAIR` reads **Worn** app-wide (owner, 2026-11-21), with the alias in the glossary.

**Owner answers 2026-11-21, round 2:**
- **D21 seal scope:** a seal also blocks rename, re-nest and delete; the warehouse is not blocked.
- **R-8.3.3 `loadOrgGraph` exception:** renewed to 2027-02-21 (it had lapsed on 2026-10-25), so Phase 7's double-booked row ships.
- **D52:** a failed test stores the derived next-due date ("Next due after repair").
- **Follow-ups:** start the CSV formula-injection guard + the Next.js ≥ 16.4.5 upgrade now. Picomatch is to be FIXED (override), not renewed; come back to the owner before 2026-12-03 if it can't be done cleanly.

**Overseer rulings on worker questions (2026-11-21; these interpret accepted rows):**
- Phase 15:
  - D49 pay = the cost (pay) cascade, labelled "Rate (pay)".
  - A day rate counts once per person per day.
  - Offer/Cancel email crew, so they get a confirm and no Undo.
  - "Disputed" reads "Queried" via its one label source.
  - The timesheet Undo reads prior values from the forward write's own activity rows; it never takes client-supplied values.
- Phase 8:
  - The version menu lives in the header ⋯ (D92), with no chip.
  - "Unplanned" (a plan state) is not "Loose" (a physical state).
  - Make-live Undo is server-checked against the expected live pointer.
- Phase 7:
  - The money tiles go (§6b); CLAUDE.md's Overview paragraph is updated in the same PR.
  - The invoicing-derivation merge and "Deposit paid" move to Phase 10.
- Phase 11:
  - The overdue tile links to `/projects?overdue=1`.
  - Global search gets a server-side role filter (security fix).
  - ⌘K Recents are ids in localStorage, keyed per org + user.

**Restart 2026-11-21 ~11:40:** the container restarted mid-slice. Every worker branch was clean and pushed; workers were re-briefed from their PR-body handoffs.

## Wave D (agreed 2026-11-19, spec §11 rows 7–18)

| Wave | Phases | Starts after |
|---|---|---|
| D1 | 7 Job header + Overview, 8 Packing + Versions, 11 Home + palette + More counts, 15 Crew planner, 16 Scan check | 6a, 6b, 2b merged |
| D2 | 9 Wizard + edit sheet, 10 Finance + Tasks tabs, 12 Assets, 13 People, 14 Gear | 7, 16, 6b merged |
| D3 | 17 Finance hub + Settings, 18 Schedule | 10, 11 merged |

### Wave D1 workers (started 2026-11-21)

Merge order: 7 first (it owns `projects/[id]/page.tsx`); 8 adds its tabs to that page only after 7 merges. 11 and 15 both touch `src/lib/nav.ts`: whichever merges second merges main first.

| Phase | Worker | Branch / PR | State | Blockers |
|---|---|---|---|---|
| 7 Job header + Overview + tab strip (M) | default | #1400 **merged 2026-11-22** (15450b14) | done. Independent review: 0 blockers, 6 should-fix, all fixed. An unapproved index was reverted (`by_projectId` used instead) | — |
| 8 Packing + Versions (L) | Sonnet | #1399 **merged 2026-11-23** (8fc9b203) | done. Two independent reviews (0 blockers; 7 + 7 should-fix, all fixed). Ships `projectContainers.sealedAt` (approved) | — |
| 11 Home v2 + palette + More counts (M) | default | `claude/ux-11-home-palette` · #1401 | S1 approved; S2 review: 0 blockers, 6 should-fix (incl. org-switch layout cross-write) being fixed; S3 (⌘K) / S4 building | — |
| 15 Crew planner + timesheets (M) | default | `claude/ux-15-crew-planner` · #1402 | all 4 slices built; slice 3–4 review: 0 blockers, 6 should-fix (open-calls cap, multi-day calls, mail chunking, dimmed selection, org week start, undo author scope) being fixed | — |
| 16 Scan check + Test & tag (M) | default | `claude/ux-16-scan-check` · #1403 | slice 1 review fixes (3 blockers) + slice 2 (/scan + Check) done; slices 3–4 building. Ad-hoc Undo deletes that save's photos (overseer ruling) | merges before Phase 14 |
| Security hotfix: crew token + pay leak | default | #1410 **merged 2026-11-23** (acb51388) | done: `responseToken` is service-only; crew pay on raw reads is manager+ (`canSeeCrewPay`). Follow-ups: `crewMembers.listPage` and `crewAssignments.projectCrew` still return pay below manager | — |
| Follow-up: CSV formula guard | default | #1405 **merged 2026-11-21** (d2b323c7) | done | — |
| Follow-up: Next.js 16.4.3 → 16.4.5 | default | #1406 **merged 2026-11-22** (f3c5547f) | done (7 moderate advisories cleared) | — |
| Follow-up: picomatch GHSA-fc5q | default | #1407 **merged 2026-11-22** (9e847a93) | done: the audit passes without the ignore, so the exception row is retired | — |

**Restarts:** the container restarted twice (2026-11-21 ~11:40 and ~15:25); the second left the build idle about 32 h. A third stop (2026-11-23 ~01:20, usage limit, then a restart) idled it about 21 h; workers were resumed with their uncommitted work intact. Branches were always clean and pushed, and workers were re-briefed from their PR-body handoffs.

**Gate addendum (2026-11-21):** the handoff §6 gate list missed several CI Hygiene steps (depcruise-ratchet broke three branches). Workers now run the full Hygiene set: check-docs-npm-npx, check-dependency-justification, depcruise / any / date-format / collect / knip / complexity / xtenant ratchets, check-client-routes, api:registry/docs/mcp checks, wasm:sync:check, mira:feature-map:check, plus pnpm audit.

**Owner, 2026-11-22:** Phase 16's T&T reading fields are FIVE optional columns (two readings, each with its own result, plus three `*Result` columns).

### Logged follow-ups (not in any phase)
- CSV importers don't strip the formula guard's leading `'` on re-import.
- tailwind-merge drops the custom font-size tokens (`text-caption`, `text-table-cell`) in `cn()` at about 40 sites; needs `extendTailwindMerge`.
- `recalcServiceCostFromCrew` counts cancelled/declined calls; the Overbookings `fetchServicesData` doesn't filter non-live versions; version-scope-ratchet reads 41 vs 32 (not in CI).
- Job page: the `V` hint inside the version submenu is inert; Documents label lists go stale per mount.
- The labour-cost store in `use-project-crew.ts` may be dead after Phase 7.
- The `braces` R-6.6 exception expired 2026-10-17 (flagged to the owner earlier).
