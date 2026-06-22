# Convex Core Inversion — Consistency Design (Phase C, hard half)

> **Scope:** the entangled transactional core that remains after the cleanly-
> invertible clusters shipped (warehouse-close, media, crew-roster, SiteSettings).
> This doc fixes the consistency model + sequencing so the core can be inverted
> Prisma→Convex-only without shipping double-allocation / cascade / double-booking
> bugs. Read with [`convex-domain-only-decommission.md`](./convex-domain-only-decommission.md)
> and the `convex-migration` memory.

## 0. The load-bearing correction

Earlier notes framed this as *"Convex has no cross-table transactions, so use
eventual consistency / reconcile."* **That is wrong and it makes the design worse.**

**A single Convex mutation is fully ACID + serializable across every document and
table it reads or writes.** The only real limit is that a transaction cannot span
*multiple* mutation calls or the network. So the rule is:

> **Every Prisma `$transaction` that spans multiple tables becomes ONE purpose-built
> Convex mutation that does the whole multi-table operation.** Convex's OCC gives
> the atomicity and the concurrency safety (the loser of a write-write race retries
> and re-reads) — the same mechanism already proven by `warehouseCloses.closeOutIfNotClosed`.

This converts the core inversion from a scary distributed-consistency problem into
a **logic-porting problem**: move each `$transaction`'s body into a Convex mutation
that uses `ctx.db` instead of `tx`. The server action shrinks to: permissions + Zod
+ orchestration of side effects that *can't* live in a mutation (S3, email) + the
activity log (Prisma, kept) + the one Convex mutation call.

What CANNOT go in a Convex mutation (must stay in the server action, around the call):
S3/storage, email, `fetch`, Node APIs, `Date.now()`-derived non-determinism is fine
(mutations may use it), reads from kept Prisma tables (User/Member/activityLog).

## 1. The unit of inversion is a TABLE, not a "surface"

A table can't be half-Prisma-half-Convex. The moment a table is Convex-only, **every
writer of that table must write Convex** — otherwise a Prisma writer and a Convex
writer split-brain it. So:

> **The inversion unit = one table + ALL its writers, flipped in a single PR.**
> Tables whose writers share a `$transaction` must flip in the SAME PR (the shared
> transaction becomes one Convex mutation touching both tables).

This is why the core can't be done as many small per-surface PRs: `projectLineItem`
is written by ~11 files; `crewAssignment` by 3 incl. `project-services.ts`. Each
table flips wholesale.

### Table → writers map (the flip groups)

Derived from the cluster mappings (verify with a fresh grep before each PR):

- **`projectLineItem` + `projectLineItemUnit` + `lineItemMergeMap`** — writers:
  `line-items.ts`, `warehouse.ts`, `category-slots.ts`, `project-groups.ts`,
  `project-categories.ts`, `project-services.ts`, `sub-hires.ts`, `bulk-checkin.ts`,
  `check-records.ts`, `split-sibling-collapse.ts`, `woocommerce.ts`. **The spine.**
- **`asset` + `bulkAsset` + `assetBulkChild` + `assetScanLog`** — writers:
  `assets.ts`, `bulk-assets.ts`, `asset-accessories.ts`, `warehouse.ts`,
  `bulk-checkin.ts`, `check-records.ts`, `test-tag-records.ts`, `maintenance.ts`,
  `kits.ts`, `models.ts`. Warehouse checkout mutates asset status **and** line items
  together → asset + line-item flip groups overlap on `warehouse.ts`.
- **`kit` + `kitSerializedItem` + `kitBulkItem`** — `kits.ts`, `projects.ts`,
  `warehouse.ts`, `site-admin.ts`.
- **`subHire` + `subHireItem` + `subHireGroup` + `supplierOrder` + `supplierOrderItem`**
  — `sub-hires.ts`, `category-slots.ts`.
- **`projectCategory` + `projectGroup` + `categorySlot`** — `project-categories.ts`,
  `project-groups.ts`, `category-slots.ts`, `projects.ts`.
- **`projectService` + `crewAssignment` + `crewShift` + `crewAvailability` +
  `crewTimeEntry`** — `project-services.ts`, `crew-assignments.ts`, `crew-time.ts`,
  `crew-availability.ts`, `crew-communication.ts`. (projectService↔crewAssignment
  share a tx; crewAssignment→shift/timeEntry cascade.)
- **`project` scalars** — `projects.ts`, `line-items.ts`, `woocommerce.ts`. Flip last
  (most-referenced; everything carries `projectId`).
- **Append-only / leaf (lower risk, can ride along or flip late):** `assetScanLog`,
  `checkRecord`, `testTagAsset/Record`, `subTestRecord`, `maintenanceRecord(+Asset)`,
  `savedTableView`, `notification*`, `woocommerce*`, `supplierModelRate`,
  `modelBulkAccessory`, `customFieldDefinition`, `projectNumberSequence`.

### Cross-group overlap (why ordering matters)

`warehouse.ts` writes **asset status + line-item status** in one checkout `$transaction`.
So the **asset** and **line-item** groups are joined at the checkout/checkin mutation.
Practical consequence: **line-items + asset must flip together** (or warehouse
checkout is split-brained). Treat `{line-item, line-item-unit, asset, bulkAsset}` as
one mega-flip for the checkout/checkin path.

## 2. The high-risk invariants and how each is handled in-mutation

| Invariant | Old (Prisma) | New (one Convex mutation) |
|---|---|---|
| **Checkout double-allocation** (two users check the same asset onto overlapping projects) | `$transaction` + app check | Single mutation: read the asset's current allocation + the target line item, validate, write status. OCC retries the loser → never double-allocates. |
| **`maxSort`-then-insert TOCTOU** (line-items, services, media) | aggregate then insert (racy even in Prisma) | Compute `max(sortOrder)+1` from `ctx.db` and insert **in the same mutation** → atomic, race-free. |
| **Cascade delete** (assignment→shifts→timeEntries; service→assignments; project→everything) | Prisma FK cascade (dropped #254) / explicit `deleteMany` | In the mutation: query children by index, delete them, delete parent — atomically. No snapshot/mirror dance. |
| **Single-primary / status transitions** (already done for media) | `$transaction` updateMany+update | One mutation reads the set, flips flags. |
| **Double-booking** (crew member on overlapping assignments) | Prisma overlap query | In the create-assignment mutation, query the member's assignments by `by_crewMemberId` + date overlap, reject/flag — atomic with the insert. |
| **Shift generation** (date-loop create one shift/day) | `createMany` | Plain JS date loop + `ctx.db.insert` per day, inside the mutation. |
| **`@@unique` constraints** (e.g. projectManager `[projectId,userId]`, partial unique on assignment) | DB constraint | Check-then-insert on the composite index inside the mutation (OCC-safe). |

**Clear-to-null:** every update path uses the `patchMember(set, clear)` pattern (from
crew-roster) — a generic `patch{Table}(id, set, clear)` custom mutation per table, or
a shared convention, because `toConvexDoc` drops nulls and the generated `update`
can't clear an optional field.

## 3. Sequencing (each step its own PR, dev-validated against the real invariant)

Flip parent-most-referenced tables in an order where each PR's mutation is
self-contained. Recommended:

1. **`projectCategory` + `projectGroup` + `categorySlot`** (grouping; reorder +
   cascade-on-project-delete). Smallest core group; proves the in-mutation
   cascade + reorder pattern. *Validate: reorder keeps contiguous sortOrder;
   deleting a category cascades slots.*
2. **`{projectLineItem + projectLineItemUnit + lineItemMergeMap + asset + bulkAsset +
   assetBulkChild}` — the checkout mega-flip.** The hardest, highest-value. One
   `checkout`/`checkin` mutation; one `createLineItem`/`updateLineItem` mutation
   (maxSort in-mutation); unit allocation. *Validate: concurrent checkout of the same
   asset to two projects → exactly one succeeds; sortOrder contiguous under
   concurrent insert; CANCELLED tombstones preserved; the 5 PDF DocumentLineItem
   consumers (CLAUDE.md) via the full-pipeline integration test.*
3. **`kit + kitSerializedItem + kitBulkItem`** (composition; asset status on add/remove
   — depends on asset being Convex from step 2). *Validate: add/remove kit member
   flips asset status atomically; cascade on kit delete (already partly done in the
   media PR's deleteKit).*
4. **`subHire + subHireItem + subHireGroup + supplierOrder + supplierOrderItem`**
   (regeneration). *Validate: regen is idempotent; line-item links stay consistent.*
5. **`projectService + crewAssignment + crewShift + crewAvailability + crewTimeEntry`**
   (the shared-tx group). `createProjectServiceWithCrew` / `updateProjectServiceCrew`
   / `deleteProjectService` (service + assignments + the linked line-item delete, now
   that line-items are Convex) as single mutations; assignment→shift generation +
   cascade in-mutation; double-booking check in-mutation. *Validate: create service
   with crew is atomic; delete service removes assignments+shifts+timeEntries+lineItem
   atomically; no double-booking; conflict detection reads Convex.*
6. **`project` scalars** + the residual leaf/append-only tables. *Validate: project
   CRUD; activity log still Prisma.*
7. **Delete the remaining mirrors** (`asset/kit/project/line-item/line-item-unit/
   sub-hire/crew-scheduling/project-subtable` mirror files) as each group's writers
   go Convex-only.

After the core: **Stage 3** (strip domain models + User/Org back-relations from
`schema.prisma`), **Stage 4** (`DROP TABLE … CASCADE`, irreversible — ship as a PR,
human merges last), **Stage 5** (delete backfills + parity + dual-write infra; keep
`convex-client`/`convex-auth*`/`*-read`).

## 4. Validation discipline (mandatory for the core)

CRUD round-trips are necessary but **NOT sufficient** here. Each core PR MUST add a
**live dev-Convex exercise of the actual invariant** (the `_tmp-validate-*.ts`
pattern + `pnpm exec convex dev --once`): concurrent double-allocation, contiguous
sortOrder under concurrent insert, full cascade removal, double-booking rejection.
Plus the existing layers (tsc + lint + full vitest + `npm run build`) and — for the
line-item mega-flip — the full PDF-pipeline integration test (5 `DocumentLineItem`
consumers per CLAUDE.md). Human preview-validation on Coolify before merge stays the
final gate; merges to prod also need each group's backfill already present (most are).

## 5. What this is NOT

- Not eventual-consistency/reconcile (Convex mutations are ACID — use that).
- Not a single big-bang PR (flip table-groups in the order above; keep each
  dev-validated and independently shippable where the overlap map allows).
- Not safe to auto-grind without per-invariant validation — the double-allocation /
  cascade / double-booking logic is the data-integrity heart of the system.
