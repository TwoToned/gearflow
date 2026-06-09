# Convex Data Layer (Hybrid Migration)

> **Status: Phase 0 complete (infrastructure).** This is a long-running, multi-phase
> migration. Full plan: [`docs/designs/convex-hybrid-migration.md`](../docs/designs/convex-hybrid-migration.md).

## Overview

Self-hosted [Convex](https://www.convex.dev) is being introduced as GearFlow's
reactive data layer, replacing the current stack incrementally:

- **Database**: Prisma + PostgreSQL → Convex (over the same Postgres instance)
- **Real-time**: SSE + in-memory EventEmitter + React Query invalidation
  ([FEATUREDOCS/53](./53-realtime-sync.md)) → Convex's reactive engine (WebSocket
  query subscriptions)
- **Client data fetching**: React Query (`@tanstack/react-query`) → `useQuery`
  from `convex/react`

**Business logic stays in Next.js server actions** — permissions
(`requirePermission`), Zod validation, activity logging, PDF generation, email,
and the Discord bot are unchanged. Convex holds thin CRUD functions (5–10 lines);
server actions call them via `fetchMutation`/`fetchQuery` from `convex/nextjs`
using the admin key.

## Architecture

```
Server Action (auth + validation + logActivity)
  └─ fetchMutation("domain:op", args, { adminToken })  ──┐
                                                         ▼
Browser  ──useQuery(api.domain.op)──►  Self-hosted Convex backend (Docker)
   ▲                                         │  reactive engine, WebSocket diffs
   └─────────── live diffs over WS ──────────┘  └─ PostgreSQL (gearflow_convex DB)
```

Trust model: the browser only **reads** from Convex. All **writes** go through
server actions that already authenticated the user. Convex functions are
themselves unauthed and trust their caller — so the Convex URL + admin key must
never reach the browser. (The Better Auth → Convex JWT bridge for direct
browser writes is Phase 5.)

## Phase 0 — Infrastructure (done)

| File | Purpose |
|------|---------|
| `docker-compose.convex.yml` | Backend + dashboard containers, pinned to release `precompiled-2026-06-03-7eff2e7`. Project name `gearflow-convex` (one stack per machine). |
| `.env.convex.example` | Template for backend infra config (instance secret, Postgres URL, ports, optional S3). Real values live in gitignored `.env.convex.local`. |
| `.env.example` | App env template, incl. Convex client/server vars. |
| `convex/schema.ts` | Convex schema — **empty** in Phase 0; populated domain-by-domain in Phase 1. |
| `convex/auth.config.ts` | Auth providers — empty until Phase 5. |
| `convex/README.md` | Conventions: one file per domain, `list`/`getById`/`create`/`update`/`remove`, orgId scoping, indexing, Prisma→Convex mapping. |
| `convex/_generated/` | Convex CLI output (committed so CI builds without a running backend). |
| `src/components/providers/convex-provider.tsx` | `ConvexClientProvider` — wraps the app in root layout, inside `GlobalErrorBoundary`. Inert if `NEXT_PUBLIC_CONVEX_URL` is unset. |
| `src/env.ts` | Adds (optional) `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`. |

### Infrastructure details

- **Images** pinned to the release SHA tag `7eff2e7c87f3f9dd9e513c253ae8987e7f90345e`
  on both `convex-backend` and `convex-dashboard`. `:latest` drifts ahead of
  tagged releases — bump the pin deliberately.
- **Postgres**: `POSTGRES_URL` is the connection string **without** db name or
  query params. Convex uses a database named after `INSTANCE_NAME` (`-`→`_`), so
  `INSTANCE_NAME=gearflow-convex` → database **`gearflow_convex`** (created
  manually, separate from Prisma's `gearflow`). `DO_NOT_REQUIRE_SSL=1` for local.
- **Linux**: backend reaches host Postgres/MinIO via `host.docker.internal`,
  mapped with `extra_hosts: ["host.docker.internal:host-gateway"]`.
- **Ports**: 3210 backend/client API, 3211 HTTP actions, 6791 dashboard.
- **File storage**: Phase 0 uses the local Docker volume (`convex_data`). The
  S3/MinIO block in `.env.convex.example` is documented but commented out;
  enable it (5 buckets) when moving storage off-volume.

### Running

```bash
docker compose -f docker-compose.convex.yml up -d            # start backend + dashboard
docker compose -f docker-compose.convex.yml exec backend ./generate_admin_key.sh
npx convex dev                                               # push schema/functions + codegen
docker compose -f docker-compose.convex.yml logs -f backend  # logs
docker compose -f docker-compose.convex.yml down             # stop
```

Dashboard: http://localhost:6791 · Backend: http://127.0.0.1:3210

## Phase 1 — Schema (done)

All **95 Prisma models → `defineTable()`** in `convex/schema.ts` (1206 fields, 380
indexes) and all **65 enums → `v.union(v.literal(...))`** in `convex/lib/validators.ts`.
Generated deterministically from `prisma/schema.prisma` by
[`scripts/generate-convex-schema.cjs`](../scripts/generate-convex-schema.cjs)
(`pnpm convex:schema`), then reviewed. Deployed clean to the backend
(`convex dev --once`), typechecks, full suite green.

**Decisions baked into the schema:**
- **Foreign keys are `v.string()`, not `v.id()`.** During the hybrid migration,
  Convex docs must interoperate with the existing Prisma **cuid** id space, and
  auth-owned entities (user/organization/member/…) stay in Better Auth/Prisma.
  Storing FKs as the source cuid string matches the design doc's own Phase 2
  example (`orgId: v.string()`). FK fields drive **indexes** only. Converting
  hot-path FKs to native `v.id()` is a post-data-migration optimization.
- **Table names**: camelCase **plural** of the Prisma model (`ProjectLineItem` →
  `projectLineItems`). Generated from one map so FK/index references stay consistent.
- **Primary cuid `@id` → Convex `_id`** (not stored explicitly).
- **Type map**: `DateTime`/`Decimal`/`Int`/`Float` → `v.number()`; `Json` →
  `v.any()`; `String[]` → `v.array(v.string())`; enum → `enums.<Name>`.
- **Optional** iff the Prisma field is nullable, has a default, is a list, or is
  `@updatedAt` — so inserts and migration backfill aren't forced to set them.
  `createdAt`/`updatedAt` kept (optional) to preserve migrated timestamps
  (Convex also exposes `_creationTime`).
- **Indexes**: one per FK, per `@unique` field, and per `@@unique`/`@@index`/`@@id`
  compound (named `by_<f1>_<f2>`). `@unique` is **not** enforced by Convex — the
  owning mutation enforces uniqueness; the index is for lookup.

> Regenerate after any `prisma/schema.prisma` change: `pnpm convex:schema`, then
> `npx convex dev --once` to redeploy + codegen, and review the diff.

## Phase 2 — Thin CRUD (done)

**81 generated per-entity modules** (`convex/<tableKey>.ts`), **405 functions** —
each table gets `list` / `getById` / `create` / `update` / `remove`. Generated by
[`scripts/generate-convex-crud.cjs`](../scripts/generate-convex-crud.cjs)
(`pnpm convex:crud`), which shares the Prisma parser
([`scripts/lib/prisma-to-convex.cjs`](../scripts/lib/prisma-to-convex.cjs)) with
the schema gen so the two can't drift. Deployed clean, typechecks, full suite
green, and a live create→list→getById→update→remove round-trip verified.

**Conventions:**
- **Unauthed.** The calling server action owns auth, permissions, validation, and
  the activity log — never add checks here, never expose the URL/admin key to the
  browser.
- **Lookups key off the cuid** (`id`) via `by_cuid` (`getById`/`update`/`remove`).
  `update` returns the Convex `_id`; `id` arg validator follows the table's real
  id type (`discordOutboxes` uses `v.number()` — its `@id` is an autoincrement Int).
- **`list`** takes `orgId` and uses `by_organizationId` for org-scoped tables;
  otherwise lists by the first foreign key, or collects all (singletons).
- **`create`** takes the full table shape (incl. the caller-supplied cuid) and
  inserts it. **`update`** takes `{ id, patch }` (all fields optional).

**14 tables are excluded** (own no Convex CRUD — they stay in Better Auth/Prisma):
`users, sessions, accounts, verifications, organizations, members, invitations,
customRoles, ssoProviders, pendingSSOApprovals, twoFactors, backupCodes,
passkeys` (auth + org membership + permissions) and `activityLogs` (audit trail,
stays in Prisma per Phase 6).

> Bulk ops, search, aggregations/rollups, and `listBy*` variants are **not**
> generated — they're added by hand per domain as Phases 3–4 cut each domain over
> (report-style queries stay as server actions that call these + post-process).

## Phase 3 — Server-action integration (in progress: Clients + Suppliers + Locations + Models + Categories + Check-items + Test-profiles + Brand/Group-templates + Custom-fields + Section-presets done)

> **Two cutover strategies have emerged.** **Hard cutover** (Clients): Convex is
> sole source of truth, every Prisma reader rewired — used when nothing else in
> Prisma holds a hard FK to the table. **Dual-write** (Suppliers): Prisma row kept
> as the durable FK anchor + Convex as the reactive read source — required when
> Prisma tables hold **required/Cascade** FKs to the migrating table (you can't
> orphan them mid-migration). Pick per domain by grepping
> `pg_constraint` for inbound FKs first.


Pilot domain: **Clients** (chosen as the simplest), strategy: **one-time backfill,
Convex source-of-truth**. Groundwork landed:
- [`src/lib/convex-client.ts`](../src/lib/convex-client.ts) — server-side
  `ConvexHttpClient` for actions/scripts to call the public Convex functions
  (no token; they're unauthed) + `toConvexDoc` mapping (Date→ms, Decimal→number,
  null→absent).
- [`scripts/convex-backfill-clients.ts`](../scripts/convex-backfill-clients.ts)
  (`pnpm convex:backfill:clients`) — idempotent Prisma→Convex copy. Ran clean,
  6/6 clients mirrored.

### Clients cutover — DONE (hard cutover, Convex is source of truth)

The "simplest" domain turned out to be relationally coupled: `prisma.client` was
read/written in **~20 sites**. All were rewired — there is now **zero**
`prisma.client` access in app code (only the backfill reads Prisma, to copy out).
Convex (`convex/clients.ts`) is the single source of truth; cross-domain joins
are composed in JS via [`src/lib/clients-read.ts`](../src/lib/clients-read.ts)
(`getClientById` / `getClientsByOrg` / `getClientMap` / `attachClient`).

Sites rewired:
- **Writes**: `server/clients.ts` (create/update/notes/archive — generate cuid +
  `fetchMutation`, keep permission/validation/`logActivity`), `server/woocommerce.ts`
  (find/create + in-memory fuzzy match), `lib/org-import.ts`.
- **Direct reads**: `server/clients.ts` (`getClients` filters/sorts/paginates in
  JS + project counts from Prisma; `getClient` attaches projects+media),
  `server/tags.ts`, `server/reports.ts`, `server/client-media.ts`, `lib/org-export.ts`.
- **Relational joins** (`include: { client }` → attach from Convex):
  `server/projects.ts` (×3, incl. sort-by-client done in JS), `server/dashboard.ts`
  (×2), `server/availability.ts` (×4), `server/warehouse.ts` (×2), `server/documents.ts`,
  `server/locations.ts`, `app/api/calendar/.../route.ts`, `lib/report-engine.ts`,
  `lib/pdfme/build-document-data.ts`.

**Pattern**: fetch the Prisma rows without the client join, then attach the
Convex client(s) by `clientId` (one `getClientMap` round-trip for lists,
`getClientById` for singletons). Sorting projects/lists by client name is done in
JS (DB can't sort across the dropped join).

**Known limitation**: in the generic **report builder**, sorting a report by a
`client.*` column is a no-op (client values still display correctly from Convex,
but ordering by them is skipped — a Prisma relation sort would order by the stale
`client` table). Acceptable for the pilot; revisit if needed.

Verified: `tsc` clean, 2185 tests pass, lint 0 errors, backfill 6/6, Convex CRUD
round-trip. Phase 4 reactive reads for Clients also done (below).

### Suppliers cutover — DONE (dual-write: Prisma FK anchor + Convex reactive doc)

Second domain. Unlike Clients, the `supplier` table is referenced by **6 live
Prisma FK constraints** — `asset`, `bulk_asset` (`preferredSupplierId`),
`project_line_item`, `sub_hire`, plus **required + Cascade** FKs from
`supplier_order` and `supplier_model_rate` (both sub-domains that stay in Prisma).
A Convex-only-writes cutover (the Clients pattern) would make a *newly-created*
supplier fail those FKs the moment you raise a supplier order / sub-hire against
it. So Suppliers uses a **dual-write**:

- **Writes** go to **Prisma first** (the durable FK anchor) **then Convex** (the
  reactive read source). The Convex payload is derived from the just-written
  Prisma row via `toConvexDoc`, so the two stores can't drift; the idempotent
  backfill is the heal path if a Convex write ever fails after its Prisma write.
  `createSupplier` uses an explicit `createId()` cuid shared by both stores.
  Permissions / validation / `buildChanges` / `logActivity` unchanged. Sites:
  `server/suppliers.ts` (create/update/delete), `lib/org-import.ts`.
- **Reads**: the supplier domain's own reactive surfaces read Convex via
  [`src/lib/suppliers-read.ts`](../src/lib/suppliers-read.ts) (`getSupplierById` /
  `getSuppliersByOrg` / `getSupplierMap` / `attachSupplier`) and the
  `use-suppliers` hooks. Backfill: [`scripts/convex-backfill-suppliers.ts`](../scripts/convex-backfill-suppliers.ts)
  (`pnpm convex:backfill:suppliers`), 3/3 mirrored, idempotent.
- **Deferred (intentional)**: the ~40 cross-domain `include: { supplier:
  { select: { name } } }` joins deep inside warehouse / category-slots /
  sub-hires / line-items / project-categories / the **PDF pipeline**
  (`build-document-data.ts`) stay on the **dual-write-fresh Prisma mirror** — they
  remain correct (the mirror is never stale) and rewiring the PDF pipeline for a
  field that's just `name` is gratuitous regression risk. These migrate to Convex
  attach in the Prisma-decommission phase, when the FKs + mirror drop together.
  `csv.ts` / `reorder.ts` / `org-export.ts` supplier reads likewise stay on the
  mirror (org-export reads the Prisma anchor so a backup can't miss an un-healed
  row).

Verified: `tsc` clean, 2185 tests pass, 0 new lint errors, `pnpm build` green,
backfill 3/3 + idempotent re-run, live `api.suppliers.list` per-org round-trip
(Prisma 3 == Convex 3).

### Locations cutover — DONE (dual-write, like Suppliers)

Third domain. The step-0 FK grep found `location` referenced by 8 inbound FKs —
mostly nullable + SET NULL (`asset`, `bulk_asset`, `kit`, `project`,
`warehouse_dashboard_token`, and the self-referential `parentId`) but **required +
Cascade** from `location_media` and `stocktake`. Starting a stocktake against a
newly-created location would FK-fail under a Convex-only cutover → **dual-write**.

- **Writes** (`server/locations.ts` create/update/delete/notes, `lib/org-import.ts`):
  Prisma first, then Convex via `toConvexDoc(writtenRow)`. New wrinkle vs
  Suppliers — the **single-default invariant** (`isDefault` unset via a Prisma
  `updateMany`) is a multi-row write, so `unsetDefaultsInConvex` reads the current
  Prisma defaults and patches them `false` in Convex too, else the reactive list
  would show two defaults. (The seed data already had 2 defaults in one org — a
  pre-existing quirk the next default-set will heal.)
- **Hierarchy**: `parentId` is a plain `v.string()` in Convex (no real FK), so the
  backfill needs no ordering and the parent/children tree composition stays on the
  dual-write-fresh Prisma mirror (the detail page) — the reactive table rebuilds
  the tree client-side from the flat Convex list.
- **Deferred (intentional)**: cross-domain `location: { select }` joins + the
  low-traffic location **filters/settings** (`kits/page`, `asset-table` filter,
  `settings/displays`, `settings/woocommerce`) stay on the fresh Prisma mirror.

Read helper: [`src/lib/locations-read.ts`](../src/lib/locations-read.ts). Backfill:
[`scripts/convex-backfill-locations.ts`](../scripts/convex-backfill-locations.ts)
(`pnpm convex:backfill:locations`), 8/8 mirrored, idempotent. Verified: `tsc`
clean, 2185 tests, 0 new lint problems, `pnpm build` green, live
`api.locations.list` round-trip (Prisma 8 == Convex 8, defaults P==C).

### Models cutover — DONE (dual-write, like Suppliers)

Fourth domain, and the most heavily-referenced so far. The step-0 FK grep found
`model` referenced by **10 inbound FKs**, several **required**: `asset` and
`bulk_asset` (required + **Restrict**), `model_media`, `model_check_item`,
`supplier_model_rate`, `model_bulk_accessory` (required + **Cascade**); plus
nullable FKs from `project_line_item`, `supplier_order_item`, `group_template_item`,
`sub_hire_item`. Creating an asset against a net-new Convex-only model would
FK-fail instantly → **dual-write** (mandatory, not optional).

- **Writes** (`server/models.ts` create/update/archive/`bulkUpdateRates`,
  `server/csv.ts` import + rate-import, `lib/org-import.ts`): Prisma first, then
  Convex via `toConvexDoc(writtenRow)`. The model row carries `Decimal` rates and
  two `Json` columns (`specifications`, `customFields`) — `toConvexDoc` maps
  Decimal→number and passes Json straight through to the Convex `v.any()` fields.
  `bulkUpdateRates` mirrors **each** row returned from the `$transaction`.
- **Deferred (intentional)**: the ~200 cross-domain `model: { select }` / `model: true`
  joins (assets, line-items, availability, the whole PDF `build-document-data`
  pipeline) stay on the dual-write-fresh Prisma mirror — never stale, and rewiring
  the PDF pipeline for a `name`/`rate` lookup is gratuitous risk; defer to
  decommission. Same call as Suppliers' ~40 `supplier.name` joins.

Read helper: [`src/lib/models-read.ts`](../src/lib/models-read.ts). Backfill:
[`scripts/convex-backfill-models.ts`](../scripts/convex-backfill-models.ts)
(`pnpm convex:backfill:models`), 37/37 mirrored, idempotent. Verified: `tsc`
clean, 2185 tests, 0 new lint problems, `pnpm build` green, live
`api.models.list` round-trip (Prisma 37 == Convex 37).

### Small-domain batch — DONE (Categories, Check-items, Test-profiles, Brand/Group-templates, Custom-fields, Section-presets)

Seven config/library domains cleared in one pass so a later session can focus on
the big central graph (asset/project/kit/bulk_asset/line-items/sub-hire/
supplier-order/documents/warehouse). Every one is **dual-write** — the deciding
factor each time was a *live* inbound Prisma FK that a Convex-only cutover would
break (the Clients latent-bug trap):

- **Categories** (`category`, 23 rows): 3 inbound FKs all nullable+SET NULL, but
  `model.categoryId`/`kit.categoryId` are live → dual-write. Self-ref `parentId`
  (plain string in Convex, no backfill ordering). Reactive: `category-manager.tsx`
  → `useCategories` + `getCategoryCounts()` (model/kit counts) + children from the
  flat list. Backfill 23/23.
- **Check-items** (`check_item`, 6 rows): 3 inbound FKs all required+Cascade
  (model_check_item/kit_check_item/check_record) → dual-write. Reactive:
  `settings/check-items/page.tsx` → `useCheckItems` + `getCheckItemCounts()`. Json
  `dropdownOptions` → `v.any()`. Backfill 6/6.
- **Test-profiles** (`test_profile`, 0 rows): 3 inbound nullable FKs, but
  `model.defaultTestProfileId` is live → dual-write across all 6 write paths
  (create/update/duplicate/seed/delete+deactivate). 3 *required* Json fields
  (visualChecks/electricalTests/thresholds) → `v.any()`. Reactive:
  `settings/test-and-tag/profiles/page.tsx` → `useTestProfiles` + active filter.
- **Brand-templates** (`brand_template`, 0 rows): ← document_template (live
  nullable FK) → dual-write incl. the default-toggle (unset prior defaults in
  Convex too). headerSettings/footerSettings are JSON *strings*. **No client
  consumer exists**, so dual-write infra only (no Phase 4 reader).
- **Group-templates** (`group_template`, 0 rows): ← group_template_item
  (required+Cascade) → dual-write. Only the PARENT scalar fields live in Convex;
  the child items (model/kit joins) stay in Prisma and `getGroupTemplates`
  composes them, so it stays on the mirror (nested `items` stripped before
  mirroring; no Phase 4).
- **Custom-fields** (`custom_field_definition`, 0 rows): leaf table → dual-write
  create/update/delete/reorder (field VALUES stay in entity customFieldValues
  JSON). Reactive: `settings/custom-fields/page.tsx` → `useCustomFieldDefinitions`
  + client-side ASSET-entityType filter (Convex list returns all entity types).
- **Section-presets** (`section_preset`, 0 rows): leaf → dual-write
  create/update/delete; `sections` JSON string. Consumed only by the cross-domain
  document editor → stays on the mirror (no Phase 4).

**Excluded / deferred:** `custom_role` is **excluded** from Convex (RBAC stays in
Prisma — no convex module). `document_template` (14 write sites, PDF-pipeline
coupled) and `service_template` (project sub-domain) are **deferred to the
big-domain session**. All backfill scripts are `pnpm convex:backfill:<domain>`.
Verified each: tsc clean, 2185 tests, 0 new lint errors, `pnpm build` exit 0.

### file_upload cutover — DONE (dual-write, infra-only — the media hub)

First domain of the big-domain session. The step-0 FK grep found `file_upload`
referenced by **7 inbound FKs, every one REQUIRED + Cascade** — `model_media`,
`asset_media`, `kit_media`, `project_media`, `client_media`, `location_media`,
`sub_hire_media`. All seven `*_media` tables stay in Prisma, so a Convex-only
cutover would FK-fail the instant any media row is attached to a net-new
Convex-only file (the Clients trap, in its sharpest form) → **dual-write**. 0 rows
today, so this is infra + heal-path: it unblocks the `*_media` tables for later.

- **Writes** (Prisma first, then mirror): the two creates — the uploads API route
  `app/api/uploads/route.ts` and `org-import.ts` — and the **seven** deletes spread
  across the `*-media` server actions plus the shared-file conditional delete in
  `sub-hires.ts` (mirrored only inside its `if (otherUsages.length === 0)` guard).
  Because the write paths live across 9 files rather than one server module, the
  mirror is a shared helper: `src/lib/file-upload-mirror.ts`
  (`mirrorFileUploadCreate` / `mirrorFileUploadDelete`).
- **No Phase 4 / reactive reader** (like Brand-templates / Section-presets): there
  is no file-upload list UI. Media galleries compose `file_upload` cross-domain
  through the `*_media` joins (`include: { file }`) on the always-fresh Prisma
  mirror, so there is nothing to subscribe to. The ownership-check `findFirst`
  lookups and the org-export `findMany` also stay on Prisma.
- Backfill `pnpm convex:backfill:file-upload` (0/0). Verified: tsc clean, 2185
  tests, 0 new lint errors, `pnpm build` exit 0.

## Phase 4 — Frontend reactive reads (in progress: Clients + Suppliers + Locations + Models + Categories + Check-items + Test-profiles + Custom-fields done)

The browser now subscribes to the `clients` table directly via Convex `useQuery`,
so a client create/update/archive (through the server actions) pushes a live
update to every viewer — no `staleTime`, no manual `invalidateQueries`.

- **Hooks**: [`src/hooks/use-clients.ts`](../src/hooks/use-clients.ts) —
  `useClients(orgId)` and `useClient(id)`, thin wrappers over
  `useQuery(api.clients.*)`. (In `src/hooks`, NOT `convex/`, so the Convex
  function bundler never sees the React import.)
- **Converted sites**:
  - `clients/[id]/edit/page.tsx` → `useClient(id)` (form only needs client fields).
  - `components/projects/project-form.tsx` client dropdown → `useClients(orgId)`
    (a client added in the quick-create dialog now appears instantly).
  - `components/clients/client-table.tsx` → `useClients(orgId)` + **client-side**
    search / type-filter / sort / pagination over the reactive list. Project
    counts are cross-domain (projects still in Prisma) so they come from a
    separate, non-reactive `getClientProjectCounts()` server query, merged in.
- **Left on server actions (intentional)**:
  - `clients/[id]/page.tsx` detail view — composes projects + media (cross-domain,
    still Prisma), so a pure Convex `useQuery` is insufficient; its client data is
    already sourced from Convex via `getClient`.
  - `quick-create-client.tsx` and all forms — **writes** stay in server actions
    (permissions/validation/`logActivity`); the Convex-subscribed lists react to
    them automatically.

Writes still flow browser → server action → Convex (admin-less HTTP). Direct
browser → Convex mutations are Phase 5+ (auth bridge) material.

### Suppliers reactive reads — DONE

The browser subscribes to the `suppliers` table via Convex `useQuery`, so any
supplier create/update/delete (through the dual-write server actions) live-updates
every viewer.

- **Hooks**: [`src/hooks/use-suppliers.ts`](../src/hooks/use-suppliers.ts) —
  `useSuppliers(orgId)` and `useSupplier(id)`.
- **Converted sites**:
  - `components/suppliers/supplier-table.tsx` → `useSuppliers(orgId)` +
    **client-side** search / `isActive`-filter / sort / pagination. Asset + order
    counts are cross-domain (Prisma) so they come from a separate, non-reactive
    `getSupplierCounts()` server query, merged in. (The supplier table shows
    active **and** archived, filterable — not active-only like the client table.)
  - Supplier dropdowns → `useSuppliers(orgId)`, **active-only** (matches the old
    `getSuppliers` `where: { isActive }`): `assets/asset-form.tsx`,
    `assets/bulk-asset-form.tsx`, `projects/sub-hire-add-form.tsx`,
    `projects/sub-hire-order-dialog.tsx` (a supplier added via quick-create now
    appears instantly).
  - `suppliers/[id]/edit/page.tsx` → `useSupplier(id)` (form needs supplier fields).
- **Left on server actions (intentional)**: `suppliers/[id]/page.tsx` detail
  (composes assets + sub-hires + orders, cross-domain) and
  `suppliers/[id]/orders/new/page.tsx`.

### Locations reactive reads — DONE

- **Hooks**: [`src/hooks/use-locations.ts`](../src/hooks/use-locations.ts) —
  `useLocations(orgId)` and `useLocation(id)`.
- **Converted sites**:
  - `components/locations/location-table.tsx` → `useLocations(orgId)` +
    **client-side** search / type-filter / sort / **tree build** / paginate.
    Asset+bulk+kit counts from a non-reactive `getLocationCounts()`; children
    counts derived from the flat reactive list.
  - Location dropdowns → `useLocations(orgId)`: `assets/asset-form`,
    `assets/bulk-asset-form`, `kits/kit-form`, `projects/project-form`,
    `stocktake/stocktake-form`, `locations/location-form` (parent picker),
    `assets/quick-create-location` (parent picker). The Convex doc carries
    `parentId` not a `parent` relation, so `parent.name` labels resolve from the
    flat list via a name map (or a synthetic `parent` field to keep the option JSX
    unchanged).
  - `locations/[id]/edit/page.tsx` → `useLocation(id)`.
- **Left on server actions (intentional)**: `locations/[id]/page.tsx` detail
  (composes the children tree + assets + bulk + kits + projects + media,
  cross-domain) and the low-traffic location filters/settings still on
  `getLocations`.

### Models reactive reads — DONE

- **Hooks**: [`src/hooks/use-models.ts`](../src/hooks/use-models.ts) —
  `useModels(orgId)` and `useModel(id)`.
- **Converted sites**:
  - `components/assets/model-table.tsx` → `useModels(orgId)` + **client-side**
    `isActive`-filter (Convex `list` returns archived too) / search
    (name·manufacturer·modelNumber·sku) / category·assetType filter / sort /
    paginate. Asset+bulk counts **and the primary photo** are cross-domain
    (assets + `model_media` still Prisma) so they come from a non-reactive
    `getModelCounts()` server query, merged in; the category Badge resolves from
    the already-loaded `getCategories()` list by `categoryId`.
- **Left on server actions (intentional)**: `models/[id]/page.tsx` detail +
  `models/[id]/edit/page.tsx` (compose assets/bulk/media via `getModel`), and the
  model **dropdowns** in `assets/asset-form`, `assets/bulk-asset-form`,
  `projects/equipment-add-form`, `projects/sub-hire-order-dialog` — these
  cross-domain-composing forms keep `getModels` against the dual-write-fresh Prisma
  mirror (never stale). Migrate at decommission.

## Migration phases (roadmap)

| Phase | Scope | Verification |
|------|-------|--------------|
| **0 Infra** ✅ | Docker stack, empty schema, provider, env | dashboard up, `convex dev` connects |
| **1 Schema** ✅ | 95 models + 65 enums → `defineTable()` | deployed clean, typechecks, tests green |
| **2 Thin CRUD** ✅ | 81 tables × 5 = 405 functions | deployed, typechecks, CRUD round-trip verified |
| **3 Server actions** 🔄 | 86 `"use server"` files call Convex (Clients hard-cutover; Suppliers + Locations + Models + Categories + Check-items + Test-profiles + Brand/Group-templates + Custom-fields + Section-presets dual-write done) | per-domain backfill + cutover; tsc/tests/build green each |
| **4 Frontend** 🔄 | React Query sites → Convex `useQuery` (Clients + Suppliers + Locations + Models + Categories + Check-items + Test-profiles + Custom-fields done) | table/dropdown/edit live-update on mutation |
| 5 Auth bridge | Better Auth → Convex JWT (admin key meanwhile) | mutations rejected without auth |
| 6 Decommission | Remove React Query + SSE event bus | [FEATUREDOCS/53](./53-realtime-sync.md) marked superseded |

## Conventions

See [`convex/README.md`](../convex/README.md) for the authoritative coding
conventions (domain file layout, the standard 5 functions per entity, orgId
scoping, mandatory indexes, and the Prisma→Convex type mapping table).
