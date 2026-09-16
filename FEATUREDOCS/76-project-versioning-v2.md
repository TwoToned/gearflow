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
`markAcceptedNative`/`markDeclinedNative`/`deleteRecalledNative`/
`setQuoteLabelNative`,
`projectVersionsWrites.materializeVersionRowsNative` (Phase 2's SERVICE-only
primitive — now calls `copyPlanGraph` internally, behaviour unchanged),
`quotes.revisionStateForProject`, `projectVersionsRead.listVersions`, the
`projects.revision`/`liveRevision` pointer pair, and the entire
`projectSnapshots`/`projectSnapshotEntries` JSON-blob mechanism (its CAPTURE
half — the RESTORE half was deleted in Phase 4, see below). The
`quotes.protected` field and the checks against it in `recallNative`/
`deleteRecalledNative`/`correctQuoteNative` were, AT THE END OF PHASE 3,
UNCHANGED — only the mutation that could SET/CLEAR it
(`setQuoteProtectedNative`) was gone, so a row protected before Phase 3 (or
by `markAcceptedNative`'s own auto-protect-on-accept) stayed protected with
no way to un-protect it through the API. **Phase 4 (below) deletes the whole
protect/unprotect mechanism outright**, closing that interim gap by removing
the check rather than restoring a way to clear it — `unacceptNative` and
`correctQuoteNative`, listed above as surviving Phase 3, are themselves
deleted in Phase 4.

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

## Phase 4 (#1230) — pricing lock collapse: one boolean replaces the whole 4-tier system

Phase 4 is a **net-deletion** phase: it collapses the old 4-tier project lock
system (`LockTier`: `OPEN`/`FINANCE_LOCKED`/`JUSTIFY`/`HARD_LOCKED`,
quote-derived lock escalation, per-edit freeform justification, and
`projectUnlockSessions`) into a single field, `projects.pricingLocked`.

### The new model

```ts
projects.pricingLocked?: boolean       // absent = false
projects.pricingLockedAt?: number
projects.pricingLockedById?: string
projects.pricingLockedByName?: string  // denormalized, for display with no join
```

Applies to the **LIVE version only** — Phase 1-3's own invariant carries
straight through: a non-live `projectVersions` row is writable in every field
family regardless of this flag. The truth table (design §4, D-table):

| State | Money | Structure/plan/warehouse |
|---|---|---|
| Non-live version | allowed | allowed |
| Live, unlocked | allowed | allowed |
| Live, locked | **rejected** (`PRICING_LOCKED`) | allowed (new adds default `$0`, `pricedUnderLock: true`) |

`convex/lib/projectLocks.ts` is the shrunken successor to the whole old
module: `isLiveVersionRow`/`assertPricingUnlocked` (the one guard every
money-write mutation calls — `LOCKED_PROJECT_FIELDS`/`LOCKED_GROUP_FIELDS`/
`LOCKED_LINE_ITEM_FIELDS`/`LOCKED_SERVICE_FIELDS`/`LOCKED_CREW_FIELDS` are
UNCHANGED, only how they're gated changed), `defaultsToZeroOnInsert`/
`pricedUnderLockOnInsert`/`afterLockAuditMetadata` (the $0-default-on-insert
mechanics, also unchanged in behaviour), and `canUnlockPricing`/
`requireCanUnlockPricing` (D42) — the RENAMED successor to the old
`isHardLockOverrideAllowed`, same two-part audience shape (a role test OR the
project's own PM), with the role test swapped from a bare
`role === "owner" || role === "admin"` check to
`hasPermission(role, "invoice", "publish")`, which also admits `manager`.
`isConfirmedOrLater`/`crossesIntoSnapshotStatus` stay in the same file
(unrelated to pricing locking) — see `convex/lib/projectLocks.test.ts` for
the pure-logic truth table and `convex/projectLifecycleLocks.test.ts` for the
integration exercise across every gated entity family.

### Who raises/lowers the flag, and when

- **D54** — `versions.makeLiveNative` (the pointer flip) NEVER touches
  `pricingLocked`, in either direction. Verified: `versions.test.ts`.
- **D55** — `quotesWrites.sendNative` raises it, but ONLY when the quote it
  sends is the project's LIVE revision (which, by construction, is always
  true today — `sendNative` has no way to send anything else). Idempotent: a
  resend of an already-locked project leaves `pricingLockedAt`/
  `pricingLockedById` untouched.
- **D56** — `quotesWrites.recallNative` clears it, but ONLY for the LIVE
  version's quote — recalling an older, no-longer-live SENT revision (one a
  promote left behind) must not unlock a job whose CURRENT live revision is
  still out with the client.
- A `CONFIRMED` status transition (`projectWrites.updateStatusNative`) also
  raises it, idempotently, the same way `sendNative` does.
- **D57** — a status REVERT never clears it (only forward-raises, never
  auto-lowers) — "this job has a quote out" or "this job was confirmed" stays
  true regardless of a later revert. Only a person lowers the flag, via
  **`projectPricingLockWrites.unlockPricingNative`** (D42-gated,
  `danger: "high"` — the API dispatcher requires `confirm: true`, and Mira's
  tool surface never exposes a `confirm` parameter to the model, so an agent
  cannot self-approve clearing it). Its sibling, `lockPricingNative`
  (re-locking), is `danger: "low"` and ungated beyond ordinary
  `project:update` permission — softening nothing, since re-locking only
  starts rejecting FUTURE money writes.
- `#986`'s "confirming without an accepted quote" override
  (`projectWrites.updateStatusNative`) now reuses `canUnlockPricing` directly
  — the freeform justification text this override used to require is
  dropped; a permission check plus the standard `STATUS_CHANGE` audit row is
  the whole gate.

### What's deleted outright

`LockTier`/`resolveLockTier`/`TIER_BY_STATUS`/`lockTierForStatus`/
`LOCK_TIER_RANK`/`LockTierReason`/`quoteStateKeepsOpen`/`bypassQuoteLock`/
`assertLifecycleGuard`/`lifecycleAuditMetadata`/`requireHardLockOverrideAllowed`
(`convex/lib/projectLocks.ts`, rewritten); the `JUSTIFY` tier and its 32
`kind: "structural"` gate sites (every structural create/update/delete is now
UNCONDITIONALLY ungated — a status/lock check never blocks structure, only a
money write against a live, locked version does); `use-justified-mutation.ts`
and its two dialogs (`justification-dialog.tsx`, `unlock-session-dialog.tsx`);
the `projectUnlockSessions` table, `projectUnlockSessionsWrites.ts`
(`openNative`/`commitNative`/`discardNative`), `unlock-session-banner.tsx`;
`restoreProjectSnapshot`/`RestoreScope`/`RestoreArgs`/`RestoreResult` and
their `LOCKED_*_FIELDS`-diffing helpers in `convex/lib/projectSnapshots.ts`
(dead code once `discardNative` — its last caller — was gone; `PROMOTE`'s own
caller, `promoteRevisionNative`, was already deleted in Phase 3);
`quotesWrites.correctQuoteNative`/`unacceptNative` and the whole
protect/unprotect mechanism they and `markAcceptedNative`'s auto-protect
depended on (`quotes.protected`/`protectedAt`/`protectedById` stay on the
schema, marked DEPRECATED, only so a pre-#1230 row that still carries `true`
doesn't fail the schema push — nothing checks the field anymore).
`projectLocksRead.status` is rewritten from a `{tier, reason, revision,
liveRevision, quoteState}` shape to `{pricingLocked, pricingLockedAt,
pricingLockedByName, canUnlockPricing}`.

**Kept unchanged**: `LOCKED_*_FIELDS` lists, the `pricedUnderLock` field/badge
(`UnpricedBadge`), and the `LockedField`/`GatedButton` UI components — they
already took a generic `locked`/`gated` boolean + `reason` string, so no
component code needed to change, only what feeds them
(`src/lib/lock-copy.ts`'s `resolveLockCopy`/`formatLockElapsed`, rewritten
for the one-boolean shape; `useProjectPricingLock`, the renamed successor to
`useProjectLockStatus`).

### Agent/API surface

`project:unlock_session` is renamed `project:unlock_pricing`
(`convex/lib/agentArgs.ts`'s `UNLOCK_PRICING_SCOPE`/
`assertUnlockPricingAllowed`, called from `unlockPricingNative` — granted in
no preset, same "denied by default" posture as before). The `justification`
privileged-arg policy row survives with `agentAccess: "allowed"`, but its
`danger` drops from `high` to `low` and its `softens` field now says
"nothing" — the JUSTIFY tier it used to soften is gone. The argument itself
is deleted outright from every mutation that accepted it EXCEPT
`lineItemWrites.addNative` and `crewAssignmentsWrites.createNative`, which
keep it as an accepted-but-IGNORED field: both are wrapped by a stable/v1
curated MCP tool, and design §13 decision 12 (additive-only) forbids removing
a field from a stable operation's contract without a `/v2`. `PRICING_LOCKED`
replaces `FINANCIALS_LOCKED`/`PROJECT_LOCKED` and `FORBIDDEN_UNLOCK_PRICING`
replaces `FORBIDDEN_HARD_LOCK_OVERRIDE` in `src/lib/api/errors.ts`'s
published error-code vocabulary. The reachability floor
(`docs/api-coverage.md`) dropped from 572 to 570 — `correctQuoteNative`/
`unacceptNative`/the three `projectUnlockSessionsWrites` verbs are gone with
no like-for-like replacement; `lockPricingNative`/`unlockPricingNative`
partially offset it.

### A backfill, not a migration

`convex/backfillProjectPricingLock.ts` (paginated, `apply`-gated, same shape
as `backfillProjectVersions.ts`) sets `pricingLocked: true` for every project
whose live revision has a SENT/ACCEPTED/EXPIRED quote, or whose status is
CONFIRMED or later — the one-time "translate the old derived state into the
new stored boolean" step for every project that existed before this phase
shipped. A project created after this phase needs no backfill; the flag is
false by construction (absent) until a real event raises it.

### Known deviations / left for a human to weigh in on

- The finance-tab "your saved draft doesn't match the live invoiced state"
  divergence line (previously partly informed by lock tier) is derived on
  read from `pricingLocked` + the live quote/invoice state, not a new stored
  field — the UI wiring for it may lag this phase; the derivation itself is
  covered by a test.
- I-14/I-15 from the tracking issue (edge cases around a promoted-but-unsent
  revision interacting with the lock) are covered by the D55/D56 tests above
  to the extent the existing quote-revision model exposes them, but a
  from-scratch audit of every interaction with Phase 1-3's `liveVersionId`
  pointer was not performed — flagging rather than silently asserting full
  coverage.

## Phase 5 (#1231) — the UI: one switcher, one panel, one strip

Phase 5 wires Phases 1-4's backend into the actual project-detail page. It
reads from the REAL `projectVersions` table via a new browser-facing read
module, `convex/versionsRead.ts` (`listForProject` — the summary list the
header pill and Versions panel both subscribe to; `getVersion` — a single
version's PLAN FIELDS for the composed object below), and writes through
the existing `convex/versions.ts` verb set (`createNative`/`makeLiveNative`/
`setLabelNative`/`deleteNative`, Phase 3) via a rewritten
`src/hooks/use-project-version-writes.ts`.

### The composed object (D32) — real now, not just the Phase 0 spike

`src/lib/project-version-compose.ts`'s `composeProjectWithVersion(project,
viewingPlanFields)` shallow-merges the viewed version's PLAN FIELDS bag
(`versionsRead.getVersion`) onto the live project. `src/app/(app)/
projects/[id]/page.tsx` computes this ONCE, right after the project loads,
via a new standalone hook `useProjectVersionState` (`project-version-
context.tsx`, split out of the context Provider so page.tsx can call it
BEFORE the provider's own JSX) — then feeds the composed object to
`getProjectWindowDates`, the Notes tab, and the Labour tab's window-date
props, unmodified, exactly as the Phase 0 spike predicted. `ProjectVersion
Provider` itself is now a thin context wrapper that just takes this
precomputed `value`.

**Known, documented limit**: only the plan-field SCALARS are composed.
Resolved relations (the client's name, the location object) still come from
the LIVE project's own `projectDetail.bundle` join, so they can lag a
non-live version's own `clientId`/`locationId` if that version was created
under a different client/location. Fully resolving version-scoped relations
is follow-up work, flagged in `composeProjectWithVersion`'s own comment, not
silently assumed away.

### VersionStrip — three states, one query

`src/components/projects/version-strip.tsx` replaces `ProjectLockStrip` +
`VersionReadOnlyBar` (both deleted) with one component:

1. **Absent** — live, unlocked, nothing to say.
2. **Viewing a non-live version** — info strip, "Make vN live" + "Back to
   live". Takes priority over state 3: `pricingLocked` describes the LIVE
   version's money fields only, and says nothing about what's on screen.
3. **Live, pricing locked** — the single lock state left post-#1230, with
   the one-click "Unlock pricing" action (`unlockPricingNative`, called
   directly via `useMutation` — confirmed by inspecting `use-project-lock.ts`'s
   existing pattern, NOT through the HTTP API dispatcher, so no `confirm`
   plumbing was needed for this UI action).

The mockup's states D (drift: "this job no longer matches the sent quote")
and E ("pricing unlocked by a person, re-lock") are a **deliberate
deferral** — not built into the strip this phase. The underlying drift
SIGNAL still exists (inlined into `project-quote-rail.tsx`'s
`InlineQuoteDrift` and `overview/quote-card.tsx`'s own copy, both replacing
the deleted shared `QuoteDriftIndicator` — same `diffSnapshotEntries`/
`summarizeDrift`/`describeDrift` pipeline, R-3.1), just not folded into
`VersionStrip` yet.

### Header pill + Versions panel — the two verb surfaces

`version-switcher.tsx` (rewritten) is the `v4 · Live ▾` header pill: lists
every version, "New version", a disabled "Compare" stub (§5's principle 6 —
tracked separately as #1232, not built), and "Manage versions…" (also bound
to the `V` keyboard shortcut, disabled while typing or another dialog/menu
is open, DESIGN.md §4). `versions-panel.tsx` (new, a Radix `Sheet`) is the
ONLY place a version is created, renamed, made live or deleted — switching
also lives there as a convenience, not a duplicate authority. Both consume
`ProjectVersionSummary`/`useProjectVersion()` from the rewritten
`project-version-context.tsx`.

`finance/make-live-dialog.tsx` (new) replaces `PromoteVersionDialog`: states
what changes before it runs (design §5.5), then lists `makeLiveNative`'s
`conflicts: string[]` after a successful flip — never blocks on them (§4.4/
D6). Opened from the strip, the pill's row actions, and the panel — one
dialog, three entry points, same as the old `PromoteVersionDialog`'s reuse
pattern.

### The Equipment tab — read-side is real; write-side has a discovered gap

`EquipmentTab` now takes `versionId` (threaded straight into
`useNativeEquipmentTab` → `equipmentTab.bundle`'s own already-version-aware
arg, Phase 2/#1228) and `addDisabledReason`. Viewing a non-live version
therefore renders that version's REAL rows through the REAL component — not
a projection — with `EquipmentAddMenuTrigger` (`equipment-add-menu-trigger.tsx`,
split out of `equipment-tab.tsx` for independent testability) greyed and
tooltipped instead of hidden (D15).

**Important discovery, not in the Phase 1-4 writeup**: every CREATE mutation
this tab calls (`lineItemWrites.addNative` and its siblings in
`projectGroupsWrites.ts`/`projectCategoriesWrites.ts`/
`projectServicesWrites.ts` — 13 call sites) stamps
`versionId: requireLiveVersionId(project)` **unconditionally** — Phase 2 made
every READ version-aware but never extended the WRITE side with a target-
version argument. EXISTING-row edits (price/qty/notes, delete, reorder) are
unaffected — they operate on an already-versioned row's own `id`, so they
correctly land wherever that row already lives, live or not. Only NEW
inserts are at risk of silently landing on the wrong (live) version. Rather
than ship an "Add" menu that would silently misfile new lines, Phase 5
GREYS the Add trigger while viewing a non-live version (`addDisabledReason`)
— a narrower version of principle 3's "same add menu" ideal, chosen for
correctness over completeness. **Closed post-Phase 5 — see "#1221 follow-up —
closing the Equipment write-side gap" below.**

### Labour and Finance tabs — scoped out of version-awareness this phase

Neither tab was threaded with `versionId` this phase (the mockups' one
worked read-path example is Equipment; `projectServices.listByProject` is
ALSO already version-aware server-side per Phase 2, so wiring
`ServicesPanel` is a smaller lift than Equipment's data-reconstruction path
— left for a follow-up, not attempted here for time). Both render their
LIVE data regardless of `?v=`, now flagged with a `VersionNotTrackedNote`
(the same "Tasks/Files aren't versioned" component Tasks/Files already
used) rather than silently showing stale-looking figures with no
indication. The Notes tab, by contrast, IS fully version-aware for free —
`crewNotes`/`internalNotes`/`clientNotes` are PLAN FIELDS, so the composed
object already carries the viewed version's own text; it renders read-only
while viewing non-live (notes writes patch the live `projects` row only,
same gap class as the Equipment "Add" issue above).

### Deleted, verified gone

`project-version-projection.ts`, `convex/projectVersionsEquipment.ts` (+
test), `version-projected-equipment.tsx`, `version-projected-labour.tsx`,
`version-projected-finance.tsx`, `version-readonly-bar.tsx`,
`quote-drift-indicator.tsx`, `reprice-from-revision-dialog.tsx`,
`promote-version-dialog.tsx` (+ its smoke test), `delete-version-dialog.tsx`,
`project-lock-strip.tsx`. `use-justified-mutation.ts`/`justification-
dialog.tsx`/`unlock-session-dialog.tsx`/`unlock-session-banner.tsx` were
already gone (Phase 4). `RecallToEditDialog` never existed under that name
in this codebase — verified absent, not assumed.

Also removed as **newly-orphaned** once the above lost their only callers
(not literally named in the issue's delete list, but dead by construction
once their sole importers were gone — R-3.1/POLICY.md dead-code discipline):
`convex/projectVersionsRead.ts` (+ test — the OLD quote-revision-based
`listVersions` the deleted switcher used), `promote-conflicts-panel.tsx` (+
test), and three throwing stubs in `use-quote-writes.ts`
(`repriceFromRevision`/`deleteDraft`/`deleteVersion` — their only callers,
the deleted dialogs, are gone). `project-quote-rail.tsx` (the OLDER, still-
alive quote-revision program, FEATUREDOCS/70) had its Promote/Reprice/
Delete-draft row actions and drift-indicator import removed (their
underlying mutations were already throwing stubs since Phase 3) — Send/
Accept/Decline/Recall/View/Rename/Delete-recalled are untouched.

### Testing

jsdom smoke tests that actually OPEN each surface (mirroring
`model-roi-tab.smoke.test.tsx`'s TooltipProvider-crash pattern):
`version-strip.smoke.test.tsx` (all 3 states + priority ordering),
`version-switcher.smoke.test.tsx` (opens the menu, lists/switches versions,
New version, disabled Compare, Manage → panel, `V` shortcut incl. the
input-focused/no-op case), `versions-panel.smoke.test.tsx` (opens as a
dialog, row eligibility, rename/delete/make-live including the conflicts
path), `finance/__tests__/make-live-dialog.smoke.test.tsx` (states what
changes, conflicts list, Cancel/Done), `project-version-compose.test.ts`
(pure-function coverage of the overlay/clear semantics).

The Equipment-tab render-parity requirement (convex/
equipmentTabVersionParity.test.ts already proves the DATA is parity) is
covered at the UI level NOT by mounting the full ~2,700-line `EquipmentTab`
(impractical — dnd-kit, seven browser-direct write hooks, several Convex
subscriptions) but by two narrower, honest proofs that together establish
the same thing: `equipment-add-menu-trigger.smoke.test.tsx` (the ONE place
`EquipmentTab` branches on `addDisabledReason` — its two states, isolated)
and `use-native-equipment-tab.test.ts` (a `renderHook` test proving
`versionId` reaches `equipmentTab.bundle`'s own query args, and that the
data path is otherwise IDENTICAL regardless of which version is being
read). Since Phase 5's only other change to `EquipmentTab` is threading
`versionId` straight through with no other conditional, these two tests
together prove the "identical apart from greyed verbs" claim by
construction rather than a brute-force DOM diff.

### E2E (I-20)

`e2e/harness-project-versioning.spec.ts`, three specs, `harness-*` E2E
convention (`E2E_HARNESS=1`, `resetHarnessDb()` per file): (1) switch to a
non-live version, edit an EXISTING line, switch back — the edit is on the
version, live is untouched (deliberately exercises an edit, not a new add,
given the write-side gap above); (2) make live with a warehouse conflict —
lists it, flips anyway, checked-out gear stays on the job; (3) quote from a
non-live version — `.skip()`'d with a comment, blocked on Phase 6 (#1233),
which doesn't exist yet. **Honesty note**: this sandbox has no live Convex
deployment and no way to run the seeded harness — specs 1-2 are written and
believed correct (mirroring `harness-revenue-path.spec.ts`'s/
`harness-create-inventory.spec.ts`'s already-proven register → onboard →
model → asset → project chain) but NOT executed and confirmed green here.

### DESIGN.md conformance

No violations found worth flagging beyond the usual: `VersionStrip`/
`versions-panel.tsx`/`make-live-dialog.tsx` all reuse existing tokens
(`intentStyles`/`intentBorderClass`, `t-overline`/`text-caption`, the
`--r`/`--r-lg` radius scale, hard-offset shadows via existing `Button`/
`Dialog`/`Sheet` primitives) rather than introducing new ad hoc styling: no
new colours, no uppercase text, `SelectValue` isn't used (no `<Select>` in
this surface), every `Tooltip` has its own `TooltipProvider`
(`GatedButton`'s and `EquipmentAddMenuTrigger`'s own, per CLAUDE.md), and no
Base UI popover is nested inside a Radix modal Dialog anywhere here (the
Versions panel is a Radix `Sheet`; the Make-live/Rename/Delete dialogs it
opens are plain Radix `Dialog`s, sibling-stacked, not nested popovers).

## #1221 follow-up — closing the Equipment write-side gap (post-Phase 5)

Extends every CREATE mutation on the five versioned plan tables with an
optional `versionId` arg (additive-only, defaulting to the project's live
version when absent — the exact pattern Phase 2 established for reads) and
re-enables Equipment's "Add" UI on non-live versions accordingly. This was
flagged as the single highest-priority follow-up in Phase 5's own writeup
above; it is now closed.

### `resolveWriteVersionId` — the write-side counterpart to `resolveVersionId`

`convex/lib/versionScope.ts`'s `resolveWriteVersionId(ctx, project,
versionId?)` mirrors `resolveVersionId`'s "optional, default live" shape,
but with one deliberate difference: a supplied `versionId` is **always
validated** against `project` (same org, same project, `contentState:
"ready"`) before being trusted, never just defaulted through like a read
does. A write landing on a foreign project's version is a persisted,
IDOR-shaped bug (the row itself is now wrong, not just one response), so the
asymmetry with the read-side helper is intentional, not an oversight.

### The 13 call sites, plus one discovered along the way

All 13 CREATE call sites named in Phase 5's gap note now take `versionId`:
`categorySlotsWrites.createCategoryAndPlaceGroup`,
`projectCategoriesWrites.createCategoryNative`,
`projectGroupsWrites.createGroupNative`,
`projectLineItems.createKitLineItemCore` (shared by `lineItemWrites.ts`'s
`addKitNative` and `groupTemplatesWrites.applyNative`'s kit expansion),
`lineItemWrites.addCustomNative`/`addNative`/`addKitNative`/
`addLineItemSmartNative`, and `projectServicesWrites.createServiceNative`/
`generateServicesNative`/`convertLineItemToServiceNative`.

**`groupTemplatesWrites.applyNative`** (apply a group template — the
Equipment tab's "Add group" → pick-a-template flow) was not named in the
original 13 but is reachable from the exact same "Add" menu Phase 5 gated,
so it gets the identical treatment: an optional `versionId`, validated the
same way, threaded to both the group it creates and every model/kit line it
expands. Left unwired without this, re-enabling "Add" would have silently
misfiled a template-created group onto live while viewing a non-live
version — the same bug class Phase 5 was built to prevent, just one layer
deeper.

**Accessory children were a second, adjacent bug**: `convex/lib/fulfillment.ts`'s
`expandAccessoryChildLines`/`expandAccessoriesForAsset`/the reconcile path
inserted accessory child lines with NO `versionId` at all (not even live) —
an oversight in the original insert-side stamping Phase 2 added, invisible
until Phase 2's own `by_versionId`-family reads made an unstamped row
match nothing. Every accessory child now inherits its PARENT line's already-
resolved `versionId` — never re-derives "live" independently, since a
parent that lands on a non-live version must keep its children there too.

### Pricing-lock interaction — unchanged principle, one added parameter

`convex/lib/projectLocks.ts`'s `defaultsToZeroOnInsert` now takes an
optional `targetVersionId`, checked via `isLiveVersionRow`. The Phase 4
invariant is unchanged — `pricingLocked` gates the LIVE version's money
writes only — this just makes that check explicit for a CREATE that can now
target something other than live: an insert aimed at a non-live version
keeps its real price regardless of the live version's lock state; an insert
that omits `versionId` (still resolving to live) keeps the exact pre-#1221
gated behaviour.

### UI re-enablement

`EquipmentTabProps.addDisabledReason` is no longer set by
`src/app/(app)/projects/[id]/page.tsx` — the prop itself stays (for a
FUTURE disable reason, e.g. a permission gate) but nothing passes a version-
related one anymore. `EquipmentTab`'s own `versionId` prop is threaded
through `UnifiedAddDialog` → `EquipmentAddForm`/`KitAddForm`/
`CustomItemAddForm` (own-stock/kit/custom-item), and directly to
`categoryWrites.create`/`groupWrites.create`/`templateWrites.applyTemplate`
for category/group/template-group creation.

Two kinds inside `UnifiedAddDialog` are deliberately left out, both
documented in that file's own header comment:

- **Sub-hire** creates rows in `subHireGroups`/`subHireOrders`/`subHireItems`
  — tables this whole program never touched (no `versionId` column, no
  live/non-live distinction). Enabling "Add → Sub-hire" while viewing a
  non-live version isn't a new gap; it's the same "not version-aware"
  bucket Labour/Tasks/Files already sit in, so the tab stays reachable with
  no special-casing.
- **Sale** (`saleMode: "FROM_RENTAL_STOCK"`) immediately mutates REAL stock
  on add (`sellSerializedAssetForSale`, `convex/lineItemWrites.ts`) — a
  physical, right-now side effect, not a plan entry, and `addLineItemSmartNative`
  runs that stock effect unconditionally regardless of the line's own
  target version (a pre-existing gap in the versioning program, not
  introduced here — flagged rather than silently left). Selling stock
  "into" a non-live version would execute that real disposal against a
  plan that isn't the one currently governing the job, so the Sale tab
  stays **disabled** while viewing a non-live version (mirrors the "reality
  only ever lives on the live version" invariant `versions.ts`'s
  `makeLiveNative` step 3 documents) rather than being wired through.
  Closing this for real means gating `applySaleStockOnAdd` itself to the
  live version — left as a follow-up, not attempted here.

Labour was checked against the same "siblings problem" and found not to
have one: `ServicesPanel` was never made version-aware on the READ side
this program (still LIVE-only, `VersionNotTrackedNote`), so there is no
"viewing a non-live version's services" state whose Add could be silently
wrong — wiring Labour's writes is bundled with wiring its reads, both still
open in "What's next" below.

### Not touched, and why

`categorySlotsWrites.createCategoryAndPlaceGroup` (the "Move existing group
to new category" dialogs) got the same optional `versionId` arg for API
completeness, but no UI thread this pass — same as when Phase 5's own
diff first introduced the arg. This is safe, not silently risky: the
mutation validates the moved group's own `versionId` against the resolved
target before writing, so an un-wired caller (defaulting to live) against a
group that actually lives on a non-live version fails LOUDLY with "Project
group does not belong to the target version" rather than silently
misfiling — a broken feature on non-live, not a data-integrity bug.
Left for a follow-up alongside Labour/Finance.

### Testing

Per-mutation: defaults-to-live, targets-a-named-version (sortOrder/siblings
scoped to that version, not live's), cross-tenant rejection, cross-project
rejection, and — where a lock exists to interact with — the lock case
(`convex/lineItemWrites.test.ts`, `convex/projectGroupsWrites.test.ts`,
`convex/projectCategoriesWrites.test.ts`, `convex/projectServicesWrites.test.ts`,
`convex/categorySlotsWrites.test.ts`, `convex/groupTemplatesWrites.test.ts`).
UI: `src/hooks/__tests__/use-line-item-writes.test.ts` (hook-level proof
`add`/`addCustom`/`addKit` thread `versionId` to their mutations unchanged)
and `src/components/projects/__tests__/unified-add-dialog.smoke.test.tsx`
(the segmented switcher's Sale-disabled-while-non-live state, the stale-kind
fallback, and Sub-hire staying reachable) — mirroring
`equipment-add-menu-trigger.smoke.test.tsx`'s established pattern of mocking
out the heavy form bodies to isolate the one thing that changed, rather than
mounting `UnifiedAddDialog`'s full dependency graph.

## What's next (later phases of #1221 — not built yet)

Wiring `ServicesPanel`/Labour and Finance onto `versionId` on both the read
AND write side (bundled together, per above); gating `applySaleStockOnAdd`
to the live version so Sale can eventually be re-enabled safely; wiring the
"Move existing group to new category" dialogs' `versionId`; Compare
(#1232); Phase 6's quote-from-a-non-live-version workflow (#1233), which
E2E spec 3 is blocked on; folding drift (state D) and the unlocked-by-a-
person notice (state E) into `VersionStrip`; migrating the OLDER switcher's
remaining surface (FEATUREDOCS/70) off `projectSnapshots` onto
`projectVersions` entirely; narrowing `projects.liveVersionId` to required
once the backfill is proven complete in prod; and closing the remaining 32
version-scope-ratchet sites (Phase 2's "What's deferred") with real
join-filtering. See `docs/designs/project-versioning-v2.md` for the full
plan (not yet merged to `main`).
