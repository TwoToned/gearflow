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

**Phase A is therefore NOT complete.** The named work-list (the six surfaces +
the prior batch) is done and preview-gated; bucket 4 is the next tranche of
clean leaf PRs, buckets 1–3 unblock as their gates clear (keystone merge / new
dual-writes / crew backfill).

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
