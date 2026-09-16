# Project Versioning v2 — Phase 1 (schema + backfill) + Phase 2 (index rename + reads) + Phase 3 (the verb set)

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-16 (review quarterly — POLICY.md R-5.5)_

Parent #1221. Phase 1 is #1226 (below); Phase 2 is #1228 (its own section
further down); Phase 3 is #1229 (its own section at the bottom). Plan:
`docs/designs/project-versioning-v2.md` §4.2, §4.4, §4.8, §4.9, §6, §7 (lives
on a separate integration branch — not merged to `main` yet).

## What this is, and what it is NOT

This is a **separate, newer program** from [FEATUREDOCS/70's Project Version
Switcher](./70-project-version-switcher.md) — read that callout box before
touching either. The existing switcher runs entirely on `projects.revision`/
`liveRevision` (two plain numbers) plus whole-project JSON snapshots
(`projectSnapshots`/`projectSnapshotEntries`). This program's eventual goal
(later phases) is to replace that with a real `projectVersions` table — one
row per version, an actual entity a child row can point at — so a version
switch doesn't require reconstructing state from a JSON blob.

**Phase 1 (this phase, #1226) ships alone, ahead of everything else in
#1221, and is purely additive:**

- A new `projectVersions` table.
- New optional columns: `projects.liveVersionId`, and `versionId`/
  `lineageId` on `projectCategories`, `projectGroups`, `projectLineItems`,
  `projectServices`, `categorySlots`.
- A one-time backfill (`convex/backfillProjectVersions.ts`, driver
  `scripts/convex-backfill-project-versions.ts`) that gives **every**
  project — templates included — exactly one `projectVersions` row
  (`number: 1`, `contentState: "ready"`), points `liveVersionId` at it, and
  stamps `versionId`/`lineageId` on every one of that project's current
  child rows (`lineageId` = the row's own `id`, i.e. every row's lineage
  starts at itself).
- **Nothing else in the app reads any of this yet.** The switcher above,
  every document renderer, recalc, the Equipment/Labour/Finance tabs — all
  keep working exactly as before. A later phase of #1221 wires reads up to
  the new table; only then does this doc (and FEATUREDOCS/70) get rewritten
  to describe the new read path.

## The schema (`convex/schema.ts`)

```ts
projectVersions: {
  id, organizationId, projectId,
  number: number,                    // v1..vN, allocated PER PROJECT, never reused
  label?: string,                    // ≤60, mirrors quotes.label
  basedOnVersionId?: string,
  createdAt, createdById,
  contentState: "ready" | "missing", // "missing" = un-capturable pre-versioning history (a later phase)
  // PLAN FIELDS — populated only on a NON-live version (a later phase's swap
  // model); a live version's plan lives on `projects` itself.
  rentalStartDate?, rentalEndDate?, projectStartDate?, projectStartTime?,
  projectEndDate?, projectEndTime?, loadIn*/event*/loadOut* dates,
  billingWeeksOverride?, billingDaysOverride?, taxRate?, discountPercent?,
  discountAmount?, depositPercent?, clientId?, clientContactId?, locationId?,
  siteContactName?, siteContactPhone?, siteContactEmail?,
  type?, description?, crewNotes?, internalNotes?, clientNotes?,
}
  .index("by_projectId_number", ["projectId", "number"])
  .index("by_organizationId", ["organizationId"])
  .index("by_cuid", ["id"])
```

No totals fields (a non-live version's totals depend partly on live crew
assignments and sub-hire costs matched by lineage, R-3.1 — see
`convex/lib/recalc.ts`). No `pricingLocked` (that's one boolean on
`projects`, a later phase).

`projects.liveVersionId?: string` is the live pointer, optional on arrival
(narrowing it to required is a later step, once the backfill is proven
complete in prod). It is a DIFFERENT field from the existing `liveRevision`
— the two coexist through this phase and are not reconciled.

## The backfill

`convex/backfillProjectVersions.ts`, paginated + `apply`-gated, same shape
as `backfillQuoteRevisions.ts`/`backfillProjectLiveRevision.ts`. Per project
(**templates included**, unlike those two):

1. Insert one `projectVersions` row, `number: 1` — the only number this
   phase ever allocates, which is what makes per-project uniqueness hold "by
   construction" (Convex indexes carry no uniqueness constraint on their
   own).
2. `projects.liveVersionId` ← that row's id.
3. Stamp `versionId`/`lineageId` on every current `projectCategories`/
   `projectGroups`/`projectLineItems`/`projectServices`/`categorySlots` row
   belonging to that project (`categorySlots` has no `projectId` of its own
   — resolved via the project's own categories, a PARENT_JOIN read).

`label` derives from the project's most recently SENT quote's own `label`
(`quotes.label`, #1085) if one exists, else the generic `"Version 1"`.

**Idempotency** — NOT the `createIfMissing` mirror-write convention (this
table has no Prisma model to mirror; it's fresh internal-mutation code, same
category as `serviceSchedules`). Instead: every write for one project (the
version insert + the `liveVersionId` patch + every child stamp) happens
inside a single mutation invocation, which Convex commits atomically — so
`project.liveVersionId != null` is a sufficient "already fully migrated"
gate with no partial-migration state possible. A second run is a no-op.

`convex/lib/projectVersionState.ts` holds the org-checked read helpers
(`listProjectVersions`/`findVersionByNumber`) the backfill's own idempotency
check and verification query use — `by_projectId_number` is a global index
(R-8.4.3: a `projectId` cuid is not itself partitioned by org), so every
read through it re-checks `organizationId` against the caller's own org
before returning a row. Covered by `convex/backfillProjectVersions.test.ts`'s
cross-tenant block, which proves a `projectId` collision across two orgs
never leaks a foreign row. (Phase 2 removed the file's third helper,
`listOrgVersions` — an unused, genuinely org-wide `by_organizationId` scan
with no caller anywhere; the collect-ratchet, POLICY.md R-9.8, flagged it as
new unjustified debt the moment Phase 2's own baseline tightened, and
deleting dead code beat marking it "safe".)

## Testing

- `convex/backfillProjectVersions.test.ts` — one version + `liveVersionId`
  per project (templates included), `number` always 1, every child table
  (including the `categorySlots` PARENT_JOIN case) gets stamped, label
  derivation, dry-run writes nothing, idempotent re-run, the verify query's
  cross-project-pointer check (a `liveVersionId` planted to point at a
  DIFFERENT project's version is flagged), and the cross-tenant read-safety
  block for `listProjectVersions`/`findVersionByNumber`.

## Phase 2 (#1228) — the deliberate breaking change: `by_projectId` → `by_versionId`

Phase 1 only ADDED columns; Phase 2 is the phase that makes them load-bearing.
`by_projectId` was **deleted** from the four tables Phase 1 tagged
(`projectCategories`, `projectGroups`, `projectLineItems`, `projectServices`
— `categorySlots` never had one, see its own schema.ts comment) and replaced
with a `by_versionId` family (`by_versionId`, `by_versionId_lineageId`, and
every renamed composite: `by_versionId_status`, `by_versionId_sortOrder`,
`by_versionId_type`, `by_versionId_date`). This is deliberate: every read
site through the old index became a compiler error, so the migration is
compiler-enumerated and exhaustive rather than "found by grep, hopefully all
of them."

### The three-way read classification

Every migrated call site fell into one of three buckets
(`docs/designs/project-versioning-v2.md` §4.9), resolved through the ONE
shared module, `convex/lib/versionScope.ts`:

1. **LIVE-ONLY** (the large majority — 54 production `liveRows(...)` call
   sites) — `liveRows(ctx, project, table)`, the project's current live
   version only. The default for a read that never had a reason to look at a
   non-live version.
2. **VERSION-AWARE** (8 functions took a new, additive-only `versionId`
   argument) — `versionRows(ctx, table, targetVersionId)` where
   `targetVersionId = resolveVersionId(project, versionId)` defaults to live
   when the caller doesn't supply one: `equipmentTab.bundle`,
   `projectEquipment.bundle`/`browserBundle`, and `projectCategories`/
   `projectGroups`/`projectLineItems`/`projectServices`'s own
   `listByProject`. 33 production `versionRows(...)` call sites in total
   (VERSION-AWARE reads plus every GENUINELY-ALL-VERSIONS site below, which
   also goes through `versionRows` per version).
3. **GENUINELY-ALL-VERSIONS** (11 sites, each carrying a
   `// VERSION-SCOPE: all-versions — <reason>` comment for
   `scripts/version-scope-ratchet.mjs` to find) — a project delete cascade
   (`projectWrites.ts`'s `deleteNative`/`deleteTemplateNative`,
   `projectCategories.ts`'s `deleteAllForProjectCore`) has to purge EVERY
   version's rows, not just the live one; `activationMilestones.ts`'s
   "has this org ever added equipment" check is intentionally
   version-agnostic; `backfillProjectVersions.ts`'s own pre-migration row
   scan can't use `by_versionId` at all (a row with no `versionId` yet is
   exactly what it's looking for).

`resolveLiveVersionIdForProject(ctx, projectId, orgId)` is the convenience
form for a write call site that only has `projectId`/`orgId` in scope (no
`Doc<"projects">` already loaded) and needs the live version id to stamp
onto a brand-new row.

### The other half: insert-side stamping + project-creation bootstrap

Just as load-bearing as the read migration, and not explicitly called out in
the index rename itself: every production `ctx.db.insert` into the four
tables now stamps `versionId` (defaulting to the project's live version) and
`lineageId` (defaulting to the row's own new id) — otherwise a newly-created
row would be invisible to every `by_versionId`-family read from the moment
it's written. And every project-CREATING write path
(`projectWrites.createNative`/`duplicateNative`/`saveAsTemplateNative`, the
legacy `projects.ts` mirror CRUD, `wooCommerceInternal.ts`'s order-ingest
project create) now calls `convex/lib/projectVersionState.ts`'s
`createLiveVersionForProject` immediately after inserting the project row —
bootstrapping version 1 + `liveVersionId`. Without this, a brand-new project
created after Phase 2 ships would have no `liveVersionId` and every read on
it would throw. `duplicateNative`/`saveAsTemplateNative` also stamp a FRESH
`lineageId` (not inherited from the source) on every copied row — a
duplicate project starts its own lineage.

### The recalc split (D59)

`convex/lib/recalc.ts`'s `recalcProjectTotals` split into three layers,
mirroring `availabilityCore.ts`'s existing bundle/compute split:
`loadTotalsBundle(ctx, projectId, orgId, orgDefaultTaxRate, versionId?)`
(reads, via `resolveVersionId`/`versionRows`) → `computeTotals(bundle)`
(PURE arithmetic, unchanged, exactly one definition — grep-provable, no
second copy) → `recalcProjectTotals(ctx, projectId, orgId, orgDefaultTaxRate,
now)` (LIVE-ONLY persist half, calls `loadTotalsBundle` with no `versionId`).
`convex/recalcSplit.differential.test.ts` proves the split computes IDENTICAL
totals to the pre-split implementation, plus a version-isolation case (a V1
booking must never affect a V2 computation on the same project).

### Availability read cost — join-filter, not index-push (yet)

`by_modelId`/`by_assetId`/`by_kitId` on `projectLineItems` are NOT
`by_versionId`-family indexes — they intentionally span every project AND
every version of each project (that's the point: "is this model/asset/kit
booked anywhere"). `convex/lib/availabilityCore.ts`'s
`loadModelAvailabilityBundle`, `findAssetConflict`, and `findKitConflict`
now **join-filter** each row against its own project's live version AFTER
loading (never at the index level) — a booking on a non-live version must
never affect stock math. The scanned-rows cost of keeping this a join-filter
rather than a narrower index is registered in `docs/exceptions.md` (R-9.8,
`backfillProjectVersions.ts` row — the sibling org-wide scan in the same
family). **Not every `by_modelId`/`by_assetId`/`by_kitId`/`by_organizationId`
read across the codebase got this same join-filter treatment in Phase 2** —
see "What's deferred" below.

### The viewed-version copy-parity guarantee

`equipmentTab.ts`'s `readEquipmentTab` is ONE function, parameterised only
by which version's rows it reads (`versionId?` → `resolveVersionId`,
defaulting to live) — there is no second code path, no "if this were live"
branch, no extra field on the response when viewing a non-live version.
`convex/equipmentTabVersionParity.test.ts` proves this isn't just true by
inspection: it materializes a non-live sibling version (see below) with
equivalent content and asserts `equipmentTab.bundle`'s response is
structurally IDENTICAL either way — same top-level keys, same row counts,
same per-row field set and values (once the by-design clone-identity fields
— fresh id/versionId/lineageId — are stripped).

### §6 step 2 — materialization (`materializeVersionRowsNative`)

`convex/projectVersionsWrites.ts`'s `materializeVersionRowsNative` (SERVICE-
only, no UI yet) gives a non-live `projectVersions` row REAL,
`by_versionId`-tagged rows of its own by cloning a source version's
`projectCategories`/`projectGroups`/`projectLineItems`/`projectServices`
rows — every cloned row gets a fresh `id` but KEEPS the source row's
`lineageId` (so `by_versionId_lineageId` can find "the same line" across
versions), and in-clone-set FK references (`categoryId`/`groupId`/
`parentLineItemId`) are rewritten through an old-id→new-id map so a
materialized child never points at a parent that only exists in the source
version. Refuses to target the project's own live version (its rows already
exist) and refuses to double-materialize a version that already has rows.
**Does NOT clone `categorySlots`** (slot ordering) — a materialized version
is correct on membership but starts with no recorded order; extend this
before relying on it for anything order-sensitive. See the mutation's own
file-level comment for the full deploy-order constraint (this backfill-then-
schema ordering has been validated only against `convex-test` fixtures in
this session's sandbox, never a real Convex deployment) and
`convex/versionMaterialize.test.ts` for its test coverage.

### CI gates added this phase

- `scripts/version-scope-ratchet.mjs` — mirrors `xtenant-bycuid-ratchet.mjs`'s
  shape for a sibling hazard: a read of one of the five tables through a
  non-`by_versionId`-family index (other than `by_cuid`, trivially safe) with
  no `VERSION-SCOPE` marker in its enclosing declaration. Baseline dropped
  78 → 32 over the phase (`categorySlots`' PARENT_JOIN reads and
  `by_parentLineItemId`/`by_categoryId` child-inherits-parent-version reads
  marked safe with a reasoned comment); the remaining 32 are real,
  UNRESOLVED version-scope risk — see "What's deferred" below, and do not
  mark a new site "safe" without actually verifying it the way
  `availabilityCore.ts`'s three functions were.
- `convex/versionScopeExhaustive.test.ts` — registry-driven exhaustive sweep
  (mirrors `xtenantExhaustive.test.ts`'s shape): seeds a project with a live
  version and a non-live sibling holding a distinguishable row in each of the
  four tables, then calls every registered project-scoped query with the
  DEFAULT (no `versionId`) args and asserts the non-live row never appears
  anywhere in the response JSON — not just top-level arrays, nested
  composite bundles (`equipmentTab.bundle`, `projectDetail.bundle`,
  `warehouseDetail.bundle`, …) too.

### What's deferred (honest gap, not silently swept under the rug)

The 32 remaining `version-scope-ratchet.mjs` offenders (`node
scripts/version-scope-ratchet.mjs --list`) are genuine, UNFIXED version-scope
risk, not merely unmarked: mostly `by_modelId`/`by_assetId`/`by_kitId`/
`by_bulkAssetId`/`by_supplierId`/`by_subHireId`/`by_crewRoleId` reads on
`projectLineItems`/`projectServices` in `availability.ts`,
`availabilityCheck.ts`, `overbookingBoard.ts` (a second `by_modelId` site
beyond the three `availabilityCore.ts` functions this phase DID fix),
`kits.ts`/`kitDetail.ts`/`kitWrites.ts`, `assetDetail.ts`/`assetWrites.ts`,
`warehouseOps.ts`, `returnsLookup.ts`, `suppliers.ts`/`suppliersWrites.ts`,
plus a handful of `by_organizationId*` org-wide scans
(`projectLineItems.ts`/`projectCategories.ts`/`projectServices.ts`'s legacy
mirror `list()`, `reservationConflicts.ts`, `warehouseReturns.ts`). Each
would need the SAME kind of real join-filter work
`loadModelAvailabilityBundle`/`findAssetConflict`/`findKitConflict` got, not
a rubber-stamped marker — deferred to a follow-up rather than rushed, per
this phase's own "prioritize correctness over checking every box" guidance.
The ratchet keeps this debt visible and non-growing (CI fails on a NEW
unmarked site) rather than hidden.

## Phase 3 (#1229) — the real verb set: `convex/versions.ts`

Phase 3 is the backend half of "make live + the version verbs": it replaces
promote-as-restore with a pointer flip and collapses three overlapping
"create a version" mutations into one, ALL on the real `projectVersions`
table Phase 1/2 built (not the older `projects.revision`/`liveRevision` +
`projectSnapshots` JSON-blob program, FEATUREDOCS/70, which Phase 3 leaves
running in parallel — see "What got deleted, and what didn't" below). No UI
in this phase — that's Phase 5, per the tracking issue's own scope.

### The verb table (design §4.4)

| Verb | Server | Replaces |
|---|---|---|
| New version | `versions.createNative({ organizationId, projectId, fromVersionId?, label? })` | `projectVersionsWrites.saveVersionNative`, `quotesWrites.repriceFromRevisionNative` (`quotesWrites.newVersionNative` itself is untouched — see below) |
| Make live | `versions.makeLiveNative({ organizationId, projectId, versionId })` | `projectVersionsWrites.promoteRevisionNative` |
| Rename | `versions.setLabelNative({ organizationId, projectId, versionId, label? })` | — |
| Delete | `versions.deleteNative({ organizationId, projectId, versionId })` | `quotesWrites.deleteDraftNative`, `quotesWrites.deleteVersionNative` |

`createNative` copies `fromVersionId`'s plan graph via `copyPlanGraph`
(`convex/lib/versionGraph.ts`) into a fresh, non-live `projectVersions` row —
the live tables/pointer are never touched, so it's safe to call from any
state, any number of times. `fromVersionId` defaults to the project's current
live version ("the version you're looking at"). The version-number allocator
reads the project's current MAX existing number and adds one — per
schema.ts's own prescription for this table (no separate persistent counter
the way the older `projects.revision` is one) — so a number CAN be reused
after its version is deleted; this is a deliberate consequence of that
design, not a bug (a deleted version's number was never live and nothing
that survives the delete still references it).

### `copyPlanGraph` — the shared clone primitive

`convex/lib/versionGraph.ts`'s `copyPlanGraph(ctx, {sourceVersionId,
targetVersionId})` is the ONE row-cloning implementation (R-3.1) shared by
`versions.createNative` and Phase 2's `materializeVersionRowsNative` (which
now calls it too, instead of carrying its own copy of the same fresh-id/
preserved-lineageId/FK-rewrite logic). It enforces a SIZE BUDGET
(`MAX_CLONABLE_PLAN_ROWS = 3000`, well under Convex's 8,192-doc/16MiB
transaction ceiling) and throws `ConvexError("VERSION_TOO_LARGE")` BEFORE
inserting anything, rather than failing partway through — a version too
large to clone in one transaction is refused, not partially copied.

### `makeLiveNative` — a pointer flip, not a restore

```
makeLiveNative({ versionId: K })     // K ≠ liveVersionId, K.contentState === "ready"
 1. permission check (project:update)   // NO lock gate (D37/D39) — a pointer flip is not
                                        // a destructive restore, so there is nothing for a
                                        // lock to protect. danger:"high", fully logged.
 2. outgoing = liveVersionId; incoming = K
 3. carry reality by lineageId          // generalises convex/projectLineItems.ts ~L930-965
                                        //   (units + check records; also maintenance links + threads)
 4. swap plan fields (§4.2) — the live version's live on `projects`, the outgoing one's
    move onto its own projectVersions row
 5. liveVersionId = K
 6. recalcVersionTotals(K)  → writes projects.*; re-derive availability; overbooking re-check
```

(The same 6-step diagram lives as an ASCII comment block directly in
`makeLiveNative`'s own source, per this phase's acceptance criteria.)

Because nothing is overwritten, there is no auto-capture step (the older
`PRE_PROMOTE` "Auto-saved before switching to vN" quote rows are gone along
with `promoteRevisionNative` itself), and **making a version live is never
blocked by an issued invoice** (D6) — the invoiced total stays whatever it
was; the balance invoice, when issued, reads whatever is live at that moment.
There is likewise no lifecycle-lock gate at all (D37/D39): a pointer flip
destroys nothing, so there's nothing for a lock to protect.

Step 6 reuses the EXISTING `recalcProjectTotals` (`convex/lib/recalc.ts`)
unchanged — since step 5 already flipped `project.liveVersionId` to `K`
before step 6 runs, the LIVE-ONLY recalc naturally reads `K`'s own rows. No
bespoke "recalc a specific version" function was written for this (R-3.1).
Availability/overbooking re-derivation on a moved rental window reuses the
same `deriveDateMoveConflicts` logic the deleted `promoteRevisionNative` used
(ported into `convex/versions.ts`, ratchet on `docs/exceptions.md`
unaffected — this is the identical board-aggregation approach, not a new
scanned-rows cost).

**Round-trip proof.** `convex/versions.test.ts` proves make-live is
symmetric: making v2 live then making v1 live again returns the project's
PLAN FIELDS to a byte-identical state (`versions.makeLiveNative — make-live
is a pointer flip — round trip v1 -> v2 -> v1 is byte-identical`). One
caveat the test seeds around deliberately: `discountAmount` is listed as a
PLAN FIELD on `projectVersions` (schema.ts, Phase 1) but is ALSO a
recalc-derived output on `projects` (`subtotal × discountPercent`,
`convex/lib/recalc.ts`) — every make-live re-derives it via
`recalcProjectTotals`, so it only stays byte-identical across a round trip
when the seed data was already internally consistent with the line items'
own subtotal. This is a pre-existing Phase 1 schema shape, not something
Phase 3 changed.

### Lineage re-pointing (step 3) — `convex/lib/versionReality.ts`

For each outgoing line with real-world footprint (`projectLineItemUnits`,
`checkRecords`, `maintenanceRecords`, `commentThreads` with
`targetType: "lineItem"`) — generalising `convex/projectLineItems.ts`'s
`mergeGroup` mutation (~L930-965), which re-points the same two tables
(units + check records) for the same reason (a line's identity changing
underneath its real-world footprint):

- **Match** (an incoming line shares the outgoing line's `lineageId`) →
  re-point every reality row onto the incoming line's id.
- **Incoming quantity < carried fulfilment** (units with
  `status: "CHECKED_OUT"`, e.g. 2 checked out, plan says 1) → **listed as a
  CONFLICT in the mutation's return value, never blocking** the make-live
  (design §4.4/D6's "list, don't block" rule applies here too) — a future
  UI phase renders `conflicts: string[]`.
- **No match** → the reality is orphaned: nobody in the incoming version
  planned this line at all. It stays on the job as a fresh, real
  `projectLineItems` row on the incoming version, flagged
  `unplanned: true` (a NEW field, `convex/schema.ts`) — the same structural-
  write allowance an on-site add gets, priced at `unitPrice: 0` (no price was
  ever agreed for it under the new plan) and carrying the SAME `lineageId` as
  the line it was orphaned from (so a later version swap can still find it by
  lineage). `projects.pricingLocked` doesn't exist yet (that's Phase 4), so
  there's no lock-exception to wire this into yet — just the unplanned-line
  creation itself, per this phase's own scope note.

Only `projectLineItems` reality is considered — categories/groups/services
have no real-world footprint of their own. `categorySlots` (ordering) is a
known, documented gap shared with `materializeVersionRowsNative` (Phase 2) —
out of scope here for the same reason.

### `deleteNative`

Refuses to delete the LIVE version (`VERSION_IS_LIVE` — make another version
live first). Otherwise hard-deletes the `projectVersions` row AND every row
it owns across the four plan tables (`VERSIONED_PLAN_TABLES`). This is safe
by construction: reality (units/checks/maintenance/threads) only ever sits on
the rows tagged with the CURRENT live version — `makeLiveNative`'s step 3
re-points every bit of it the moment a version stops being live, so a
non-live version's rows never have any live reality left to orphan by the
time anyone deletes them. Classified `danger: "high"` per the delete/archive
rubric (irreversible).

### What got deleted, and what didn't

**Deleted** (superseded by the verb table above, `agentOps` entries removed
with them): `projectVersionsWrites.saveVersionNative`,
`projectVersionsWrites.promoteRevisionNative` (and its `PRE_PROMOTE`
auto-capture machinery — `assertPromotePreconditions`/
`autoCaptureOutgoingRevision`), `quotesWrites.repriceFromRevisionNative`,
`quotesWrites.setQuoteProtectedNative`, `quotesWrites.deleteDraftNative`,
`quotesWrites.deleteVersionNative`. Also removed: `recallNative`'s
un-supersede branch (it assumed send-supersedes-across-REVISIONS, which
stops being the model once versioning moves onto the real `projectVersions`
table — `recallNative` itself is UNCHANGED otherwise, `restoredQuoteId`
stays in its return shape, always `null` now).

**NOT deleted, still the OLDER quote-revision program** (FEATUREDOCS/70,
unaffected by this phase — do not conflate the two):
`quotesWrites.sendNative`/`newVersionNative`/`recallNative`/
`markAcceptedNative`/`markDeclinedNative`/`unacceptNative`/
`correctQuoteNative`/`deleteRecalledNative`/`setQuoteLabelNative`,
`projectVersionsWrites.materializeVersionRowsNative` (Phase 2's SERVICE-only
primitive — now calls `copyPlanGraph` internally, behaviour unchanged),
`quotes.revisionStateForProject`, `projectVersionsRead.listVersions`, the
`projects.revision`/`liveRevision` pointer pair, and the entire
`projectSnapshots`/`projectSnapshotEntries` JSON-blob mechanism. The
`quotes.protected` field and the checks against it in `recallNative`/
`deleteRecalledNative`/`correctQuoteNative` are also UNCHANGED — only the
mutation that could SET/CLEAR it (`setQuoteProtectedNative`) is gone, so a
row protected before this phase (or by `markAcceptedNative`'s own
auto-protect-on-accept) stays protected with no way to un-protect it through
this API. This is a known, accepted interim gap — not something a future
phase is tracked to fix, since the "Protect/Unprotect" verb itself is a
**removed verb** per the phase spec.

**UI callers left intentionally broken, with a clear note** (Phase 5's job to
rewire, not silently left calling a since-deleted function):
`src/hooks/use-project-version-writes.ts`'s `saveVersion`/`promoteRevision`
and `src/hooks/use-quote-writes.ts`'s `repriceFromRevision`/`deleteDraft`/
`deleteVersion`/`setProtected` now throw a clear, descriptive error instead
of calling a Convex function that no longer exists — every call site
(`version-switcher.tsx`'s "Add version", `promote-version-dialog.tsx`,
`delete-version-dialog.tsx`, `reprice-from-revision-dialog.tsx`,
`project-quote-rail.tsx`'s Protect toggle) already catches and toasts the
mutation's error message, so this surfaces as an ordinary "temporarily
unavailable" toast rather than a crash. The OLD system's argument shapes
(quote revision NUMBERS) don't map 1:1 onto the new verbs' `projectVersions`
row ids, so this isn't a mechanical rewire — real UI work for Phase 5.

### Testing

`convex/versions.test.ts` (all four verbs — RBAC, cross-org IDOR, template
rejection, `contentState: "missing"` rejection, the round-trip proof, lineage
match/no-match/conflict, D6, D37/D39), `convex/lib/versionGraph.test.ts`
(`copyPlanGraph`'s clone shape + the `VERSION_TOO_LARGE` size-budget throw),
`convex/quotesWrites.test.ts`/`convex/projectVersionsWrites.test.ts`/
`convex/projectVersionsEquipment.test.ts`/`convex/projectVersionsRead.test.ts`
updated for the deletions (several tests replaced `saveVersionNative`/
`setQuoteProtectedNative` calls with direct DB seeding of the same end state,
since those mutations no longer exist to call).

## What's next (later phases of #1221 — not built yet)

The Phase 5 UI work called out above (wiring the version switcher, promote/
delete dialogs and the reprice/protect actions onto the new verb set — or
retiring them, per the new design), `projects.pricingLocked` + the
`unplanned`-line lock-exception (Phase 4), migrating the switcher
(FEATUREDOCS/70) off `projectSnapshots` onto `projectVersions` entirely,
narrowing `projects.liveVersionId` to required once the backfill is proven
complete in prod, and closing the remaining 32 version-scope-ratchet sites
(Phase 2's "What's deferred") with real join-filtering. See
`docs/designs/project-versioning-v2.md` for the full plan (not yet merged to
`main`).
