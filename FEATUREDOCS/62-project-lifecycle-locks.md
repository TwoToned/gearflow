# Project Lifecycle Locks & Snapshots

**Superseded (#1230, Phase 4 of "Project versioning v2", parent #1221, merged
2026-09).** This doc originally described the #957 tracking-issue model: a
4-tier `LockTier` (`OPEN`/`FINANCE_LOCKED`/`JUSTIFY`/`HARD_LOCKED`) derived
from project status (+ #988's quote-sent escalation), an unlock-session
mechanism (`projectUnlockSessions`, open/commit/discard), and per-edit
freeform justification. **Phase 4 deleted the entire tier + unlock-session +
justification mechanism outright.** See FEATUREDOCS/78's Phase 4 section for
the full replacement story, decisions D42/D54-D57, and the deletion list.
This file is kept — rewritten, not removed — because the snapshot mechanism
(#792) it also documented is still live and still worth one place to read
about. Don't trust anything below about `LockTier`, `assertLifecycleGuard`,
`projectUnlockSessions`, or a `justification` argument — none of it exists
anymore. If you're looking for the CURRENT lock model, read
`convex/lib/projectLocks.ts`'s own header comment first; it's the single
source of truth and is kept current by policy (R-3.1).

## The current model, in one paragraph

`projects.pricingLocked` (+ `pricingLockedAt`/`pricingLockedById`/
`pricingLockedByName`) is a single boolean, applying to the project's LIVE
version only. It gates ONE thing: a direct edit to a money field
(`LOCKED_PROJECT_FIELDS`/`LOCKED_GROUP_FIELDS`/`LOCKED_LINE_ITEM_FIELDS`/
`LOCKED_SERVICE_FIELDS`/`LOCKED_CREW_FIELDS`, unchanged field lists) on the
live version, via the one guard, `assertPricingUnlocked`. Structure (add/
remove/reorder a line, group, category, service, crew assignment) is NEVER
gated by anything in this file — the old `JUSTIFY` tier and its ~32
`kind: "structural"` gate sites are gone; every structural mutation is
unconditionally ungated now. A non-live `projectVersions` row is writable in
every field family regardless of the flag. It's raised by `sendNative` (D55,
live-version quote sent), a manual `CONFIRMED` transition
(`updateStatusNative`), and — new as of the #1236 "money phase" merge —
defensively by `maybeAutoAdvanceProjectStatus`
(`convex/lib/projectAutoStatus.ts`) the moment a job first reaches
`AWAITING_PAYMENT`/`CONFIRMED` by any trigger, closing the gap where an
invoice-first job (no quote ever sent) or an accepted non-live quote could
otherwise reach the money phase with pricing still open. It's lowered only by
a person, via `projectPricingLockWrites.unlockPricingNative` (D42 audience:
`invoice:publish` or the project's own PM) or `recallNative` (D56, live
version's quote only) — never automatically, never on a status revert (D57).
See FEATUREDOCS/77 for the merge-time reasoning in full.

## Snapshots (`projectSnapshots` + `projectSnapshotEntries`) — unchanged by Phase 4

Parent row + per-entity rows, NOT a single JSON blob (Convex's ~1MB doc limit
on large projects, plus per-entity rows make diffing a queryable join instead
of a client-side JSON walk). Captured by `captureProjectSnapshot`
(`convex/lib/projectSnapshots.ts`). Live reasons, as of this merge:

- **`reason: "CONFIRMED" | "COMPLETED"`** — on every crossing that LANDS on
  CONFIRMED or COMPLETED (forward advance OR a revert-then-re-advance
  "re-crossing" — each takes a NEW snapshot, versioned, never overwritten).
  Taken identically by the manual path (`updateStatusNative`) and the
  automatic one (`maybeAutoAdvanceProjectStatus`'s `PAYMENT_SETTLED` rule,
  the one trigger allowed to reach CONFIRMED — FEATUREDOCS/76).
- **`reason: "QUOTE_SENT"`** — at every quote send (`quotesWrites.sendNative`),
  carrying the `revision` it freezes. See FEATUREDOCS/66.
- **`reason: "VERSION_SAVED"`** (#1085) — `quotesWrites.newVersionNative`
  capturing the outgoing live revision before moving past it. Also carries
  `revision`.

Two reasons in the schema union are **deprecated, read-only** — kept because
pre-Phase-4/pre-Phase-3 rows already carry them, never written from now on:
`"UNLOCK"` (the old unlock-session open-time capture, Phase 4 deleted its only
writer) and `"PRE_PROMOTE"` (the old `promoteRevisionNative`'s auto-capture,
Phase 3 of the SAME versioning program replaced that mutation with
`versions.makeLiveNative`, which never restores/overwrites so has nothing to
pre-capture).

Entities captured: project (incl. computed totals), categories, groups, line
items, services, crew assignments — the full project subtree, stripped of
`_id`/`_creationTime`.

`collectCurrentEntries` (same file) reads the SAME shape read-only (no write)
— used by the Versions UI to diff a snapshot against "current" through the
identical code path as snapshot↔snapshot (`src/lib/project-snapshot-diff.ts`).

Every read is org-checked (R-8.4.3) — `projectSnapshotEntries.by_snapshotId`
is not itself org-scoped, so callers re-check the parent snapshot's
`organizationId` first (see `convex/projectLocksRead.ts`).

There is no restore/revert-from-snapshot verb anymore — the old
`restoreProjectSnapshot`/`RestoreScope`/`RestoreArgs`/`RestoreResult`
machinery (the unlock session's `DISCARD` outcome, and `promoteRevisionNative`'s
`PROMOTE` scope) was dead code once both callers were gone, and was deleted
along with them. A snapshot today is read-only history + the diff view —
"going back" to a past version is `versions.makeLiveNative` (a pointer flip
onto a real `projectVersions` row, FEATUREDOCS/78), not a snapshot restore.

## Reads: `convex/projectLocksRead.ts`

`status` returns `{ pricingLocked, pricingLockedAt, pricingLockedByName,
canUnlockPricing }` for the caller — the header lock chip/glyph and the
Overview readiness checklist read this, never a stored tier. `listSnapshots`/
`snapshotEntries`/`currentEntries` are unchanged by Phase 4 (see Snapshots
above).

## Server enforcement (R-9.3 / R-8.4.2)

Every gate site is a browser-callable native mutation — hiding a locked field
in the UI is not enough, since a browser-direct caller bypasses the client
Zod entirely (FEATUREDOCS/54's "write security bar"). `assertPricingUnlocked`
throws `ConvexError({ code: "PRICING_LOCKED" })` — the ONE code left from the
old set (`FINANCIALS_LOCKED`/`JUSTIFICATION_REQUIRED`/`PROJECT_LOCKED`/
`SESSION_ALREADY_OPEN`/`NO_OPEN_SESSION`/`FORBIDDEN_HARD_LOCK_OVERRIDE` are
all gone with the mechanisms that threw them). `unlockPricingNative`'s own
audience check throws `FORBIDDEN_UNLOCK_PRICING`.

## Gate site coverage

Every write to a `LOCKED_*_FIELDS` field calls `assertPricingUnlocked` before
persisting: `projectWrites.updateNative`, `lineItemWrites.ts` (`addNative`,
`addCustomNative`, `addKitNative`, `addLineItemSmartNative`, `patchNative`,
`patchManyNative`), `projectGroupsWrites.updateGroupPriceNative`,
`projectServicesWrites.ts` (create/update paths that touch `costTotal`/
`billableToClient`), `crewAssignmentsWrites.ts` (create/update paths that
touch `rateOverride`/`rateType`/`estimatedHours`). New-row inserts on a
locked live version default the money fields to `$0`
(`defaultsToZeroOnInsert`/`pricedUnderLockOnInsert`) rather than being
rejected outright — the row still gets created, just unpriced, and
`afterLockAuditMetadata` stamps `{ afterLock: true }` on its audit row.
Structural mutations (create/update/delete a category, group, line item
shape, service, crew assignment; reorder; bulk/generate/clone variants) are
NEVER gated — no call to `assertPricingUnlocked`, no equivalent check at all.

## Open questions

- **CANCELLED**: cancelling a pricing-locked project is currently ungated
  (status transitions never call `assertPricingUnlocked`). Unresolved from
  the original #957 discussion; the tier system's deletion didn't change the
  answer either way.
- **Snapshot size at scale**: validate the per-entity-row approach against
  the largest real projects before this is exercised in anger — no test here
  proves it against a 1000+ line-item project. Unchanged by Phase 4.
