# Project Versioning v2 — Phase 1 (schema + backfill) + Phase 2 (index rename + reads)

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-15 (review quarterly — POLICY.md R-5.5)_

Parent #1221. Phase 1 is #1226 (below); Phase 2 is #1228 (its own section
further down). Plan: `docs/designs/project-versioning-v2.md` §4.2, §4.9, §6,
§7 (lives on a separate integration branch — not merged to `main` yet).

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

## What's next (later phases of #1221 — not built yet)

Save/switch/promote mutations wired to a UI, a real content-capture path for
non-live versions' PLAN FIELDS (Phase 2 only added the row-cloning primitive,
`materializeVersionRowsNative` — no caller yet), migrating the switcher
(FEATUREDOCS/70) off `projectSnapshots` onto `projectVersions`, narrowing
`projects.liveVersionId` to required once the backfill is proven complete in
prod, and closing the remaining 32 version-scope-ratchet sites above with
real join-filtering. See `docs/designs/project-versioning-v2.md` for the
full plan (not yet merged to `main`).
