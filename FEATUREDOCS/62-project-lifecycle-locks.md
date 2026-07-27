# Project Lifecycle Locks, Unlock Sessions & Snapshots

Tracking issue #957, three coordinated sub-issues: #791 (finance soft-lock), #793
(ON_SITE justification gate), #792 (COMPLETED hard-lock + versioning). One
coherent model — a shared status-tier definition, an unlock-session mechanism,
a snapshot mechanism, and justification-in-audit plumbing — not three
independent features.

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
| `ENQUIRY` / `QUOTING` / `QUOTED` | **OPEN** | Nothing |
| `CONFIRMED` / `PREPPING` / `CHECKED_OUT` | **FINANCE_LOCKED** | Financial fields locked behind a finance unlock session; new items/groups/services default to $0 |
| `ON_SITE` / `RETURNED` | **FINANCE_LOCKED + JUSTIFY** | Above, plus structural mutations require per-edit confirm + written justification |
| `COMPLETED` / `INVOICED` | **HARD_LOCKED** | All structural + financial mutations blocked; full unlock session restricted to org admins/owners + the project's assigned PM(s) |
| `CANCELLED` | OPEN | Ungated (open question — see below) |

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
`removeNative`, `removeManyNative`), `projectGroupsWrites.ts` (`createGroupNative`,
`updateGroupNative`, `updateGroupPriceNative`, `deleteGroupNative`,
`moveLineItemNative`, `moveLineItemsNative`), `projectCategoriesWrites.ts`
(`createCategoryNative`, `updateCategoryNative`, `deleteCategoryNative`),
`projectServicesWrites.ts` (`createServiceNative`, `updateServiceNative`,
`deleteServiceNative`), `crewAssignmentsWrites.ts` (`createNative`,
`updateNative`, `deleteNative`).

**Deliberately deferred, not silently dropped:** bulk/generate/clone variants —
`projectServicesWrites.ts`'s `bulkDeleteServicesNative` /
`bulkUpdateServiceStatusNative` / `generateServicesNative` /
`cloneServicesNative` / `convertLineItemToServiceNative`, `lineItemWrites.ts`'s
`reorderNative` (sortOrder-only, no audit today, mirrors `reorderGroupsNative`),
and `crewAssignmentsWrites.ts`'s `bulkDeleteNative` / `bulkStatusNative` /
`generateShiftsNative` are not yet gated. These are lower-blast-radius than the
primary create/update/delete paths above but should be closed in a follow-up
PR before this is considered complete coverage of the #791/#793 acceptance
criteria ("every gate site").

## Open questions (from #957, unresolved)

- **CANCELLED**: cancelling a FINANCE_LOCKED/HARD_LOCKED project is currently
  ungated (status transitions are excluded from the #793 structural gate).
  Leaning yes-but-later on requiring justification for cancellation from
  CONFIRMED+.
- **Snapshot size at scale**: validate the per-entity-row approach against the
  largest real projects before this is exercised in anger — no test here
  proves it against a 1000+ line-item project.
