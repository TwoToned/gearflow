# Project Versioning v2 — Phase 1 (schema + backfill)

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-15 (review quarterly — POLICY.md R-5.5)_

Parent #1221, this phase #1226. Plan: `docs/designs/project-versioning-v2.md`
§4.2, §6 step 1, §7 (lives on a separate integration branch — not merged to
`main` yet).

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
(`listProjectVersions`/`findVersionByNumber`/`listOrgVersions`) the backfill's
own idempotency check and verification query use — `by_projectId_number` is
a global index (R-8.4.3: a `projectId` cuid is not itself partitioned by
org), so every read through it re-checks `organizationId` against the
caller's own org before returning a row. Covered by
`convex/backfillProjectVersions.test.ts`'s cross-tenant block, which proves
a `projectId` collision across two orgs never leaks a foreign row.

## Testing

- `convex/backfillProjectVersions.test.ts` — one version + `liveVersionId`
  per project (templates included), `number` always 1, every child table
  (including the `categorySlots` PARENT_JOIN case) gets stamped, label
  derivation, dry-run writes nothing, idempotent re-run, the verify query's
  cross-project-pointer check (a `liveVersionId` planted to point at a
  DIFFERENT project's version is flagged), and the cross-tenant read-safety
  block for `listProjectVersions`/`findVersionByNumber`.

## What's next (later phases of #1221 — not built yet)

Save/switch/promote mutations against the new table, a real content-capture
path for non-live versions (the PLAN FIELDS above), migrating the switcher
(FEATUREDOCS/70) off `projectSnapshots` onto `projectVersions`, and
narrowing `projects.liveVersionId` to required once the backfill is proven
complete in prod. See `docs/designs/project-versioning-v2.md` for the full
plan (not yet merged to `main`).
