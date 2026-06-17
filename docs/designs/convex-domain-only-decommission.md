# Convex Domain-Only Decommission — Full Plan

> **Goal:** make Convex the sole store for all **domain** data, keeping a small
> Postgres only for **Better Auth + `customRole` (RBAC) + `activityLog`**.
> Decided 2026-06-16. This is the endgame of the Prisma→Convex migration
> (see [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md) and
> [`convex-hybrid-migration.md`](./convex-hybrid-migration.md)).

> **Status: Phase A IN PROGRESS.** The leaf + keystone + the six named
> follow-on surfaces are read-rewired (PRs open, preview-gated — see the
> [Phase A progress log](#phase-a--progress-log-2026-06-16) below). A large
> remainder of read-only domain reads is still on Prisma (inventory + gates in
> the progress log). Phases B/C not started. Tracked as tasks #4 (Phase A), #5
> (Phase B), #6 (Phase C).

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

## Phase A — Progress log (2026-06-16)

Phase A is being shipped one surface per PR, each validated by `tsc + vitest +
eslint` (and CI `Build/Lint/Tests/Type Check` on the base-`main` PRs) by the
agent; **data-correctness is human-gated on the Coolify preview before merge**
(hard constraint #1). Live golden-diff was deferred to unit tests + preview for
this batch (the shared dev Convex is volatile/contended and not the merge gate).

### ⚠️ Post-removal reset (2026-06-17) — READ THIS FIRST

After the surfaces below were opened, **main PR #227 "all-feature-removals"**
landed: ~40,836 deletions / 330 files, removing **Stocktake, Reports tab
(SavedReport + scheduled exports), Damage Capture, Utilization tab, Workshop
kanban, Reorder tab, Discord integration, Org Transfer (export/import), the PDF
template *builder* (PDF generation kept), the built-in camera scanner, warehouse
accessories, crew *certifications*, drag-and-drop, social login, and the pricing
min-cost optimizer** — with DB migrations dropping the corresponding tables/enums
(`stocktakes`, `damage_event`, `saved_report`, `crew_certification`, Discord
tables, bulk_asset reorder columns, …) and a Convex purge tool for orphans.

Recovery applied this session:
- **Closed as obsolete:** **#204** stocktake (`stocktake.ts` + `stocktakes`
  table gone); **#195 / #196 / #197 / #209** the crew stack (the
  `crewCertifications` table was dropped and the certs feature removed → the
  branches reference a deleted table and merge-conflict; also still deploy-gated).
- **Rebased onto new main (clean 3-way merge; CI re-validates):** **#194**,
  **#198**, the keystone chain **#199–#203**, **#205**, **#206**, **#208**,
  **#210**. Each now contains new main.
- **Reworked onto new main:** **#207** document-templates — the builder removal
  gutted `document-templates.ts` 826→147 lines; reworked to convert only the 3
  surviving reads (`getDocumentTemplates`, `getPublishedTemplatesForDropdown`,
  `getDocumentTemplate` — the `system-` virtual-default synthesis + `brandTemplate`
  join survive). (Gate: confirm `documentTemplate` is still dual-written
  post-removal; if not, it becomes a blocked terminus.)
- **New tracked task — crew read-rewiring rebuild:** rebuild the surviving crew
  reads (dashboard minus cert widgets, time, `getProjectCrew` minus cert badges,
  `getCrewMembersForAssignment` + availability) **fresh on post-removal main with
  all `crewCertifications` references stripped**, once the crew-scheduling backfill
  (the standing deploy gate) is addressed. Do NOT rebase the old crew branches —
  rebuild clean.

The "Shipped this program" table and "Remaining Phase A scope" inventory below
were written **before** #227 — treat the removed-feature rows as struck through:
the `reports`, `damage`, `utilization`, `scheduled-reports`, `org-export`,
`stocktake`, Discord `asset-service`/`channel-sync`, and `workshop-kanban`
(maintenance queue) entries no longer exist, so **Phase A's remaining surface is
smaller than stated below.** Bucket 4's still-valid leaf targets are: models,
categories, locations, suppliers, assets, bulk-assets, kits, projects
(list/detail/counts), maintenance (minus workshop queue), check-items,
brand-templates, group-templates, section-presets, project-tasks,
project-managers, custom-fields, tags, scan-lookup. Bucket 1 (keystone-blocked)
is unchanged. Bucket 2/3 gates unchanged (notificationDismissal +
warehouseDashboardToken still not dual-written; crew still backfill-gated).

### Shipped this program (PRs open, not merged — merge order matters)

**Earlier batch (leaf + cluster + keystone):**
- `#194` test-tag-reports (first leaf) → `src/lib/test-tag-read.ts`
- `#195` ← `#196` ← `#197` crew cluster (dashboard / time / project-crew tab) →
  `crew-scheduling-read.ts`, `users-read.ts` (stacked)
- `#198` supplier-orders → `supplier-order-read.ts`
- `#199` keystone reconstruction primitive → `project-line-item-tree-read.ts`
- `#200` ← `#201` ← `#202` ← `#203` keystone consumers (getProject →
  getProjectForWarehouse → getProjectPullSheet → build-document-data/PDF),
  shared `project-line-item-read.ts` (stacked on `#199`)
- `#204` stocktake → `stocktake-read.ts`

**This session (the six named follow-on surfaces):**

| PR | Surface | Base | New `*-read.ts` | New Convex queries | Gate |
|----|---------|------|-----------------|--------------------|------|
| `#205` | check-records (`getCheckHistory`, `getModelFailureAnalytics`) | main (CI green) | `check-record-read.ts` | `checkRecords.listByOrgAndAsset`, `modelCheckItems.listByModel`, `projectLineItems.listByIds` | checkRecord/projectLineItem/modelCheckItem backfilled in prod |
| `#206` | project-services (`getProjectServices`, `…ById`, `getServiceTemplates`, `…Summary`) | main (CI green) | `project-service-read.ts` | `crewAssignments.listByServiceIds` | projectService + serviceTemplate backfilled |
| `#207` | document-templates (5 real-DB reads; virtual system-default synthesis untouched) | main (CI green) | `document-template-read.ts` | none (reused list/getById) | documentTemplate + brandTemplate backfilled |
| `#208` | warehouse-display (`getWarehouseDisplayData` services + line-item counts) | main (CI green) | `warehouse-display-read.ts` | `projectLineItems.listByProjectIds` | projectService + projectLineItem backfilled (done) |
| `#210` | test-tag-assets (`getTestTagAssets`, `…Asset`, `lookup…`, `…DashboardStats`) | `#194` (stacked) | extends `test-tag-read.ts` | `testTagRecords.listByAssetId`, `testTagAssets.getByTestTagId` | testTagAsset/Record/subTest backfilled |
| `#209` | crew `getCrewMembersForAssignment` (the last deferred crew read) | `#197` (stacked) | extends `crew-scheduling-read.ts` | `crewAvailabilities.listByCrewMemberIds` | **crew-scheduling NOT confirmed backfilled in prod — run `convex:backfill:crew-scheduling` + `:crew` BEFORE merging the crew stack** |

Pattern held across all six: thin Convex fetchers + mappers (epoch-ms→Date,
Decimal→number, absent→null, strip `_id`/`_creationTime`), pure JS
filter/sort/attach replicating Prisma `where`/`orderBy`/`include` (Postgres
null-ordering and enum **declared-order** rank maps where applicable), Auth-`User`
joins kept on Prisma via a batched `prisma.user.findMany` (not a violation), and
**no Prisma fallback on a Convex miss** (→ `null`/empty). New Convex queries were
added only to **existing** module files, so `convex/_generated` needs no regen
(`api.d.ts` types each module via `typeof import("../<module>.js")`) and no
shared-dev push was required.

### Wave 2026-06-17b — stuck-on-disk recovery + the named ungated-leaf sweep

A fresh session re-validated four conversions that an earlier session had left
**uncommitted on disk** (a harness-level shell-init failure had killed the prior
run mid-flight), then converted the rest of the named ungated-leaf surfaces. 13
PRs, each its own surface; all base `main` except `#238` (stacked on `#194`).
Every base-`main` PR is **CI-green (Build / Lint / Tests / Type Check)**; `#238`
was built locally (stacked PRs get CI only after retarget). All follow the
established pattern (thin `*-read.ts` fetchers + epoch-ms→Date / Decimal→number /
absent→null mappers + pure unit-tested filter/sort replicating Prisma
`where`/`orderBy`, declared-order enum rank maps, Postgres NULLS ordering; no
Prisma fallback on a miss; new Convex queries added only to **existing** module
files so `convex/_generated` needs no regen).

| PR | Surface | Base | `*-read.ts` | New Convex queries | Notes / what stays Prisma |
|----|---------|------|-------------|--------------------|---------------------------|
| `#228` | test-tag **profiles** (`getTestProfiles`, `getTestProfile`) | main | `test-profiles-read.ts` | none | writes + validation `findFirst`s |
| `#229` | **saved views** (`getSavedViews`) | main | `saved-views-read.ts` | none | all writes |
| `#230` | **brand templates** (`getBrandTemplates`, `…ById`) | main | `brand-templates-read.ts` | none | writes + delete-unlink `updateMany` |
| `#231` | **custom-field definitions** (`getCustomFieldDefinitions`, `getActiveCustomFields`) | main | `custom-fields-read.ts` | none | auth gate + writes |
| `#232` | **media galleries** (`getAssetMedia`/`getModelMedia`/`getKitMedia`/`getProjectMedia`) | main | extends `media-read.ts` | none (reused `listByParent`) | detail-page composites `getAsset`/`getKit`/`getModel` (terminus) |
| `#233` | **check items** (`getCheckItems`/`Counts`/`getCheckItem`/`getModelCheckItems`/`getKitCheckItems`) | main | `check-items-read.ts` | `modelCheckItems.listByModelId`/`listByCheckItemId`, `kitCheckItems.listByKitId` | writes + read-then-write |
| `#234` | **maintenance** (`getMaintenanceRecords`, `getMaintenanceRecord`) | main | `maintenance-read.ts` | none | `maintenanceRecordAsset` join (terminus); workshop queue already removed by #227 |
| `#235` | **group templates** (`getGroupTemplates`) | main | `group-templates-read.ts` | none | `groupTemplateItem` children stay Prisma (terminus); parent from Convex + items attached from Prisma |
| `#236` | **project tasks** (`getProjectTasks`, `getMyOpenTasks`, `getTaskAssignees`) | main | `project-tasks-read.ts` | none (reused `listByProject`/`list`) | auth `member`/`User` assignee half (terminus); crew half from Convex |
| `#237` | **kit/supplier/category trims** (`getKitCounts`, `getAvailable[Bulk]AssetsForKit`, `getSupplierCounts`, `searchContainerAssets`) | main | extends `assets-read`/`kits-read`/`suppliers-read` | none | `getCaseCategoryIds` reads Better Auth `organization.metadata` (terminus) |
| `#238` | **test-tag records** (`getTestTagRecords`, `getLatestTestRecord`, `getAuditorScopeOptions`, `getAuditorPortalData`) | `#194` (stacked) | extends `test-tag-read.ts` | `testTagRecords.listByOrgAndAsset` | **`testTagAuditorToken` reads BLOCKED** (table not dual-written → stay Prisma); `testedBy`=auth User (terminus) |
| `#239` | **crew roster** (`getCrewMembers`/`ById`/`getMyCrewMemberId`/roles/skills/options/departments) | main | extends `crew-read.ts` | none | `getCrewMemberExtras` (all cross-domain joins) + `getCrewSkills` `_count` m2m + `getOrgUsersForCrewLink` member half stay Prisma; **deploy-gated on `convex:backfill:crew`** |
| `#240` | **crew scheduling** (dashboard ×6, time ×3, `getProjectCrew`, `getProjectLabourCost`, `getCrewMembersForAssignment`, availability ×3, calendar ×2) | main | `crew-scheduling-read.ts` | `crewShifts.listByAssignmentIds`, `crewAvailabilities.listByCrewMemberIds` | all writes + read-then-write (incl. `checkCrewConflicts`); `crew-communication.ts` untouched; **deploy-gated on `convex:backfill:crew-scheduling` + `:crew-availability-org`** |

The crew cluster was **rebuilt fresh on post-removal main** (the old `#195`–`#197`
/ `#209` crew stack was closed because it referenced the dropped
`crew_certification` table) — split by table-group into roster
(`crew.ts`→`crew-read.ts`, member/role/skill) and scheduling (the other 5 files →
new `crew-scheduling-read.ts`, assignment/shift/availability/timeEntry) so the two
PRs don't both edit `crew-read.ts`. Both carry the standing crew backfill deploy
gate.

### Wave 2026-06-17c — ungated bucket-4 sweep (the big-domain primary reads) — COMPLETE

The same session then cleared the **entire remaining ungated bucket-4 inventory**:
the primary list/detail/count server reads for the big domains plus the last small
leaves. 8 PRs, each base `main`, validated `tsc + vitest + eslint`, none touching
`convex/_generated`. Where a domain's list is already served reactively by a
`useQuery` hook (so the server action has no live caller), the still-Prisma
`"use server"` export was converted anyway to remove the Prisma dependency and keep
the documented return shape — a safe rewire either way.

| PR | Surface | `*-read.ts` | Converted | Left on Prisma (why) |
|----|---------|-------------|-----------|----------------------|
| `#242` | **models** | extends `models-read.ts` | `getModels` (list/filter/sort/paginate, `_count` + primary photo from mirrors) | `getModel` (detail media composite — terminus); create/update/archive/bulkUpdateRates (read-then-write) |
| `#243` | **assets + bulk-assets** | extends `assets-read.ts` | `getAssets`, `getBulkAssets` | `getAsset`/`getBulkAsset` (detail composite — terminus); update/delete `_count` guards (read-then-write) |
| `#241` | **kits** | extends `kits-read.ts` | `canDeleteKit` (kit row; `projectLineItem.count` ref-check stays Prisma) | `getKit` (detail composite — terminus); #237's count/availability reads; kit-composition read-then-write |
| `#244` | **categories + locations** | extends `categories-read.ts`/`locations-read.ts` | `getCategories`, `getCategoryCounts`, `getCategoryTree`, `getCaseCategoryIds` tree-walk; `getLocations` (tree rebuilt client-side) | `getCategory`/`getLocation` (detail composites); default-toggle unset (read-then-write); #237's `searchContainerAssets`; `org.metadata` (Better Auth) |
| `#247` | **suppliers** | extends `suppliers-read.ts` | `getSuppliers`, `getSuppliersPaginated`, `getSupplierById` | `_count.lineItems` + `getSupplierSubhires` (keystone-blocked); #237/#198 reads |
| `#245` | **projects** | extends `projects-read.ts` | `getCallSheetDates` (scalar dates + projectService + crew counts — no line items) | `getProject` (keystone); `getProjects`/`getTemplates`/`getProjectIssueFlags` (keystone-blocked `_count.lineItems`/overbooked); number-allocation + all mutations (read-then-write) |
| `#246` | **small leaves** (project-managers / tags / scan-lookup) | new `project-managers-read.ts`; `maintenance-read.ts` for tags; reuse for scan | `getProjectManagers`, `getOrgTags` (maintenance tags arm — last Prisma read in the file), scan-lookup `testTagAsset` resolve (+ new `testTagAssets.getByOrgTestTagId`) | add/remove manager (read-then-write); `user` joins (Better Auth) |
| `#248` | **dashboard / notifications / project-costs** | reuse `maintenance-read`/`crew-scheduling-read`/`project-services-read`; `countActiveCrew` added to `crew-read.ts` | dashboard `maintenanceDue`/`activeCrew`/`pendingCrewOffers`; notifications `pendingOffers`/`submittedTimesheets`; project-costs `projectService`+`maintenanceRecord` aggregates (file no longer imports Prisma) | line-item counts/groupBys (keystone-blocked); `getDismissedKeys`+`getRecentActivity` (dual-write-blocked: `notificationDismissal` not mirrored, `maintenanceRecordAssets` not mirrored); invitation/user/org (Better Auth) |

**Caveat for the merge-time consolidator:** several of these branches independently
re-created the same new helper file (`maintenance-read.ts` in `#234` and `#248`;
`crew-scheduling-read.ts` in `#240` and `#248`; `project-service(s)-read.ts` naming
differs between `#206` and `#248`). They don't conflict in isolation but will need
de-duplication when merged together — keep one canonical copy per helper.

**Result: the ungated leaf surface is exhausted.** Every dual-written domain whose
read was a pure, non-keystone, non-blocked server read is now converted on a PR.
What remains is entirely behind the three gates (keystone merge / new dual-writes /
crew prod-backfill) — see the updated bucket status below.

### Confirmed terminuses (do NOT convert — would read empty / break invariants)

- **`category_slot`** — in the Convex schema but **never dual-written** (zero
  `api.categorySlots.*` calls in `src/`) AND every read of it is inside a
  `$transaction` (read-then-write, project-grouping). Double terminus.
- **`warehouseDashboardToken`** — **not dual-written** (no `api.warehouseDashboardTokens.*`
  in `src/`; Convex table empty). All token CRUD + `validateDisplayToken` stay
  Prisma until Phase B adds a dual-write + backfill. (Documented in `#208`.)
- **`organization`** (warehouse-display org name, T&T dashboard `metadata`) — a
  Better Auth table; auth/RBAC domain, Prisma forever.
- Standing terminuses unchanged: auth/RBAC/`activityLog`; read-then-write
  (`aggregate(_max sortOrder)`-before-`$transaction` in line-items/sub-hires;
  `checkPredictiveMaintenance` over freshly-written rows); mirror-source
  (`*-mirror.ts` + backfills); detail-page media composites
  (`getAsset`/`getKit`/`getModel` galleries); `org-export` (reads the Prisma
  anchor by design); `maintenanceRecordAsset`/`notificationEmailLog`/
  `wooCommerceOrderLog` write-path idempotency reads.

### Remaining Phase A scope (NOT yet done — the honest inventory)

A full `prisma.<table>.{findMany,findFirst,findUnique,count,aggregate,groupBy}`
sweep of `src/server` + `src/lib` (incl. the `db.<table>.*` alias used by the
Discord `src/lib/services/` cluster, which a `prisma.`-only grep misses) shows
**~80 read-only domain reads across ~30 files still on Prisma** beyond the
surfaces above. They were intentionally deferred in prior sessions (the live UIs
already read Convex via `useQuery` hooks; the server actions were left on the
dual-write-fresh Prisma mirror "until decommission"). They split into four
buckets by gate:

1. **Keystone-blocked** (need the unmerged `project-line-item-read.ts` /
   `project-line-item-tree-read.ts` from `#199`–`#203`): the many
   `projectLineItem`/`projectGroup`/`projectCategory` readers —
   `project-categories.ts` (`getProjectCategories`, `getUncategorizedLineItems`,
   `getProjectOverbookedStatus`), `category-slots.ts` (`getUncategorizedSubHireGroups`,
   `getUncategorizedProjectGroups`), `project-groups.ts`, `availability.ts`
   (model/asset/kit/calendar bookings), `lib/reservation-conflicts.ts`,
   `lib/utilization.ts`, `lib/report-engine.ts`, `lib/availability.ts`,
   `warehouse-close.ts`, `bulk-checkin.ts`, `dashboard.ts` line-item counts,
   `clients.ts` line-item count, `suppliers.ts` sub-hires, `projects.ts`
   `getProjectIssueFlags`. Convert each once the keystone chain merges.
2. **Dual-write-blocked** (table not dual-written → must add mirror + backfill
   first): `notificationDismissal` (`notifications.ts:getDismissedKeys`),
   `warehouseDashboardToken` (token CRUD). These straddle Phase A/B.
3. **Crew-backfill-gated** (run `convex:backfill:crew-scheduling` + `:crew` in
   prod first): `crew-availability.ts`, `crew-calendar.ts`, plus the merge of
   `#209`/the crew stack.
4. **Ungated, ready-to-convert leaf surfaces** (domain dual-written + backfilled,
   reactive hook already live; the server read is the only Prisma holdout) — the
   bulk of the remainder, each a tidy one-surface PR off main:
   `models.ts`, `categories.ts`, `locations.ts`, `suppliers.ts`, `assets.ts`,
   `bulk-assets.ts`, `kits.ts`, `projects.ts` (list/detail/counts),
   `maintenance.ts`, `damage.ts`, `check-items.ts`, `brand-templates.ts`,
   `group-templates.ts`, `section-presets.ts`, `saved-views.ts`, `reports.ts`
   (saved reports), `scheduled-reports.ts`, `project-tasks.ts`,
   `project-managers.ts`, `custom-fields.ts`, `tags.ts` (`getOrgTags` — last
   Prisma read in the file), `scan-lookup.ts` (stale "no Convex mirror" comment —
   testTagAsset now mirrored), `woocommerce.ts` (`getWooCommerceOrderLogs`
   read-only **viewer** — distinct from the write-path idempotency terminus),
   `dashboard.ts`/`notifications.ts` non-line-item composites,
   `lib/project-costs.ts`, `lib/services/asset-service.ts` +
   `channel-sync-service.ts` (the `db.*`-alias Discord reads).

**Phase A status (post-2026-06-17c): the ungated/unblocked half is COMPLETE; the
remainder is fully gated.** Every dual-written domain whose read was a pure,
non-keystone, non-blocked server read is now converted on a preview-gated PR. The
honest inventory below was the pre-wave snapshot; the bucket-by-bucket status that
follows it is authoritative. The three remaining gates and their unblock actions:
1. **Merge the keystone chain `#199`–`#203`** → then convert the bucket-1
   projectLineItem/Group/Category readers (they reuse the keystone helpers; building
   them on the unmerged chain would be a fragile deep stack, so they wait for merge).
2. **Add dual-write + backfill** for the 5 bucket-2 tables, run each backfill in
   prod, then convert their reads.
3. **Run the crew backfills in prod** (`convex:backfill:crew` + `:crew-scheduling` +
   `:crew-availability-org`) → then `#239`/`#240` can merge.
Only after all three clear is Phase A 100% done and Phase B (write inversion)
unblocked.

**Post-wave-2026-06-17b status update.** The wave above cleared a large slice:
- **Bucket 4 — DONE this wave:** maintenance (`#234`), check-items (`#233`),
  brand-templates (`#230`), group-templates (`#235`), saved-views (`#229`),
  project-tasks (`#236`), custom-fields (`#231`), test-profiles (`#228`), media
  galleries (`#232`), and the kit/supplier/category read-trims (`#237`). Several
  bucket-4 rows were **already deleted by #227** and are moot: `damage.ts`,
  `reports.ts`/`scheduled-reports.ts`, `lib/services/asset-service.ts` +
  `channel-sync-service.ts` (Discord), workshop-queue.
- **Bucket 4 — NOW EXHAUSTED (wave 2026-06-17c, PRs `#241`–`#248`):** the big-domain
  primary reads (`models`, `assets`+`bulk-assets`, `kits`, `categories`+`locations`,
  `suppliers`, `projects` non-line-item), the small leaves (`project-managers`,
  `tags getOrgTags`, `scan-lookup`), and the non-blocked `dashboard`/`notifications`/
  `project-costs` reads are all converted on PRs. `section-presets.ts` was deleted by
  #227 (moot). `woocommerce.ts` (`getWooCommerceOrderLogs` viewer) turned out to be
  **bucket 2, not bucket 4** — `wooCommerceOrderLog` is not dual-written. So **no
  ungated leaf reads remain**; everything still on Prisma is behind a gate (1/2/3).
- **Bucket 3 — DONE this wave (still deploy-gated):** `crew-availability.ts` +
  `crew-calendar.ts` (and dashboard/time/assignments) shipped in `#239`/`#240`.
  These **must not merge** until `convex:backfill:crew` + `:crew-scheduling` +
  `:crew-availability-org` have run against prod Convex.
- **Bucket 2 — the now-complete dual-write-blocked set:** `notificationDismissal`
  (+ `getRecentActivity`'s un-mirrored `maintenanceRecordAssets` join, `#248`),
  `warehouseDashboardToken`, `testTagAuditorToken` (`#238`), `wooCommerceOrderLog`
  (the `getWooCommerceOrderLogs` viewer — confirmed not dual-written, `#248`-adjacent),
  and `userNotificationPreference`. Each needs a `*-mirror.ts` dual-write + a
  `convex-backfill-*.ts` (+ a prod backfill run) before its read can move — write-path
  groundwork that straddles Phase A/B. **Deliberately NOT attempted in the read-only
  waves.**
- **Bucket 1 (keystone-blocked)** — the projectLineItem/projectGroup/projectCategory
  readers. **Unblocks the instant the `#199`–`#203` keystone chain merges**; the
  `project-line-item-read.ts` / `project-line-item-tree-read.ts` helpers it produces
  are exactly what these readers reuse. This is now the single largest remaining
  Phase A tranche: `project-categories.ts`, `category-slots.ts`, `project-groups.ts`,
  `availability.ts` + `lib/availability.ts`, `lib/reservation-conflicts.ts`,
  `lib/report-engine.ts`, `warehouse-close.ts`, `bulk-checkin.ts`, the
  `dashboard.ts`/`notifications.ts` line-item counts, `suppliers.ts` sub-hires +
  `_count.lineItems`, and `projects.ts` `getProjects`/`getTemplates`/
  `getProjectIssueFlags`.

---

## Phase B — Write inversion (task #5, blocked by A)

### Readiness (as of 2026-06-16): NOT READY — Phase A must finish first

Phase B is **blocked by the remaining Phase A inventory above.** Inverting a
mutation to Convex-only is only safe once *every* read of that domain (across all
surfaces) is already on Convex — otherwise a still-Prisma reader would observe a
row the Convex-only write never created. Concretely, before Phase B can start:

1. **Finish Phase A bucket 4** (the ungated leaf reads) and **merge the keystone
   chain** to unblock bucket 1. Until the `projectLineItem` family of readers is
   fully on Convex, the highest-value mutations (checkout/checkin, line-item
   fulfilment, kit composition) cannot invert.
2. **Add dual-write + backfill for the two Phase-A/B straddlers**
   (`notificationDismissal`, `warehouseDashboardToken`) so they have a Convex
   copy to read *and* a safety-net mirror to drop later.
3. **Run the crew-scheduling backfill in prod** and merge the crew stack
   (`#195`–`#197`, `#209`).

What Phase B then entails (unchanged): flip each mutation from Prisma-first+mirror
to Convex-only, re-implementing the cross-table invariants Prisma `$transaction` +
FK cascades enforce (warehouse checkout/checkin, line-item fulfilment, kit
composition, sub-hire regeneration, accessory expand/collapse, the
`maxSort`-then-insert ordering races, cascade deletes) inside Convex
single-document-atomic mutations (idempotency + ordering + conflict handling by
design); then delete the ~19 `src/lib/*-mirror.ts` + the now-dead mirror-source
reads. Keep the dual-write as a per-surface safety net until each mutation is
proven on preview, dropping the mirror only after. auth/RBAC/`activityLog` writes
stay Prisma.

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

## Phase C — Drop Prisma domain tables (task #6, blocked by B)

- Remove the domain models from `prisma/schema.prisma` (keep the auth/RBAC/audit
  subset).
- Delete the backfill scripts + parity check + dual-write infra.
- Migrate the DB to drop the now-unused domain tables.
- Result: a small Postgres for Better Auth + `customRole` + `activityLog`;
  everything else lives in Convex.

---

## Resumption checklist (new session)

1. Read this doc + `FEATUREDOCS/54` + tasks #4/#5/#6.
2. Confirm prod parity still clean (`scripts/convex-parity-check.ts`).
3. Start Phase A on a leaf surface, one PR, validate on Coolify preview, merge.
4. Keep `git`/CI green each step; never commit feature work straight to `main`
   (this plan doc is the exception — docs only).
