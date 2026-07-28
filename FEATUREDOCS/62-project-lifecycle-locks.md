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
  badge for a $0-defaulted add.
- **`src/lib/native-writes.ts`** — `FINANCIALS_LOCKED` / `JUSTIFICATION_REQUIRED`
  / `PROJECT_LOCKED` / `SESSION_ALREADY_OPEN` / `NO_OPEN_SESSION` /
  `FORBIDDEN_HARD_LOCK_OVERRIDE` mapped to `UserFacingError` toasts.

**Wiring status:** the Financials tab's lock banner/button and the Versions
panel are fully wired into the project detail page. `useJustifiedMutation` +
`JustificationDialog` are built and smoke-tested but not yet threaded through
every individual equipment/group/service/crew form's call site — each of
those still needs its `justification` arg wired through the hook. Tracked as
follow-up, not silently dropped (mirrors the #790 PR's "deliberately deferred"
convention).

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
