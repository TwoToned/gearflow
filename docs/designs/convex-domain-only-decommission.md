# Convex Domain-Only Decommission — Full Plan

> **Goal:** make Convex the sole store for all **domain** data, keeping a small
> Postgres only for **Better Auth + `customRole` (RBAC) + `activityLog`**.
> Decided 2026-06-16. This is the endgame of the Prisma→Convex migration
> (see [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md) and
> [`convex-hybrid-migration.md`](./convex-hybrid-migration.md)).

> **Status: Phase A IN PROGRESS (2026-06-16).** Leaf surfaces converting one PR at
> a time (test-tag reports, crew cluster, supplier orders done); the **keystone
> line-item-tree reconstruction primitive is built + validated** (wiring its 4
> consumers is the next step — see the Keystone section). Phases B/C not started.
> Tracked as tasks #4 (Phase A), #5 (Phase B), #6 (Phase C).

---

## Decision & scope

"Wipe out Prisma" = **domain data Convex-only**, NOT eliminate Postgres entirely.

- **Moves to Convex (the target):** all 9 core domains (asset, bulkAsset, kit,
  model, category, location, supplier, project, client) + their dual-written
  sub-tables (line items/units/services/groups/categories/managers/tasks, kit
  composition, sub-hires, supplier orders, accessory joins, supplier rates,
  scan logs, check records, T&T, media, damage, maintenance, stocktake,
  warehouse close, saved reports/views, file uploads, crew, templates, etc.).
- **Stays on Postgres FOREVER (out of scope):** Better Auth tables
  (`user/session/account/verification/organization/member/invitation/jwks/
  twoFactor/backupCode/passkey/ssoProvider/pendingSSOApproval`), `customRole`
  (RBAC — Convex is never the authZ source of truth), `activityLog` (audit).
  Eliminating Postgres entirely would require migrating Better Auth off its
  Prisma adapter — explicitly a separate, later project, not this one.

## Why this is safe to keep hybrid if we stop

The current steady state (Postgres = durable write anchor + auth, Convex =
reactive read layer, every mutation dual-writes Prisma-first then mirrors) is a
legitimate permanent architecture. This program is opt-in cleanup, not a
correctness fix. Nothing breaks if we pause between phases.

---

## Hard constraints / ground rules

1. **Verification gap.** The dev worktree cannot run Convex or the app (local DB
   lacks Better Auth migrations; Convex isn't configured for tests). So each
   change gets `tsc + vitest + build` from the agent, but **data-correctness is
   validated by the human on the Coolify PR preview before merge.** This cadence
   is mandatory.
2. **Execution model: one surface per PR.** Small, independently shippable,
   preview-validated. Lowest-risk leaf surfaces first; keystone (line-item tree)
   once the pattern is proven; write-inversion last.
3. **No Prisma fallback on a Convex miss** — a miss yields `null` (same as a
   Prisma join against a deleted row). Falling back hides mirror drift.
4. **Convex dates are epoch-ms numbers**; convert with `new Date(n as number)`.
   Money (Prisma Decimal) comes back as `number`. `status`/optional fields may be
   `string | undefined` — guard with `?? ...`.
5. **Backfills on Coolify:** run `npx tsx scripts/convex-backfill-X.ts` DIRECTLY
   in the app container (NOT `npm run` — the `--env-file=.env` flags fail because
   Coolify injects env vars and there is no `.env` file). Service token mints from
   `BETTER_AUTH_SECRET` + the `jwks` table; no Convex admin key is needed.

---

## Phase 0 — Done (shipped to prod)

- Cross-domain Prisma reads (the 9 core domains) decommissioned across the server
  surface, PDF pipeline, reports, CSV, WooCommerce, warehouse-display.
- Dual-write groundwork complete for every remaining sub-table:
  - Tier 2: `projectLineItemUnit`, `assetBulkChild`, `modelBulkAccessory`,
    `supplierModelRate`.
  - Tier 3: `testTagAsset`, `testTagRecord`, `subTestRecord`, `assetScanLog`,
    `checkRecord` (T&T + event tables).
  - Skipped by decision (no safe read payoff): `notificationEmailLog`,
    `wooCommerceOrderLog`, `maintenanceRecordAsset`.
- All 9 backfills run in prod (Coolify) + parity clean except the expected
  `clients` hard-cutover gap (Convex ahead of the frozen Prisma `client` table —
  by design). Parity check now covers the new tables.
- Prod moved to Coolify; prod Convex = Cloud `useful-cuttlefish-334`.

---

## Phase A — Read-rewiring (task #4)

Move every remaining Prisma **domain read** to Convex. Deploy gate is satisfied
(prod Convex fully backfilled).

**Scale:** ~460 read sites across ~40 files; ~20 new `lib/*-read.ts` helpers.

### What MOVES vs what STAYS

- **MOVE** — read-only reads that back a UI response or server-action return.
- **KEEP: read-then-write** (~50) — a read inside the same action that then
  mutates based on it. Unsafe to move (eventual consistency). Especially the
  `aggregate({ _max: { sortOrder } })`-before-`$transaction` patterns in
  `line-items.ts` (~L908, ~L1014) and `sub-hires.ts` (~L510) — these are
  TOCTOU-sensitive; they move only in Phase B when the whole mutation goes
  Convex-only.
- **KEEP: mirror-source** (~37) — `lib/*-mirror.ts` + backfills read Prisma to
  copy INTO Convex. Removed in Phase B with the mirrors.
- **KEEP: auth/RBAC/audit** (~161) — forever-Prisma.
- **KEEP: detail-page media composites** — `assets.ts:getAsset`, `kits.ts:getKit`
  compose `*_media` galleries inside a large cross-domain query; documented
  terminus until Phase B (splitting one include is gratuitous risk).

### Keystone: the shared line-item-tree reader

`getProject` (equipment editor), `getProjectForWarehouse`, `getProjectPullSheet`,
and `build-document-data` all read the same `project → categories → groups →
lineItems → (units / childLineItems / kit / asset / bulkAsset)` tree from Prisma.
Build ONE Convex tree reader that reconstructs the nested tree from flat
`listByProject` rows, reusing the existing attach helpers
(`attachLineItemTree` = model+supplier, `attachKitTree`, `attachAssetBulkAssetTree`)
plus units (now dual-written) and category/group grouping. The
tree-reconstruction logic is pure → unit-test it with fixtures before wiring.
Convert this once and all four consumers follow. **Highest leverage, highest
risk — do it after the pattern is proven on leaf surfaces.**

Cross-cutting reminder: the PDF pipeline has 5 independent `DocumentLineItem`
consumers (see CLAUDE.md). Any data-shape change needs the full-pipeline
integration test, not just plugin-level tests.

#### Keystone progress — reconstruction primitive DONE (reader built, wiring next)

`src/lib/project-line-item-tree-read.ts` is the pure tree-reconstruction core
(`indexChildren` / `indexUnits` / `reconstructScope` / `reconstructCategories`),
fixture-unit-tested (`*.test.ts`) and validated by a structural golden-diff vs
Prisma `getProject` on the seeded project (grouped tree byte-matches). It takes
flat Convex rows (caller maps Convex docs → rows) and rebuilds the exact nested
shape; the existing attach helpers then decorate it. **Semantics nailed down
(load-bearing for the wiring):**

- **Dual projection.** A `lineItems` array is the *relation* for its scope, not
  just parents: `project.lineItems` = ALL non-CANCELLED items (parents AND
  children); `group.lineItems` = `groupId === g.id`; `category.lineItems` =
  `categoryId === c.id AND groupId == null`. A child appears BOTH as a scope entry
  and nested under its parent. Consumers split via `isKitChild`/`parentLineItemId`
  (structureLineItems, build-document-data `topLevelItems`).
- **Include depth is explicit.** getProject top-level nests `childLineItems` 2
  deep, grouped 1 deep; build-document-data per its own include. Past the depth the
  `childLineItems` key is ABSENT (not `[]`).
- **Tie-order is non-deterministic.** `sortOrder` is per-scope sequential, so the
  flat top-level `project.lineItems` has global ties → Postgres returns them in
  physical order, unreplicable from Convex. The GROUPED tree (what the editor
  renders) has distinct within-scope sortOrder and matches exactly. Wiring should
  not depend on flat top-level tie-order (golden-diff the grouped tree exactly +
  the flat list as a set).

**Wiring follow-ups (each its own PR, golden-diffed on an enriched seed with
kits/children/units/accessories/CANCELLED):** getProject → getProjectForWarehouse
→ getProjectPullSheet → build-document-data (PDF, with the full-pipeline
integration test). Each needs a full-row Convex→Prisma mapper (date fields →
Date, Decimal → number across the ~50-field ProjectLineItem; units carry
`asset`/`bulkAsset` as `{id,assetTag}` selects) + the existing attach passes
(attachLineItemTree → attachKitTree → attachAssetBulkAssetTree [+ check-counts for
warehouse]).

**Consumer 1/4 — `getProject` DONE** (PR `feat/convex-read-get-project`, stacked
on the primitive PR). The full-row mapper + fetch + attach live in
`src/lib/project-line-item-read.ts` (`buildProjectEquipmentTree`); getProject now
reconstructs categories/groups/lineItems/units from Convex and keeps Prisma only
for the project scalars + location + projectManagers + media. New batch Convex
query `projectLineItemUnits.listByLineItemIds`. Per-consumer shape pinned: units =
`{id,assetTag}` selects, line item = plain `kit` (no `_count`), asset/bulkAsset/kit
via a new `attachAssetBulkKitPlain` (raw docs, dates → Date). Validated by mapper
unit tests + a live structural golden-diff vs the old Prisma include on an enriched
project (kit→child→grandchild, accessory parent+children, units incl. CANCELLED, a
CANCELLED top-level line): grouped tree byte-matches, flat list matches as a set,
per-node structure (depth truncation, CANCELLED exclusion, resolved
model/supplier/asset/kit ids) all match. **2/4–4/4 (warehouse → pull-sheet → PDF)
reuse these fetchers + mappers; only the attach shape differs (warehouse needs
`attachKitTree` `_count` + full asset on units).**

**Consumer 2/4 — `getProjectForWarehouse` DONE** (PR `feat/convex-read-warehouse-tree`,
stacked on consumer 1). `buildWarehouseLineItems` reuses the mappers; the
reconstruction primitive gained a backward-compatible `keepCancelled` option
(warehouse keeps every status, getProject drops CANCELLED tombstones). Flat
EQUIPMENT scope, full asset on units (`attachAssetBulkAssetTree`), model/kit
`_count` grafts. Golden-diffed vs the old Prisma include + attach pipeline (SERVICE
line excluded, CANCELLED EQUIPMENT line included, CANCELLED unit excluded): id-set
+ per-node structure match.

**Consumer 3/4 — `getProjectPullSheet` DONE** (PR `feat/convex-read-pull-sheet`,
stacked on consumer 2). `buildPullSheetLineItems` — flat EQUIPMENT scope, drops
CANCELLED (default), no units, full asset attach + per-asset `location` graft;
returns `{ lineItems, locationMap }` so the caller resolves `project.location` too.
Golden-diffed vs the old include + attach + graft.

**Consumer 4/4 — `build-document-data` (PDF) DONE** (PR `feat/convex-read-pdf-data`,
stacked on consumer 3). `buildDocumentLineItemData` — no type filter, drops
CANCELLED, depth 2, per-line category/group selects, units in the PDF SELECT shape,
model/supplier/kit/asset attach; returns `{ lineItems, categories }`. subHire
supplier now via `getSupplierMap`. Validated by (1) a live full-pipeline golden-diff
(reconstructed tree + categories + `structureLineItems` output match the old Prisma
path) and (2) a new `document-data-reconstruction.test.ts` running flat Convex docs
through the whole pipeline (reconstruction → structure → filter → height → render).
**Keystone done — all four consumers reconstruct from Convex.** Remaining Phase A:
stocktake, check-records, project-services, category-slots, warehouse-display,
test-tag-assets, document-templates, crew availability, + a final sweep.

### New read helpers needed (priority by MOVE-read frequency)

1. `projectLineItem-read.ts` (+ `projectLineItemUnit`) — biggest
2. `subHire-read.ts` (+ Item/Group)
3. `crewAssignment-read.ts` (+ crewTimeEntry/Availability/Certification)
4. `maintenanceRecord-read.ts`
5. `projectService-read.ts`, `projectManager`, `projectGroup`, `projectCategory`, `projectTask`
6. `stocktake-read.ts` (+ Item)
7. `testTag-read.ts` (testTagAsset/testProfile), `checkRecord-read.ts`
8. `supplierOrder-read.ts`, `supplierModelRate`, `assetScanLog`, `assetBulkChild`, `modelBulkAccessory`
9. `documentTemplate`/`serviceTemplate`/`brandTemplate`/`groupTemplate`, `savedReport`/`savedTableView`, `fileUpload`, `discordIntegration`, `warehouseClose`
   - (existing: assets, bulkAssets, kits, models, categories, locations, suppliers, projects, clients, crewMember, line-item-tree)

### Top files by MOVE count (work-list anchors)

`sub-hires.ts`, `line-items.ts`, `project-services.ts`, `stocktake.ts`,
`org-export.ts`, `test-tag-assets.ts`, `crew.ts`, `kits.ts`, `projects.ts`,
`warehouse.ts`, `test-tag-reports.ts`, `crew-assignments.ts`, `crew-time.ts`,
`check-items.ts`, `supplier-orders.ts`, `check-records.ts`, `crew-dashboard.ts`,
`category-slots.ts`, `warehouse-display.ts`, `document-templates.ts`.

### Suggested ordering

1. Leaf surfaces (low blast radius): crew-dashboard, reports/exports
   (`org-export`, `test-tag-reports`), `document-templates`, stocktake lists.
2. Mid: crew cluster, test-tag cluster, sub-hire detail/list, supplier-orders.
3. Keystone: line-item-tree reader → getProject → warehouse → pull-sheet → PDF.

---

## Phase B — Write inversion (task #5, blocked by A)

The hard, high-risk half. After all domain reads are on Convex:

- Flip every server-action mutation from **Prisma-first + mirror** to
  **Convex-only**.
- Re-implement the invariants Prisma transactions + FK cascades currently
  enforce, inside Convex mutations: warehouse checkout/checkin, line-item
  fulfillment, kit composition, sub-hire regeneration, accessory expand/collapse,
  the `maxSort`-then-insert ordering races, cascade deletes. Convex is
  single-document-atomic with no cross-table transactions, so multi-table
  invariants must be designed deliberately (idempotency, ordering, conflict
  handling).
- Delete the ~19 `src/lib/*-mirror.ts` and the now-dead mirror-source reads.
- Keep auth/RBAC/activityLog writes on Prisma.

This phase carries real data-integrity risk in prod; sequence carefully, keep
the dual-write as a safety net until each mutation surface is proven on preview,
and only then drop the mirror for that surface.

---

## Phase C — Invert FK-anchor mirrors + drop Prisma domain tables (task #6)

> **Scope reconciliation (2026-06-18).** The original Phase C above assumed Phase B
> inverted *all* writes. It did not: Phase B inverted only the **safely-invertible**
> (leaf / no-inbound-FK) tables. The **12 remaining mirror clusters still dual-write
> Prisma-first** because they are **FK anchors** — other still-Prisma domain rows hold
> FK constraints pointing into them, so their Prisma row must exist. Inverting them
> (with the transactional-invariant re-implementation the Phase B section describes)
> therefore belongs to Phase C, gated behind dropping those FK constraints first.
>
> Remaining mirrors: `asset` (+bulk, bulk-child, scan-log), `kit` (+items),
> `project`, `line-item`, `line-item-unit`, `crew` (member/role/skill),
> `crew-scheduling` (assignment/shift/availability/time-entry), `file-upload`,
> `media` (7 `*_media`), `sub-hire` (+item/group, supplier-order),
> `warehouse-close`, `project-subtable` (service/task/manager).

**FK boundary is clean (verified):** no kept table (auth / `customRole` /
`activityLog`) has an FK into any domain table — `activityLog.{projectId,assetId,
kitId}` are plain soft-string columns, `customRole` references only `organization`.
So dropping domain tables can never violate a constraint on a kept table; the only
schema edits on kept models are deleting Prisma back-relation array fields.

### Sequenced stages (one surface per PR, preview-validated)

- **Stage 1 — drop domain↔domain FK constraints** *(IN PROGRESS — branch
  `phase-c/stage-1-drop-domain-fk`, migration
  `20260618110000_drop_domain_domain_fk_constraints`)*. One self-discovering
  migration drops every FK where **both** endpoints are domain tables, preserving
  domain→`user`/`organization` (those vanish with the table drop in Stage 4).
  Unblocks order-independent write-inversion. Non-destructive (constraints, not
  data). Validated locally in a rolled-back txn: matches the domain↔domain FK set,
  preserves the domain→auth set.
- **Stage 2 — invert the 12 mirrors to Convex-only** (~8–12 PRs, leaf→root). Each
  PR builds the real Convex mutation with re-implemented invariants (cascade
  deletes, `maxSort`-then-insert ordering races, kit composition, sub-hire
  regeneration, warehouse checkout/checkin), removes the Prisma write + mirror
  call, deletes the `*-mirror.ts` file, and is preview-validated before the mirror
  is dropped. Order: **warehouse-close** → file-upload+media → crew → crew-scheduling
  → project-subtable → asset → kit → sub-hire → **project+line-item (keystone, last;
  full-pipeline PDF integration test)**.
- **Stage 3 — schema removal** (1 PR): delete the 71 domain models + orphaned
  `User`/`Organization` back-relation arrays from `schema.prisma`; `prisma validate`
  + `generate` clean; grep-gate zero `prisma.<domainModel>.` remaining.
- **Stage 4 — drop tables** (1 PR, irreversible): hand-authored migration via
  `migrate deploy`, single `DROP TABLE IF EXISTS … CASCADE` over the 71 domain
  tables + implicit `_CrewMemberToCrewSkill`. Pre-drop `pg_dump` is the only data
  rollback.
- **Stage 5 — infra cleanup** (1 PR): delete backfill scripts (44), parity-check,
  resync/purge/roundtrip scripts + their `package.json` entries; **keep**
  `convex-client.ts`, `convex-auth*.ts`, all `*-read.ts`. Update docs.

**Also in Phase C (independent of the FK web):** migrate `SiteSettings`
(`site_settings`) to Convex — the `siteSettings` Convex table/CRUD exists but the
app still reads/writes `prisma.siteSettings` (`platform.ts`, `auth.ts`,
`site-admin.ts`, two route handlers). Its own small PR (relation-isolated singleton).

**Result:** a small Postgres for Better Auth + `customRole` + `activityLog`;
everything else lives in Convex.

---

## Resumption checklist (new session)

1. Read this doc + `FEATUREDOCS/54` + tasks #4/#5/#6.
2. Confirm prod parity still clean (`scripts/convex-parity-check.ts`).
3. Start Phase A on a leaf surface, one PR, validate on Coolify preview, merge.
4. Keep `git`/CI green each step; never commit feature work straight to `main`
   (this plan doc is the exception — docs only).
