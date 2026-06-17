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
- [ ] **Phase B — write inversion:** NOT STARTED. The large, high-risk half. Flip
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
