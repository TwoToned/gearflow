# Warehouse Linear Flow — Pick/Prep → Prepped → Deployed → Returned → Depreped

> Status: IN PROGRESS — v1 tabs implemented (PR #184). Stage model
> (`src/lib/warehouse-stage.ts` + tests), deprep-preserves-returned-units fix,
> the Returned/Depreped tabs + leak removal, and partial-return split context
> (`describeStageSplit` → "6 deployed · 4 returned" on the Returned/Depreped
> rows) are landed. Pending: **visual QA**; the Deployed-tab "of N" hint
> (optional symmetry polish); Kanban board (fast-follow).
> (Originally: APPROVED via /autoplan — ready to implement.)
> Branch: worktree-bridge-cse_013eDwEAQ9UkG61zX5gBcp98
> Owner: Jayden
>
> **Final scope (post-gate):** v1 = the 5-stage linear **tabs** (Pick/Prep →
> Prepped → Deployed → Returned → Depreped) + separate Close-Out. Stage names kept
> as above ("Depreped" retained per owner). The **Kanban board is a fast-follow**
> (separate initiative), built as a reduced-content overview over the same shared
> `stagesFor()` model — not a full clone, mobile falls back to tabs. All critical
> correctness fixes (unit-aware stage helper, unit-preserving forward deprep,
> quantity-aware Returned/Depreped filters, unit-count badges) are **in v1**.

## Problem

The per-project warehouse board (`src/app/(app)/warehouse/[projectId]/page.tsx`)
presents gear movement as three tabs — **Pick/Prep → Deploy → Return** — plus
Bulk Check-In and Close-Out. The mental model breaks because the flow runs
left-to-right and then *reverses*:

- A **returned** item falls back into **Pick/Prep**. Literally encoded at
  `page.tsx:1326`: `if (item.status === "RETURNED") return true;`. So gear that
  came back early reappears in the *first* tab, looking like it **never went
  out** instead of "came back."
- **Deprep** is a *backward* action that lives in the **Deploy** tab — it sends a
  PACKED item back toward Pick/Prep. The operator watches gear move right, then
  jump left.

Net effect: it is unclear, at a glance, what has actually gone out, what has come
back, and what never left. The user wants a single left-to-right pipeline where
"returned" is a distinct, visible stage cleanly separated from "not yet
deployed," and deprep reads as the final *forward* step.

## Desired flow (linear, left → right)

```
Pick/Prep ──▶ Prepped ──▶ Deployed ──▶ Returned ──▶ Depreped ──▶ [Close-Out]
 (to pack)   (staged)    (on site)   (came back)  (unpacked)    (finalize project)
```

The underlying state sequence already exists, but **review surfaced that the
data model is unit-level, not line-level** — a single line can occupy multiple
stages at once (partial returns, kits with children split across stages). The
naive "one stage per line" model is WRONG. The stage seam must be **unit-aware
and return per-stage memberships + quantities**, not a single enum.

### Stage membership (unit/quantity-aware — corrected after review)

`stagesFor(item)` returns a **set** of stages with per-stage quantities, derived
from unit rows and rollup counters (NOT from a single line `status`):

| Stage      | Membership signal (unit/quantity-aware)                                  | Action → next   |
|------------|--------------------------------------------------------------------------|-----------------|
| Pick/Prep  | units not packed / not out / not returned; qty>0; **never** `RETURNED`    | Prep → Prepped  |
| Prepped    | units `prepStatus=PACKED`, not yet CHECKED_OUT, not returned              | Deploy→Deployed |
| Deployed   | `checkedOutQuantity > returnedQuantity` (units still out)                 | Return→Returned |
| Returned   | `returnedQuantity > 0` AND `prepStatus !== PENDING` (back, not put away)  | Deprep→Depreped |
| Depreped   | returned AND `prepStatus === PENDING` (put away)                          | (lands here)    |
| Close-Out  | project-level finalize (`batchCloseOut` → `COMPLETED`)                    | separate tab    |

Why each correction (all three review voices independently flagged these):
- **Deployed/Returned key on quantities, not `status`.** A line with 6 of 10
  units out and 4 back stays `status=CHECKED_OUT` (`deriveOrderLineStatus`
  prioritizes any CHECKED_OUT unit). It must count **6 in Deployed and 4 in
  Returned simultaneously**. `status=RETURNED && prepStatus=PACKED` would miss it
  entirely. Mirror the existing bulk math at `page.tsx:1368` / `:231`.
- **Returned uses `prepStatus !== PENDING`, not `=== PACKED`.** A returned item
  flagged `FLAGGED_FAULTY` / `FLAGGED_TT_OVERDUE` (`completeCheckAndFlag`) is
  neither PACKED nor PENDING — `=== PACKED` would make it vanish from every tab
  once the `:1326` leak is removed.

### CRITICAL: deprep must preserve returned units (forward transition fix)

The plan originally said "deprep (`completeCheckAndDeprep` / `deprepItem`) becomes
the forward Returned → Depreped transition." **Review found these two are NOT
interchangeable and the wiring is a landmine:**

- `deprepItem` (`check-records.ts:~346`) **DELETES** non-CHECKED_OUT units —
  which includes RETURNED units. After deletion `computeRollupCounters` rolls
  `returnedQuantity` back to 0 and `deriveOrderLineStatus` reverts the line to
  CONFIRMED. The item **vanishes from Returned and reappears in Pick/Prep as if
  it never shipped** — the exact bug this initiative kills. Today
  `handleDeprep` (`page.tsx:~2198`) routes no-check-items lines through this
  destructive path.
- `completeCheckAndDeprep` (`check-records.ts:514`) only resets the **line**
  `prepStatus`, not the **unit** `prepStatus` — so a later `syncLineItemRollup`
  can promote the line back to PACKED (Codex finding). Unstable.

**Required:** the Returned → Depreped forward transition must use a
unit-preserving deprep that resets unit `prepStatus` to PENDING **without
deleting RETURNED units**, and keeps the rollup consistent. `deprepItem`'s
unit-deletion is reserved strictly for the *backward* "packed by mistake" undo on
the **Prepped** stage (where units are PACKED, never RETURNED, so deletion is
safe). This split + a precondition guard is mandatory, with regression tests.

**Close-Out stays a separate tab** (per user decision): Depreped is the per-item
put-away landing stage; Close-Out is the project-level finalize action.

## Two views, one model: Tabs **and** a Kanban board toggle (per user decision)

The user wants the option to switch between a **tabbed** view (default, current
paradigm) and an **always-visible Kanban board** (all stages as horizontal
columns, gear flowing left→right). Both views render the **same stage-filter
model** — the filter predicates below are the single source of truth; tabs and
board are two presentations over them.

- A view toggle (Tabs ⇆ Board) on the warehouse board header. Persist the choice
  (per-user localStorage or org/user pref — TBD in Eng review).
- **Board view** lays the stages out as columns with the same per-stage content
  (scan, container grouping, kit/grandchild expansion, accessory rows, selection
  bars). Mobile board view collapses to a horizontal scroll or falls back to
  tabs (decide in Design review).
- The stage-filter predicates must be **extracted into shared, tested helpers**
  so tabs and board can't drift. This is the load-bearing refactor.

> **Review flagged a USER CHALLENGE on the board (decided at the gate).** All
> three independent voices (Claude design, Claude eng, Codex) recommend **cutting
> the Kanban board from v1** and shipping the corrected linear tabs first, then
> adding the board as a scoped fast-follow. Reasons: the three tab components
> (`pick-prep-tab` 387 lines, `deploy-tab` 433, `return-tab` 450) are bespoke,
> not shared — a board is a **5× component rebuild**, not a re-skin; there are no
> Prepped/Depreped components today; five simultaneous scan inputs is a
> barcode-focus hazard; and mobile (where operators live) can't show a 5-7 column
> board. The user explicitly asked for **both** tabs and a board toggle — so this
> is the user's call, not auto-decided. If the board ships in v1 it should be a
> **reduced-content overview** (compact cards + counts, click a card → opens that
> stage's tab for deep work), NOT a full clone, and **mobile falls back to tabs**.

## Scope (SELECTIVE EXPANSION — shared stage model, two presentations)

1. **Add a distinct "Returned" stage.** New tab/column showing `status =
   RETURNED` items that are still in staging. This is the headline fix: returned
   gear gets its own visible home instead of masquerading as un-deployed.

2. **Stop the RETURNED → Pick/Prep leak.** Remove `page.tsx:1326`
   (`if (item.status === "RETURNED") return true;`) and the equivalent kit/
   grandchild branches so returned items never reappear in Pick/Prep.

3. **Reframe deprep as forward.** Move the deprep action out of the Deploy tab
   and onto the Returned stage as the "Deprep" forward transition into Depreped.
   (Keep a deprep/undo affordance on Prepped for the genuine "I packed this by
   mistake" case — that is a real backward action and stays as an explicit
   secondary control, not the primary flow.)

4. **Relabel + reorder tabs** to read left-to-right as the 5 named stages. Tab
   counts reflect each stage. The existing per-tab machinery (scan input,
   container grouping, kit/prep-kit expansion, selection bars, accessory child
   rows) is preserved per stage.

5. **Keep Bulk Check-In and Close-Out** as their own tabs (Close-Out separate per
   user decision; Bulk Check-In additive parallel view, unchanged).

6. **Extract shared stage-filter helpers** (`warehouseStage(item)` →
   `PICK_PREP | PREPPED | DEPLOYED | RETURNED | DEPREPED`) used by both tabs and
   the new board, kit/grandchild-aware, unit-tested. Single source of truth.

7. **Add a Tabs ⇆ Board view toggle** with persisted preference; board view
   renders the same stages as columns.

### Explicitly NOT in scope (deferred)
- Renaming internal enums/functions (`checkOut`/`checkIn`/`CHECKED_OUT`). UI
  terminology only, per existing convention (FEATUREDOCS/12 "UI Terminology").
- Changing the warehouse *list* page status chips
  (`warehouse/page.tsx:50-64`) beyond what's needed for label consistency.

## Key engineering risks (from code review)

- **Filter correctness across 4 layers.** Stage membership is computed in
  several places that must stay in sync: `pickPrepItems`, `preppedItems`,
  `checkedOutItems` (page.tsx:1305-1370), plus `groupItems` / `groupCheckinItems`
  grouping. Each has a **kit-parent branch and a nested-grandchild branch.** A new
  "Returned" filter and the removal of the RETURNED leak must be applied to all
  layers including grandchildren, or kits will appear in the wrong stage.
- **PDF cross-cutting audit.** Per CLAUDE.md, the `DocumentLineItem` shape has 5
  independent consumers. This change is *UI-tab* only and should not touch the
  PDF pipeline — but the Delivery Docket / Return Sheet / Pull Slip filter on
  `CHECKED_OUT`/`RETURNED`, so any status-derivation change must be verified
  against them.
- **Counts / rollup.** Tab counts derive from the same filters; the
  `packedQuantity` / `checkedOutQuantity` / `returnedQuantity` rollup counters
  (`syncLineItemRollup`) and the warehouse list page / TV dashboard prep-progress
  must still read correctly. Partial returns (a line with K of N units back) span
  Deployed and Returned simultaneously and must show in both.
- **Convex mirror.** Per project memory, warehouse counts and line-item trees
  read off the Convex mirror in places; verify stage filters that run client-side
  on `lineItems` still get the fields they need.

## Test plan (outline)
- Unit: stage-filter predicates for each of the 5 stages, including kit-parent
  and grandchild branches, partial-return split lines, and bulk items.
- Integration: full lifecycle of one serialized line and one kit through all 5
  stages; assert it appears in exactly one primary stage at each step (except
  partial return).
- Regression: returned item never appears in Pick/Prep; deprep moves Returned →
  Depreped; early return shows in Returned, not Pick/Prep.

---

# /autoplan Review Report

UI scope: yes (Design ran). DX scope: no (no developer-facing API/CLI — skipped).
Dual voices: Codex + Claude subagent, both ran for Design and Eng. CEO premise
gate confirmed with user (approach: tabs **and** board toggle; Close-Out separate).

## Eng dual-voices — consensus

| Dimension                         | Claude | Codex | Consensus |
|-----------------------------------|--------|-------|-----------|
| 1. Single-enum stage helper sound? | NO     | NO    | DISAGREE w/ plan → unit-aware membership set (CONFIRMED fix) |
| 2. Returned filter correct?        | NO     | NO    | CONFIRMED: must be quantity-aware + `prepStatus!==PENDING` |
| 3. Deprep-as-forward safe?         | NO (C1)| NO    | CONFIRMED CRITICAL: `deprepItem` deletes returned units |
| 4. Leak removal sufficient?        | NO     | NO    | CONFIRMED: orphans flagged/partial items |
| 5. Board = "two presentations"?    | NO     | NO    | CONFIRMED: 5× rebuild, recommend cut to fast-follow |
| 6. Counts correct as items.length? | NO     | NO    | CONFIRMED: must be unit/quantity counts |

## Design dual-voices — consensus

| Dimension                          | Claude | Consensus (Codex covered UX inline) |
|------------------------------------|--------|-------------------------------------|
| Returned visually distinct?        | NO     | CONFIRMED: needs color/icon token, not position alone |
| Partial-return (K-of-N) designed?  | NO     | CONFIRMED CRITICAL: split line shows in 2 stages, undesigned |
| Empty/loading/zero states?         | NO     | CONFIRMED: pipeline has many empty stages by default |
| Tabs+Board justified per-view JTBD?| NO     | CONFIRMED: board = lean overview or cut |
| Naming clear to operators?         | NO     | CONFIRMED: "Depreped" not a word; "Prepped"~"Pick/Prep" |
| Primary transition affordance?     | unspec | CONFIRMED: scan is ground truth, not drag-drop |

## Critical findings folded into the plan above (correctness, not taste)
- C1 deprep-deletes-returned-units → unit-preserving forward deprep + guard + tests.
- C2 Returned/Depreped filters → quantity-aware; `prepStatus !== PENDING` for Returned.
- H1 stage helper → `stagesFor(item): Set<Stage>` with quantities, unit-aware.
- Counts → unit/quantity-based, document intentional partial-line multi-membership.

## Additional findings (fold in during implementation)
- **Grouping is 2 more sync points**: `groupItems`/`groupCheckinItems`
  (`page.tsx:144-263`) re-derive child membership — must consume a child-level
  `stagesFor(child)` predicate; new Prepped/Depreped grouping fns needed.
- **`?tab=` deep-link contract**: keep stable internal tab `value` keys (or
  redirect old→new); only labels change. Grep `?tab=`/`tab=check` incl. email/
  notification senders before renaming.
- **Bulk + sub-hire + split-qty=1 + exhausted-original (qty<=0)** edge kinds: the
  helper must replicate the `equipmentItems` pre-filter (`page.tsx:1294-1302`) or
  keep it as the upstream gate.
- **PDF watch item**: change is UI-only UNLESS the C1 deprep fix alters when a
  line stays `status=RETURNED`; if so, verify all 5 `DocumentLineItem` consumers
  (Delivery Docket / Return Sheet / Pull Slip filter on RETURNED/CHECKED_OUT).
- **Mobile**: board falls back to tabs (decided). No mobile horizontal-scroll board.
- **Naming (taste, at gate)**: consider "Packed" (matches `prepStatus=PACKED`) and
  "Put Away"/"Stowed" for "Depreped"; differentiate "Pick/Prep" vs the staged stage.

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO | Premise: presentation change, not data-model | Gate | P1 | Code proves 5-stage sequence already exists; leak at :1326 is the real bug |
| 2 | CEO | Approach: tabs + board toggle, Close-Out separate | Gate→User | — | User chose both views + separate Close-Out |
| 3 | Eng | stagesFor → Set+quantities, unit-aware | Mechanical | P1,P5 | All 3 voices: single enum can't express partial/kit multi-stage |
| 4 | Eng | Forward deprep must preserve RETURNED units | Mechanical | P1 | `deprepItem` deletes them → reintroduces the bug (C1) |
| 5 | Eng | Returned = `returnedQty>0 && prepStatus!==PENDING` | Mechanical | P1 | Avoids orphaning flagged/partial returns (C2) |
| 6 | Eng | Counts = unit/quantity, not items.length | Mechanical | P1 | Matches rollup; partial lines legitimately span 2 stages |
| 7 | Eng | Preserve `?tab=` value keys on relabel | Mechanical | P5 | Deep links/emails depend on them |
| 8 | Design | Mobile board → fall back to tabs | Mechanical | P5 | 5-7 col scroll unusable on handheld |
| 9 | Eng/Design | Board v1 vs fast-follow | **User Challenge** | — | Both models recommend cut; user asked for both → gate |
| 10 | Design | Stage naming (Packed/Put-Away) | Taste | P5 | Operator-language clarity; user's call |
| 11 | Design | Board = reduced overview vs full clone | Taste | P3,P5 | If board ships, lean cards beat narrow-column clones |
