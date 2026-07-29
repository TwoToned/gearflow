# Project Lifecycle Locks, Unlock Sessions & Snapshots

Tracking issue #957, three coordinated sub-issues: #791 (finance soft-lock), #793
(ON_SITE justification gate), #792 (COMPLETED hard-lock + versioning). One
coherent model — a shared status-tier definition, an unlock-session mechanism,
a snapshot mechanism, and justification-in-audit plumbing — not three
independent features.

**#988** (Phase C of #985's finance version-control program) extends the same
model with a second tier input — a sent quote can lock pricing on an
otherwise-OPEN project — and closes every previously-deferred gate site. See
"The quote-send lock is a second INPUT, not a second lock" below.

## Lock-tier model (single source of truth)

`convex/lib/projectLocks.ts` exports `lockTierForStatus()` — the ONE place the
status → tier boundary is defined. Every gate site across
`projectWrites.ts`/`lineItemWrites.ts`/`projectGroupsWrites.ts`/
`projectCategoriesWrites.ts`/`projectServicesWrites.ts`/`crewAssignmentsWrites.ts`
imports it (directly or via `assertLifecycleGuard`) rather than re-deriving the
boundary — a second hand-maintained copy would be a defect even in sync
(POLICY.md R-3.1).

| Statuses | Tier | What's gated |
|---|---|---|
| `ENQUIRY` / `QUOTING` / `QUOTED` | **OPEN** | Nothing (unless a quote has been sent — see below) |
| `CONFIRMED` / `PREPPING` / `CHECKED_OUT` | **FINANCE_LOCKED** | Financial fields locked behind a finance unlock session; new items/groups/services default to $0 |
| `ON_SITE` / `RETURNED` | **FINANCE_LOCKED + JUSTIFY** | Above, plus structural mutations require per-edit confirm + written justification |
| `COMPLETED` / `INVOICED` | **HARD_LOCKED** | All structural + financial mutations blocked; full unlock session restricted to org admins/owners + the project's assigned PM(s) |
| `CANCELLED` | OPEN | Ungated (open question — see below) |

### The quote-send lock is a second INPUT, not a second lock (#988, Phase C)

#985's finance version-control program adds one more input to the SAME
resolver rather than a second lock mechanism (that would be an R-3.1 defect on
the most safety-critical code in the app): `convex/lib/projectLocks.ts` exports
`resolveLockTier({ status, quoteState })`, and `lockTierForStatus(status)` is
now the STATUS-only half of it.

| Status tier | Current revision's quote state | Effective tier | Reason |
|---|---|---|---|
| OPEN (`ENQUIRY`/`QUOTING`/`QUOTED`) | none, or `DRAFT` | **OPEN** | `STATUS` |
| OPEN | `SENT` / `ACCEPTED` / `DECLINED` / `SUPERSEDED` / `EXPIRED` | **FINANCE_LOCKED** | `QUOTE_SENT` |
| FINANCE_LOCKED / JUSTIFY / HARD_LOCKED (CONFIRMED+) | any | unchanged | `STATUS` |

"Current revision's quote state" is the quote row at `projects.revision`
(`quoteState.ts#currentRevisionQuoteStatus`) — NOT any historical row. That's
what makes "cutting a new version is the unlock" (#985 decision 2) true:
`newVersionNative` bumps `projects.revision` and inserts a fresh `DRAFT` at the
new number, so the CURRENT revision reads `DRAFT` again even though the
previous one is still sitting there `SENT` (soon to flip to `SUPERSEDED` when
the new one actually sends). Every state other than none/`DRAFT` escalates
identically — `DECLINED`/`SUPERSEDED`/`EXPIRED` included — because decision 2
makes `newVersionNative` the ONLY sanctioned way off any of them; there's no
"quietly keep editing the same revision" path once it's gone out.

Properties that make this safe (see the full truth table in
`convex/lib/projectLocks.test.ts`):
- **Monotonic.** Quote state can only ever raise OPEN to FINANCE_LOCKED, never
  touch (let alone lower) a tier that's already FINANCE_LOCKED/JUSTIFY/
  HARD_LOCKED from status alone. A sent quote on a COMPLETED project softens
  nothing.
- **One function, zero new gate sites.** All ~25 existing call sites still
  call `assertLifecycleGuard(ctx, project, opts)` completely unchanged —
  `assertLifecycleGuard` looks up the current revision's quote state itself
  (only when the status tier is itself OPEN — any higher tier already
  dominates, so this adds no extra read to the CONFIRMED+/ON_SITE+/COMPLETED+
  paths that make up most gated writes).
- **`LockTier` values are unchanged** — `FINANCIALS_LOCKED`/`PROJECT_LOCKED`
  codes and their `native-writes.ts` toast mappings still apply untouched.
  `defaultToZero` is likewise unchanged: a quote-sent OPEN-status project
  defaults new adds to $0 exactly like a CONFIRMED one.
- **`reason: "STATUS" | "QUOTE_SENT"`** is new on `LifecycleGuardResult` and on
  `projectLocksRead.status`'s return (alongside `revision` and `quoteState`),
  so the UI can say _why_ pricing is locked and offer the right exit ("Create
  quote v(N+1)" / "Recall quote" vs. the existing unlock-session flow) instead
  of a bare "locked" — Phase E (#990) renders that from this one query.

**The sanctioned-exit exception.** `quotesWrites.ts`'s `sendNative` and
`newVersionNative` are the two mutations that raise/cut the quote-derived
lock, so they'd otherwise deadlock against their own not-yet-superseded state
(`newVersionNative` runs while the current revision is STILL the live `SENT`
quote it's about to move past). Both pass `bypassQuoteLock: true` to
`assertLifecycleGuard`, resolving the tier from STATUS alone — the one
deliberate opt-out `LifecycleGuardOptions` exposes, and the only two call
sites that should ever set it.

## The shared guard: `assertLifecycleGuard`

One function every gate site calls, encoding the full precedence table:

```ts
const guard = await assertLifecycleGuard(ctx, project, {
  kind: "financial" | "structural",
  justification, // only checked when kind is "structural" and the tier requires it
});
```

- **OPEN** — always passes.
- **HARD_LOCKED** — requires an open `FULL` session, full stop. No per-edit path,
  regardless of `kind`.
- **FINANCE_LOCKED financial write** — requires an open session (either scope).
- **FINANCE_LOCKED structural write** — passes ungated (the structural gate
  starts at ON_SITE, not CONFIRMED).
- **JUSTIFY financial write** — requires an open session (finance lock spans
  through ON_SITE+) — never ALSO prompted by the structural dialog.
- **JUSTIFY structural write** — an open session suppresses the prompt (no
  double-prompt); otherwise requires a bounded justification (10–1000 chars,
  `convex/lib/fieldGuards.ts`).

Callers pick `kind` by asking "does THIS specific write touch a locked money
field?" — e.g. `lineItemWrites.ts`'s `patchNative` computes
`touchesMoney = LOCKED_LINE_ITEM_FIELDS.some(f => f in setObj || clear.includes(f))`
and calls the guard with `kind: touchesMoney ? "financial" : "structural"`, so a
single edit that touches both routes through the financial path only (no
double-prompt).

The guard also returns `defaultToZero` — true once the tier is locked and no
session is open — which every add-mutation uses to zero the new entity's price
fields server-side (never trusting the client to skip its own autofill).

## Locked financial fields (authoritative list — `convex/lib/projectLocks.ts`)

| Entity | Fields |
|---|---|
| Project | `taxRate`, `discountPercent` (#940 WS1: `depositPercent` moved to the client payment profile; `depositPaid`/`invoicedTotal` moved to recalc-owned/derived — none of the three are on this locked-input list anymore, see FEATUREDOCS/10 and FEATUREDOCS/66) |
| Group | `price`, `discount`, `rentalPeriod`, `rentalQuantity` |
| Line item | `unitPrice`, `discount`, `duration` |
| Service | `costTotal` (manual, crew-less only — a crew-attached service's cost keeps auto-deriving from the crew rate table, issue #796), `billableToClient` |
| Crew assignment | `rateOverride` / `rateType` / `estimatedHours` |

`recalcProjectTotals` and `recalcServiceCostFromCrew` are never gated — they only
ever READ these fields to compute derived totals, never set them.

## Unlock sessions (`convex/projectUnlockSessionsWrites.ts`)

`projectUnlockSessions`: `{ id, organizationId, projectId, scope: FINANCIAL | FULL,
justification, openedBy, openedAt, snapshotId, outcome: OPEN | COMMITTED | DISCARDED }`.
At most one **OPEN** row per project (enforced in `openNative`).

- **`openNative`** — requires `project:update` (FINANCIAL) or
  `isHardLockOverrideAllowed` (FULL — org admin/owner OR in the project's
  `projectManagers` set, `convex/lib/projectLocks.ts`). Captures a snapshot
  (reason `UNLOCK`, the discard target), inserts the session row, writes an
  audit entry with the justification in `metadata`.
- **`commitNative`** ("Save & relock") — `outcome: COMMITTED`. Whatever changed
  during the session stays.
- **`discardNative`** — restores from the open snapshot via
  `restoreProjectSnapshot` (`convex/lib/projectSnapshots.ts`), scoped to the
  session's `scope`:
  - **FINANCIAL discard** — money fields only. Structural changes made during
    the session (items added/removed) are NOT rolled back; an item added
    during the session survives but its price fields revert to $0/unset.
  - **FULL discard** — structure + financials: patches changed entities,
    recreates removed ones, removes added ones — EXCEPT anything referencing
    live warehouse state (`assetId`/`bulkAssetId`/`kitId`), which is left as a
    conflict for manual review rather than forced (`isWarehouseBacked` in
    `projectSnapshots.ts`). Asset/kit status fields are never rewritten by
    either scope (warehouse state is real-world truth).
- **`autoCommitOpenSession`** — called from `updateStatusNative` on every
  actual status change: a session never silently spans a status transition.

While a session is open, `getOpenUnlockSession` short-circuits every gate site
for that project — every financial write's audit row is tagged
`metadata.unlockSessionId`.

## Snapshots (`projectSnapshots` + `projectSnapshotEntries`)

Parent row + per-entity rows, NOT a single JSON blob (Convex's ~1MB doc limit
on large projects, plus per-entity rows make diffing a queryable join instead
of a client-side JSON walk). Captured by `captureProjectSnapshot`
(`convex/lib/projectSnapshots.ts`):

- **`reason: "CONFIRMED" | "COMPLETED"`** — inside `updateStatusNative`'s
  transaction, on every crossing that LANDS on CONFIRMED or COMPLETED (forward
  advance OR a revert-then-re-advance "re-crossing" — each takes a NEW
  snapshot, versioned, never overwritten).
- **`reason: "UNLOCK"`** — at every unlock-session open (the discard target).

Entities captured: project (incl. computed totals), categories, groups, line
items, services, crew assignments — the full project subtree, stripped of
`_id`/`_creationTime`.

`collectCurrentEntries` (same file) reads the SAME shape read-only (no write) —
used by the Versions UI to diff a snapshot against "current" through the
identical code path as snapshot↔snapshot (`src/lib/project-snapshot-diff.ts`).

Every read is org-checked (R-8.4.3) — `projectSnapshotEntries.by_snapshotId` is
not itself org-scoped, so callers re-check the parent snapshot's
`organizationId` first (see `convex/projectLocksRead.ts`).

## Hard lock + revert restriction (#792)

At HARD_LOCKED, `assertLifecycleGuard` rejects everything (`PROJECT_LOCKED`)
without an open FULL session — this is the same guard call every gate site
already makes, so hard-lock coverage falls out of the shared mechanism rather
than being a separate check.

**Reverting a project OUT of HARD_LOCKED** (COMPLETED/INVOICED → anything
earlier) is a trivial bypass of the hard lock unless gated the same as opening
a FULL session — `updateStatusNative` calls `requireHardLockOverrideAllowed` +
requires a bounded `justification` arg whenever `isRevertOutOfHardLock(from, to)`.
`COMPLETED → INVOICED` stays HARD_LOCKED on both ends and is NOT a revert (a
normal forward move, ungated). Re-completing captures a fresh snapshot (any
crossing back into CONFIRMED/COMPLETED always snapshots).

## Versions / diff UI

- **`convex/projectLocksRead.ts`** — `status` (tier + open session, for the
  banner/lock icons), `listSnapshots`, `snapshotEntries`, `currentEntries`.
- **`src/components/projects/project-versions-panel.tsx`** — version list →
  read-only "as of" summary (financial totals) → diff (added/removed/changed
  rows with before/after price), mounted from the project detail page's ⋯ menu
  ("Versions") and the Financials tab. Renders through simplified read-only
  rows, not the live editable equipment tab.
- **`src/lib/project-snapshot-diff.ts`** — pure diff logic (`diffSnapshotEntries`,
  `projectTotalsFromEntry`), framework-free and unit-tested independent of the
  panel.

## Client wiring

- **`src/hooks/use-project-lock.ts`** — `useProjectLockStatus` (reactive tier +
  session), `useUnlockSession` (open/commit/discard).
- **`src/components/projects/unlock-session-dialog.tsx`** /
  **`unlock-session-banner.tsx`** — the open action + the persistent
  "unlocked by X — 'reason'" banner with Save & relock / Discard.
- **`src/hooks/use-justified-mutation.ts`** + **`justification-dialog.tsx`** —
  the shared #793 wrapper: pre-checks the project's tier and prompts for a
  justification BEFORE invoking a gated mutation, and also catches the
  server's `JUSTIFICATION_REQUIRED` as a fallback (the project may have
  advanced underneath a stale client). One shared hook + dialog so every
  gated surface prompts identically — not a per-form one-off.
- **`src/components/projects/unpriced-badge.tsx`** — the amber "Unpriced"
  badge for a $0-defaulted add. Mounted on Equipment tab rows (#990). Reads
  `group.pricedUnderLock` / `item.pricedUnderLock` — a stored field, not an
  inference from "currently locked" (see below).
- **`src/lib/lock-copy.ts`**, **`project-lock-chip.tsx`**,
  **`project-lock-strip.tsx`**, **`project-lock-glyph.tsx`**,
  **`src/components/ui/locked-field.tsx`**, **`gated-button.tsx`** — the six
  lock-legibility surfaces (#990, Phase E) — see below.
- **`src/lib/native-writes.ts`** — `FINANCIALS_LOCKED` / `JUSTIFICATION_REQUIRED`
  / `PROJECT_LOCKED` / `SESSION_ALREADY_OPEN` / `NO_OPEN_SESSION` /
  `FORBIDDEN_HARD_LOCK_OVERRIDE` mapped to `UserFacingError` toasts.

## Making the lock legible (#990, Phase E)

#791/#793 shipped one FINANCIALS_LOCKED/JUSTIFICATION_REQUIRED toast; #988
(Phase C) closed every deferred gate site so the toast was never lying. #990
is the client half: a lock has to be visible *before* you try, explain
itself, and offer the exit — not a surprise after a failed save. Six
surfaces, one shared source per surface (POLICY.md R-3.1):

1. **`src/lib/lock-copy.ts`** — the ONE copy module (`resolveLockCopy`,
   `formatLockElapsed`, `scrollToLockStrip`). Every surface below renders a
   `LockCopy` from this, so the header chip, the strip, a `<LockedField>`
   tooltip and a `<GatedButton>` tooltip can never say something different
   about the same state. Formula: `[state] — [consequence]. [the exit].`
2. **`src/components/projects/project-lock-chip.tsx`** — the always-mounted
   header chip beside the project status (`page.tsx`'s identity row). Null
   for OPEN with no session — absence already reads as "editing normally".
3. **`src/components/projects/project-lock-strip.tsx`** — the shared strip,
   mounted ONCE at `id="lock-strip"` above the tabs (not inside Finance),
   replacing Phase D's Finance-tab-only `QuoteLockStrip`. Renders
   `<UnlockSessionBanner>` while a session is open; otherwise the
   `resolveLockCopy` line plus the exit that matches `reason` — "Create
   quote v(N+1)" + "Recall" for `QUOTE_SENT` (reusing `project-quote-rail.tsx`'s
   exported `<ReasonDialog>` rather than a second recall dialog), or the
   existing unlock-session flow for `STATUS`.
4. **`src/components/ui/locked-field.tsx`** — the field-level wrapper. Uses a
   native `<fieldset disabled>` around the child rather than cloning
   `disabled`/`readOnly` onto it: a fieldset cascades to every descendant
   form control (works for a single `<Input>` or a composite block — a
   checkbox + a select + an input), and every registry control's own
   `disabled:` Tailwind classes apply automatically since they read real
   `:disabled` state. Wired into `price-edit-dialog.tsx`,
   `edit-line-item-dialog.tsx`, `edit-group-dialog.tsx`,
   `add-service-dialog.tsx`, `services-panel.tsx`'s real add/edit-service
   form (charge/discount/cost — the fields `updateServiceNative`'s
   `moneyChanged` check actually gates), `bulk-edit-line-items-dialog.tsx`,
   `crew-panel.tsx`'s rate/rateType/estimatedHours, and the project edit
   form's discount field (`project-wizard.tsx`; `taxRate` is likewise
   locked but has no UI field to wrap — org-default only). Sub-hire group
   pricing (`price-edit-dialog.tsx`'s other mode) is deliberately NOT
   wrapped — `subHiresWrites.ts#updateGroup` never calls
   `assertLifecycleGuard`, so locking it in the UI would be a lie the
   server doesn't back up (§7.3 "server parity, non-negotiable").
5. **`src/components/ui/gated-button.tsx`** — the action-level wrapper:
   `aria-disabled` (never `disabled`, which kills the tooltip) + its own
   `TooltipProvider` + a no-op handler, keyboard-focusable. Applied to the
   Equipment tab's and Services panel's primary "Add ▾" triggers at
   HARD_LOCKED — every path out of either menu is server-rejected at that
   tier with no per-edit escape, so the menu itself is gated instead of
   opening onto three dead ends.
6. **`src/components/projects/project-lock-glyph.tsx`** — the list/board/
   dashboard glyph (`project-table.tsx`, `project-board.tsx`,
   `dashboard/page.tsx`'s Upcoming list). Derived from `status` alone via
   the SAME `lockTierForStatus` the server resolves from — no second row
   query. Deliberately status-only: it does NOT detect the `QUOTE_SENT`
   case (an OPEN-status project with a sent quote), because that needs each
   row's current-revision quote state, which `projects.listPage`/
   `listBoard` don't carry and a per-row lookup would reintroduce the
   per-project-loop cost #942 flagged. A coverage gap, not a wrong answer —
   the header chip and lock strip both resolve it correctly once opened.

**Justify tier (surface 5 of the issue) — partially wired.** `remove`/
`bulkDelete` now forward `justification` end-to-end and are routed through
`useJustifiedMutation` for line items (single + bulk), groups (single),
services (single + bulk), and crew assignments (single + bulk) — the
highest-risk, most common ON_SITE+ structural edits. `add`/`update`/status
call sites are NOT yet threaded (they either don't touch a JUSTIFY-gated
field or the justification arg still needs plumbing through each write hook
+ dialog). Tracked as follow-up, not silently dropped (mirrors the #790 PR's
"deliberately deferred" convention). One known limitation: `useJustifiedMutation`'s
"catch the server's `JUSTIFICATION_REQUIRED` as a fallback" path only fires
if the raw `ConvexError` reaches it — the write hooks all pipe errors through
`mapNativeWriteError` first, which converts it to a `UserFacingError` (a
different class) before it gets there. The PRE-check (`tier === "JUSTIFY" &&
!hasOpenSession`, evaluated before the mutation ever fires) is what carries
the real UX; the fallback is a defensive backstop for a stale client racing
a status change mid-session, and doesn't currently trigger through this
integration.

**`UnpricedBadge`** is now mounted on the Equipment tab's `GroupRow`/
`LineItemRow` (`equipment-rows.tsx`) — kit children excluded, not
independently priced. Not yet mounted on Services/Crew rows.

**`pricedUnderLock` (bug fix, follow-up to #990).** The badge originally
rendered on `moneyLocked && price === 0` — i.e. it INFERRED "this was
`defaultToZero`'d" from "the project happens to be locked right now AND this
row happens to be $0", with no memory of when or why the row became $0. That
false-positives hard: a row that's been $0 since long before any lock ever
existed (no catalog `dailyRate`/`weeklyRate` configured, a sub-hire kit
pending supplier confirmation, or any other legitimately-unpriced reason)
starts showing "Added after the quote was confirmed — price it deliberately"
the moment the project LATER becomes locked, which is simply false for that
row.

Fixed by storing the actual cause instead of inferring it:
`projectLineItems.pricedUnderLock` / `projectGroups.pricedUnderLock`
(`convex/schema.ts`, both `v.optional(v.boolean())`) are set `true` at the
exact moment `assertLifecycleGuard`'s `defaultToZero` forces a row's price to
$0/unset — every insert path (`addNative`, `addCustomNative`,
`addLineItemSmartNative`, `addKitNative` → `createKitLineItemCore`,
`projectGroupsWrites.createNative`) via the shared
`pricedUnderLockOnInsert(defaultToZero)` helper
(`convex/lib/projectLocks.ts`), and the FINANCIAL-scope
`restoreProjectSnapshot`'s "added during the session, not in the snapshot →
reset to $0" branch (`convex/lib/projectSnapshots.ts`) — the same
not-deliberately-priced state by construction. It's cleared back to `false`
the moment a human deliberately sets a real price: `patchNative`'s `unitPrice`
edit, `updateGroupPriceNative` (always — reaching it means the FINANCIAL
guard already passed), a line-item merge that keeps a real client-supplied
price, and a FINANCIAL-scope snapshot restore that lands a real historical
price from the snapshot. `pricedUnderLock` is listed in
`LINE_IMMUTABLE_ON_PATCH` — server-derived only, never client-settable.

The badge condition is now simply `item.pricedUnderLock` / `group.pricedUnderLock`
— no `moneyLocked` check needed (a `defaultToZero`'d row stays flagged for
review even after the project is later unlocked, until someone actually prices
it). This also let `moneyLocked` be dropped entirely from `GroupRow`'s and
`LineItemRow`'s props — it had no other reader.

**Unlock session diff (§7.2).** `projectLocksRead.status`'s `openSession` now
carries `snapshotId`; `unlock-session-banner.tsx`'s Save & relock and Discard
both open a confirm step first, rendering `<SnapshotDiffSummary>` (factored
out of `project-versions-panel.tsx` — one diff renderer for both, POLICY.md
R-3.1) against that session's UNLOCK snapshot before committing.

## Server enforcement (R-9.3 / R-8.4.2)

Every gate site is a browser-callable native mutation — hiding a locked field
in the UI is not enough, since a browser-direct caller bypasses the client
Zod entirely (FEATUREDOCS/54's "write security bar"). All server-side
rejections use `ConvexError({ code })` with a stable code the client branches
on: `FINANCIALS_LOCKED`, `JUSTIFICATION_REQUIRED`, `PROJECT_LOCKED`,
`SESSION_ALREADY_OPEN`, `NO_OPEN_SESSION`, `FORBIDDEN_HARD_LOCK_OVERRIDE`.

## Gate site coverage

Gated: `projectWrites.ts` (`updateNative`, `updateStatusNative`, `deleteNative`'s
snapshot/session cascade), `lineItemWrites.ts` (`addNative`, `addCustomNative`,
`addKitNative`, `addLineItemSmartNative`, `patchNative`, `patchManyNative`,
`removeNative`, `removeManyNative`, `reorderNative`), `projectGroupsWrites.ts`
(`createGroupNative`, `updateGroupNative`, `updateGroupPriceNative`,
`deleteGroupNative`, `moveLineItemNative`, `moveLineItemsNative`),
`projectCategoriesWrites.ts` (`createCategoryNative`, `updateCategoryNative`,
`deleteCategoryNative`), `projectServicesWrites.ts` (`createServiceNative`,
`updateServiceNative`, `deleteServiceNative`, `bulkDeleteServicesNative`,
`bulkUpdateServiceStatusNative`, `generateServicesNative`,
`cloneServicesNative`, `convertLineItemToServiceNative`),
`crewAssignmentsWrites.ts` (`createNative`, `updateNative`, `deleteNative`,
`bulkDeleteNative`, `bulkStatusNative`, `generateShiftsNative`).

That closes every site #791/#793's acceptance criteria asked for ("every gate
site") — the bulk/generate/clone/reorder variants below were the deferred set;
#988 (Phase C) gates each with `kind: "structural"` (the same family a single
create/update/delete already uses), a per-distinct-project dedup for the ones
that can span more than one project (mirroring `patchManyNative`/
`removeManyNative`'s existing dedup pattern), and `defaultToZero` applied to
every new/copied money field exactly like a manually-added entity:
`bulkDeleteServicesNative`, `bulkUpdateServiceStatusNative`,
`generateServicesNative`, `cloneServicesNative` (gated on the TARGET project —
the source isn't written to), `convertLineItemToServiceNative`,
`lineItemWrites.reorderNative`, `crewAssignmentsWrites.bulkDeleteNative`,
`bulkStatusNative`, `generateShiftsNative`. Each has a "rejects on an ON_SITE
project without justification, succeeds with one" test.

## Open questions (from #957, unresolved)

- **CANCELLED**: cancelling a FINANCE_LOCKED/HARD_LOCKED project is currently
  ungated (status transitions are excluded from the #793 structural gate).
  Leaning yes-but-later on requiring justification for cancellation from
  CONFIRMED+.
- **Snapshot size at scale**: validate the per-entity-row approach against the
  largest real projects before this is exercised in anger — no test here
  proves it against a 1000+ line-item project.
