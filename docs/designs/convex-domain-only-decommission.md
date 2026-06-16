# Convex Domain-Only Decommission — Full Plan

> **Goal:** make Convex the sole store for all **domain** data, keeping a small
> Postgres only for **Better Auth + `customRole` (RBAC) + `activityLog`**.
> Decided 2026-06-16. This is the endgame of the Prisma→Convex migration
> (see [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md) and
> [`convex-hybrid-migration.md`](./convex-hybrid-migration.md)).

> **Status: Phase A IN PROGRESS (2026-06-16).** Everything below Phase 0 ("Done")
> is shipped and stable. Phase A read-rewiring underway — leaf surfaces converting
> one PR at a time (test-tag reports, crew cluster, supplier orders, …). Phases
> B/C not started. Tracked as tasks #4 (Phase A), #5 (Phase B), #6 (Phase C).

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

### Phase A progress log

- **`test-tag-reports.ts` — DONE (PR #194).**
- **Crew cluster — DONE (stacked PRs #195 dashboard → #196 time → #197 assignments).**
  Helpers `crew-scheduling-read.ts` + `users-read.ts`; org-scoped `crewShifts.listByOrg`
  / `crewCertifications.listByOrg`. Deferred: `getCrewMembersForAssignment`. Crew
  deploy gate: backfill crew + crew-scheduling in prod before merge.
- **`supplier-orders.ts` — DONE.** `getSupplierOrders` + `getSupplierOrderById` →
  Convex via `supplier-order-read.ts`; new `supplierOrderItems.listByOrderIds`.
  Independent PR off main. supplierOrder/item backfilled in prod with the sub-hire
  family (gate already satisfied).

**Env note for validators.** The dev worktree can run live Convex reads/backfills
against the shared dev deployment by prefixing `BETTER_AUTH_URL="https://preview.lab.rvlt.app"`
(issuer match; local secret matches the dev JWKS). Seed (`npm run seed` +
`seed:test-tag` / `seed:crew` / `seed:supplier-orders`), then
`BETTER_AUTH_URL=… npx tsx … scripts/convex-backfill-all.ts`, then parity. The
shared dev backend is volatile — re-run the relevant backfill right before validating.

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
