# Convex Domain-Only Decommission — Execution Runbook & Resume State

> **Live tracker for the "everything (A+B+C) before reopening prod" effort.**
> Prod is intentionally OFF to users for the duration. All work lands on the
> single integration branch `integration/convex-decommission` and merges to
> `main` ONCE at the very end (one Coolify deploy), immediately before the final
> prod backfill + reopen. Keep this file current as the source of truth.

## Branch model

- **`integration/convex-decommission`** = `main` + every Phase A read PR + (in
  progress) bucket-1/bucket-2 + Phase B + Phase C. Built and validated locally;
  not merged to `main` until the end.
- The ~30 individual `feat/convex-read-*` PRs (#194,#198,#199–#211,#228–#248) are
  the provenance; they are all merged INTO the integration branch (stacked PR
  tips collapse: #203 carries the keystone chain, #210/#238 carry #194). Don't
  merge them to `main` individually — the integration branch supersedes them.

## Status (update each session)

- [x] **Phase A — ungated reads:** DONE. All `feat/convex-read-*` branches merged
      into `integration/convex-decommission`. Validated: `tsc` clean,
      **2364 vitest pass**, `pnpm build` exit 0. Pushed.
- [x] **Phase A — bucket 1 (keystone-blocked reads):** DONE (merged into integration,
      validated `tsc` + **2413 vitest** + `pnpm build` exit 0). Converted the PURE
      keystone-unblocked reads: `availability` (server + `lib/availability.ts`
      incl. `computeOverbookedStatus`), `reservation-conflicts` (conflict-detection
      reads; the TOCTOU swap-guard reads correctly stay Prisma), and the line-item
      **counts/flags** in `dashboard.ts`/`projects.ts`/`suppliers.ts`/`clients.ts`.
      `report-engine.ts` is gone (removed with Reports by #227).
      **Everything still reading `prisma.projectLineItem/Group/Category` is now
      read-then-write, mirror-source, or the `category_slot` terminus** —
      i.e. Phase-B territory (those reads move only when the enclosing mutation
      inverts to Convex-only). Files: `line-items.ts`, `sub-hires.ts`,
      `warehouse.ts`, `warehouse-close.ts`, `bulk-checkin.ts`, `project-categories.ts`,
      `project-groups.ts`, `split-sibling-collapse.ts` (all read-then-write);
      `*-mirror.ts` (mirror-source, deleted in Phase B); `category-slots.ts`
      (terminus); minor `notifications.ts`/`check-records.ts` count leftovers.
      **⇒ Phase A read-rewiring is COMPLETE for all non-write-coupled reads.**
- [ ] **Phase A — bucket 2 (dual-write-blocked):** NOT STARTED. Add a
      `*-mirror.ts` dual-write + `convex-backfill-*.ts` + register in
      `convex-backfill-all.ts` for: `notificationDismissal`, `warehouseDashboardToken`,
      `testTagAuditorToken`, `wooCommerceOrderLog`, `userNotificationPreference`,
      and mirror `maintenanceRecordAssets` (for `getRecentActivity`). Then convert
      their reads. (These straddle A/B — they add write-path code.)
- [~] **Phase B — write inversion:** IN PROGRESS. **Clean tier DONE + validated
      (tsc + 2413 vitest + build, integration tip pushed): `custom-fields`
      (no FK), `test-profiles` (3 SetNull FKs dropped), `brand-templates` (1 SetNull
      FK + PDF-pipeline reader converted).** That exhausts the SetNull-only,
      child-free, cascade-free tier. **Every remaining domain has a `Cascade`
      inbound FK and/or a non-Convex child, so each needs cascade-delete
      re-implementation (higher risk):** `group-templates` (Cascade child
      `groupTemplateItem` — not in Convex; move it first or re-impl cascade),
      `locations` (Cascade from `location_media` + a SetNull set),
      `categories` (Cascade to `category_slot` — itself a non-Convex terminus —
      + 5 SetNull), `suppliers` (3 Cascade: supplierOrder/Item/ModelRate), `models`
      (required Restrict from asset/bulkAsset), then the multi-table core
      (line-items/warehouse/kits/sub-hires). Recommend per-surface preview
      validation from here. Flip
      every domain mutation from Prisma-first+mirror to Convex-only; re-implement
      the invariants Prisma transactions + FK cascades enforce (warehouse
      checkout/checkin, line-item fulfillment, kit composition, sub-hire
      regeneration, accessory expand/collapse, `maxSort`-then-insert ordering,
      cascade deletes) inside Convex mutations (single-document-atomic, no
      cross-table tx → design idempotency/ordering deliberately). Delete the ~19
      `src/lib/*-mirror.ts`. Keep auth/RBAC/activityLog on Prisma.
- [ ] **Phase C — drop Prisma domain tables:** NOT STARTED. Remove domain models
      from `prisma/schema.prisma` (keep Better Auth + `customRole` + `activityLog`),
      delete backfills/parity/mirrors, migrate the DB to drop the tables.
- [ ] **Final prod backfill + cutover + reopen** (see below).

## Bucket-1 progress

- [x] **`availability` (read-only) → Convex.** Branch `wip/bucket1-availability`.
      Converted every line-item read in `src/server/availability.ts`
      (`getModelBookings`, `getAssetBookings`, `getKitBookings`, `getCalendarData`)
      and `computeOverbookedStatus` in `src/lib/availability.ts` from Prisma to
      Convex. The old nested `where: { project: { ... } }` join is replaced by
      fetching the org's flat line items (`projectLineItems.list`) + units
      (`projectLineItemUnits.list`) + projects (`getProjectsByOrg`) and reproducing
      the project-window join, status filters, dedup and quantity math in JS.
      - New pure helpers + Convex fetchers in `src/lib/availability-read.ts`
        (20 unit tests in `availability-read.test.ts`), mapped via the shared
        keystone mappers (`mapLineItemDoc`/`mapUnitDoc`) — keystone helpers NOT edited.
      - **Fidelity note:** the calendar filter (`projectMatchesCalendarWindow`) is
        deliberately looser than the booking filter (`projectMatchesWindow`) — the
        calendar only excludes `CANCELLED`, keeping RETURNED/COMPLETED/INVOICED
        projects exactly as the old Prisma `getCalendarData` did, whereas the
        booking reads exclude the full `notIn` set. Asset bookings union the legacy
        `lineItem.assetId` path with the unit-level (`projectLineItemUnit.assetId`)
        fulfillment path, deduping by line id, same as before.
      - **Stayed Prisma:** nothing in these two files — both were 0-write. Auth-User
        joins n/a here; `clientName` resolution stays in the server-action layer via
        the existing Convex `getClientMap` (already a Convex domain, not Prisma).
      - No new Convex queries added — reused existing `projectLineItems.list`,
        `projectLineItemUnits.list`, `projects.list`.

- **`reservation-conflicts`** (`wip/bucket1-reservation`) — DONE (branch, no PR).
  Converted the PURE conflict-detection reads in `src/lib/reservation-conflicts.ts`
  to Convex: `findProjectConflictsCore` + `findSwapCandidatesCore` now read line
  items + units from the Convex mirror (`projectLineItems.list` / `projectLineItemUnits.list`)
  via new `src/lib/reservation-conflicts-read.ts`, replicating every Prisma `where`
  filter (date-range overlap with inclusive bounds, `status != CANCELLED` on lines,
  `status != RETURNED` on units, exclude-self/templates/dead-status projects,
  kit/retired/lost/inactive asset filter, line-wins-tie-break) in unit-tested pure
  helpers. New helpers only — keystone files untouched. No new Convex query (reused
  existing `list` queries + `mapLineItemDoc`/`mapUnitDoc`). The `swapLineItemAsset`
  server-action's post-swap activity-log read was also moved to Convex
  (`projectLineItems.getById` + `assets.getById`).
  **LEFT ON PRISMA (read-then-write):** `swapLineItemAssetCore` — its pre-write
  line-item lookup and the in-`$transaction` TOCTOU guard reads (`tx.projectLineItem`/
  `tx.projectLineItemUnit.findFirst`) gate `tx.projectLineItem.update`, so they must
  read the same store they write inside the same transaction; converting them would
  re-open the double-booking race the feature closes. (Asset/window context for that
  method still comes from Convex; only the write-gating booking reads stay Prisma.)
  **DEPLOY GATE:** `projectLineItem` + `projectLineItemUnit` Convex backfills must be
  run in prod before this read-rewiring deploys, else conflict detection reads empty.
  The existing `reservation-conflicts.int.test.ts` now requires live mirrored Convex
  data (it drives the cores end-to-end) — re-validate on Coolify preview, not in a
  dev worktree.

- **line-item counts/flags** (branch `wip/bucket1-counts`, off `integration/convex-decommission`):
  Converted the keystone-unblocked projectLineItem COUNT/flag reads to Convex via a
  new pure read helper `src/lib/line-item-count-read.ts` (fetchers
  `getLineItemsByOrg` / `getLineItemsByProjectIds` over `projectLineItems.list` /
  `listByProjectIds`, + unit-tested pure count/group functions). No new Convex
  queries (reused existing `projectLineItems.list` / `listByProjectIds`).
  - `dashboard.ts`: `getDashboardStats` overdueReturns (CHECKED_OUT items in the
    JS-resolved overdue-project set), `getMyHomeData` + `getUpcomingProjects`
    EQUIPMENT per-project `_count.lineItems` groupBys → Convex.
  - `projects.ts`: `getProjects({includeLineItems})` slim list, `getTemplates`
    `_count.lineItems` (non kit-child), `getProjectIssueFlags` line-item input
    findMany → Convex. (`computeOverbookedStatus`'s own overlapping-bookings query
    LEFT on Prisma — shared by warehouse/project-categories, out of bucket scope.)
  - `suppliers.ts`: per-supplier `_count.lineItems` (now an org-wide Convex count
    folded into `getOrgSupplierCounts`) + `getSupplierSubhires` (filter
    subHireId!=null, createdAt-desc, paginate, project select grafted from Convex
    project list) → Convex. `deleteSupplier`'s `_count` guard LEFT on Prisma
    (feeds a same-action delete mutation).
  - `clients.ts`: `getClient` per-project `_count.lineItems` groupBy → Convex.
  - Validation: `tsc` clean, 10/10 new vitest pass, eslint clean (only the
    pre-existing `_id`-strip warning in suppliers.ts).

## Phase B progress (write inversion)

- [x] **`custom-fields` → Convex-only writes.** DONE (commit on integration,
      validated `tsc` + 2413 vitest + build). create/update/delete/reorder write the
      Convex `customFieldDefinitions` doc as sole source of truth; Prisma row + inline
      mirror removed. Re-implemented `@@unique([organizationId,entityType,fieldKey])`
      in app code + the `where:{id,organizationId}` org-guard (verify org via `getById`
      before update/remove/reorder). **Lowest-risk: zero inbound Prisma FK, no child
      table, no cascade → no migration needed.**

- [x] **`test-profiles` → Convex-only writes.** DONE (branch `wip/phaseb-test-profiles`,
      validated `tsc` clean + 2413 vitest pass + eslint clean + `build` exit 0).
      - **Relation reader converted:** `resolveTestProfile` no longer does the Prisma
        `include: { testProfile, asset.model.defaultTestProfile }` cascade. Re-implemented
        over Convex copies, preserving the EXACT fallback order: (1) testTagAsset's own
        `testProfileId` (`getTestProfileFromConvex`, org-guarded), (2) linked
        `asset.modelId → model.defaultTestProfileId` (`getAssetById` → `getModelById` →
        `getFullTestProfileById`, org-guarded), (3) org default for class+type
        (`isDefault && isActive`), (4) any active for class+type, else null.
        `test-tag-table.tsx:124` reads an already-attached serialized `testProfile` (from
        the Convex `profileMap` attach in `test-tag-assets.ts`), not a Prisma relation →
        no change.
      - **FKs dropped:** migration `20260617130000_drop_test_profile_fk_constraints`
        drops `model_defaultTestProfileId_fkey`, `test_tag_asset_testProfileId_fkey`,
        `test_tag_record_testProfileId_fkey` (all `IF EXISTS`). Schema: removed the three
        inbound `@relation` fields + the `Model[]/TestTagAsset[]/TestTagRecord[]`
        back-refs on `TestProfile`; the `*Id` columns stay as plain `String?` cuids (the
        `organizationId` org-cascade FK stays). Not applied locally (prod cutover only).
      - **Writes inverted (Convex-only, no Prisma, no mirror):** `createTestProfile`,
        `updateTestProfile`, `duplicateTestProfile`, `seedDefaultProfiles`,
        `deleteTestProfile` all use `createId()` + `Date.now()` ms via
        `api.testProfiles.create/update/remove`. Deleted the inline
        `mirrorTestProfileToConvex`/`patchTestProfileInConvex` helpers + the
        `prisma`/`toConvexDoc`/`FunctionArgs` imports.
      - **Invariants re-implemented:** `@@unique([organizationId, name])` → app-level
        dedup against ALL org profiles (added `getAllTestProfilesFromConvex`, since the
        existing read helper defaults `isActive` to true and would miss inactive names) on
        create/duplicate-loop/rename; `where:{id,organizationId}` org-guard via
        `getTestProfileFromConvex` before update/delete; `deleteTestProfile`'s
        in-use→soft-deactivate vs hard-delete branch preserved by counting referencing
        rows from Convex (`testTagAssets`/`testTagRecords`/`models` lists) now that the
        `_count` FK relations are gone; `seedDefaultProfiles` keeps the by-name skip + the
        same SEED_PROFILES. The three Json fields pass straight through (`v.any()`).
        `logActivity` calls retained; testedBy/auth stays Prisma.

- [x] **`brand-templates` → Convex-only writes.** DONE (branch
      `wip/phaseb-brand-templates`, validated `tsc` + 2413 vitest + eslint + build).
      Medium-risk (touches the PDF pipeline + 1 inbound FK). create/update/delete/
      set-default/unset-default now write the Convex `brandTemplates` doc as sole
      source of truth (`createId()`+`Date.now()`, `api.brandTemplates.create/update/
      remove`); inline `mirrorBrandTemplateToConvex`/`patchBrandTemplateInConvex` +
      `toConvexDoc`/`FunctionArgs` removed. **Migration**
      `20260617130100_drop_brand_template_fk_constraint` drops
      `document_template_brandTemplateId_fkey` (SetNull); `brandTemplateId` is now a
      plain string cuid (FK removed from `schema.prisma`, back-relation removed from
      `BrandTemplate`). **PDF pipeline:** `lib/pdfme/generate-pdf.ts` no longer
      `include: {brandTemplate:true}` — `documentTemplate` stays a Prisma read, and
      the brand template is resolved from Convex via `getBrandTemplateForOrg(
      brandTemplateId, orgId)` (identical `accentColor`/`footerSettings` shape).
      **Invariants re-implemented:** single-default-per-org (`unsetBrandDefaultsInConvex`
      lists the org's brand templates and clears every other default before setting the
      target); org-guard via `getById` before update/remove; **delete-unlink across BOTH
      stores** — Prisma `documentTemplate.updateMany(brandTemplateId→null)` (PDF path
      still reads Prisma) AND a per-doc Convex `documentTemplates.update` with explicit
      `brandTemplateId: undefined` (the shared mirror helper drops null keys and can't
      clear a field, so the mutation is called directly). headerSettings/footerSettings
      pass through unchanged; `logActivity` kept.
- [x] **`locations` → Convex-only writes (cascade tier).** DONE (branch
      `wip/phaseb-locations`, validated `tsc` clean + 2413 vitest pass + eslint clean
      [0 errors, only pre-existing unused-var warnings] + `build` exit 0). **High blast
      radius — 7 inbound FKs across 7 tables.** **Migration**
      `20260617131000_drop_location_fk_constraints` drops (all `IF EXISTS`):
      `asset_locationId_fkey`, `bulk_asset_locationId_fkey`, `kit_locationId_fkey`,
      `project_locationId_fkey`, `location_parentId_fkey` (self-ref),
      `location_media_locationId_fkey` (was Cascade), and
      `warehouse_dashboard_token_locationId_fkey` (was SetNull). (`stocktake_locationId_fkey`
      no longer exists — table removed by `20260617000000_remove_stocktake`.) Schema:
      removed the inbound `@relation` fields on `Asset`/`BulkAsset`/`Kit`/`Project`/
      `LocationMedia`/`WarehouseDashboardToken`, the self-ref `parent`/`children`, and
      ALL back-relation lists (`assets`/`bulkAssets`/`kits`/`projects`/`media`/
      `warehouseDashboardTokens`/`children`) on `model Location`; the `*Id`/`parentId`
      columns stay as plain strings holding the Convex cuid (the `organizationId`
      org-cascade FK stays). Not applied locally (prod cutover only).
      - **Writes inverted (Convex-only, no Prisma, no mirror):** `createLocation`,
        `updateLocation`, `deleteLocation`, `updateLocationNotes` (+ the WooCommerce
        venue auto-create in `woocommerce.ts`) use `createId()` + `Date.now()` via
        `api.locations.create/update/remove`. Deleted the inline
        `mirrorLocationToConvex`/`patchLocationInConvex` helpers + the `prisma` (write
        path) / `toConvexDoc` / `FunctionArgs` imports (`prisma` kept only for the
        location_media Prisma-side cascade delete below).
      - **Invariants re-implemented:** single-default-per-org (`unsetDefaultsInConvex`
        now lists the org's locations from Convex and clears every other default before
        setting the target); org-guard via `getLocationById` before update/remove;
        **delete guards from Convex counts** (`countLocationRelations` over the org's
        Convex location/asset/bulk-asset lists) — "Cannot delete location with
        sub-locations" if children > 0, "Cannot delete location with assets assigned to
        it" if assets/bulkAssets > 0 (exact prior `_count` semantics); **location_media
        Cascade re-implemented in deleteLocation across BOTH stores** — `location_media`
        is still dual-written (Prisma + Convex mirror; the PDF/detail galleries read it),
        so after the guards pass every locationMedia doc for the location is removed from
        Convex (`api.locationMedia.remove` each, via the new `getLocationMediaGallery`)
        AND the Prisma rows (`prisma.locationMedia.deleteMany`), matching the old
        Cascade (which dropped only the join rows, leaving `file_upload`).
      - **Detail composite rebuilt:** the FK drop broke `getLocation`'s deep Prisma
        `include` (parent/children/assets/bulkAssets/kits/projects/media + `_count`), so
        it's reconstructed from the Convex domain lists in `getLocationDetail`
        (locations-read.ts): parent + children-with-counts, active asset/bulk/kit subsets
        (assetTag asc, take 50) with model attach, projects (createdAt desc, take 20)
        with client attach, the locationMedia gallery with file lookups, and the
        top-level `_count`.
      - **Cross-cutting consumer fixes (FK drop broke ~10 other readers):** every Prisma
        `include: { location }` / nested `project.location` select was converted to a
        Convex attach (`getLocationMap`/`getLocationById`/`attachLocation`): `models.ts`
        getModel (asset/bulk location), `assets.ts` getAsset, `kits.ts` getKit,
        `projects.ts` (getProjects list + search-by-location-name now resolves matching
        location ids from Convex → `locationId: { in }`; getProject location+parent
        inheritance; getTemplates), `crew-communication.ts`, the two crew iCal routes,
        and `warehouse-display.ts` (4 token queries). `TestTagAsset.location` is a plain
        `String?` column (not a relation) — untouched.

- [x] **`suppliers` → Convex-only writes (cascade tier).** DONE (branch
      `wip/phaseb-suppliers`, validated `tsc` clean + 2413 vitest pass + eslint clean +
      `build` exit 0). Highest-FK-fanout domain so far — **5 inbound FKs dropped**.
      **Migration** `20260617131100_drop_supplier_fk_constraints` drops (all `IF EXISTS`):
      `asset_supplierId_fkey`, `project_line_item_supplierId_fkey` (sub-hire),
      `supplier_order_supplierId_fkey` [Cascade], `sub_hire_supplierId_fkey` [Cascade],
      `supplier_model_rate_supplierId_fkey` [Cascade]. Schema: removed all 5 inbound
      `@relation` fields + the `assets/lineItems/orders/subHires/supplierModelRates`
      back-relations on `Supplier`; each `supplierId` stays a plain `String?`/`String`
      cuid referencing the Convex `suppliers` doc. Not applied locally (prod cutover only).
      **Writes inverted (Convex-only, no Prisma row, no mirror):** `createSupplier`,
      `updateSupplier`, `deleteSupplier` use `createId()`+`Date.now()` via
      `api.suppliers.create/update/remove`; inline `mirrorSupplierToConvex`/
      `patchSupplierInConvex` + `toConvexDoc`/`FunctionArgs` imports removed. The
      `updateSupplier` activity-log `before` diff now reads the prior Convex doc
      (`getConvexSupplierById` → `mapSupplier`) instead of a Prisma `findUnique`; empty
      optionals passed as `undefined` (Convex clears the field; read mapper coerces
      absent→null). **Invariants re-implemented:** delete guard
      (assets/lineItems/orders) re-derived from the existing `getOrgSupplierCounts`
      (already all-Convex), preserving the EXACT three messages + order — and because the
      guard blocks deletion whenever any dependent exists, the dropped Cascade FKs never
      fired in practice, so **no full cascade re-impl needed**. The one delete-time
      cleanup that DID rely on a cascade — `supplier_model_rate` (NOT in the guard; a
      supplier with only rates can be deleted) — is re-implemented: `deleteSupplier`
      lists the supplier's rates from Convex and deletes them from BOTH stores
      (`supplier_model_rate` is still dual-written: Prisma `deleteMany` + Convex
      `removeSupplierModelRateFromConvex` per id). Org-guard via `getConvexSupplierById`
      before update/remove. `isActive`/tags pass through; `logActivity`+`buildChanges`
      kept. `getSupplierCounts`/list reads already Convex — left as-is. `prisma` import
      retained ONLY for the dual-written `supplierModelRate.deleteMany`.
- **⚠️ The "low-risk single-table CRUD" tranche is essentially just custom-fields.**
  The other single-table domains I'd flagged as low-risk turned out NOT to be, because
  each still has a residual Prisma **relation reader** that depends on the inbound FK,
  and dropping the FK needs a DB migration:
  - `test-profiles`: `test-tag-profiles.ts:resolveTestProfile` reads `testProfile` +
    `model.defaultTestProfile` via Prisma `include` (3 SetNull inbound FKs to drop).
  - `brand-templates`: `lib/pdfme/generate-pdf.ts` reads `documentTemplate … include:
    {brandTemplate:true}` — **PDF pipeline** (high cross-cutting risk per CLAUDE.md);
    1 SetNull FK + the delete-unlink `documentTemplate.updateMany`.
  These are MEDIUM-risk per-domain passes (convert the relation reader → DB migration
  to drop the FK → invert writes → delete mirror), not part of the low-risk batch.

### Phase B per-domain recipe (for the medium/high-risk domains, next)

1. Convert any residual Prisma **relation reader** of the domain to Convex (so nothing
   reads the FK relation).
2. **DB migration** (hand-authored — `migrate dev` resets; use `migrate deploy`): drop
   the inbound `@relation` FK constraints, leaving the FK columns as plain `String`
   cuids that reference the Convex doc (the `Project.clientId` pattern). Remove the
   `@relation` fields from `prisma/schema.prisma`; regenerate the client.
3. Invert the domain's writes to Convex-only (`api.X.create/update/remove`); generate
   cuids with `createId()`; set `createdAt/updatedAt = Date.now()`.
4. **Re-implement invariants the DB enforced:** `@@unique` → app-level dedup check;
   `onDelete: Cascade` → explicit Convex cascade in the remove path; `where:{id,orgId}`
   → org-guard via `getById` before mutate; `maxSort`-then-insert ordering races →
   Convex-side ordering. Multi-table mutations have NO cross-table transaction in
   Convex → design idempotency/ordering deliberately.
5. Delete the `src/lib/*-mirror.ts` for the domain.
6. Validate `tsc` + `vitest` + `build`; behaviour is human-gated on Coolify preview.

Rough risk order for the remaining domains: test-profiles, brand-templates,
group-templates (Cascade child) → locations, categories, suppliers, models (many
inbound FKs) → assets/bulkAssets, kits, projects, line-items, sub-hires, warehouse
(the multi-table cascade/ordering core — highest risk, do last with preview validation
per surface).

## Merge-time consolidation TODO (before final merge to main)

De-duplicate helper files that multiple branches created (the integration merge
kept one canonical copy of each and unioned functions, but two redundant standalone
files remain):
- `src/lib/project-service-read.ts` (#206) vs `src/lib/project-services-read.ts`
  (#248) — same domain, different filename. Pick one; point both consumers at it.
- `convex/testTagAssets.ts` has `getByTestTagId` AND `getByOrgTestTagId` (identical
  `.first()` queries) — collapse to one, repoint the scan-lookup consumer.
Everything else was unioned in place (assets-read, kits-read, suppliers-read,
crew-read, crew-scheduling-read, maintenance-read, test-tag-read,
convex/projectLineItems.ts, convex/modelCheckItems.ts).

## FINAL prod backfill + cutover runbook (run when A+B+C are code-complete)

Order matters; do it inside the Coolify **prod** app container (env injected, no
`.env` files — drop the `--env-file` flags).

1. **Merge** `integration/convex-decommission` → `main` (one Coolify deploy). The
   deployed code now reads (and, post-Phase-B, writes) Convex.
2. **Backfill prod Convex** (idempotent; one command runs all 38 in order):
   ```
   # inside the prod app container:
   npx tsx scripts/convex-backfill-all.ts
   ```
   Re-run until it reports all-zeros (the heal pass for the deploy-window gap).
3. **Parity-check** Prisma vs Convex:
   ```
   npx tsx scripts/convex-parity-check.ts
   ```
   Expect clean except the known `clients` hard-cutover gap (Convex ahead by design).
4. **Smoke test** the running app (warehouse checkout/checkin, line-item edit, kit
   build, T&T scan, PDF generation) before reopening.
5. **Reopen prod** to users.

Notes:
- Backfills mint a Convex service token from `BETTER_AUTH_SECRET` + the `jwks`
  table — no Convex admin key needed.
- Prod Convex = Cloud `useful-cuttlefish-334`. The dev worktree only has dev creds
  (`groovy-koala-475`), so prod backfills can only be run in the prod container
  (or by adding prod creds to a worktree's `.env.local`).
- The dual-write stays active until Phase B flips writes to Convex-only; until then
  re-running the backfill is always a safe heal.
