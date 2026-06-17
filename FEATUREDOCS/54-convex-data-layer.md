# Convex Data Layer (Hybrid Migration)

> **Status: Phase 0 complete (infrastructure).** This is a long-running, multi-phase
> migration. Full plan: [`docs/designs/convex-hybrid-migration.md`](../docs/designs/convex-hybrid-migration.md).
>
> **Endgame plan (decided 2026-06-16):** "domain data Convex-only" — keep Postgres
> for Better Auth + RBAC + activityLog. Full phased plan (A read-rewiring →
> B write-inversion → C drop tables), scope, and ground rules:
> [`docs/designs/convex-domain-only-decommission.md`](../docs/designs/convex-domain-only-decommission.md).
> Currently PAUSED before Phase A; all dual-write groundwork is shipped + backfilled.

## Overview

Self-hosted [Convex](https://www.convex.dev) is being introduced as GearFlow's
reactive data layer, replacing the current stack incrementally:

- **Database**: Prisma + PostgreSQL → Convex (over the same Postgres instance)
- **Real-time**: SSE + in-memory EventEmitter + React Query invalidation
  ([FEATUREDOCS/53](./53-realtime-sync.md), now **removed** — the bus was a dead
  no-op) → Convex's reactive engine (WebSocket query subscriptions)
- **Client data fetching**: React Query (`@tanstack/react-query`) → `useQuery`
  from `convex/react` (now **removed** — RQ is gone from the dependency tree; the
  non-reactive reads use the `useServerQuery`/`useServerMutation`/
  `createSharedResource` keystones, see the React Query removal section below)

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

Trust model (Phase 5, **now authenticated**): every Convex function requires a
valid ES256 JWT. The **browser** carries a Better Auth **user token** (org-scoped
reads only). **Server actions / scripts / webhooks** carry a **service token**
(full access — the explicit form of the old "trust the caller"). Browser **writes
are rejected** at Convex (RBAC stays in Prisma server actions — Convex is never
the authZ source of truth). See [Phase 5 below](#phase-5--auth-bridge-done) and
[`docs/designs/convex-phase5-auth-bridge.md`](../docs/designs/convex-phase5-auth-bridge.md).

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

### Crew roster cutover — DONE (dual-write: member / role / skill only)

The crew cluster has 8 tables, but only the **roster trio — crew_member, crew_role,
crew_skill — is migrated** here. The FK grep showed dual-write is mandatory: live
inbound FKs cross the cluster boundary from tables that stay in Prisma —
`project_service.crewRoleId` → crew_role; `damage_event` / `project_task` /
`discord_account_link` / `discord_link_token` → crew_member; plus the implicit m2m
`_CrewMemberToCrewSkill` (which has **no Convex representation** — a member's skills
stay composed on the Prisma mirror).

- **Scope decision:** the project-coupled scheduling/timesheet sub-tables
  (`crew_assignment`, `crew_shift`, `crew_availability`, `crew_certification`,
  `crew_time_entry`) are **deliberately left Prisma-only** for now. They are
  leaf/child tables with cascade-delete semantics Convex can't cheaply replicate,
  and they are only ever composed inside project-joining or member-detail views
  that stay on the Prisma mirror (the crew dashboard, planner, timesheets, member
  detail). Their Convex CRUD + schema already exist (Phase 2); they get dual-written
  when those UIs go reactive alongside the project/central-graph migration.
- **Writes** (Prisma first, then mirror via `src/lib/crew-mirror.ts`): `server/crew.ts`
  (member/role/skill create/update/delete + image + user-link), `server/crew-calendar.ts`
  (iCal enable/disable/regenerate → member patch), `app/api/crew/avatar/route.ts`
  (avatar set/clear), and `org-import.ts` (role/skill/member creates).
- **Reactive read — DONE:** the crew roster table (`components/crew/crew-table.tsx`,
  used by both the manager dashboard and the read-only list view) now subscribes via
  `useCrewMembers` + `useCrewRoles` (`src/hooks/use-crew.ts`) and does
  filter/sort/paginate client-side. crewRole name/color resolves from the reactive
  roles list; the linked user, skills (m2m), and cert count are cross-domain and
  merged in non-reactively via `getCrewMemberExtras()`. The roles/skills **settings
  page** stays on the server-action reads over the fresh Prisma mirror for now
  (low-traffic config; the `useCrewRoles`/`useCrewSkills` hooks exist for when it's
  revisited) — same call as the deferred low-traffic surfaces in Locations.
- Backfill `pnpm convex:backfill:crew` (roster trio only; 8 roles + 8 members + 0
  skills). Verified: tsc clean, 2185 tests, 0 new lint errors, `pnpm build` exit 0.

### document_template + service_template cutover — DONE (dual-write, infra-only)

The two templates deferred from the small-domain batch. The FK grep found **zero
inbound FKs** on either (both reference *other* tables outbound: document_template →
brand_template via `brandTemplateId`), and both are **0 rows**. Despite no inbound
FKs, both are **dual-write, not hard cutover**: document_template is read all over
the PDF pipeline (`build-document-data` and friends), so a hard cutover would force
a gratuitous PDF-pipeline rewrite — exactly the risk the Models/Suppliers notes warn
against. Like the other 0-row PDF/doc-coupled domains (brand_template, section_preset),
this is **infra-only**.

- **Writes** (Prisma first, then mirror via `src/lib/template-mirror.ts`):
  `server/document-templates.ts` — all 15 write paths (5 creates: create + 3
  duplicate variants + import; 8 single-row updates incl. the two `tx.*` section/
  block saves and the thumbnail save; 1 delete; and `setDefaultTemplate`, whose
  multi-row `updateMany` unset is mirrored by capturing the prior-default ids and
  patching each `isDefault:false` before patching the new default `true`).
  `server/project-services.ts` — service template create/update/delete.
- **Not mirrored (intentional):** the brand-template-delete unlink in
  `brand-templates.ts` (`documentTemplate.updateMany … brandTemplateId: null`) — the
  generated Convex `update` can't clear an optional field (validator rejects null;
  an absent key is a patch no-op), and document_template is 0-row infra, so the
  Convex copy's `brandTemplateId` re-syncs on the template's next edit. The universal
  toConvexDoc null→absent limitation applies to all clear-to-null patches.
- **No Phase 4 / reactive reader:** the document settings page has gnarly virtual
  system-default composition and the service settings/services-panel are low-traffic;
  both stay on the server-action reads over the fresh Prisma mirror (which the PDF
  pipeline reads anyway). The Convex CRUD + hooks can be wired when those UIs go
  reactive.
- Backfill `pnpm convex:backfill:templates` (0/0). Verified: tsc clean, 2185 tests,
  0 new lint errors, `pnpm build` exit 0.

### Central graph — analysis & recommended sequencing (NOT yet migrated)

The remaining domains (`asset`, `bulk_asset`, `kit`, `project`, `project_line_item`,
`project_category`, `project_group`, `sub_hire`/`supplier_order` families) form **one
deeply-interlocked cluster**, not a set of independent domains. The per-domain FK
grep + write-site survey done this session (counts as of 2026-06-09):

| domain | inbound FK | rows | why it's not independently scopable |
|--------|-----------|------|--------------------------------------|
| `bulk_asset` | 10 (3 req+Cascade: kit_bulk_item, asset_bulk_child, model_bulk_accessory) | 8 | **shares the registry/`asset-table.tsx` UI with `asset`** — can't make the table reactive for bulk while serialized assets stay Prisma. Must migrate WITH `asset`. |
| `asset` | 13 | 126 | most-referenced; shared UI with bulk_asset; T&T / scan / check / damage / stocktake / line-item joins everywhere. |
| `kit` | 10 | 0 | kit members (serialized + bulk), kit_media, kit_check_item, line items. Own page UI. 0 rows makes backfill trivial — reasonable **first** central-graph target if taken with its member sub-tables. |
| `project_category` | 6 (1 req+Cascade: category_slot) | 12 | writes across **3 files** (project-categories, category-slots, projects-duplication tx). Delete cascades groups + reparents line items. |
| `project_group` | 5 (category_slot nullable Cascade) | 17 | writes across **6 files** (project-groups split/merge/reorder ×11, category-slots, group-templates, line-items, project-categories deleteMany, projects-duplication). Entangled with `category_slot` cross-type "mixedGroups" ordering + `sub_hire_group`. |
| `project_line_item` | 5 | 33 | the spine of the equipment tab; references model/asset/bulkAsset/kit/supplier/category/group/subHire; self-referential parent/child + kit children. |
| `project` | 15 | 5 | most-referenced of all; client (already Convex), line items, assignments, services, media, documents. |
| `sub_hire` / `supplier_order` | 4 / 3 | 1 / 1 | "families" with item + group + media sub-tables; `sub-hires.ts` is ~1750 lines; reference project + supplier + project_category/group. |

**Key blockers that make these big, not small:**
1. **Shared UI** — `asset` + `bulk_asset` render through the same `asset-table.tsx`
   registry; migrate them as one unit (don't half-convert a shared table).
2. **The project editor is one composition** — `project` ↔ `project_line_item` ↔
   `project_category` ↔ `project_group` ↔ `category_slot` ↔ `sub_hire_group` are
   read together (the equipment tab's `getProjectCategories` mixed-ordered list).
   Their writes (split/merge/reorder/slot moves) span 6+ files with multi-row
   `$transaction`s that all need mirroring. Migrate the grouping substructure as a
   set, not piecemeal — a half-wired dual-write here causes silent drift.

**Recommended sequencing for the next session** (smallest-blast-radius first):
1. `kit` + kit member sub-tables (0 rows; self-contained kit page; de-risks asset).
   ✅ **DONE** — see "Kit reactive reads" above. Dual-write across kits.ts +
   org-import + warehouse + projects + site-admin; reactive kit list + edit page.
2. `asset` + `bulk_asset` **together** (shared registry UI; dual-write — both have
   req+Cascade inbound from T&T/scan/check/kit/line-item).
   ✅ **DONE** — see "Asset + Bulk-asset reactive reads" above. Dual-write across
   ~16 files (CRUD + warehouse hot path + maintenance/stocktake/fault/accessories/
   reorder/checkin/import); reactive shared registry + edit pages.
3. `project_category` + `project_group` **together** as dual-write **infra-only**
   (composed only in the cross-domain equipment editor → no Phase 4; mirror the
   create/update/delete/reorder/split/merge writes; the category-delete cascade
   removes its groups from Convex; the project-duplication `tx.create`s in
   `projects.ts` must mirror too).
   ✅ **DONE** — see "Project grouping substructure" above. 6 files mirrored;
   category_slot stays Prisma-only.
4. `project_line_item` (depends on 1–3 being in Convex for its FK joins).
   ✅ **DONE** — see "Project line items" above. Infra-only; upsert-by-project
   sweep covers the warehouse/check status paths. Sub-hire line-item writes → step 5.
5. `sub_hire` / `supplier_order` families.
   ✅ **DONE** — see "Sub-hire + supplier-order families" above. Also closed the
   deferred step-4 sub-hire line-item writes.
6. `project` last (most-referenced).
   ✅ **DONE** — see "Project" above. **The central graph is fully dual-written.**

All Convex CRUD modules + schema for every table above already exist (Phase 2).
Each follows the proven per-domain playbook (backfill → dual-write all paths incl.
org-import + multi-row side-effects → read-lib + hook → reactive main UI → verify
tsc + 2185 tests + 0 new lint errors + build + live round-trip).

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

### Kit reactive reads — DONE (central-graph step 1)

The kit cluster (`kit` + member sub-tables `kit_serialized_item` /
`kit_bulk_item`) is **dual-written** — required+Cascade inbound FKs from the
member tables / `kit_media` / `kit_check_item` plus nullable refs from `asset` /
`project_line_item` / scan/check/maintenance / `group_template_item` mean a
Convex-only cutover would FK-fail. The first central-graph domain (0 rows;
self-contained kit page; de-risks `asset`).

- **Mirror**: [`src/lib/kit-mirror.ts`](../src/lib/kit-mirror.ts) — generic
  mirror-core (create/patch/remove) for the kit + both member sub-tables, plus
  `syncKitsToConvex(kitIds)` for the multi-row `kit.status`/`locationId` updates
  in the warehouse check-out/in/force-return and project-cancel `$transaction`s
  (each returns the affected kit ids — root + nested kits — and mirrors after
  commit). Member add/remove transactions return the written/deleted row so the
  Convex mirror runs post-commit (Convex is an out-of-transaction HTTP write);
  the nested `asset`/`bulkAsset` include is stripped before mirroring.
- **Write sites**: `kits.ts` (create/update/notes/archive/delete + member
  add/addBatch/remove), `org-import.ts` (3 creates + image patch),
  `warehouse.ts` (checkOutKit/checkInKit/forceReturnKit), `projects.ts`
  (deleteProject frees kits), `site-admin.ts` (adminDeleteUser removes a user's
  kit items).
- **Hooks**: [`src/hooks/use-kits.ts`](../src/hooks/use-kits.ts) —
  `useKits(orgId)` / `useKit(id)`.
- **Converted sites**:
  - `kits/page.tsx` → `useKits(orgId)` + **client-side** filter (active,
    non-prep, status/condition/location/category/tags + search) / sort
    (incl. category & location by name) / paginate. Member-item counts + primary
    photo are cross-domain (kit media still Prisma) → non-reactive
    `getKitCounts()` merged in; category/location names resolve from the lists
    already loaded for the filter options.
  - `kits/[id]/edit` → `useKit(id)` (form needs only scalar kit fields).
- **Left on server actions (intentional)**: `kits/[id]/page.tsx` detail
  (composes assets / bulk / line items / scan logs / maintenance / media — all
  cross-domain, still Prisma) stays on `getKit`. `kit_media` / `kit_check_item`
  stay Prisma-only (media composes on the mirror; check-config join not yet
  migrated), so kit delete's media/check cleanup needs no Convex mirror.
- **Backfill**: `pnpm convex:backfill:kit` (0/0 — kit tables empty). Live
  create→patch→remove round-trip verified against the running backend.

### Asset + Bulk-asset reactive reads — DONE (central-graph step 2)

`asset` (serialized, 126 rows) + `bulk_asset` (8 rows) are **dual-written** and
migrated **together** — they share the `asset-table.tsx` registry UI, so the
table can't go reactive for one while the other stays on Prisma. Both carry
required+Cascade inbound FKs (asset: kit_serialized_item / asset_media /
maintenance_record_asset / asset_bulk_child; bulk: kit_bulk_item /
asset_bulk_child / model_bulk_accessory) plus many nullable refs → dual-write.

- **Mirror**: [`src/lib/asset-mirror.ts`](../src/lib/asset-mirror.ts) —
  create/patch/remove for both tables + `syncAssetsToConvex(ids)` /
  `syncBulkAssetsToConvex(ids)`, the workhorses for the warehouse / stocktake /
  maintenance / fault / project `$transaction`s that mutate status / location /
  quantity across many rows (re-read Prisma rows post-commit, patch each).
- **Write sites** (asset is the hottest-write domain): `assets.ts` +
  `bulk-assets.ts` (CRUD), `warehouse.ts` (check-out/in/kit/force-return — touched
  ids accumulated through the line-item-fulfillment helpers and synced after
  commit), `kits.ts` (kit member/archive/delete release assets + bulk qty),
  `maintenance.ts` (hold/release), `stocktake.ts`, `test-tag-records.ts`,
  `asset-fault-service.ts`, `asset-accessories.ts` (attach/detach + DEDICATED bulk),
  `bulk-checkin.ts`, `check-records.ts`, `reorder.ts`, `csv.ts`, `org-import.ts`,
  `models.ts` (cascade delete), `projects.ts` (deleteProject frees assets).
- **Hooks**: [`src/hooks/use-assets.ts`](../src/hooks/use-assets.ts) —
  `useAssets` / `useAsset` / `useBulkAssets` / `useBulkAsset`.
- **Converted sites**:
  - `asset-table.tsx` (shared registry) → `useAssets` + `useBulkAssets` +
    **client-side** filter / sort / paginate for BOTH views. Model name+category
    + location resolve from the Convex models/categories/locations the table
    already loads; primary photos come from a non-reactive `getAssetRegistryPhotos()`
    (asset_media + model_media fallback, cross-domain) merged in. Warehouse status
    flips now live-update the registry.
  - `assets/registry/[id]/edit` → `useAsset` / `useBulkAsset` (scalar forms).
- **Left on server actions (intentional)**: the asset/bulk **detail** pages
  (compose T&T / scan / check / maintenance / accessories / media — all Prisma)
  stay on `getAsset` / `getBulkAsset`.
- **Clear-to-null caveat (matters here)**: detaching an accessory clears
  `asset.parentAssetId`→null and removing an asset from a kit clears
  `asset.kitId`→null; both are no-ops in Convex (toConvexDoc drops null, the patch
  validator rejects null). The Convex doc keeps the stale FK until the next
  non-null write or a backfill run. Documented in asset-mirror.ts; the reactive
  registry tolerates it. A general fix (null-aware Convex update) is decommission-era.
- **Backfill**: `pnpm convex:backfill:asset` (134 rows; counts verified P==C).
  Live patch round-trip verified against the running backend.

### Project grouping substructure — DONE (central-graph step 3, infra-only)

`project_category` (12 rows) + `project_group` (17 rows) are **dual-written
infra-only** — there is **no Phase 4**. They are composed only inside the
cross-domain equipment editor (project ↔ line_item ↔ category ↔ group ↔
category_slot ↔ sub_hire_group, read as the equipment tab's mixed-ordered list),
which stays on Prisma reads. The mirror keeps the Convex graph complete for the
eventual decommission. `category_slot` (the cross-type ordering layer) stays
Prisma-only.

- **Mirror**: [`src/lib/project-grouping-mirror.ts`](../src/lib/project-grouping-mirror.ts)
  — create/patch/remove for both + `syncProjectGroupsToConvex` /
  `syncProjectCategoriesToConvex` for the reorder/split/merge/move transactions.
- **Write sites** (6 files): `project-categories.ts` (create/update/reorder/delete
  — delete cascades its groups out of Convex), `project-groups.ts`
  (create/update/price/accept/move/reorder/delete), `category-slots.ts`
  (move-to-category + create-category-and-move; reorder stays on category_slot),
  `group-templates.ts` (applyGroupTemplate), `line-items.ts` (group suggestedPrice
  recalc on add), `projects.ts` (duplicateProject copies categories + groups).
- **Clear-to-null**: moving a group to the Uncategorised zone clears
  `categoryId`→null — a no-op in Convex (documented); tolerable for a
  consumer-less substructure, heals on next non-null write or backfill.
- **Backfill**: `pnpm convex:backfill:project-grouping` (29 rows; P==C).

### Project line items — DONE (central-graph step 4, infra-only)

`project_line_item` (33 rows) — the equipment-tab spine — is **dual-written
infra-only** (no Phase 4; composed only in the equipment editor + PDF pipeline,
both Prisma reads). Dual-write: `project_line_item_unit` is required+Cascade, the
table self-references (parent/child + kit children), project_service /
check_record / damage_event are nullable refs.

- **Mirror**: [`src/lib/line-item-mirror.ts`](../src/lib/line-item-mirror.ts) —
  explicit create/patch/remove for CRUD + `upsertProjectLineItemsToConvex(projectId)`
  (the workhorse: a project has few line items, so re-read-and-create-or-patch
  each after a status `$transaction` commits — captures status flips AND scan-time
  accessory/kit-child row EXPANSIONS, and can't miss an internal site) +
  `syncLineItemsToConvex(ids)` for non-project-scoped multi-row writes.
- **Write sites** (the spine is written from ~17 files): line-items.ts (CRUD;
  remove cascades children), warehouse.ts (all check-out/in/kit/force-return),
  check-records.ts (all prep/deprep/pack/flag/store/complete*), bulk-checkin.ts,
  woocommerce.ts + org-import.ts (create), projects.ts (duplicate mirror + delete
  remove), project-groups.ts (recalc-prices + move), category-slots.ts (group
  moves resync followed items), project-services.ts (linked-item deletes),
  split-sibling-collapse.ts, reservation-conflicts.ts.
- **Remaining (documented)**: sub-hire line-item writes (8, in sub-hires.ts) land
  with **step 5**; category/group-delete reparenting (`categoryId`/`groupId`→null)
  + user-delete FK clears are clear-to-null no-ops that heal on a backfill run.
- **Backfill**: `pnpm convex:backfill:line-items` (33; P==C). Live upsert
  round-trip verified.

### Sub-hire + supplier-order families — DONE (central-graph step 5, infra-only)

`sub_hire` (+ `sub_hire_item`, `sub_hire_group`) and `supplier_order`
(+ `supplier_order_item`) — **dual-written infra-only** (1 row each). Each head
carries required+Cascade inbound from its sub-tables; project_line_item /
category_slot carry nullable refs.

- **Mirror**: [`src/lib/sub-hire-mirror.ts`](../src/lib/sub-hire-mirror.ts) —
  create/patch/remove for all 5 tables + `syncSubHireToConvex(id)` /
  `syncSupplierOrderToConvex(id)` (re-read head + sub-rows, upsert each — the
  workhorse for the family `$transaction`s).
- **Write sites**: supplier-orders.ts (order + item CRUD/status), sub-hires.ts
  (~17 actions — create/update/delete/status/item·group CRUD/setItemGroup/pricing/
  placement/changeProject/duplicate/payment; each syncs the family + upserts the
  project's line items), reorder.ts + org-import.ts (creates), category-slots.ts
  (sub-hire group moves). `sub_hire_media` stays Prisma-only.
- **Also closed the step-4 gap**: the deferred sub-hire `project_line_item` writes
  are now mirrored (via `upsertProjectLineItemsToConvex` at each sub-hire action).
- **Known limitation (documented)**: sub-hire line-item **regeneration**
  (`generateSubHireLineItemsTx` does deleteMany + recreate with FRESH ids) orphans
  the pre-regen line-item rows in Convex — infra-only, no consumer. Cleared by
  `pnpm convex:resync:line-items` (a clean per-org truncate + backfill of the Convex
  `projectLineItems` table that re-establishes exact Convex==Prisma parity; safe to
  run any time while line items remain infra-only). Run after this session: 33
  removed, 33 re-created, parity confirmed.
- **Backfill**: `pnpm convex:backfill:sub-hires` (5 rows; P==C). Live sync verified.

### Project — DONE (central-graph step 6, infra-only) — CENTRAL GRAPH COMPLETE

`project` (incl. templates; 5 rows) — the most-referenced central table (15
inbound FK, most required+Cascade) — is **dual-written infra-only**. clientId
already lives in Convex.

- **Mirror**: [`src/lib/project-mirror.ts`](../src/lib/project-mirror.ts) —
  create/patch/remove + `syncProjectToConvex(id)`.
- **Write sites**: projects.ts (create / update / status / notes / archive /
  duplicate / saveAsTemplate / deleteTemplate / deleteProject), woocommerce.ts +
  org-import.ts (create), line-items.ts `recalculateProjectTotals` (the recomputed
  totals — fired after most line-item mutations), channel-sync-service.ts
  (discordChannelId claim).
- **Backfill**: `pnpm convex:backfill:projects` (5; P==C). Live sync verified.

With this, **every central-graph table is dual-written into Convex**: kit + asset
+ bulk + project_category + project_group + project_line_item + sub_hire family +
supplier_order family + project. The reactive UIs that ship now are the asset/bulk
registry, kit list, and the config/library domains; the deep cross-domain
compositions (equipment editor, dashboards, PDF pipeline) remain Prisma reads
until decommission.

### Crew scheduling / timesheet sub-tables — DONE (infra-only) — DUAL-WRITE SURFACE COMPLETE

`crew_assignment`, `crew_shift`, `crew_availability`, `crew_certification`,
`crew_time_entry` — the project-coupled, cascade-child layer of the crew domain
(the roster trio role/member/skill was migrated earlier in `crew-mirror.ts`) — are
**dual-written infra-only** (no Phase 4; composed only inside project-joining and
member-detail views that stay on Prisma reads). With these wired, the **entire
dual-write surface is finished** — every Convex-mirrored table is now kept current.

- **Mirror**: [`src/lib/crew-scheduling-mirror.ts`](../src/lib/crew-scheduling-mirror.ts)
  — generic create/patch/remove per table (relation-strip + tolerant remove) +
  `syncCrewAssignmentToConvex(id)` / `…ForProjectToConvex` / `…ForServiceToConvex`
  (re-read head + shifts + time-entries and upsert — the workhorse for multi-row
  writes and shift regeneration) + `syncCrewTimeEntriesToConvex(ids)` for the
  submit/approve `updateMany`s.
- **Cascade handling** (Convex has no FK cascade): the delete paths snapshot the
  descendant ids from Prisma BEFORE the cascading delete (`snapshotAssignmentCascade`
  / `snapshotServiceCrew` / `snapshotProjectCrew` / `snapshotCrewMemberCascade`),
  then `removeCrewAssignmentCascadeFromConvex` / `removeCrewMemberCascadeFromConvex`
  AFTER commit. Removes are tolerant of rows missing from Convex (pre-dual-write data).
- **Write sites** (8 files): crew-assignments.ts (create/update/status/delete +
  shift generate/update/delete — `generateShifts` drops the regenerated-orphaned
  shifts then re-syncs), crew-availability.ts (add/remove), crew.ts
  (cert add/remove + `deleteCrewMember` cascade), crew-time.ts
  (create/update/delete + submit/approve/dispute), crew-communication.ts
  (`sendCrewOffer`), `app/api/crew/respond/[token]` (accept/decline),
  project-services.ts (create/update/delete service crew reconcile +
  `updateServiceCrewStatus` + `cloneServicesFromProject`), projects.ts
  (`deleteProject` cascade), org-import.ts (all 5 creates).
- **Clear-to-null caveat** applies (nullable FK→null is a no-op in Convex);
  tolerable for a consumer-less mirror, heals on a backfill run.
- **Backfill**: `pnpm convex:backfill:crew-scheduling` (12 rows = 9 assignments +
  3 certifications; P==C, idempotent re-run verified).

### Clients FK bug fix — DONE

Clients were **hard-cutover** to Convex (sole source of truth): new clients are
created ONLY in Convex, and the Prisma `client` table is frozen at its
cutover-time rows (read only by the one-time backfill). But the Prisma DB still had
**live FK constraints into that frozen table** — `project.clientId → client(id)`
(nullable, NO ACTION) and `client_media.clientId → client(id)` (required, CASCADE).
Assigning a net-new (Convex-only) client to a project, or uploading media for one,
FK-failed because there was no matching Prisma `client` row. (Not caught by tests
because the fixtures only used the 6 backfilled clients.)

**Fix (codex-reviewed: drop the FKs, not a shadow dual-write).** A shadow dual-write
would be a partial rollback of the cutover and would preserve an attractive
nuisance — a stale relational model that no longer reflects ownership. Instead:

- Migration `20260609000000_drop_client_fk_constraints` drops both constraints
  (`IF EXISTS`, idempotent). The columns + indexes stay. Applied via
  `prisma migrate deploy` (NOT `migrate dev` — see [[prisma-preexisting-drift]]).
- `schema.prisma`: removed the `Project.client` / `ClientMedia.client` relations and
  the `Client.projects` / `Client.media` back-relations; `clientId` is now a plain
  `String` holding the Convex cuid (matching how Convex stores FKs). Removing the
  relations also removes the footgun of a query accidentally JOINing the frozen
  6-row table. Verified no live Prisma `include:{client}` and no `prisma.client.*`
  access remained (only the backfill's relation-free `findMany`).
- Cascade note: dropping `client_media`'s ON DELETE CASCADE is moot — Prisma
  `client` rows are never deleted. A future Convex client delete must clean up
  `project.clientId` / `client_media` rows in app logic.
- Test: `src/server/project-client-fk.int.test.ts` — creating a project (and client
  media) against a brand-new, Prisma-absent clientId succeeds.

**Still ahead (post-central-graph):** ~~deferred crew scheduling/timesheet
sub-tables~~ **DONE** (see "Crew scheduling / timesheet sub-tables" above — the
dual-write surface is now complete); Phase 5 (auth bridge); Phase 6 (decommission —
rewire the deferred cross-domain Prisma joins off the mirror, tear out the
SSE/EventEmitter system, and run a clean truncate+backfill to clear any
regenerate-orphaned sub-hire line-item rows).

## Phase 5 — Auth bridge (done)

The browser now talks to Convex with a **real identity**, and **every Convex
function is authenticated**. Full design + threat model + codex review:
[`docs/designs/convex-phase5-auth-bridge.md`](../docs/designs/convex-phase5-auth-bridge.md).

**The hole it closed:** through Phases 0–4 every function was public + unauthed
and `NEXT_PUBLIC_CONVEX_URL` is public — anyone could read any org's data *and run
any mutation* directly from a browser. Phase 5 shuts that before production.

**Two ES256 JWTs, one Better-Auth JWKS, one Convex `customJwt` provider**
(`convex/auth.config.ts`), distinguished by claim:

- **User token** — Better Auth `jwt()` plugin, `GET /api/auth/token`
  (session-gated, 401 without a session). `sub`=userId + `orgId`/`role` claims
  read **fresh from membership at mint** (can't be elevated by stale session
  metadata). Forwarded by the browser via `ConvexProviderWithAuth`
  (`src/components/providers/convex-provider.tsx`). Grants **org-scoped reads**.
- **Service token** — minted in-process via `auth.api.signJWT`
  (`src/lib/convex-auth.ts`), a **path-less** Better-Auth endpoint (no HTTP route —
  `POST/GET /api/auth/sign-jwt` → 404). `sub`=`gearflow-service` + `svc:true`,
  cached, 5-min TTL. Attached to the shared server `ConvexHttpClient` by
  `getConvexClient()` (now async). Grants **everything** — the explicit form of the
  old implicit "trust the caller"; server actions still own permissions/validation/
  audit before calling Convex.

**Enforcement** (`convex/lib/auth.ts`, applied uniformly by the CRUD generator):
mutations → `requireService` (browser writes rejected; RBAC stays in Prisma).
Reads are **service-only by default**; a table opens to org-scoped user reads
(`requireOrgRead`/`requireOrgReadDoc`) only if it's org-scoped **and** on the
explicit `BROWSER_READABLE` allowlist (= the tables with a `use-*` hook). This
default-deny is deliberate: several org-scoped tables carry plaintext secrets
(access tokens, webhook/signing secrets), and "org-scoped ⇒ readable" would have
leaked them to any org member via the public read (flagged by /cso). Service
detection is strict: `sub===gearflow-service` **AND** `svc===true`; a non-service
token bearing `svc` is rejected.

- **Key storage**: Better Auth's `jwt()` plugin keypair lives in the new Prisma
  `jwks` table (`Jwks` model; migration `20260610000000_add_jwks_table`),
  encrypted with `BETTER_AUTH_SECRET`. Auth-owned → present in the Convex *schema*
  for completeness like the other auth tables, but **excluded from Convex CRUD**
  (`jwkses` in the generator EXCLUDE set).
- **Env**: `CONVEX_AUTH_ISSUER` (= `BETTER_AUTH_URL`) and `CONVEX_AUTH_JWKS_URL`
  are read by `convex/auth.config.ts` at push time; set them in the Convex
  deployment env (`npx convex env set …`).
- **Verified** (`pnpm convex:auth:roundtrip`, 8/8): anon read REJECTED, service
  read ALLOWED, user-match read ALLOWED, user-wrong-org read REJECTED, user
  mutation REJECTED, anon mutation REJECTED, **user read of a secret table
  (wooCommerceIntegrations) REJECTED, service read ALLOWED**. Plus `sign-jwt` 404,
  `/token` 401 without session, and tsc + 2185 tests + 0 new lint + build all green,
  and a clean `/cso` pass (the secret-table finding above was caught and fixed).
- **Not in scope (future):** direct browser *writes* (need per-mutation
  authorization in Convex), and hardening the non-org reads as their UIs go
  reactive. The service-token path is the only writer during the hybrid period.

## Phase 6 — Decommission (in progress)

Multi-session tail. Three independent, independently-shippable subsystems; do ONE
per session and leave a clean handoff. The full enumeration is in "Remaining work
& session sizing" below. Progress so far:

### Truncate + backfill resync — DONE

`pnpm convex:resync:line-items` ran (33 removed, 33 re-created, Convex == Prisma)
to clear the sub-hire-regeneration orphans documented in the sub-hire family
section. A full per-org parity check across every dual-written table
(`suppliers`, `subHires`, `subHireItems`, `subHireGroups`, `supplierOrders`,
`supplierOrderItems`, `projects`, `projectLineItems`, `kits`, `assets`,
`bulkAssets`, `projectCategories`, `projectGroups`) confirmed **only
`projectLineItem` had orphans** — child tables (`subHireItem`/`subHireGroup`/
`supplierOrderItem`) are managed by precise create/patch/remove, never bulk
delete-and-recreate, so they stay in parity. No other table needs a resync.

### Supplier dimension — FLAT reads decommissioned (nested deferred)

The deferred cross-domain `supplier` joins split cleanly into two kinds. **Flat**
reads — where `supplier` is a top-level relation on the queried row — are now off
the Prisma mirror and onto Convex attach (`src/lib/suppliers-read.ts`:
`attachSupplier` / `getSupplierById` / `getSuppliersByOrg`, plus the new
`getMatchingSupplierIds` for search filters). Rewired:

- `server/supplier-orders.ts` — `getSupplierOrders` (list + the
  `WHERE supplier.name CONTAINS` search → resolve ids, fold `supplierId in [...]`
  into the OR, omit on no match) and `getSupplierOrderById`.
- `server/sub-hires.ts` — `getSubHires` (list + search filter), `getSubHire`,
  `getSupplierRateHistory`, and every write path that only needed
  `supplier.name` for its activity-log label / return shape (`createSubHire`,
  `updateSubHire`, `deleteSubHire`, `updateSubHireStatus`, `changeSubHireProject`,
  `updateSubHirePaymentStatus`; removed a vestigial unused include in
  `duplicateSubHire`).
- `server/assets.ts` `getAsset`, `server/line-items.ts` `addLineItem` /
  `updateLineItem` returns, `server/csv.ts` (asset CSV export + import name→id
  map), `lib/org-export.ts` (export uses `getSuppliersByOrg`, strips `_id`/
  `_creationTime` like clients), `lib/reorder.ts` (org-scoped existence check via
  `getSupplierById`).

**Search-filter rule (codex-reviewed):** id-resolution is only order-safe because
neither search query sorts or paginates by the supplier name (`getSupplierOrders`
is `pageSize`-capped but ordered by `createdAt`; `getSubHires` is unpaginated,
`createdAt`-ordered). A query that sorts/pages by `supplier.name` CANNOT use this
shortcut after the join is removed — keep it on Prisma or fetch-all-then-sort.

**Deferred (next PDF/model session — they share one line-item tree):** the
**nested** supplier joins, where `supplier` sits inside a `lineItems → childLineItems`
tree alongside the still-Prisma `model.*` includes: `server/warehouse.ts` (×6,
3-deep), `server/category-slots.ts` (×5), `server/project-categories.ts` (×5),
`server/projects.ts` `getProject` (×1), and the PDF `lib/pdfme/build-document-data.ts`
(×4). These belong with the model.* + `*_media` + PDF-pipeline rewire as ONE
coherent session: the equipment editor is a single delicate read composition, the
PDF pipeline has 5 independent `DocumentLineItem` consumers (CLAUDE.md "gratuitous
risk"), and a recursive line-item-tree attach helper should land once and serve
supplier + model + media together. `prisma.supplier.*` direct reads are otherwise
fully gone (only `server/suppliers.ts` dual-write source + `lib/org-import.ts`
mirror-write remain, which is correct).

### Nested supplier + model dimension — line-item trees decommissioned (warehouse + media deferred)

The nested `lineItems → childLineItems` joins for **supplier + model** are now off
the Prisma mirror and onto a single recursive Convex attach helper,
[`src/lib/line-item-tree-read.ts`](../src/lib/line-item-tree-read.ts):

- `buildLineItemAttachMaps(orgId)` fetches the org's models / suppliers /
  categories from Convex in one `Promise.all` and keys them by cuid `id`.
- `attachLineItemTree(rows, maps)` walks a tree and attaches `model` (with the
  equipment `category` nested, replacing `model: { include: { category } }`) +
  `supplier` (replacing `supplier: { select: { name } }`) onto every node,
  recursing into `childLineItems`. The Prisma query keeps its physical-asset joins
  (`asset`/`bulkAsset`/`kit`/`units`) and the project-grouping joins (`category` =
  project_category, `group` = project_group) — separate decommission dimensions —
  and drops only `model` + `supplier`. **No Prisma fallback on a map miss** (codex
  steer): a miss yields `null` like a Prisma join against a deleted row; falling
  back would hide mirror drift and re-introduce the join.

**Two distinct "category" concepts** live on the same node and must not be
conflated: the line item's own `category` (a project_category relation, stays
Prisma) vs. the equipment `model.category` attached from Convex `categories`.

Rewired reads (each tree fully converted — never half a tree):
`lib/pdfme/build-document-data.ts` (3-deep line-item tree + the `subHires[].supplier`
shells), `server/projects.ts` `getProject` (3 trees: grouped + ungrouped per
category + top-level), `server/category-slots.ts` (`getUncategorizedSubHireGroups` +
`getUncategorizedProjectGroups`, incl. the `subHire.supplier` shell),
`server/project-categories.ts` (`getProjectCategories` — grouped + sub-hire-group +
ungrouped trees + the `subHire.supplier` shell — and `getUncategorizedLineItems`).

**PDF cross-cutting audit (CLAUDE.md mandate).** The attach produces the exact
shape the dropped Prisma include produced, so all 5 independent `DocumentLineItem`
consumers (gearflow-table render + top-level filter, section-renderer
`calculateItemHeight` + `getFilteredParentItems`, `buildDeliveryDocketGroups`) see
identical data — verified against the full field-consumption map (`model.name` /
`modelNumber` / `weight` / `category.name`, `supplier.name`→`supplierName`). New
integration test [`src/lib/pdfme/line-item-tree-attach.test.ts`](../src/lib/pdfme/line-item-tree-attach.test.ts)
exercises the WHOLE pipeline (attach → enrichment → `structureLineItems` →
`getFilteredParentItems` → `gearflowTable.pdf` render) against a realistic
equipment tree (owned line + sub-hire item + kit-with-member + stale-FK miss) and
asserts model/category/supplier reach the page with no tail-drop.

**Deferred this session (documented split):**
- **`warehouse.ts`** (`getProjectForWarehouse` + `getProjectPullSheet`) — its model
  join carries `model._count.modelCheckItems`, read by 8+ warehouse-prep UI sites,
  and `model_check_item` is **NOT dual-written to Convex**. Converting it needs a
  separate Prisma count-attach (scalars from Convex, the check-item count from
  Prisma) — a distinct concern best done as its own pass, not bolted onto this
  already-high-risk PDF/equipment-editor session (codex agreed: keep warehouse
  fully Prisma until then, don't half-convert the tree).
- **`*_media`** (`model_media`/`asset_media`/…) — these join tables have Phase-2
  Convex CRUD modules but are **NOT dual-written** (no mirror, no backfill), so
  their Convex copies are empty/stale. All `*_media` reads stay on Prisma. (They
  don't appear inside these particular line-item trees anyway — the project-media
  gallery composes separately.)

Verified: tsc clean, 2191 tests (2185 + 6 new), 0 new lint (8 errors / 344 warnings
baseline), `pnpm build` exit 0, codex diff review (no correctness bugs), + a live
round-trip ([`scripts/convex-roundtrip-line-item-attach.ts`](../scripts/convex-roundtrip-line-item-attach.ts))
proving the attached model/category/supplier match a direct Prisma join (5/5 models,
supplier exact). `prisma.supplier.*` / `prisma.model.*` cross-domain reads remaining
in app code are now only warehouse (deferred) + the dual-write sources.

### Warehouse line-item trees decommissioned — ★ line-item-tree dimension COMPLETE ★ (session 2026-06-10d)

The two deferred warehouse readers — `server/warehouse.ts` `getProjectForWarehouse`
(3-deep) + `getProjectPullSheet` (3-deep) — are now off the Prisma mirror, finishing
the nested supplier+model+category line-item-tree dimension. Both drop their
`model` + `supplier` includes and attach from Convex via `attachLineItemTree`
(reusing the helper from the previous session — `getProjectPullSheet`'s `model.category`
now comes off the mirror too). `kit` stays a Prisma join in both: the attach helper
never touches it, and `getProjectForWarehouse`'s `kit._count.kitCheckItems` reads a
table (`kit_check_item`) that, like `model_check_item`, is not dual-written.

**The `model._count.modelCheckItems` graft (approach (a), codex-confirmed).**
`model_check_item` is NOT dual-written to Convex, so the per-model check-item count
that gates per-line check prompts (read by 8+ sites in
`warehouse/[projectId]/page.tsx`, plus `warehouse-types.ts` + `item-check-form.tsx`)
cannot come off the mirror. So model **scalars + category + supplier** come from
Convex, but the **count stays sourced from Prisma**: one indexed grouped query
(`prisma.modelCheckItem.groupBy({ by: ['modelId'], where: { organizationId,
modelId: { in } }, _count: { _all: true } })` — `@@index([organizationId, modelId])`),
then `attachModelCheckItemCounts` grafts `_count: { modelCheckItems: n }` back onto
each Convex-attached `model` node (recursing children, absent → `0`, null model
preserved). This keeps the warehouse payload byte-identical to the old
`model: { ..., _count: { modelCheckItems } }` include. New pure helpers in
[`src/lib/line-item-tree-read.ts`](../src/lib/line-item-tree-read.ts):
`collectTreeModelIds`, `attachModelCheckItemCounts`, type `ModelWithCheckCount`;
the `groupBy` lives in `warehouse.ts` `getModelCheckItemCountMap` (Prisma can't be
imported into the pure module). Codex consult endorsed (a) over (b) (dual-writing
model_check_item + kit_check_item first) — (a) keeps decommission scope tight,
preserves payload compat, avoids hiding mirror misses, and leaves the config-ish
check-item tables as a deliberate later migration.

**The deferred-from-(a) split still holds:** `kit_check_item` count stays Prisma
(kit kept a Prisma join), and `*_media` joins stay Prisma (not dual-written). When
those tables are eventually mirrored, the `kit` join + the `model._count` graft can
collapse fully onto Convex.

Verified: tsc clean (also fixed a pre-existing type error in
`line-item-tree-attach.test.ts` — `RawNode` intersected `Partial<DocumentLineItem>`'s
`childLineItems` and forced children to be full `DocumentLineItem`; `Omit`'d the
field), 2198 tests (2191 + 7 new in
[`src/lib/line-item-tree-read.test.ts`](../src/lib/line-item-tree-read.test.ts)),
0 new lint (8/344 baseline), `pnpm build` exit 0, codex diff review, + a live
round-trip ([`scripts/convex-roundtrip-warehouse-tree.ts`](../scripts/convex-roundtrip-warehouse-tree.ts))
proving model/category/supplier AND the grafted `_count.modelCheckItems` match the
dropped Prisma joins/include (DB currently has 0 `model_check_item` rows, so the live
count is 0==0; the non-zero graft is covered by the unit test). After this,
**every line-item-tree reader is off the mirror** — the only remaining
`prisma.model.*` / `prisma.supplier.*` cross-domain reads are the dual-write sources
(`server/models.ts`, `server/suppliers.ts`) + `lib/org-import.ts` (mirror writes).

### Check-item assignment mirrors + warehouse counts off Convex (session 2026-06-10e)

The two check-item ASSIGNMENT join tables — `model_check_item` and
`kit_check_item` — are now **dual-written** (they had Phase-2 CRUD but empty/stale
Convex copies). `src/lib/check-item-assignment-mirror.ts` (scalar-projecting
mirror-core create/remove — relation includes stripped before the strict Convex
validator — + `syncModelCheckItemsForModels` / `syncKitCheckItemsForKit` heal
helpers for the `updateMany`-reorder and `createMany`-bulk paths that return no
ids; a **tolerant remove** that swallows a missing mirror row so a delete during
migration drift never errors after the durable Prisma delete — codex-flagged,
matches crew-scheduling-mirror's `removeSafe`). Wired every write site:
`check-items.ts` (add/remove/reorder/bulk for both), `kits.ts` deleteKit (capture
ids before the cascade, remove from Convex after), `org-import.ts` (both creates).
Backfill `pnpm convex:backfill:check-item-assignments` (idempotent heal path; DB
currently has 0 rows of each).

With both tables mirrored, the **warehouse line-item-tree count graft collapses
onto Convex** (the bit session 2026-06-10d deliberately left on Prisma):
`getModelCheckItemCountMap(orgId)` / `getKitCheckItemCountMap(orgId)` in
`line-item-tree-read.ts` now source the per-model/per-kit count from one org-scoped
Convex `list` counted in JS (codex-endorsed over a hand-maintained Convex count fn
the generator would overwrite), replacing the Prisma `groupBy`. New `attachKitTree`
grafts the Convex `kits` doc + `_count.kitCheckItems` onto every tree node (**no
Prisma fallback** on a map miss), so `warehouse.ts` `getProjectForWarehouse` +
`getProjectPullSheet` drop their last `kit` Prisma join too. Payload stays
shape-identical (`model._count.modelCheckItems` + `kit._count.kitCheckItems`, read
by 8+ warehouse-prep UI sites). The model/kit **"Checks" tabs + the check-item
library usage count go reactive** (`use-check-item-assignments.ts` →
`modelCheckItems`/`kitCheckItems` added to `BROWSER_READABLE` — no secrets).

**`crewMembers.icalToken` field-level redaction (the tracked sub-8 Phase-5
residual — now CLOSED).** crewMembers is browser-readable, so its per-member
calendar-feed secret leaked to any org member via the public Convex read. The CRUD
generator gained a `REDACTED_FIELDS` map; browser-readable reads now strip listed
fields for USER tokens (the service token still sees the full row, and the crew
detail page reads the token via a Prisma-backed server action — unaffected).
Helper `redactFields()` in `convex/lib/auth.ts`.

Verified: tsc clean, **2203 tests** (2198 + 5 new attachKitTree), 0 new lint (8
errors / 345 warnings — +1 sanctioned `_id`-strip), `pnpm build` exit 0, codex diff
review (fixed the one P2 — tolerant remove), + a live round-trip
([`scripts/convex-roundtrip-check-items.ts`](../scripts/convex-roundtrip-check-items.ts))
**7/7**: Convex-sourced model/kit counts see an inserted assignment, and
`icalToken` is VISIBLE to the service token but REDACTED for the user token on both
`list` + `getById` (non-secret fields intact). Used the JWKS-sidecar recipe (dev
:3007 → curl jwks → sidecar on `gearflow-convex_default` net → env-set → ran →
RESTORED `CONVEX_AUTH_JWKS_URL` to host.docker.internal:3000 + tore down).

**Remaining Phase 6:** ~~`*_media` reads~~ **DONE** (see below — dual-written +
photo grafts off the mirror), ~~warehouse scan-path single-model reads~~ **DONE**
(see below), then SSE/EventEmitter teardown (blocked on React Query removal), then
React Query removal (172 files / ~875 `useQuery`).

### `*_media` dual-write + photo grafts off the mirror (session 2026-06-10f)

The seven `*_media` join tables — `model_media`, `asset_media`, `kit_media`,
`project_media`, `client_media`, `location_media`, `sub_hire_media` — are now
**dual-written** (they had Phase-2 Convex CRUD but empty/stale copies).
[`src/lib/media-mirror.ts`](../src/lib/media-mirror.ts) is config-driven
(`MEDIA_SPECS` per kind): `mirrorMediaCreate` (targeted single insert on the
create path) + **`syncMediaForParent`**, an AUTHORITATIVE per-parent reconcile
(re-read all of a parent's Prisma rows, upsert each, then REMOVE Convex rows whose
Prisma id is gone). Media correctness is a **parent-level invariant** (one primary
photo, sort order, promote-next-on-delete) so the delete / set-primary / reorder /
parent-cascade paths reconcile the whole parent rather than mirror each
intermediate patch — and the remove-stale pass is what makes a delete correct
(upsert-only would leave the deleted row in Convex). Codex-reviewed (the
remove-stale requirement was the key steer; matches the `mediaDoc` scalar-strip +
tolerant-remove patterns in check-item-assignment-mirror). Wired ALL write sites:
the 7 `*-media` server actions (model/asset/kit have create + delete+promote +
set-primary; model adds reorder; project/client/location/subHire are create +
delete), `sub-hires.ts`, `kits.ts` `deleteKit` (kit-cascade → reconcile to empty),
and `org-import.ts` (the 6-table media loop). Backfill
`pnpm convex:backfill:media` ([`scripts/convex-backfill-media.ts`](../scripts/convex-backfill-media.ts),
idempotent; exercises the non-zero path unlike the 0-row check-item tables —
though the dev DB currently has 0 media rows, the live round-trip seeds one).

**Photo grafts moved onto the Convex mirror** (codex-endorsed "move, keep the
shape"). The three reactive-list primary-photo grafts —
`getModelCounts` (models.ts), `getKitCounts` (kits.ts), `getAssetRegistryPhotos`
(assets.ts) — read the photo off the Convex `*_media` + `fileUploads` mirror via
[`src/lib/media-read.ts`](../src/lib/media-read.ts) (`getPrimaryPhotoMap` /
`getPrimaryPhotoMaps`) instead of a Prisma `*_media` join. The read keeps its
exact prior shape (a `{ url, thumbnailUrl }` map keyed by parent id); only the
backing store changes. `getAssetRegistryPhotos` (asset + model) uses
`getPrimaryPhotoMaps(["asset","model"])` so the largest collection
(`fileUploads`) is `.collect()`ed **once**, not per kind (codex P2 fix). Pure
`buildPrimaryPhotoMap` is unit-tested (PHOTO+isPrimary filter, file join,
missing-file→null, no Prisma fallback). These reads run on the **service token**
(server actions), so no `BROWSER_READABLE` change — `*_media` stays service-only.

**Left on Prisma (codex-endorsed, matches the supplier/model precedent):** the
**detail-page** media galleries (`getModel` / `getAsset` / `getKit` compose
`media` inside a large non-reactive cross-domain Prisma query — splitting one
`media` include out is gratuitous risk) and the **dead standalone gallery
actions** (`getModelMedia` / `getAssetMedia` / … are imported by no UI). **The PDF
pipeline reads NO `*_media`** (verified by grep), so there is NO PDF-consumed media
shape change → the CLAUDE.md 5-consumer cross-cutting audit + a PDF integration
test do not apply here (a justified skip, not an omission).

Verified: tsc clean, **2210 tests** (2203 + 7 new across media-mirror.test.ts +
media-read.test.ts), 0 new lint errors (8/346 — +1 sanctioned `_id`-strip in
`patchIn`), `pnpm build` exit 0, codex diff review (fixed the one P2), + a live
round-trip ([`scripts/convex-roundtrip-media.ts`](../scripts/convex-roundtrip-media.ts))
**8/8** seeding a real fileUpload + primary PHOTO modelMedia: the Convex-sourced
photo == a direct Prisma join (non-zero url/thumbnail), `getModelById` scan-path
attach matches, and `syncMediaForParent` removes a Prisma-deleted row. JWKS-sidecar
recipe used (dev :3007 → curl jwks → sidecar on `gearflow-convex_default` →
env-set → ran → RESTORED `CONVEX_AUTH_JWKS_URL` to host.docker.internal:3000 +
torn down).

### Warehouse scan-path single-model reads off the mirror (session 2026-06-10f)

The two warehouse **scan-path** readers in `server/warehouse.ts` that still joined
`model` from Prisma are off the mirror now that `model` + `model_check_item` are
dual-written:

- `lookupAssetForScan` — the asset / bulkAsset look-ups dropped their
  `model: { include: { category, _count: { modelCheckItems } } }` includes and
  attach `model` from the Convex mirror via `getModelById`. The scan path only
  reads `model.name` (the old `category` + `_count` includes there were
  **vestigial** — never consumed), so the attach is a single `getModelById` per
  found asset/bulk; `model.name` references became optional-chained (a mirror miss
  → empty name, no Prisma fallback).
- `quickAddAndCheckOut` — the created line item dropped its
  `model: { include: { _count: { modelCheckItems } } }` include; after the tx the
  `model` is attached from `getModelById` + the `_count.modelCheckItems` grafted
  from `getModelCheckItemCountMap` (the existing dual-written-source helper),
  preserving the old shape (model scalars + `_count`, no category/supplier) so the
  client still routes the line through the check queue on a non-zero count.

**Latent dual-write gap fixed:** `quickAddAndCheckOut` created a `projectLineItem`
but never mirrored it to Convex (no `upsertProjectLineItemsToConvex`), leaving the
mirror short a row until a resync. Now mirrored after the tx (the same call every
other line-item write site uses). Covered by the round-trip's `getModelById`
assertion (model present + name match).

### SSE / EventEmitter teardown — ✅ DONE (2026-06-11f)

The dead realtime-sync system ([FEATUREDOCS/53](./53-realtime-sync.md)) is fully
removed. It was **safe to delete outright** (not fix-then-keep) because it had zero
working consumers:

- **Emit side was a no-op.** `logActivity` always passed a lowercase/camelCase
  `entityType` (`"asset"`, `"project"`, …) but `mapEntityTypeToEvent` switched on
  PascalCase (`"Asset"`, `"Project"`, …) → no case ever matched → `events.emit`
  was never reached. Confirmed: zero PascalCase `entityType:` literals in `src/`.
- **Read side had no readers left.** `use-realtime.ts` only called React Query's
  `invalidateQueries` on SSE-mapped keys (project / asset / kit / warehouse-project /
  maintenance-records / dashboard / crew-members / …), and **every** one of those
  keys' readers is now a reactive Convex hook or `useServerQuery` — none are React
  Query readers anymore. So removal is data-identical: no cross-user liveness is
  lost (it never existed), and same-view refresh is already handled by explicit
  `refetch`/`onChanged` calls in the converted pages.

Removed across four commits (each tsc/tests/build green):
1. `src/lib/activity-log.ts` — dropped `mapEntityTypeToEvent` + the `events.emit`
   side-effect + the `@/lib/events` import; `logActivity` still writes the
   activity-log row to Prisma (its real job).
2. `src/app/layout.tsx` — removed `<RealtimeProvider>` + its import.
3. Deleted `src/lib/events.ts`, `src/app/api/realtime/route.ts`,
   `src/hooks/use-realtime.ts`, `src/providers/realtime-provider.tsx` (and reworded
   the two doc-comments in `use-server-query.ts` / `use-reactive-server-query.ts`
   that pointed at the deleted hook).
4. Docs (this entry + the [FEATUREDOCS/53](./53-realtime-sync.md) superseded header).

`src/server/damage.int.test.ts` never touched the event bus (its only "events"
reference is a comment about activity-log rows), so it needed no change; the suite
stays green at 2235 tests.

**If cross-user liveness is wanted later**, that's the version-vector pattern
(`useReactiveServerQuery` + `convex/<table>Detail.ts`) already used for
kit / asset / warehouse / stocktake detail — a separate feature, not this teardown.

**Endgame after this — ✅ DONE (2026-06-11g):** the RQ infra (`query-provider` +
`user-nav`'s `queryClient.clear()`) and the `current-role` auth datum
(`use-permissions` + `member-list` + `role-editor-dialog`) were the last holdouts.
`current-role` was converted onto `createSharedResource` (the recommended option —
data-identical, since SSE is dead), taking React Query to **zero**. See the
"React Query removal — ✅ DONE" section below.

### React Query removal — ✅ DONE (2026-06-11g — RQ at zero; foundation 2026-06-10g)

~172 files / ~875 `useQuery` (534) + `useMutation` (417) calls at the start.
Multi-session, batched by **data-island** (the unit is a DATUM/query-key, not a
file). Foundation + 3 datums in 2026-06-10g; 8 more in 2026-06-10h (~164 files still
import RQ). Sections below: the keystone hook, the safety rule, then per-session
progress.

**End-state model.** Reads → Convex `useQuery` (natively reactive over WebSocket —
works even for cross-domain reads because the whole graph is dual-written). Writes
stay **browser → server action → Convex** (browser writes rejected per Phase 5).
Convex pushes a live update to every subscriber after a write, so there is **NO
cache to invalidate** — React Query's `invalidateQueries` glue disappears as each
datum is converted. SSE/`use-realtime.ts` can only be torn out once RQ is fully
gone (it has no readers left to invalidate).

**The keystone: [`src/hooks/use-server-mutation.ts`](../src/hooks/use-server-mutation.ts)**
— `useServerMutation`, a drop-in replacement for RQ's `useMutation`. Same
object-config API (`{ mutationFn, onSuccess, onError, onSettled }` →
`{ mutate, mutateAsync, isPending, error, data, reset }`) so a call site converts
with a one-line swap. Invalidation-free; `onSuccess` is for view-local effects
only (toast / close dialog / `router.refresh()`). Hardened (codex): in-flight
**counter** so `isPending` survives overlapping calls (`remove.mutate(id)` per
row), latest-call-wins `data`/`error`, callback errors logged not merged with the
mutation error, options ref updated in an effect (react-compiler), unmount-guarded.
11 unit tests.

**The unit of conversion is a DATUM, not a file (the critical safety rule).** A
writer can drop a datum's invalidation only once **every reader of that datum** is
Convex-subscribed — otherwise a still-RQ reader loses its post-write refresh
(silent staleness — the one hazard codex flagged). So: (1) find every reader of
the datum (`grep` the query key + the server action), (2) convert each reader to
the reactive `use-*` hook (a file may keep RQ for its *other* data — per-datum,
not per-file), (3) convert the writers to `useServerMutation` and drop that
datum's `invalidateQueries`, (4) the table must already be in `BROWSER_READABLE`
(add it + regen if not; no secrets). The org-scoped Convex `list` returns all rows
(all entity types / archived) — re-apply the old `where` filter client-side, the
sanctioned Phase-4 pattern (testProfiles/suppliers/models all do this).

**Done this session (3 domains/datums):**
- **custom-fields** — fully clean per-file island (3 files). New
  `useActiveCustomFields(orgId, entityType)` (filters the reactive list) replaces
  `getActiveCustomFields` in `custom-fields-input`/`-display`; settings page
  create/update/delete → `useServerMutation`, both invalidations dropped.
- **testProfiles** — per-datum: `model-form.tsx` + `test-and-tag/new` testProfiles
  read → `useTestProfiles` (both keep RQ for other data); settings page (5
  mutations) → `useServerMutation`, fully RQ-free.
- **check-item library** (`[check-items]`) — per-datum: `model-table.tsx`
  bulk-assign dialog read → `useCheckItems(open ? orgId : undefined)` (mirrors the
  old `enabled:open`); settings page (create/update/delete) → `useServerMutation`,
  fully RQ-free. (The `[model-check-items]`/`[kit-check-items]` ASSIGNMENT datum in
  `item-check-form` is separate, untouched.)

No `BROWSER_READABLE` change needed (all 3 tables were already reactive from Phase
4). Verified: tsc clean, 2221 tests (2210 + 11 hook tests), 0 new lint (8 err /
345 warn — actually −1 warn from removed dead imports), `pnpm build` exit 0, codex
review (no dropped-invalidation bug; the keystone hook design endorsed). No live
JWKS round-trip needed — no new Convex table/function exposed; the new logic is the
client hook, covered by unit tests.

**Done session 2026-06-10h (8 more datums; 6 commits pushed).** All eight were
config/dropdown/edit datums whose list readers were already reactive from Phase 4,
so each was finished by converting the *remaining* RQ readers + dropping the now-dead
invalidations (per-datum, never per-file). Crucially, many "readers" the first grep
flagged were actually stale `invalidateQueries` calls in writers — distinguish true
`useQuery` readers from dead invalidations before touching anything.
- **suppliers**, **clients** — 0 remaining RQ readers (list already on
  `useSuppliers`/`useClients`); pure cleanup of dead `invalidateQueries` + the two
  quick-create components moved to `useServerMutation`.
- **kits** — kit-add-form picker → `useKits` (re-apply `getKits`'s active+non-prep
  filter, assetTag sort, category name from `useCategories`); dead `["kits"]`
  invalidations dropped.
- **locations** — woocommerce/kits-page/asset-table readers → `useLocations`
  (default-first then name; parent name resolved from the flat list); 4 writers'
  invalidations dropped; `quick-create-location`/`location-form` → `useServerMutation`.
- **categories** — all 9 readers → `useCategories` / new **`useCategoriesWithParent`**
  (mirrors `include:{parent}` + `orderBy:[{sortOrder},{name}]` from the flat list);
  3 writers (category-manager, the management page, quick-create) → `useServerMutation`;
  the management page now mirrors `CategoryManager` exactly (reactive list + cross-domain
  `getCategoryCounts` + children from the flat list).
- **crew-roles** + **crew-skills** — crewRoles read under THREE keys (`crew-roles-all`,
  `crew-roles`, `crew-role-options`) and crewSkills under two; all → `useCrewRoles`/
  `useCrewSkills`. Role member-counts derive from the reactive `useCrewMembers`
  (`crewRoleId`); the crew_member↔crew_skill m2m is NOT in Convex, so per-skill counts
  come from a NEW cross-domain `getCrewSkillCounts()` server action (the
  `getCategoryCounts` pattern). Dialog readers keep `enabled:open` via
  `useCrewRoles(open ? orgId : undefined)`.
- **models** — the 4 model dropdowns (asset-form, bulk-asset-form, equipment-add-form,
  sub-hire-order-dialog) → `useModels` (re-apply `isActive` + per-call `assetType`
  filter + name sort; scalar fields only); `["models"]` invalidations dropped incl.
  rewriting csv-import-dialog's `type==='assets'?['assets']:['models']` ternary to keep
  only the still-RQ assets branch.

No `BROWSER_READABLE` change (all eight tables were reactive from Phase 4); no live
JWKS round-trip (no new Convex table/fn — `getCrewSkillCounts` is Prisma-only, server
side). Each batch independently verified: `tsc` clean, **2221 tests**, 0 new lint
(stash-compare normalized for line-shift noise), `pnpm build` exit 0, codex diff
review (no dropped-invalidation bug found in any). 11 datums now fully off RQ
(custom-fields + testProfiles + check-item-library from 2026-06-10g, plus these 8).

**Remaining (~164 files import RQ).** The survivors are mostly hard cross-domain-composing
pages (projects / warehouse / dashboard) whose reads compose data a pure
table `useQuery` can't express yet — those either get hand-written Convex composite
queries (the dual-write graph makes this possible) or stay on RQ until then. Notable
still-RQ datums needing cross-domain joins: **assets/bulk-assets** (test-and-tag/new
needs `asset.model.*`), **org-tags** (11 readers, no hook yet — needs a new hook +
`BROWSER_READABLE` entry + round-trip), plus the project/warehouse/dashboard composites.
The clean config/dropdown/edit reads convert mechanically by the playbook above. NOT a
safe parallel fan-out as-is: the config "domains" entangle through shared big files
(`model-table`, `model-form`, warehouse) so parallel agents would conflict — do
sequential per-datum batches. Add each newly-reactive table to `BROWSER_READABLE`
(no secrets) before relying on its browser read.

**Done session 2026-06-10i (org-tags + the `useServerQuery` keystone + 14 no-liveness
datums; 5 commits pushed; ~164 → 156 files import RQ).** Two distinct conversion
*kinds* were used this session, and the distinction is the key lesson:

1. **org-tags** — NOT a Convex table. `getOrgTags()` is a read-only aggregate over the
   `tags[]` arrays of 9 entity tables, autocomplete-only, never invalidated. So the
   prompt's "add the tag table to `BROWSER_READABLE` + round-trip" did **not** apply.
   New one-shot hook [`use-org-tags.ts`](../src/hooks/use-org-tags.ts) wrapping the
   existing server action; converted all 11 entity forms. Clears on org change to
   mirror RQ's per-key isolation (codex caught this). No Convex change, no round-trip.

2. **The `useServerQuery` keystone** ([`src/hooks/use-server-query.ts`](../src/hooks/use-server-query.ts),
   7 unit tests) — the **read analogue of `useServerMutation`** for the large
   *no-liveness read* tail. Drop-in for RQ's `useQuery`
   (`{ queryKey, queryFn, enabled }` → `{ data, isLoading, error, refetch }`),
   one-shot, keyed on a serialized `queryKey`. **Staleness is derived during render**
   (a result is tagged with the key it was fetched for; a result under a different key
   reads as stale → `undefined`) rather than cleared via `setState` in an effect —
   that both guarantees RQ's per-key isolation AND avoids the "synchronous setState in
   an effect" cascading-render lint. **Use it ONLY for datums proven no-liveness:
   never in any `invalidateQueries` call AND not in `use-realtime.ts`'s SSE key map.**
   For anything that must update live, use a reactive Convex `useQuery` hook instead.

   Converted with it (all verified never-invalidated + not SSE-mapped, so a one-shot is
   data-identical — RQ gave them no liveness beyond mount/focus refetch anyway):
   - **7 cross-domain count badges**: supplier-counts, location-counts, model-counts,
     client-project-counts, crew-skill-counts, category-counts (both readers), kit-counts.
     Each is a secondary badge merged into an already-reactive Convex table list. Dropped
     the **spurious** `["kit-counts"]` invalidation in the kits-page force-return mutation
     (getKitCounts returns only member-item counts + primary photo; a force-return returns
     checked-out assets, changing neither — codex confirmed). Kept the `["assets"]` one.
   - **7 previews / lookups / summaries**: project-number-preview, utilization-summary,
     kit-delete-info, reports-summary, peek-test-tag-ids, project-number-next,
     woocommerce-meta-keys. Dropped two `staleTime` options (no useServerQuery
     equivalent; key-change still drives the refetch — at worst slightly more eager).

   8 files became **fully** React-Query-free (location-form, supplier/location/client
   tables, crew settings, both category readers, utilization page, project-numbering
   settings). The rest are partial-file (the page keeps RQ for its other datums).

**RQ-removal datum verification rule, refined this session.** Before converting a datum,
classify it: (a) **reactive** (it IS or should be live — a table list, detail page,
or anything in `use-realtime.ts`'s SSE map / explicitly invalidated) → convert to a
reactive Convex `useQuery` hook; (b) **no-liveness** (never invalidated anywhere AND
not in the SSE map) → `useServerQuery`. Two cheap greps settle it: `grep '"<key>"' | grep
invalidate` and check `use-realtime.ts`'s `getInvalidationKeys`. NB React Query's
`invalidateQueries({queryKey:["dashboard"]})` is a *prefix* match on the first element —
`["dashboard-stats"]` does NOT match `["dashboard"]`, so most `dashboard-*` datums are
actually no-liveness despite the SSE entry; verify per key, don't assume.

**Remaining (~156 files import RQ).** Survivors split into: **(a)** more no-liveness
single-datum reads (mechanical via `useServerQuery` — e.g. the remaining `*-summary` /
analytics / settings-preview reads); **(b)** auth/RBAC/platform datums (organization,
custom-roles, members, sso-*, profile, notifications, admin) that **stay Prisma forever**
— most should also become `useServerQuery`, BUT first check the invalidation relationship:
those read+written in the same view can refetch via the reader's `refetch()` from the
writer's `onSuccess`; cross-component invalidated ones need more care; **(c)** hard
cross-domain-composing pages (projects / warehouse / dashboard / crew scheduling, detail
pages) needing hand-written Convex composite queries or a careful multi-hook client-join
— slowest, ~1–3/session; **(d)** assets/bulk-assets (test-and-tag/new needs a 4-way
client join). SSE/`use-realtime.ts` teardown stays blocked until RQ is FULLY gone.

**Done session 2026-06-10j (the no-liveness read tail, GO-FAST sweep; 5 commits pushed;
156 → 143 files import RQ; 26 → 70 datums off RQ — 44 this session).** Pure mechanical
`useQuery` → `useServerQuery` swaps over the proven no-liveness recipe, batched by domain
(one commit per group): **dashboard** (6: dashboard-stats/activity/upcoming/sub-hire-stats,
my-home, my-crew-id), **crew analytics/pickers** (11: crew-planner, crew-upcoming-shifts,
crew-active-assignments, crew-picker-list, crew-for-assignment, crew-members-for-assignment,
crew-linkable-users, crew-member-extras, crew-message, task-assignees, projects-list),
**admin** (2: admin-dashboard, admin-org-custom-roles), **analytics/lookups** (16:
model-failure-analytics, bookings, ad-hoc-lookup, asset-check-history, maintenance-assets,
project-issues, call-sheet-dates, kit-availability, containerAssets, locations-for-display,
document-templates-dropdown, warehouse-pullsheet ×2 files, test-tag-search,
test-tag-bulk-assets, saved-report ×2 files, template-editor), **supplier/accessory detail**
(9: supplier ×2, supplier-orders, supplier-assets, supplier-subhires, supplier-rate,
model-rates, accessory-assets, accessory-bulk, model-accessory-bulk). 13 files became
fully RQ-free.

**THE ONE METHODOLOGY UPGRADE that made the sweep safe: the invalidate grep MUST be
multiline-aware.** A single-line `grep 'invalidateQueries(.*queryKey:\s*\["key"'` MISSES
the common multi-line form
```
queryClient.invalidateQueries({
  queryKey: ["key", orgId, id],
});
```
The correct classifier is `grep -Pzo '(invalidateQueries|refetchQueries|setQueryData|
cancelQueries|removeQueries)\(\s*\{?\s*queryKey:\s*\[\s*"<key>"'` (null-joined, multiline).
This caught **crew-availability** and the **entire stocktake batch** (stocktake / -progress
/ -recent / -search) as actually-invalidated → reactive → EXCLUDED from this sweep (they need
reactive Convex hooks; the scanner invalidates them after each scan — genuinely live).
A naive single-line grep would have wrongly forced `useServerQuery` onto a live multi-user
counting workflow. Also confirmed once, globally: there are **zero** `refetchQueries` /
`setQueryData` / `removeQueries` / `cancelQueries` and **zero** template-literal invalidation
keys in the codebase, so the literal multiline invalidate grep is authoritative; and the
QueryClient sets `refetchOnWindowFocus: false` globally (`query-provider.tsx`), so a
no-liveness `useServerQuery` is genuinely data-identical (mount + manual `refetch()` only).

**Other gotchas this session:** (1) `useQuery<Generic>(...)` calls hide from a `useQuery(`
grep — the generic sits between the name and `(`. The orphan-import detector and a swap
regex both missed three reactive readers in `sub-hire-order-dialog.tsx`; tsc caught it
(`Cannot find name 'useQuery'`). When deciding whether to drop `useQuery` from an import,
trust tsc, not a `useQuery(` grep. (2) The keys returned by a `queryKey:` grep include BOTH
readers AND invalidate-call keys — e.g. `["asset"]`/`["model"]`/`["project"]` in the
accessory-manager / kit-add-form files were invalidate targets, not readers, so those files
had their ONLY reader converted and `useQuery` became an orphan import (correctly dropped).
(3) Drop any `staleTime` option on conversion — `useServerQuery` rejects it (tsc error);
key-change drives the refetch. **No codex review** (pure mechanical swaps, zero invalidation
drops — `useServerQuery` only wraps existing server actions); **no JWKS round-trip** (no new
Convex table/fn). Verified: tsc clean, **2228 tests** (unchanged — client-hook swaps),
0 new lint (normalized stash-compare vs base across 34 changed files), build exit 0.

**Done session 2026-06-10k (★ NO-LIVENESS READ TAIL EXHAUSTED ★; 4 commits pushed;
143 → 143 files import RQ but 70 → 76 datums off RQ; 7 files newly fully RQ-free).**
A single up-front classification pass settled the whole session: dump every remaining
`useQuery` key, run the multiline invalidate grep + the SSE exact-match set (`use-realtime.ts`)
against each, and a properly-anchored Python parser to attribute keys to the RIGHT call
(see gotcha 4 below). Result — only a handful of true no-liveness RQ readers remained, all
converted: **clean swaps** (`activity-logs`, `category` detail, availability `calendar`,
`auditor` token page, `item-check-form` model/kit-check-items → fully RQ-free) + **keep-RQ
siblings** (`asset-registry-photos` graft, `members` picker ×3, `auditorScopeOptions`,
`crew-conflicts` preview) + **two read+write islands** (`saved-views-menu`, `tasks-panel`'s
`project-tasks`) converted with `useServerQuery` + `useServerMutation`, replacing
`invalidateQueries(key)` with the reader's `refetch()` — data-identical because each is a
single reader+writer with no other consumer and no cross-user liveness under RQ either (both
files now fully RQ-free).

**After this sweep the no-liveness tail is empty.** A re-scan shows 124 RQ `useQuery` calls
left: 118 genuinely reactive, and the 6 "candidates" are exactly the excluded special cases —
the `client` / `location` / `bulk-asset` **detail pages** (they pass `queryKey={[...]}` as a
prop to child `MediaUploader` / `NotesEditor` that invalidate dynamically — a literal grep
can't see that, so they are NOT data-identical → reactive tail), `notifications` ×2
(`refetchInterval: 60_000` polling — `useServerQuery` has no interval → reactive tail / Convex
hook), and `stocktakes` (the reactive scanner workflow). **Everything mechanical is done; what
remains is all genuinely reactive and needs hand-written reactive Convex `useQuery` hooks.**

**New gotchas this session (beyond 2026-06-10j's):** (4) **a non-anchored `queryKey:` lookahead
mis-attributes a variable-key reader to the NEXT literal key.** A reader written
`useQuery({ queryKey: tasksKey, queryFn })` followed later by `useServerQuery({ queryKey:
["task-assignees"] })` gets reported as reading `task-assignees` if the parser scans forward
for the first `queryKey: ["..."]`. Anchor the key extraction to *immediately* after the
matching `useQuery( {` and resolve variable keys (`const tasksKey = ["project-tasks", …]`) to
their element-0; otherwise you'll "convert" a key that's already done and miss the real island.
(5) **`useServerQuery` rejects `retry` too** (like `staleTime`) — drop it (it never retried
anyway; data-identical). (6) **RQ's `mutate(vars, { onSuccess })` per-call options are not
supported by `useServerMutation`** — rewrite as `mutateAsync(vars).then(...).catch(() => {})`
(the global `onError` still fires inside `mutateAsync`; `.then` runs only on success — same
semantics). (7) **A component test that pre-seeds the RQ cache for synchronous resolution
breaks under `useServerQuery`** (which fetches via a mount effect through the mocked server
action): drop the `QueryClientProvider`, drive the data set via a **mutable `mock`-prefixed**
return (`let mockCurrentItems …; vi.fn(async () => mockCurrentItems)` — the `mock` prefix
satisfies vitest's vi.mock hoist rule), and make each case `await renderForm()` so the
resolving microtask flushes (`await act(async () => { await Promise.resolve(); })`) before the
asserts. (8) **The lint normalized stash-compare is non-negotiable** — dropping a reader can
orphan the `useQuery` *import* (maintenance-form lost its only RQ reader but kept the import →
one new `no-unused-vars` warning); the base-vs-HEAD normalized compare (`file|rule`, line
numbers stripped) caught it. **No codex / no JWKS round-trip** (pure mechanical, zero
invalidation drops). Verified: tsc clean, **2228 tests** (item-check-form test reworked for the
async load), 0 new lint (normalized base-vs-HEAD compare), build exit 0.

**NEXT = the reactive tail** (slower, ~1–3 conversions/session; needs reactive Convex `useQuery`
hooks, NOT `useServerQuery`; the graph is fully dual-written so composites are possible):
notifications (drop the 60s poll for a WS push — check the notifications table is dual-written
first), the `client` / `location` / `bulk-asset` detail pages, `stocktake*` + `crew-availability`
(scanner / scheduling live workflows), and the hard project / warehouse / dashboard detail
composites.

**Reactive-tail blocker confirmed (the detail-page coupling point).** The detail-page readers
are NOT independent: `MediaUploader` (`src/components/media/media-uploader.tsx`) and `NotesEditor`
(`src/components/ui/notes-editor.tsx`) are **shared write-components (9 consumers)** that take a
`queryKey: unknown[]` prop and internally `useMutation` + `queryClient.invalidateQueries(queryKey)`
after an upload / note-save. The keys passed are the detail pages' own reader keys —
`["model"|"asset"|"kit"|"project"|"client"|"location"|"sub-hire", orgId, id]` — and several of
those (`model`, `asset`, `kit`, `project`) are ALSO in the SSE `getInvalidationKeys` map, so the
same key is the refresh channel for BOTH "refresh my view after my own write" (the child prop) AND
cross-user SSE pushes. This means: (a) the SSE-keyed detail pages (model/asset/kit/project) are
genuinely live and must become **reactive Convex `useQuery` hooks** (`useAsset`/`useKit`/`useModel`
exist but return only the table doc — the detail pages compose cross-domain media + projects +
sub-graphs, so they need hand-written composite Convex queries, NOT `useServerQuery`); (b) you
canNOT convert one detail page in isolation — `MediaUploader`/`NotesEditor` must convert WITH the
pages (replace the `queryKey` prop + internal invalidation with an `onChanged?: () => void`
callback wired to the page's reactive refresh, and flip their own `useMutation` →
`useServerMutation`), which touches all 9 consumers at once. Treat "detail pages + the two shared
write-components" as ONE reactive-tail unit. `client`/`location` detail (keys not in the SSE map)
are refreshed ONLY by the child prop today (same-view, no cross-user) so they could in principle go
`useServerQuery` + `onChanged={refetch}` — but only after the shared-component API change, so they
ride along with the same unit. Auth/RBAC/platform datums (organization / custom-roles / members / sso-* / profile /
notifications-prefs / admin) stay Prisma forever — most become `useServerQuery` but check the
same-view read+write `refetch` relationship first. SSE / `use-realtime.ts` teardown stays
BLOCKED until RQ is FULLY gone.

**Done session 2026-06-10l (★ REACTIVE-TAIL BLOCKER CLEARED ★ — shared write-components
decoupled; 1 commit pushed; 135 → 131 files import RQ; 4 files newly fully RQ-free).** The
first reactive-tail unit. `MediaUploader` (`src/components/media/media-uploader.tsx`) and
`NotesEditor` (`src/components/ui/notes-editor.tsx`) — the two shared write-components that took a
`queryKey: unknown[]` prop and called `queryClient.invalidateQueries(queryKey)` internally — now
take an **`onChanged?: () => void`** callback instead, with their internal `useMutation` flipped to
`useServerMutation`. Both components are fully RQ-free; the refresh channel is caller-provided. This
is the coupling the 2026-06-10k entry flagged as the blocker for converting any detail page, and it
landed **entirely data-identical** (no composite Convex hook needed yet — the callback can wire to
either the existing RQ invalidation OR a reactive refetch). All 7 consumers rewired in the same
(forced-atomic) commit:
- **model / asset / kit / project** detail pages keep their RQ reader (asset/kit/project are in the
  SSE `getInvalidationKeys` map; `model` is not but the page is a big cross-domain composite left for
  later) and pass `onChanged={() => queryClient.invalidateQueries({ queryKey: [...same key...] })}` —
  byte-for-byte the invalidation the component used to run internally.
- **clients/[id] + locations/[id]** — the KEY WIN. Both are non-SSE same-view single-reader islands
  (one `useQuery` detail reader + one archive/delete `useMutation`, NO `queryClient`, and no external
  reader/invalidator of `["client"|"location", orgId, id]` anywhere). Reader → `useServerQuery`,
  mutation → `useServerMutation`, `onChanged={refetch}`. Both pages now FULLY RQ-free. Data-identical:
  under RQ these keys were only ever invalidated by the media/notes child (same-user, same-view), so
  mount + `refetch()` is the same refresh.
- **sub-hire-order-dialog** — the old `queryKey={["sub-hire", subHire.id]}` was a **latent no-op**:
  the real reader key is the 3-element `["sub-hire", orgId, subHireId]`, so the 2-element prefix never
  matched (RQ invalidation is prefix-match from element 0). The functional refresh was the explicit
  `invalidate()` calls in `onUploadComplete`/`onRemove`. Wired `onChanged={invalidate}` and dropped the
  now-redundant manual calls.

**Why this was safe to do first / data-identical.** The SSE map (`use-realtime.ts`
`getInvalidationKeys`) contains ONLY `project`/`asset`/`kit` (+ `warehouse-project`, `projects`,
`dashboard`, `crew-members`, …) — NOT `model`, `bulk-asset`, `client`, `location`, or `sub-hire`. So
the only genuinely cross-user-live detail keys among the 7 consumers are asset/kit/project, and those
keep their RQ reader untouched (onChanged just reproduces the old invalidation). The non-SSE pages lose
nothing by moving to `useServerQuery`+refetch. Verified: tsc clean, **2228 tests** (unchanged — the
changes are client hook swaps + JSX prop rewires, no test touched the components), 0 new lint
(normalized base-vs-HEAD compare vs 248943a9 — only line-number shifts in sub-hire-order-dialog from
the two deleted `invalidate()` lines, same file/rule), build exit 0, **codex review clean** (no dropped
refresh, no onChanged/invalidation ordering mismatch). No JWKS round-trip (no new Convex table/fn — the
new logic is the two client hooks, already keystoned + unit-tested).

**NEXT reactive-tail units (unchanged from 2026-06-10k, now UNBLOCKED for the detail pages):** the
SSE-live detail pages (model/asset/kit/project) need hand-written **reactive Convex composite `useQuery`
hooks** to drop their RQ reader (they compose cross-domain media + projects + sub-graphs; `useAsset`/
`useKit`/`useModel` exist but return only the table doc) — flip `onChanged` from invalidate → the hook's
reactive refresh (often a no-op since Convex pushes) at that point. Also: `stocktake*` + `crew-availability`
(live scanner / scheduling workflows), `notifications` (60s poll → needs a real reactive Convex
notifications hook; **verify the `notification` table is dual-written first — it is NOT today** (only
`notificationDismissals` is in the Convex schema), so notifications stays Prisma+RQ until that table is
dual-written), and the hard project/warehouse/dashboard composites. Auth/RBAC/platform datums stay
Prisma. SSE/`use-realtime.ts` teardown stays BLOCKED until RQ is FULLY gone.

**Done session 2026-06-10m (NON-SSE detail-page sweep + same-view island batch + crew detail; 6 commits
pushed; 131 → 120 files import RQ; 11 files newly fully RQ-free).** Same data-identical move as the
clients/locations detail pages from 2026-06-10l, applied to the next two NON-SSE detail composites
(both keys absent from the `use-realtime.ts` `getInvalidationKeys` SSE map → no cross-user liveness):
- **`model` datum** (`assets/models/[id]/page.tsx` + `[id]/edit/page.tsx` + the
  `model-accessories-manager.tsx` child). Reader → `useServerQuery`; archive / archive-bulk /
  delete-bulk / force-return → `useServerMutation`; the in-page `["model", orgId, id]` invalidations
  became `refetch()`. The two `MediaUploader` `onChanged` callbacks and the accessories-manager
  (whose hardcoded `invalidateQueries(["model"])` became an `onChanged?: () => void` prop) wire to
  the page's `refetch`. **`models/[id]/page.tsx` KEEPS `useQueryClient`** ONLY to invalidate the
  cross-domain `["assets"]` / `["bulk-assets"]` keys, which are **still read by React Query in
  `test-and-tag/new/page.tsx`** (the deferred 4-way-join page) — per the per-datum rule, you don't
  drop another datum's invalidation while it has RQ readers. The edit page + accessories-manager are
  fully RQ-free.
- **`maintenance` datum** (`maintenance/page.tsx` list + `[id]/page.tsx` + `[id]/edit/page.tsx`).
  All three readers → `useServerQuery`. The list is a **same-view read+write island** (its delete
  invalidated `["maintenance"]` = its own reader key → now `refetch()`). Detail/edit deletes navigate
  to the list (its `useServerQuery` reader remounts fresh) so the cross-route invalidation drops. All
  three fully RQ-free. NOTE: the SSE key is `["maintenance-records"]` (a DISTINCT element-0, read by
  nothing today), so `["maintenance"]` was never SSE-live — no liveness lost.

**Why data-identical (same proof as 2026-06-10l).** `refetchOnWindowFocus:false` globally +
`staleTime:0` default ⇒ a cross-route reader remounts and refetches regardless of invalidation; a
non-SSE key has no cross-user push. The only same-view writers were converted to `refetch()`. Verified:
tsc clean, **2228 tests** (unchanged — client-hook swaps), lint clean on the 6 changed files, build
exit 0, **codex review: No findings** (checked for dropped invalidations a still-mounted reader depends
on, missed readers of `["model"]`/`["maintenance"]`, and the accessories-manager `onChanged` wiring). No
JWKS round-trip (no new Convex table/fn — the reads wrap existing server actions via `useServerQuery`).

**Same session — same-view island batch (8 more files, 3rd commit).** After the easy no-liveness
*read* tail was exhausted (10i–10k), these are the remaining single-reader read+**write** islands: a key
read in exactly one file and invalidated only by that file's own writers. Converted reader→`useServerQuery`,
writers→`useServerMutation`, the self-invalidation→`refetch()`. Fully RQ-free: `report-schedule-card`,
`test-and-tag/page` (dropped a `staleTime`), `settings/displays`, `settings/woocommerce`, `reports/page`.
KEEP `useQueryClient` ONLY for a cross-domain key still read by RQ elsewhere (per-datum rule):
`workshop`→`["maintenance-records"]` (SSE-mapped), `test-and-tag/[id]`→`["test-tag-assets"]` (registry),
`damage`→`["project-operational-costs"]` (project costs panel). Classification was driven by a per-key
`invalidate_sites`/`reader_files` count: a key with `reader_files=1` is a same-view island; **EXCLUDED**
the shared multi-reader keys `organization` (8 readers incl. always-mounted layout branding/favicon →
genuinely reactive), `custom-roles` (6 readers, RBAC), `service-templates` (one reader is the SSE project
panel) — those need real reactive hooks, not `useServerQuery`. Verified: tsc clean, 2228 tests, 0 new lint
(normalized base-vs-HEAD), build exit 0, **codex review: No findings** (verified the 3 cross-domain keeps,
the `refetchIntegration` vs `refetchLogs` wiring, and no missed same-view reader).

**Same session — crew detail+edit (the last big non-SSE island, 5th commit).** `crew/[id]/page.tsx`
(2117 lines) composes FOUR per-id datums (`crew-member`/`crew-availability`/`crew-ical`/
`crew-time-entries`), none in the SSE map (the SSE key is the plural `["crew-members"]` list). Converted
all 4 readers → `useServerQuery` with named refetches, 13 main-component mutations → `useServerMutation`
(each `["crew-<x>", orgId, id]` invalidation → the matching `refetch()`), and the 3 nested child dialogs
(AddCertification/AddAvailability/AddTimeEntry — which invalidated the PARENT's reader keys internally) →
an `onSaved` callback wired to the parent's refetch (the MediaUploader decoupling pattern), their own
`useQueryClient`/`orgId` removed. `deleteMutation` KEEPS `queryClient.invalidateQueries(["crew-members"])`
(cross-domain, SSE-mapped; the roster itself is already Convex-backed so it's a harmless conservative
keep). `crew/[id]/edit` reader → `useServerQuery` (fully RQ-free). Verified: tsc clean, 2228 tests, 0 new
lint (normalized), build exit 0, **codex review: No findings** (checked all 13 mutation→refetch mappings,
the 3 child `onSaved` wirings, no dropped refresh, no orphaned `orgId`). The HAZARD that made this
codex-worthy: a child dialog or main mutation wired to the WRONG refetch = silent staleness (write
succeeds, the affected list doesn't refresh) — none found.

**NEXT reactive-tail (the genuinely hard remainder).** The remaining `useQuery` readers are mostly the
SSE-live composites that need real reactive Convex hooks (NOT `useServerQuery`, which would drop
cross-user liveness): **asset/kit/project detail pages** (in the SSE map; compose cross-domain
media+projects+sub-graphs → need hand-written reactive Convex composite `useQuery` hooks, then flip
`onChanged` invalidate → reactive refresh), **warehouse-project / warehouse-projects** (SSE-live),
**stocktake\*** + **crew-availability** (live scanner/scheduling — invalidated per-scan), and the
project/dashboard composites. `crew/[id]/page.tsx` is convertible as a non-SSE unit like model/
maintenance (`crew-member`/`crew-ical`/`crew-time-entries` keys are same-view; `crew-availability` is
invalidated only by same-view writers) but it is ~2000 lines with many writers — its own session.
Notifications needs the `notification` table dual-written first. SSE/`use-realtime.ts` teardown stays
BLOCKED until RQ is FULLY gone.

**Done session 2026-06-10n (★ THE BUCKET-B KEYSTONE — first SSE-live reactive composite; 120 → 119
files import RQ; kit detail fully RQ-free).** This is the reusable pattern for every remaining
SSE-live detail composite (asset/project/warehouse). The shape decision (codex-consulted up front
because it governs ~5 more sessions): **version-vector trigger, NOT a full reactive Convex composite.**

- **Why not a full Convex composite (the rejected Option A).** The kit detail page is served by the
  `getKit` server action, which composes data Convex CANNOT hold — `scanLogs.scannedBy` is a Better
  Auth **USER** (stays in Prisma forever), plus maintenanceRecords/category/location. Replicating that
  shape in a Convex query would be infeasible AND the exact data-shape-drift footgun CLAUDE.md warns
  about. So the server action stays **byte-identical** (zero drift) and we add only a cheap reactive
  *trigger*.
- **The pattern (Option B).** A hand-written Convex query `convex/kitDetail.ts` `version({id})` returns
  a "version vector": the kit doc `updatedAt` + a deterministic **content signature** over each
  member/media sub-table (`kitSerializedItems`/`kitBulkItems`/`kitMedia` by `kitId`). The browser
  subscribes via `useKitDetailVersion(id)` (`src/hooks/use-kits.ts`), and a NEW keystone hook
  **`useReactiveServerQuery({ watch, queryKey, queryFn })`** (`src/hooks/use-reactive-server-query.ts`)
  re-runs `getKit` whenever the serialized `watch` changes. Convex pushes the vector to every
  subscriber over the WebSocket → cross-user reactivity, replacing the SSE `kit:updated` invalidation.
  Convention established: hand-written reactive composite queries live in `convex/<table>Detail.ts`
  (NOT `convex/<table>.ts`, which `scripts/generate-convex-crud.cjs` owns and would clobber).
- **★ The silent-staleness contract (the whole safety property).** The vector MUST be a SUPERSET of
  what the old SSE `kit:updated` event covered (kit + its direct contents), or a cross-user refresh is
  silently dropped. Two subtleties:
  - **Content signature, not count+max-timestamp** (codex caught this). `setKitPrimaryPhoto` flips
    `kitMedia.isPrimary` only — same row count, same `createdAt` — so a count+ts vector would MISS it
    and the header photo would go stale. The signature folds in every mutable, page-visible field
    (`isPrimary`/`sortOrder`/`position`/`quantity`/…), so add/remove AND in-place edits both move it.
  - **Match the OLD refresh scope, don't over-reach.** `kit:updated` fires only from `logActivity` for
    `entityType:"Kit"`. Cross-domain history the kit page did NOT live-refresh on under the old model —
    project line items (`line-item:changed`), scan logs, maintenance (`maintenance:changed`), the member
    assets' own condition (`asset:updated`) — is intentionally OUT of the vector. Data-identical, not
    over-eager.
- **`useReactiveServerQuery` semantics** (codex-reviewed twice): fetches on first-defined `watch` (not
  on mount — avoids a double-fetch racing the WS connect); a `watch` change at the same `queryKey` is a
  background refresh (data stays visible, no skeleton flash); **`queryKey` is the identity** so a same-id
  `[id]`-route navigation (App Router re-renders in place, no remount) never briefly shows the WRONG
  entity (results are identity-tagged at fetch-start, surfaced only if `result.identity===identityKey`);
  request-sequenced latest-wins. Same-view writes flow through the vector automatically, but each
  mutation's `onSuccess` still calls `refetch()` — an immediate source-of-truth re-read that doesn't
  depend on the Convex mirror write landing first (the redundant watch-driven fetch is harmless).
- **Page rewire** (`kits/[id]/page.tsx`, fully RQ-free): kit reader → `useReactiveServerQuery`; all 6
  mutations (status/force-return/add-item/remove-item/add-bulk/remove-bulk) → `useServerMutation` with
  `invalidate(["kit",…])` → `refetchKit()`; the 2 dialog-gated cross-domain reads
  (`getAvailableAssetsForKit`/`…Bulk…`, NOT in the SSE map) → `useServerQuery` + `refetch()` after add;
  MediaUploader/NotesEditor `onChanged` → `refetchKit`.
- **Verified:** tsc clean, **2228 tests**, 0 new lint (changed files clean + normalized base-vs-HEAD),
  `pnpm build` exit 0, **codex review** (one Medium — the identity-staleness gap above — fixed, then
  "Fixed, no new issues"), and a **live JWKS-sidecar round-trip** (`scripts/convex-roundtrip-kit-detail.ts`,
  5/5): `version()` callable with a user token + org-scoped (different-org token rejected), and the
  vector changes on member-add, media-add, AND the `isPrimary`-only flip (the silent-staleness proof).

**NEXT reactive-tail (now UNBLOCKED — the keystone exists).** Reuse `useReactiveServerQuery` +
`convex/<table>Detail.ts version()` for the rest of bucket B, one composite per session: **asset detail**
(`assets/registry/[id]` — `["asset",orgId,id]` SSE + child asset-checks/accessories; bulk-asset variant),
**warehouse** (`warehouse/page` + `[projectId]` + reorder/bulk-checkin/close-out), the **project cluster**
(biggest — the equipment editor is one delicate read composition; migrate as a set), **stocktake**
(replace the 3-5s scanner poll with Convex reactivity). Each version vector must capture exactly what its
SSE event covered (write the content signature over the mutable, page-visible sub-table fields). Then
**notifications** (dual-write the `notification` table first), the auth/RBAC tail (`useServerQuery`), and
finally SSE/`use-realtime.ts` teardown (only at RQ == 0).

**Done session 2026-06-11 (★ ASSET DETAIL — 2nd bucket-B reactive composite; 119 → 118 files import RQ;
`assets/registry/[id]` fully RQ-free).** Reused the kit keystone verbatim: `convex/assetDetail.ts`
`version({id})` (asset doc `updatedAt` + content signatures over `assetMedia` by_assetId and `childAssets`
= assets by_parentAssetId), `useAssetDetailVersion(id)` in `src/hooks/use-assets.ts`, and
`useReactiveServerQuery({ watch, queryKey:["asset",orgId,id], queryFn:()=>getAsset(id) })` on the page.
`getAsset` stays byte-identical. Page rewire: serialized reader → `useReactiveServerQuery`; the bulk
variant (which just redirects to the model page and is NOT in the SSE map) → plain `useServerQuery`; the 3
mutations (archive/delete/force-return) → `useServerMutation` (force-return → `refetchAsset()`;
archive/delete just `router.push`, dropping their old `invalidateQueries(["assets"]/["bulk-assets"])`
which were already no-ops since the registry table is Convex-reactive); MediaUploader/NotesEditor
`onChanged` → `refetchAsset`. **`AssetAccessoriesManager`** converted off RQ: `useMutation`→
`useServerMutation`, dropped `useQueryClient`, and its `invalidateQueries(["asset"])` → a new `onChanged`
prop wired to `refetchAsset` (the MediaUploader decoupling pattern). `asset-checks-tab.tsx` already used
`useServerQuery` (read-only) — no change.

- **★ KEY FINDING — the SSE realtime system currently emits NOTHING.** Every `logActivity` call passes a
  lowercase/camelCase `entityType` (`"asset"`, `"maintenance"`, `"kit"`, `"project"`, …) but
  `mapEntityTypeToEvent` (`src/lib/activity-log.ts`) switches on PascalCase (`"Asset"`,
  `"MaintenanceRecord"`, …). ZERO PascalCase entityType literals exist in `src/` → no case ever matches →
  `events.emit` is never reached. So `use-realtime.ts` invalidation has been dead, and **cross-user
  reactivity did not exist** for any of these pages. Consequence for bucket B: every version vector is a
  pure, SAFE ADDITION (a superset that ADDS liveness), not something that can regress a data-identical
  contract. The only thing that must be preserved is SAME-VIEW reactivity, which the explicit `refetch()`
  in each mutation `onSuccess` handles independent of the vector. (This casing bug is pre-existing and
  out of scope here; worth a fix or a deliberate decision before SSE teardown — but teardown removes the
  whole path anyway. Flagged in the handoff/memory.)
- **Scope of the asset vector** (given the above, a superset of the page-visible mutable sub-tables that
  are mirrored to Convex): asset row (`updatedAt`), `assetMedia` (Photos tab, dual-written — folds in
  `isPrimary`/`sortOrder`/`type`/`fileId`/`displayName` so a `setAssetPrimaryPhoto` in-place flip moves
  it), and `childAssets` (serialized accessories via `by_parentAssetId`). KNOWN GAPS, all acceptable
  because same-view refetch covers them and cross-user liveness here is new: accessory DETACH clears
  `parentAssetId` to null = a Convex no-op (the documented clear-to-null caveat in `asset-mirror.ts`), so
  a cross-user detach doesn't move the vector; `assetBulkChildren` (bulk accessories) is in the schema but
  NOT yet dual-written, so it is left out of the vector; maintenance/line-item/history tabs are out
  (Prisma-only and never fired an SSE event that hit this page's key).
- **Verified:** tsc clean, **2228 tests**, 0 new lint (changed files: 0 errors, 3 pre-existing warnings
  carried verbatim), `pnpm build` exit 0, and a **live JWKS-sidecar round-trip**
  (`scripts/convex-roundtrip-asset-detail.ts`, 5/5): `version()` callable with a user token + org-scoped
  (different-org token rejected), and the vector moves on media-add, the `isPrimary`-only flip (the
  silent-staleness proof), AND a child-asset attach.

**Done same session — WAREHOUSE LIST + REORDER (the standalone warehouse pages; the `[projectId]` detail
composite is HANDED OFF, see below).** `projects` + `projectLineItems` are both dual-written, so warehouse
is feasible. Split warehouse into standalone pages (done now) vs the heavy multi-tab detail (next session).
- **`warehouse/page.tsx` (the landing list, `["warehouse-projects",orgId,{search}]`)** → version vector.
  New `convex/warehouseDetail.ts` `listVersion({orgId})` = a content signature over the org's
  warehouse-pipeline (CONFIRMED/PREPPING/CHECKED_OUT/ON_SITE/RETURNED), non-template projects, folding in
  `status`/`rentalStartDate`/`rentalEndDate`/`clientId`/`updatedAt`. Membership transitions move it for
  free (QUOTE→CONFIRMED appears, RETURNED→COMPLETED disappears); two off-pipeline statuses don't move it
  (the tight-scope proof, asserted in the round-trip). New `useWarehouseListVersion(orgId)` in
  `src/hooks/use-warehouse.ts`; page reader → `useReactiveServerQuery` (queryFn stays `getProjects`,
  byte-identical), 2 mutations (status/batch-close) → `useServerMutation` (invalidate → `refetch()`).
  **SCOPE NOTE:** line-item changes that DON'T change `project.status` are intentionally OUT of the list
  vector — the cards render no line-item progress; the only line-item read is the deploy/return dialog's
  warning count (point-in-time, low stakes). Line-item reactivity belongs to the `[projectId]` detail.
  **getProjects has TWO cross-domain joins that don't touch the project row when they change: the
  displayed `client.name`, and `location.name` which getProjects' SEARCH filters on
  (`OR:[{name},{projectNumber},{location:{name}}]`; project name/number ARE on the row → covered by
  updatedAt). Both clients and locations are dual-written, so the vector folds BOTH referenced names into
  each row's signature (resolved by clientId/locationId) — else a cross-user client/location rename leaves
  the (possibly search-filtered) list stale until a separate project change. This CLOSES the getProjects
  dependency set (codex flagged both as P2; both fixed).**
- **`warehouse/reorder/page.tsx` (`["reorder-candidates",orgId]`, NOT in the SSE map)** → plain
  `useServerQuery` (data-identical, no liveness existed), mutation → `useServerMutation` + `refetch()`.
- **Verified:** tsc clean, 2228 tests, 0 new lint, build exit 0, **codex review (2 P2s — missing
  client/location names in the vector — both fixed, re-reviewed)**, live round-trip
  `scripts/convex-roundtrip-warehouse-list.ts` **8/8** (callable + org-scoped + moves on create / in-place
  pipeline flip / **client rename** / **location rename** / pipeline-exit, and does NOT move on an off-list
  status change). 117 → 115 files import RQ.

**Done (session 2026-06-11b) — `warehouse/[projectId]/page.tsx` DETAIL composite + `close-out-tab` +
`bulk-checkin-tab` off React Query** (the handoff above, completed; 3 files newly fully RQ-free).
- New `convex/warehouseDetail.ts` `version({projectId})` = project doc `updatedAt` + `status` + the resolved
  **client name** (header renders `project.client.name`, a cross-domain join) + a content signature over the
  project's `projectLineItems` (by `projectId`) rollups: `status`/`prepStatus`/`prepContainer`/`quantity`/
  `checkedOutQuantity`/`returnedQuantity`/`assigned`/`packed`/`damaged`/`lost`/`assetId`/`bulkAssetId`/
  `kitId`/`returnCondition`/`returnStatus`/`checkedOutAt`/`returnedAt`/`updatedAt`. `useWarehouseProjectVersion`
  in `use-warehouse.ts`; page reader → `useReactiveServerQuery`.
- **★ Per-unit `project_line_item_unit` is in the Convex schema + has generated CRUD but is NEVER
  dual-written** (`line-item-mirror.ts` STRIPS `units`; zero `api.projectLineItemUnits` write sites). So the
  vector watches the line-item **rollups** instead — which ARE mirrored: every warehouse/check/fulfillment/
  bulk-checkin `$transaction` calls `upsertProjectLineItemsToConvex(projectId)` post-commit (re-reads ALL
  line items → captures status flips AND scan-time row expansions), and the fulfillment logic updates those
  rollups in the same tx as the unit rows. A rollup signature therefore tracks the unit flips it summarises;
  the round-trip proves an in-place check-out (status + `checkedOutQuantity` flip, same row count) moves it.
- Page: 10 `useMutation` → `useServerMutation`; **9** `.mutate(vars,{onSuccess})` per-call-option sites →
  `mutateAsync(vars).then(body).catch(()=>{})` (one was easy to miss in `handleReturnSelected` — tsc caught
  it). `invalidate()` → `refetchProject()` + the selection clears, and **dropped the dead
  `["project-prep-kits"]` invalidation** (grep-confirmed ZERO readers anywhere — data-identical). The
  `containerAssets`/`OnlinePickList`/`ItemCheckForm` reads were ALREADY `useServerQuery` (the handoff's
  `project-prep-kits` `useServerQuery` does not exist — it was only ever an invalidate target).
- `close-out-tab` + `bulk-checkin-tab`: each a same-view island that ALSO cross-invalidated the parent
  `["warehouse-project"]` key → added an `onChanged?:()=>void` prop (page wires `onChanged={refetchProject}`),
  reader → `useServerQuery`, mutation → `useServerMutation`, own-key invalidate → `refetch()`, cross-key
  invalidate → `onChanged?.()`. No tests touch them.
- Same-view safety preserved by the explicit per-mutation refetch (SSE map emits nothing — the vector is a
  pure additive cross-user improvement).
- **Verified:** tsc clean, **2228 tests**, 0 new lint (normalized base-vs-HEAD — both 8 warnings/0 errors;
  the only diff is the pre-existing `lineItems` exhaustive-deps warning's *embedded* line number shifting),
  build exit 0, **codex review clean** ("no discrete regressions in the modified reactive query, mutation
  conversion, or warehouse tab refresh paths"), live JWKS round-trip
  `scripts/convex-roundtrip-warehouse-detail.ts` **7/7** (user-token callable + org-scoped + vector moves on
  line-item add, **in-place check-out AND in-place return at same row count** [silent-staleness proofs],
  client rename, project status flip). 115 → 112 files import RQ.
- **JWKS round-trip is simpler than the sidecar dance**: the steady-state
  `CONVEX_AUTH_JWKS_URL=http://host.docker.internal:3000/api/auth/jwks` is already set, so just run the prod
  build on host :3000 (`corepack pnpm start`), the docker backend reaches it via `host.docker.internal`, run
  the script, kill the server. No `convex env set`, no sidecar, no restore. (`corepack pnpm` because pnpm
  isn't on PATH in this worktree; node via mise.)

**Done same session (2026-06-11b) — STOCKTAKE detail datum off RQ (the polling scanner DEFERRED).** The
`["stocktake",orgId,id]` detail datum has NO liveness — not in the SSE `getInvalidationKeys` map, never
polled — so it's a plain non-reactive read (NOT a version vector; stocktake tables aren't dual-written
anyway). Both readers (`stocktake/[id]` + `[id]/edit` pages) → `useServerQuery`; `stocktake-draft` (2
mutations) + `stocktake-review` (4 mutations) → `useServerMutation`. Review's
`queryClient.invalidateQueries(["stocktake",…])` is dropped — a no-op once both readers are off RQ, and
`onUpdate()` (the page's refetch) already provides the post-write refresh (data-identical). 4 files newly
fully RQ-free. **DEFERRED to a dual-write-first session: `stocktake-scanner` polls (`refetchInterval` 3s/5s)
for live progress/recent-scans = genuine cross-user liveness, and `stocktakes`/`stocktakeItems` are NOT
dual-written; the separate `["stocktakes"]` list datum (`stocktake-table`/`stocktake-form`) rides with it.
The split is clean: the scanner only ever invalidates its OWN progress/recent/search keys (never the detail
key) and calls `onUpdate` on complete.** Verified: tsc clean, **2228 tests**, 0 new lint (normalized
base-vs-HEAD), build exit 0, **codex review clean**; no JWKS round-trip (no new Convex table/fn — both hooks
wrap existing server actions).

**Done same session (2026-06-11b) — STOCKTAKE DUAL-WRITE (infra; unblocks the reactive scanner).**
`stocktake` + `stocktake_item` are now dual-written so the warehouse scanner can later drop its 3–5s polling
for a Convex subscription. All writes live in ONE file (`src/server/stocktake.ts`), but span
createMany/updateMany/deleteMany + single-row scan writes, so rather than mirror each site the design uses a
single workhorse `syncStocktakeToConvex(id)` (`src/lib/stocktake-mirror.ts`) called after every commit (18
sites): it re-reads the parent + ALL items from Prisma (authoritative) and pushes them to a custom
service-only Convex mutation `api.stocktakeMirror.sync({stocktake, items})` in **ONE round-trip**, which
reconciles in a single tx. **★ Two correctness keys:** (1) the sync uses **`ctx.db.replace` not `patch`** so
a field reset to null on the Prisma side (`scannedAt`/`scannedById` on unmark-found) actually CLEARS in
Convex — a patch would leave it stale (the silent-staleness guard the reactive scanner will depend on); items
absent from the incoming set are deleted (authoritative). (2) **concurrency** (codex P2): two users scanning
the same stocktake each send a full-snapshot reconcile, so an older snapshot landing after a newer one would
revert Convex to stale state. The app is a single pm2 process, so `syncStocktakeToConvex` **serializes per
`stocktakeId` via a promise chain** — each sync reads its snapshot only after the prior send completes, so the
last write always applies last (horizontal scaling would instead need a server-stamped monotonic guard in the
mutation). Arg validators reuse the schema enum validators (`enums.Stocktake*`) so the payload type-checks
against `db.insert/replace` (a loose `v.string()` fails the typed insert). Backfill
`scripts/convex-backfill-stocktake.ts` (`pnpm convex:backfill:stocktake`) reuses the same sync path so it
can't diverge. **INFRA-ONLY for now** — no reactive consumer yet; the scanner conversion (replace the poll +
`stocktake-progress`/`-recent` RQ keys with a Convex `useQuery` over the mirrored `stocktakeItems`, plus the
`["stocktakes"]` list datum) is the follow-on. Verified: tsc clean, **2228 tests**, 0 new lint (normalized +
new files 0 problems), build exit 0, **codex review clean after the P2 fix**, backfill 1/1, live round-trip
`scripts/convex-roundtrip-stocktake.ts` **6/6** (parent+item mirror, in-place update, ★ reset-to-null CLEAR,
reconcile-delete, service-only rejection).

**Done same session (2026-06-11b) — REACTIVE STOCKTAKE SCANNER (the payoff: polling → Convex push).** With
the dual-write in place, `stocktake-scanner.tsx` drops its `refetchInterval` polling (progress 5s, recent 3s)
for the keystone version-vector pattern: new `convex/stocktakeDetail.ts` `version({stocktakeId})` (content
signature over the stocktake's items + parent counts) drives re-runs of the three UNCHANGED server actions
(`getStocktakeProgress` / `getRecentScans` / `searchStocktakeAssets`) via `useReactiveServerQuery`. The server
actions stay byte-identical — they join asset/bulkAsset → model for display, which would be a data-shape-drift
risk to rebuild in Convex. New `useStocktakeVersion` hook in `src/hooks/use-stocktake.ts`. The scanner is now
fully RQ-free: 5 mutations → `useServerMutation`, the three readers → `useReactiveServerQuery` watching the
version, the per-write `invalidate()` → an explicit `refreshLive()` (same-view immediacy; the version push
that follows is a harmless no-op). Now cross-user live (two pickers see each other's scans). **★ CODEX P2
(same cross-domain-join-freshness class as the warehouse-list vector): `getRecentScans` /
`searchStocktakeAssets` display + search on the JOINED `assetTag` / `customName` / `serialNumber` /
`model.name`, which the item row's `assetId`/`bulkAssetId` don't cover — with the poll gone, a rename
elsewhere would stay stale. FIXED: the version folds the joined fields too (assets/bulkAssets/models are
dual-written), resolved deduped-by-id to bound the reads.** Verified: tsc clean, **2228 tests**, 0 new lint
(normalized scanner + new files clean), build exit 0, **codex review clean after the join-fold fix**, live
round-trip extended to **9/9** (adds: version user-callable + org-scoped, vector moves on an in-place scan,
and ★ a joined asset rename moves the vector with NO stocktake row changed).

**Done same session (2026-06-11b) — STOCKTAKE LIST + FORM off RQ → the ENTIRE stocktake feature is RQ-free.**
The `["stocktakes"]` list datum turned out to need NO version vector: it's not in the SSE map, never polled,
and never invalidated (the form navigates to the detail page after create, so there was no same-view list
refresh to preserve). So `stocktake-table`'s reader → `useServerQuery` and `stocktake-form`'s create/update
mutation → `useServerMutation`, both data-identical (plain mechanical swaps, zero invalidation drops → no
codex/round-trip). With this, every stocktake file (the `[id]`/`[id]/edit` pages + draft/review/scanner/table/
form) is off React Query. Verified: tsc clean, **2228 tests**, 0 new lint (normalized), build exit 0.

**Done same session (2026-06-11b) — NOTIFICATION feature off RQ (poll preserved, NOT a reactive trigger).**
★ The memory premise ("dual-write the `notification` table first") was WRONG: there is NO `notification`
Prisma model — notifications are COMPUTED on the fly by `getNotifications`, which scans **9 domains**
(maintenance / projects×2 / bulk stock / invitations / crew certs+assignments+timesheets / line items). A
precise Convex trigger would be a fragile 9-table version vector, so a periodic 60s poll is the right design;
the honest conversion keeps the poll while dropping React Query. `useServerQuery` gained an optional
`refetchInterval` (a setInterval bumping its reload nonce). New `src/hooks/use-notifications-feed.ts` — a
shared, deduped, visibility-aware poll for the `getNotifications` aggregate: the always-mounted bell + the
`/notifications` page subscribe to ONE module-level poller per orgId. **★ THREE codex P2s, all fixed: (1)**
the raw poll kept hitting the server in idle background tabs → skip ticks while `document.hidden` (RQ's
`refetchIntervalInBackground:false` default); **(2)** per-call `useServerQuery` lost RQ's request-sharing
across observers, so the bell + page each ran the 9-domain scan → the shared feed dedups to one scan per
interval (+ a single in-flight promise); **(3)** a tab hidden longer than the interval stayed stale on return
→ a `visibilitychange` listener refetches when the tab becomes visible (added to BOTH the feed and the
useServerQuery poll). Consumers: bell (notifications→useNotificationsFeed, dismissals→useServerQuery+poll,
dismissMutation→useServerMutation, invalidate→refetchDismissed — sole reader/writer of that key);
notifications/page (→useNotificationsFeed); account/notifications (preferences read+write island →
useServerQuery+useServerMutation). Whole feature off RQ; no Convex change, no dual-write, no version vector.
Verified: tsc clean, **2228 tests**, 0 new lint (normalized + new hook clean), build exit 0, **codex review
clean after the 3 P2 fixes** (no round-trip — no Convex change).

**Done session 2026-06-11c (★ AUTH/RBAC TAIL COMPLETE — 6 commits pushed; 102 → 83 files import RQ; 12
auth/platform datums off RQ).** The auth/RBAC/platform datums all stay in **Prisma forever** (Convex is
never the authZ source), so NONE became a Convex table — every conversion wraps an existing server action.
Two conversion shapes were used, and telling them apart was the whole job (classify each datum first:
SSE-map? polled? multi-reader? same-view island?):

1. **★ The `createSharedResource` keystone** ([`src/hooks/use-shared-resource.ts`](../src/hooks/use-shared-resource.ts),
   7 unit tests → **2235 tests**) — a module-level, deduped, per-key store modelled on
   `use-notifications-feed` (same subscribe/dedup shape) but with NO polling. This is the read analogue for
   **genuinely multi-reader/multi-writer** datums where `useServerQuery` is WRONG: `useServerQuery` is
   per-component, so one component's `refetch()` never updates another's copy — but a datum read by the
   always-mounted layout AND written elsewhere needs the cross-component refresh React Query's shared
   `["key"]` cache gave. Writers call a module-level `refresh*(orgId)` (their old
   `invalidateQueries(["key"])`). **Each shared datum MUST convert ALL its readers + writers atomically** —
   a split RQ/store drops the shared refresh. Built on it:
   - **organization** (`use-organization.ts`) — 8 readers incl. the ALWAYS-MOUNTED `BrandingProvider` +
     `DynamicFavicon` (a settings/branding edit live-updates the layout) + 5 settings pages; 5 writers.
   - **custom-roles** (`use-custom-roles.ts`, RBAC) — 6 readers (role manager + invite + member-list + 3
     SSO surfaces); writers = role manager + role editor. SSO readers gained `useActiveOrganization().id`
     (they used the bare `["custom-roles"]` key); all readers/writers standardised on it as the store key.
   - **profile** (`use-profile.ts`, keyed per-USER) — always-mounted `UserNav` avatar + the account page;
     account writes → live nav update. Account page fully RQ-free (its `active-sessions` + `passkeys` are
     same-view islands → `useServerQuery` + refetch; 12 mutations → `useServerMutation`).
   - **org-members** (`use-org-members.ts`, getMembers shape) + **pending-invitations**
     (`use-pending-invitations.ts`) — the invite form + roster co-mount on the members settings page, so an
     invite/role-change/remove must live-update the list. invite-member fully RQ-free. ★ The project form
     also read `["org-members"]` but via a DIFFERENT server action (`getOrgMembers`, paginated) — an
     **incidental RQ key collision** (different shape, never co-mounts); that no-liveness dropdown reader →
     plain `useServerQuery`, decoupling the collision.
   - **sso-settings** + **sso-providers** (`use-sso-settings.ts` / `use-sso-providers.ts`) — the SSO page
     reads them but the writes live in NESTED child editors (`SSOProviderSection → ProviderRow /
     EditProviderForm / AddProviderForm`, group-mapping). Threading an `onChanged` callback through that
     nesting would be heavy prop-drilling, so a shared-store `refresh*` (module-level, no drilling) was the
     pragmatic call over the MediaUploader-style callback used elsewhere.

2. **Plain `useServerQuery` (+ `useServerMutation`) for same-view islands** — non-SSE, non-polled, single-
   page read+write. `sso-pending-approvals` (own datum), the whole **account page** islands, and all three
   **admin pages** (`admin/users`, `admin/organizations` list + `[id]` detail). The admin detail's
   cross-route `["admin-the-org"]` invalidation **drops** — the list page remounts + refetches on
   navigation (the data-identical model/maintenance-detail pattern). `members` was already `useServerQuery`
   from 2026-06-10j.

**Intentional KEEP on React Query: `current-role`** (`use-permissions.ts`) — the viewer's effective
permission set, invalidated by role-editor / member-list / admin role changes. It gates the whole UI and is
cross-cutting; left on RQ for a deliberate later decision (those writers keep their `["current-role"]`
invalidation via `useQueryClient`). **No new Convex table/fn → no JWKS round-trip, no Convex deploy** (the
auth datums are Prisma-only). Verified: tsc clean, **2235 tests** (2228 + 7 shared-resource hook tests), 0
new lint (normalized base-vs-HEAD per commit), `pnpm build` exit 0. (Codex review not run this session —
environment lacked the codex CLI; the shared-store keystone is unit-tested and the rest are mechanical
swaps with zero invalidation drops beyond the documented data-identical cross-route ones.)

**Done session 2026-06-11d (★ PROJECT CLUSTER COMPLETE — fully off React Query, reads AND writes; 11
commits pushed; 83 → 58 files import RQ).** The biggest, most-interlocked piece — the equipment editor
composition the docs warned was "2–3 sessions, migrate as a set." Done in one pass via the
`createSharedResource` keystone applied at scale (extended to pass the store key to the fetcher, so
`(projectId) => getProject(projectId)` works; backward-compatible — auth fetchers ignore the key). Each
datum converted atomically across all readers + writers, verified (tsc / 2235 tests / 0 new lint), one
commit each, then a final write-sweep.

**★ The decision that made it tractable: shared stores, NOT version vectors.** SSE is dead (the
lowercase/PascalCase `entityType` bug — confirmed again this session), so cross-user liveness never
existed; a shared store keyed by projectId is therefore **data-identical** to the old behaviour (mount +
same-view refresh), while a per-composite version vector would be an enormous data-shape-drift footgun for
zero parity gain. Version vectors remain a deferred "add real liveness" enhancement, not needed for RQ
removal.

**The datums (one shared store each unless noted), keyed by projectId:**
- **project spine** (`use-project-detail`, `["project",…,id]` = getProject header/status/financials/managers):
  3 page readers, ~10 scattered writers. ★ Half the writers invalidated a 2-element `["project", projectId]`
  key that did NOT prefix-match the 3-element reader (latent no-op) — all wired to `refreshProjectDetail`,
  realising the intended refresh.
- **equipment composition** (`use-project-equipment`): project-categories + uncategorized-items /
  -subhire-groups / -project-groups + project-overbooked + project-sub-hires + the single sub-hire detail.
  equipment-tab's one `invalidate()` chokepoint (passed to child dialogs via `onInvalidate`) now calls the
  `refresh*` set. ★ Caught the variable-key reader trap (`const queryKey = [...]` hides from a literal grep).
- **services** (`use-project-services`: project-services + summary) + **service-templates** /
  **group-templates** (`use-service-templates` / `use-group-templates`, keyed by orgId — settings list+form
  + the panel/tab dropdowns, the same cross-component-same-page shape as the SSO stores).
- **crew** (`use-project-crew`: project-crew + project-labour-cost). ★ call-sheet-dialog read project-crew
  under a 2-element key = a SEPARATE RQ cache from the crew panel's 3-element key; the store unifies them.
- **conflicts** (`use-project-conflicts`; swap-candidates → useServerQuery same-component; tracked the
  swapping id in local state since useServerMutation has no `.variables`).
- **projects list** + **project templates** + **operational-costs**: single-reader / cross-route islands →
  plain `useServerQuery`; the cross-route invalidations drop (the reader remounts + refetches on navigation —
  the model/maintenance-detail data-identical pattern). project-overbooked's broad 1-element page invalidate
  became a no-op once the equipment tab moved to the projectId-keyed store → rewired to
  `refreshProjectOverbooked(id)`.
- **availability / asset-lookup**: parameterized per-(model,dates,project) checks read only in the add /
  edit-line-item dialogs (fetched on open, dialog closes on its own mutation) → `useServerQuery`; the broad
  invalidations drop (no stay-open staleness).
- **Final write-sweep:** all 57 remaining `useMutation` → `useServerMutation` (the cache was already gone, so
  pure async-wrapper swaps; no `.variables` / per-call-option gotchas in the cluster). crew-panel keeps
  `useQueryClient` ONLY for the cross-domain `["crew-member"]` key (a crew datum, read outside the cluster).

**No new Convex table/fn → no JWKS round-trip / Convex deploy** (the project reads stay server actions that
compose Better-Auth users + cross-domain joins; project / project_line_item are already dual-written).
Verified each commit: tsc clean, **2235 tests**, 0 new lint (normalized base-vs-HEAD), `pnpm build` exit 0.
(No codex this session — CLI unavailable in the environment; the keystone is unit-tested and each datum's
reader/writer set was verified complete by exact-key greps, not prefix assumptions.) **NEXT:** assets/bulk
registry tail, crew scheduling, platform-config mechanical tail, then SSE/use-realtime teardown at RQ == 0.

**Done session 2026-06-11e (★ RQ REMOVAL ALL BUT COMPLETE — platform-config tail + assets/kit/crew/test-tag
write paths + the last reader composites; 14 commits pushed; 57 → 7 files import React Query, and the 7 are
the intentional terminus).** Cleared every remaining convertible datum. The 7 survivors are: the **current-role
KEEP** (`use-permissions` reader + `member-list`/`role-editor-dialog` writers — the deliberate auth keep), the
**RQ infra removed only at RQ==0** (`query-provider`, `user-nav`'s `queryClient.clear()` logout hygiene,
`use-realtime`'s dead SSE bus), and one **test** (`saved-views-menu.smoke.test`). Order: platform-config
islands → write-only swaps → dead-invalidation drops → the reader composites that unblock each other.

- **Platform-config islands** (one commit each): org-ical-settings (calendars), discord (2 readers incl. a 10s
  `refetchInterval`, 6 mutations), entity-activity timeline + damage dialog (the timeline's only invalidator,
  the damage dialog, never co-mounts it → cross-route drop), **platform-branding** (always-mounted layout
  readers → a new `use-platform-name` **shared store** via `createSharedResource`, writer calls
  `refreshPlatformBranding()`) + admin site-settings island, and the **document-templates designer subsystem**
  (7 files: list page reader → `useServerQuery` + `onChanged` to the co-mounted manager; the 4 designer-route
  editors' list invalidates drop cross-route; `onMutate` folded into the mutationFn since `useServerMutation`
  has none; section-presets island).
- **Write-only swaps** (no `useQueryClient`, readers already reactive): 19 asset/kit/client/crew/maintenance/
  supplier/settings/check/report form+table components — pure `useMutation → useServerMutation`. (`report-*`
  used RQ-only `.isError` → `.error`.)
- **Dead-invalidation drops**: crew/[id], test-and-tag/[id], workshop, crew-panel, kits/page,
  asset-table, csv-import-dialog, models/[id] — each retained `useQueryClient` only for a cross-domain key
  whose last RQ reader was gone (verified by direct occurrence inspection — see the multiline-grep caveat
  below). ★ The keystone unblocker: **test-and-tag/new** (the deferred "4-way join") was the LAST RQ reader of
  `assets`/`bulk-assets`; it just reads `getAssets`/`getBulkAssets` (which already join `model` server-side) to
  auto-populate a form → a plain `useServerQuery` is data-identical (no reactive composite needed). Converting
  it made the `assets`/`bulk-assets` invalidations in asset-table/csv-import/models-page all dead → dropped.
- **Reader composites with child-dialog writers** (the parent-callback pattern, NOT a shared store, since the
  writers are children): **test-tag registry** (table reader → `useServerQuery` + a `refreshSignal` prop the
  co-mounted Sync button bumps), **crew dashboard** + **crew timesheets** (parent reader datums →
  `useServerQuery`; child Log/Edit dialogs get an `onLogged`/`onSaved` callback wired to the parent's refetch;
  cross-route crew-pending-time/dashboard-stats/crew-time-entries invalidates drop — those pages remount on
  navigation), settings/test-and-tag **auditor-tokens** (single component + child form via the existing
  `onSaved`).

★ **METHODOLOGY CAVEAT that bit once (corrected in the amended commit):** the automated
`useQuery({ queryKey: ["key"` reader-detection grep gives **false negatives on multiline queryKeys**
(`queryKey: [\n  "key",`) — it missed `test-tag-table` reading `test-tag-assets`. The reliable check is a
direct `grep -rn '"key"'` over ALL of `src/` and eyeballing each occurrence's role (useQuery reader vs
useServerQuery reader vs invalidate). The drop was still safe (cross-route), but the *stated reasoning* was
wrong until corrected. **Always inspect occurrences directly before declaring a key "dead".**

★ **SSE IS CONFIRMED DEAD (re-verified):** every `logActivity` passes a lowercase/camelCase `entityType` but
`mapEntityTypeToEvent` (`src/lib/activity-log.ts`) switches on PascalCase → no case ever matches → `events.emit`
never fires. So all these `useServerQuery`/shared-store/parent-callback conversions are **data-identical** —
cross-user liveness never existed; only same-view refresh (preserved by the explicit refetch/onChanged/onSaved
calls) mattered. **Fix or consciously delete this casing bug as the first step of the SSE teardown.**

Verified every commit: `tsc` clean, **2235 tests**, 0 new lint (normalized base-vs-HEAD, `LC_ALL=C sort` +
`comm`), `next build` exit 0 (env-gated API routes need `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`
set, even dummy, or page-data collection fails on `@/env`-importing routes — NOT a regression). No new Convex
table/fn → no JWKS round-trip. **NEXT = the endgame:** fix the dead-SSE casing bug, tear out
`use-realtime`/EventEmitter/SSE ([FEATUREDOCS/53](./53-realtime-sync.md)), then drop `query-provider` +
`user-nav`'s `clear()`; `current-role` is a deliberate keep until a separate decision (it gates the whole UI).

**Done session 2026-06-11g (★ REACT QUERY REMOVAL COMPLETE — RQ at zero; 3 commits pushed; 6 → 0 files import
`@tanstack/react-query`, dependency removed).** The deliberate terminus is resolved: the `current-role` KEEP
was **converted, not kept**. The decision (surfaced up front): SSE is dead, so a shared store is data-identical
to RQ's behaviour while a `useServerQuery` would be *wrong* (per-component, no cross-reader refresh) — so
`current-role` moved onto the `createSharedResource` keystone exactly like its sibling auth datums
(`organization`, `custom-roles`), which are also Prisma-forever / never-Convex-authZ.

- **The datum** (one reader, two writers — full per-datum safety-rule sweep first via `grep -rn '"current-role"'`
  over ALL of `src/`, eyeballing each occurrence's role): new `src/hooks/use-current-role.ts` shared store
  (`useCurrentRoleResource` + `refreshCurrentRole`, keyed by orgId; the `/api/current-role` fetcher ignores the
  key since the route derives the org from the session — the orgId key only forces a re-fetch on org switch, as
  the old `["current-role", orgId]` key did). Reader `use-permissions.ts` → `useCurrentRoleResource(orgId)`
  (same `{role, roleName, permissions, isLoading}` public API, so `useCanDo`/`useIsViewer` and all ~40 call
  sites are untouched). Writers `member-list` (member role change) + `role-editor-dialog` (permission edit) →
  `refreshCurrentRole(orgId)` instead of `invalidateQueries(["current-role"])`; both shed their last
  `useQueryClient`. (Commit 1.)
- **RQ infra removed at RQ==0** (commit 2): deleted `query-provider.tsx`; removed `<QueryProvider>` from the
  root layout **and** the auditor portal layout (`app/auditor/layout.tsx` — a second, easily-missed consumer
  the first grep didn't catch, now a pass-through `<>{children}</>`); dropped `user-nav`'s `queryClient.clear()`
  logout hygiene + `useQueryClient` (the shared-resource stores re-fetch on subscribe, so a fresh login
  re-hydrates on mount — no cross-user cache persists); removed the dead `QueryClientProvider` scaffolding from
  `saved-views-menu.smoke.test` (`SavedViewsMenu` was already on `useServerQuery`/`useServerMutation`); reworded
  the stale QueryProvider doc-comment in `convex-provider`.
- **Dependency dropped** (commit 3): `@tanstack/react-query` + the unused `@tanstack/react-query-devtools` out
  of `package.json` + `pnpm-lock.yaml`.

★ **The auditor-layout catch reaffirms the methodology caveat:** the reader-detection grep must sweep ALL of
`src/`, not just the obvious file — a single-line `import {QueryProvider}` grep over `app/layout.tsx` alone
missed `app/auditor/layout.tsx`, caught only by `tsc` after deleting the provider. Always grep the whole tree.

No new Convex table/fn → no JWKS round-trip / Convex deploy (the auth datums are Prisma-only). Verified each
commit: `tsc` clean, **2235 tests**, 0 new lint (normalized base-vs-HEAD, `LC_ALL=C sort` + `comm -13`),
`next build` exit 0 (re-run after the file deletions to regenerate `.next/types`). (No codex this session — CLI
unavailable in the environment; the keystone is unit-tested and the conversion is a mechanical port onto the
proven shared-store pattern with zero invalidation-semantics change.)

### PDF / document / report mirror-read decommission — ✅ DONE (2026-06-12, Tier 1 + 2 + supplier/location follow-up)

Plan: [`docs/designs/convex-pdf-decommission-session.md`](../docs/designs/convex-pdf-decommission-session.md).
The scoping pass found the **true PDF pipeline was already off the mirror** (model/supplier/category via
`attachLineItemTree`, client via `clients-read`, zero `*_media` reads, and the 5 `DocumentLineItem` consumers
are pure shape-consumers). So this session closed the *remaining* document/report/export cross-domain reads —
**model + category + (PDF) location** — onto the Convex attach helpers. 6 commits pushed; each tsc clean,
**2237 tests** (2235 + 2 new integration assertions), 0 new lint, `next build` exit 0.

- **Tier 1 — true PDF document path** (`build-document-data.ts`): the last mirror read was **location**.
  Dropped the `asset.location`/`bulkAsset.location` join (`asset: true`/`bulkAsset: true` keep `locationId` +
  `assetTag`); `deriveLocationName` now resolves from `getLocationMap` by `locationId`. Project venue attaches
  the Convex location doc by `projectRow.locationId` (name + address). **Shape byte-identical** (`locationName`
  already existed) → all 5 consumers untouched. Deleted dead `server/documents.ts` (`getProjectForDocument`,
  zero callers). Extended the full-pipeline integration test (`line-item-tree-attach.test`) with a
  `locationName`-survives assertion + the previously-uncovered **consumer-#2 height-reservation guard**
  (`estimateSectionHeight`, the v0.8.1.1 tail-drop class).
- **Tier 2 — report / export generators** (model + category off the mirror via the new shared
  `getModelWithCategoryMap` helper in `models-read`, which nests the equipment category like a Prisma
  `model: { include: { category } }` join): `report-engine` (new `attachModelsToRows` mirroring
  `attachClientsToRows`; direct category scoped to models/kits since `lineItems.categoryId` is a
  *project_category*), `csv` (3 exports), `reorder` (candidates + draft), `utilization`, `warehouse-close`.

★ **Key distinction baked into report-engine:** clients were a **hard cutover** (frozen Prisma table → relation
sorts skipped), but model/category/location are **dual-write** with a **fresh** Prisma mirror — so only the
*display read* moves to Convex; Prisma relation **sorts** on model/category stay correct (no `buildOrderBy`
change). Model reads were made null-safe (mirror miss → blank/"Unknown") since the joins are no longer
guaranteed.

**Verification caveat:** `report-engine` has no unit test (needs a DB) and `reorder.int.test` is excluded from
the default suite — both want the **live round-trip** (run a report with model/category columns; render a docket
+ quote; confirm Convex count == Prisma count). `reorder.int.test`'s `getReorderCandidatesCore` now reads model
names from Convex — the same dependency `createReorderDraftCore` already had via `getSupplierById`, so the int
harness already needs a Convex-aware setup (pre-existing migration debt, not new). No codex this session (CLI
unavailable). No new Convex table/fn → no JWKS round-trip.

**Follow-up — ✅ DONE (same session):** the **supplier + location relations in reports / CSV / reorder** are now
also off the mirror (commits `36ef914f` + `988b0ba1`): `report-engine` gained `attachSuppliersToRows` +
`attachLocationsToRows` (direct `supplier`/`location` + nested `project.location`; the `project` relation dropped
its nested location include to a plain join); `csv` asset/bulk exports attach `location` from `locations-read`;
`reorder` resolves `preferredSupplier` (by `preferredSupplierId`) + location from the Convex maps. So the entire
**document / report / export surface** now reads model / category / supplier / location / client from Convex —
the 6 scoped files (`build-document-data`, `report-engine`, `csv`, `reorder`, `utilization`, `warehouse-close`)
have **zero** cross-domain model/category/supplier/location Prisma joins left.

**Live round-trip verification — ✅ DONE (2026-06-12, tip `727a15f1`).** Ran the full
[verification protocol](../docs/designs/convex-pdf-decommission-verification.md) against a live Convex backend +
Postgres. Org **Test Org** (`ncmdpyj8712sfcmm89g1dxvl`); rich projects **Summer Nights Festival 2026** (client +
venue + 11 model lines + 1 sub-hire) and **TechCorp Annual Gala** (ON_SITE, 6 checked-out models).

- **Phase 0 — mirror current:** all 5 backfills idempotent, **0 created** (models 37/37, categories 23/23,
  suppliers 3/3, locations 8/8, clients 6/6 already present).
- **Phase 1 — count parity:** Convex list length == Prisma count for **all 4 domains** (37/23/3/8). ✅
- **Phase 2 — before/after value parity:** `verify-decommission.ts` dumped every cross-domain field
  (`buildDocumentData` venue/client/per-line model+cat+supplier+loc across all 5 projects; `executeReport`
  assets/models/kits/lineItems incl. 126 asset rows; `getReorderCandidatesCore`) on the new tip vs. baseline
  `30a2a547` → **`diff` empty**. Hardened beyond the protocol: (a) a direct **map value-parity** check
  (Convex map vs Prisma row, **field-by-field**, all 5 domains — 37+23+3+8+6 rows, zero mismatches), and (b) a
  **forced reorder candidate** (temporarily made `CBL-SOCAPEX` low-stock with a `preferredSupplierId`, reverted
  after) so the reorder cross-domain path ran with **non-null** values on both commits → diff still empty,
  confirming the `preferredSupplierId` key (not `supplierId`) resolves the supplier correctly. The seed has no
  natural reorder candidates and 0 line-item suppliers, so without (a)+(b) those paths were only *vacuously*
  equal.
- **Phase 3 — auth-gated UI** (`/browse`, real session, single-org owner): **Reports** assets report rendered
  Model Name / Category / Location / Supplier with values present and the **model.name sort correct** (Postgres
  collation — JS `localeCompare` gives false breaks; codepoint-ordered ✅). **Registry / Utilization** render
  model + category + location from Convex. **Reorder** dashboard (forced candidate) showed model / category /
  supplier / location populated; a real `createReorderDraftCore` line read exactly **`"Socapex 6-way Loom 20m —
  restock (CBL-SOCAPEX)"`**. **Documents:** delivery-docket + quote + packing-list all 200 / valid PDF — venue
  name+address, client name+contact, equipment **model names**, and the packing-list **Category** column all
  render. **CSV exports** (captured actual download bytes): Assets (`modelName`/`category`/`locationName`/
  `supplierName`), Models (`category`), Bulk (`modelName`/`category`/`locationName`) — all populated from Convex.
  **Warehouse Close-Out tab** (`getCloseOutSummary`) renders **6/6 real model names, 0 "Unknown"** in the live UI
  (the page's unrelated browser-reactive `useQuery(api.warehouseDetail.version)` authenticates once the session's
  `activeOrganizationId` is set — the client RBAC/Convex path needs it even though server-side scoping is
  single-org). All 6 server-side files confirmed in the actual UI.
- **Phase 4 — excluded `reorder.int.test`:** fails **10/11** on `InvalidAuthHeader` (the `gearflow_test` DB's
  Better Auth JWKS keypair isn't trusted by the Convex backend, which is pinned to the main DB's key — every
  Convex call fails on auth *before* fixture lookup). Baseline `30a2a547` passes **8/11** (only the 3
  `createReorderDraftCore` tests, already Convex-dependent via `getSupplierById`, fail); the **+7** new failures
  are exactly the `getReorderCandidatesCore` read tests now Convex-dependent — same auth root cause. This is the
  documented Convex-fixture/harness gap (generalized), **not** a logic regression; the reorder path is proven
  correct by Phase 2.
- **Findings:** (1) sub-hire **"via &lt;Supplier&gt;"** does not appear on the generated docs because this seed's
  sub-hire has `showOnDocs = false` (gate at `gearflow-table.ts:1209`) — correct product behaviour, and the empty
  Phase-2 diff confirms baseline behaves identically. (2) The warehouse `[projectId]` **page** initially failed on
  an unrelated **browser-reactive** Convex `useQuery(api.warehouseDetail.version)` — *not* one of the 6
  server-action files under test, and only because the synthetic session was minted with a null
  `activeOrganizationId` (so `authClient.useSession()` → `ConvexProviderWithAuth` saw no identity). Pre-setting the
  session's `activeOrganizationId` fixes it; the page and Close-Out tab then render normally. No new Convex
  table/fn was needed (no JWKS round-trip). **Verdict: data-identical confirmed.**

**Tier 3 — `warehouse.ts` hot-path joins — ✅ DONE (2026-06-12).** All cross-domain Prisma relation joins in
`warehouse.ts` are off the mirror (4 atomic commits; tsc clean, 0 new lint, **2237 tests green**):
- **model** (the 6 documented sites): check-out/check-in tx helpers (`checkOutDeployWholeLine`,
  `finalizeCheckoutItem`, `processItemCheckIn`) dropped `model: true` → grafted post-tx by new
  `attachModelToResults` from `getModelMap`; `getScanLog` dropped `asset: { include: { model } }` → grafted from
  the model map; `ensureContainerOnProject` dropped `model: true` on both find+create → grafted post-tx.
- **location**: `getProjectForWarehouse` + `getProjectPullSheet` dropped `location: true` (project) and the
  nested `asset: { include: { location } }` (3 tree levels) → project location from `getLocationMap`, asset
  location grafted recursively across the tree via `graftAssetLocation`. All flat docs, shape-identical to the
  old includes; consumers are warehouse / pull-sheet / scan / container UI only — **no PDF docket path** (the
  docket sources from `build-document-data`, already decommissioned), so no cross-cutting `DocumentLineItem`
  audit needed. Standalone `location.findFirst({ isDefault })` id-lookups stay on the fresh Prisma mirror (not
  joins). **Live-verified:** pull sheet renders model/client/venue + the recursive asset-location graft (forced
  a `SMOKE-cdlm` asset to Main Warehouse → rendered, reverted); warehouse Close-Out + project pages render.
  `warehouse.ts` now has **zero** cross-domain model/category/supplier/location Prisma relation joins.

**Non-document cross-domain reads — 🔄 IN PROGRESS.** Decommissioning the remaining `model`/
`category`/`supplier`/`location`/`asset`/`bulkAsset`/`kit`/`project` relation joins on the non-document server
surface, one file at a time. **Done + pushed (through 2026-06-15):**
- `bulk-assets.ts` — `getBulkAssets` + `getBulkAsset` (model+category+location via `getModelWithCategoryMap`/
  `getLocationMap`); `BulkAssetWithRelations` retyped.
- `assets.ts` — `getAssets` list (model+category+location; vestigial primary-photo media joins dropped).
- `maintenance.ts` — `getMaintenanceRecords` / `getWorkshopQueue` / `getMaintenanceRecord` /
  `getAssetsForMaintenanceSelect` (`asset.model` via `attachAssetModels` + `getModelMap`).
- `damage.ts` — `listDamageEvents` / `getDamageEvent` (`asset.model` + `bulkAsset.model` via `attachDamageModels`).
- `stocktake.ts` — `getStocktakes` / `getStocktakeById` / `scanStocktakeItem` / `getRecentScans` /
  `searchStocktakeAssets` / `markStocktakeItemFound` (model+location via Convex maps; category filters stay mirror).
- `check-records.ts` — prep/check write surface: line-item `model` joins grafted via `attachLineItemModels` +
  `getModelMap`. Kit joins left for the kit-domain decommission.
- `kits.ts` — **dead `getKits` list deleted**; category/location/media joins gone.
- `warehouse-display.ts` — `prisma.project.findMany` replaced with `getProjectsByOrg` + JS date filters;
  7-day warehouse dashboard loop is now Convex-sourced.
- `sub-hires.ts` — `project` include in `getSubHires` / `getSubHire` / `updateSubHireStatus` /
  `changeSubHireProject` replaced with `getProjectsByOrg` / `getProjectById` from Convex.
- `kits-read.ts` — added `getKitByAssetTag` Convex helper.
- `warehouse.ts` — scan path (`lookupAssetForScan`): all three domain lookups (asset/bulkAsset/kit) now
  Convex via `getAssetByAssetTag` / `getBulkAssetByAssetTag` / `getKitByAssetTag`; parent-kit and
  parent-asset lookups via `getKitById` / `getAssetById`; `forceReturnAsset` / `forceReturnKit` /
  `bulkForceReturnAssets` / `getAvailableAssetsForModel` all off Convex (project conflict window now JS
  filter over `getProjectsByOrg`).
- `line-items.ts` — 13 cross-domain reads replaced: project conflict windows → `getProjectsByOrg` + JS
  date-range filter; asset/kit header lookups → `getAssetById` / `getKitById`; location join →
  `getLocationById`; kit sub-tables (serializedItems/bulkItems) remain Prisma but fetched separately and
  merged. `addKitToProject` / `addLineItem` / `updateLineItem` / `addCustomLineItem` / `lookupAssetByTag` /
  `checkKitAvailability` all converted.
- `line-item-tree-read.ts` — added `attachAssetBulkAssetTree`: walks a lineItem tree (recursing into
  `childLineItems` + `units`) and attaches `ConvexAsset` / `ConvexBulkAsset` from org-scoped maps; replaces
  `asset: true` / `bulkAsset: true` Prisma joins at every tree level.
- `warehouse.ts` `getProjectForWarehouse` + `getProjectPullSheet` — removed `asset: true` / `bulkAsset: true`
  from the 3-level lineItem + units includes; calls `attachAssetBulkAssetTree` after the kit/model pipeline;
  `graftAssetLocation` still works (ConvexAsset has `locationId`).

**Detail-page reads — INTENTIONAL Prisma terminus (do NOT decommission).** `assets.ts:getAsset` and
`kits.ts:getKit` **stay on Prisma by design** — splitting the `*_media` gallery include is gratuitous risk
(5-consumer PDF audit + non-null `model` type contract). These tables remain FK anchors regardless.

**Post-mutation within-transaction reads — INTENTIONAL Prisma terminus.** The `include: { asset: true,
bulkAsset: true }` on `tx.projectLineItem.findUnique/create` inside `checkOutItems` / `checkInItems` /
`quickAddAndCheckOut` (warehouse.ts lines ~842, ~892, ~1129, ~1682, ~1748, ~1775) need fresh data
immediately after the mutation — the Convex mirror is eventually consistent so these CANNOT use Convex.
Same rationale as `maintenanceRecordAssets`.

## Sub-table dual-write groundwork — DONE 2026-06-16 (reads pending, gated on backfill)

To let the remaining point-2 sub-table READS move off Prisma, the tables that were
not yet dual-written got mirrors + idempotent backfills this session. **Dual-write
(writes) is complete and safe to ship now; the READ rewiring is a separate, later
deploy** — see the deploy-ordering gate below.

**Tier 2 — Convex table existed, no write path → wired dual-write:**
- `projectLineItemUnit` — `src/lib/line-item-unit-mirror.ts`, an AUTHORITATIVE
  per-line-item reconcile (upsert present + remove stale; units are deleted as
  well as created). Folded into `upsertProjectLineItemsToConvex` /
  `syncLineItemsToConvex` / `removeLineItemFromConvex`, so all ~50 post-commit
  line-item mirror sites cover units for free. New Convex query `listByLineItem`.
- `assetBulkChild` (`asset-bulk-child-mirror.ts` → asset-accessories.ts),
  `modelBulkAccessory` (`model-bulk-accessory-mirror.ts` → model-accessories.ts),
  `supplierModelRate` (`supplier-model-rate-mirror.ts` → sub-hires.ts upsert path).

**Tier 3 — no Convex mirror existed → built from scratch:**
- T&T: `test-tag-mirror.ts` (testTagAsset/testTagRecord/subTestRecord) wired into
  test-tag-assets/records/reminders, models, assets, org-import, site-admin
  (cascade-aware: subTestRecord children removed before parent).
- `asset-scan-log-mirror.ts` (append-only) → warehouse, bulk-checkin, check-records,
  org-import. SCAN_VERIFY logs that roll back on `TestTagBlockError` are NOT mirrored
  (never commit).
- `check-record-mirror.ts` → check-records (saveCheckRecords sink through all 7
  callers), split-sibling-collapse, org-import.

All in-`$transaction` writes mirror strictly POST-COMMIT (Convex calls can't run
inside a Prisma tx). Backfill scripts: `npm run convex:backfill:{line-item-units,
asset-bulk-children,model-bulk-accessories,supplier-model-rates,test-tag-assets,
test-tag-records,sub-test-records,asset-scan-logs,check-records}`.

**SKIPPED (user decision — no safe read payoff; would be overhead + a footgun):**
`notificationEmailLog` (1 read = read-then-write dedup → moving risks duplicate
emails), `wooCommerceOrderLog` (2 reads = webhook idempotency → double-processing),
`maintenanceRecordAsset` (export-only read; writer `damage-core.ts` must stay
Convex-free). These stay Prisma.

### ⚠️ DEPLOY-ORDERING GATE for the read rewiring

The dual-write keeps Convex fresh for NEW changes only; EXISTING rows live in
Convex only after the backfill runs. Therefore the read-rewiring deploy (task 4)
MUST land **after** the backfills have run against **prod Convex** — otherwise
existing projects' line items / units / kit composition / T&T history read empty.
Safe sequence: (1) ship the dual-write commits, (2) run the backfills against prod
Convex, (3) ship the read rewiring. The read rewiring could NOT be verified in the
dev worktree (local DB lacks better-auth migrations → backfills can't run there;
Convex tables are empty), so it is deliberately deferred to its own gated change.

**✅ Final non-document file sweep — DONE (2026-06-15/16).** The last 10 files with
cross-domain Prisma reads on the non-document surface are now off the mirror. All
converted shape-identically (org-scoped Convex prefetch + JS filter/find; null on
a map miss, no Prisma fallback; Convex epoch-ms dates → `new Date(ms)` where a Date
is needed). Build + 2280 tests + tsc all green.

| File | What was converted |
|------|-------------------|
| `build-document-data.ts` | dropped `asset`/`bulkAsset`/`kit` joins (3 tree levels) + unit asset joins; attach via `attachLineItemTree` → `attachKitTree` → `attachAssetBulkAssetTree`; `unitInclude` now selects `assetId`/`bulkAssetId` scalars. All 5 DocumentLineItem consumers untouched (233 PDF tests green) |
| `woocommerce.ts` | `resolveLocation` fuzzy-match over `getLocationsByOrg`; product matcher over `getModelsByOrg`; dup project-number check over `getProjectsByOrg` (writes `location.create`/`project.create` stay) |
| `report-engine.ts` | per-row `asset.groupBy`/`asset.count`/`project.findMany`/`kit.count` → org-wide Convex prefetch + JS (one fetch per dataSource block; `projectLineItem.aggregate` stays Prisma — sub-table) |
| `csv.ts` | model/asset/bulkAsset exports + category ref + import dedup maps off Convex (sorts → JS `localeCompare`; export dates wrapped `new Date(ms)`) |
| `asset-accessories.ts` | available-accessory list via `getAssetsByOrg` + JS; parent/child point lookups via `getAssetById`/`getBulkAssetById`; childAssets/childBulkItems existence via org asset + `assetBulkChildren` Convex lists |
| `model-accessories.ts` | `getModelById` + `getBulkAssetById` + org check |
| `line-items.ts` | child serialized-asset count via `getAssetsByOrg` + JS filter; `recalculateProjectTotals` header via `getProjectById` |
| `project-services.ts` | 5 project org-scope checks via `getProjectById`; location via `getLocationById` |
| `project-categories.ts` | project header via `getProjectById`; lineItems split to a separate Prisma sub-table query |
| `warehouse.ts` `getScanLog` | dropped asset/bulkAsset/project joins → Convex attach (asset gets grafted model); `scannedBy` Better-Auth join stays |

**Plus two adjacent build-blockers fixed the same session** (both downstream of
earlier decommission commits that shipped with errors):
- `reservation-conflicts.ts` — a prior batch converted the model/asset reads but
  left the `project: { … }` relation-filter joins, which broke tsc once project
  rental dates became Convex numbers. Finished it: `overlappingProjectIds()` helper
  (collect live-overlapping ids from `getProjectsByOrg` + JS window → `projectId: { in }`),
  `toConflictProject()` shape map, asset tags from a Convex map, swap-candidate +
  TOCTOU-recheck paths off the mirror.
- `assets/registry/[id]/page.tsx`, `kits/[id]/page.tsx`, `equipment-add-form.tsx` —
  null-guarded the now-nullable `asset.model`/`bulkAsset.model` (Convex map-miss →
  null vs the old non-null Prisma relation); `asset-service.test.ts` now mocks
  `getModelById` so the Discord lookup tests run offline.

**Note:** `asset-service.ts` (Discord asset lookup) still has a `project: { isTemplate,
status }` relation-filter on its `projectLineItem.findFirst` (line ~65) — a leftover
cross-domain read from the model-only batch. Low priority (single point read, fresh
Prisma mirror) but tracked for a future pass.

## Phase A read-rewiring — leaf surfaces (in progress, preview-gated)

The "domain data Convex-only" decommission's Phase A (read-rewiring) ships
**per-surface, each as its own PR**, validated on a Coolify PR preview against prod
Convex (Convex data-correctness can't be verified in a dev worktree). Each surface
follows the proven pattern: a thin `src/lib/<x>-read.ts` (mappers epoch-ms→Date,
Decimal→number, absent→null, JSON `v.any()` passed through, Prisma-defaulted
columns coerced non-null) + pure unit-tested filter/sort predicates replicating the
Prisma `where`/`orderBy` + JS attach for cross-domain joins. **No Prisma fallback on
a Convex map miss** (a miss reads null, like a join against a deleted row — falling
back would hide mirror drift). The merge gate for each PR is the deploy-ordering gate
above: the table must be backfilled into prod Convex before the read deploys.

- **maintenance records** (`server/maintenance.ts` → `src/lib/maintenance-read.ts`).
  `getMaintenanceRecords` (list + paginate) and `getMaintenanceRecord` (detail) now
  source the `maintenanceRecord` row from Convex (`maintenanceRecords.list` /
  `.getById`, both pre-existing) via `getMaintenanceRecordsByOrg` /
  `getMaintenanceRecordById`. The `maintenanceRecordAssets` join table is the
  intentional Prisma terminus (NOT mirrored — the record's `updatedAt` is the
  reactive signal), so the asset/model join is attached from Prisma exactly as the
  old `include` did, and the Auth-`User` joins (`reportedBy` / `assignedTo`) stay
  Prisma via a batched `prisma.user.findMany`. The model doc is grafted from Convex
  (`getModelMap`). Filtering (status / type / assetId / search-across-tag+model-name)
  and sorting (default `[status asc, scheduledDate asc]` or explicit scalar `sortBy`,
  with declared-enum-order rank maps + Postgres NULLS-LAST/FIRST) are pure
  unit-tested predicates in `maintenance-read.ts`; pagination is a JS `slice` over
  the org's records (mirrors the old `skip`/`take`). All writes
  (`create`/`update`/`delete` + the asset state-machine) and `getAssetsForMaintenanceSelect`
  stay Prisma. Org-scope on the by-cuid `getById` is enforced in the action
  (`record.organizationId !== organizationId → null`), matching the old
  `where: { id, organizationId }`. No new convex query needed.

## Remaining work & session sizing (post-central-graph)

The central graph is fully dual-written. What's left, with honest per-item effort
estimates (validated against this session's pace of ~1 domain per ~hour for
mechanical dual-write, much slower for design/security/teardown work):

1. ~~**Deferred crew scheduling/timesheet sub-tables**~~ — **DONE.**
   `crew_assignment`, `crew_shift`, `crew_availability`, `crew_certification`,
   `crew_time_entry` are now dual-written (see the section above). The entire
   dual-write surface is complete.
2. ~~**Clients hard-cutover latent FK bug**~~ — **DONE.** See "Clients FK bug fix"
   below. Both live FKs into the frozen Prisma `client` table
   (`project.clientId`, `client_media.clientId`) were dropped; the columns stay as
   plain external ids holding the Convex cuid.
3. ~~**Phase 5 — auth bridge**~~ — **DONE.** See "Phase 5 — Auth bridge" above:
   every Convex function is now authenticated (user token → org-scoped reads;
   service token → trusted backend; browser writes rejected). Verified 6/6
   round-trip + `/cso`.
4. **Phase 6 — decommission** — the tail of the ~3-month effort, explicitly
   **multi-session**. ✅ **SSE/EventEmitter teardown DONE** (2026-06-11f). ✅ **React
   Query removal DONE** (2026-06-11g — RQ at zero, dependency removed). ✅ **PDF /
   document / report model+category+location reads DONE** (2026-06-12, Tier 1+2 —
   the PDF pipeline itself was already off the mirror; see the section above). The
   "gratuitous risk" 5-`DocumentLineItem`-consumer audit is satisfied (shape-
   identical swap + a new height-reservation integration guard). The supplier +
   location follow-up landed same session, so the whole document/report/export
   surface is off the mirror. ✅ **Tier 3 `warehouse.ts` hot-path model + location
   joins DONE** (2026-06-12 — checkout/checkin/scan-log/container model + project/
   asset location off the mirror; 2237 tests green; live-verified; see the section
   above). **Still remaining:** the non-document cross-domain `model.*`/`category`/
   `supplier`/`location` reads (asset/kit detail, check-records, stocktake, …); flip
   the infra-only domains to reactive; and a clean **truncate +
   backfill** across all dual-written tables to clear the regenerate-orphaned
   sub-hire line-item rows. **Size: a sequence of scoped, independently-shippable
   sessions (one per subsystem).** Do NOT attempt in one pass.

**What remains for the migration overall (as of 2026-06-15):** the table in
"Still remaining" above covers the ~10 files with genuine cross-domain Prisma reads
left. The two intentional Prisma terminus groups (detail-page media queries +
post-mutation in-tx reads) stay forever. The infra-only dual-write domains
(brand/section/group/document/service templates, project grouping, file_upload) have
no reactive reader yet — not blocking decommission, just reactive gaps.
Convex stays the reactive read layer; RBAC/`custom_role`/`activityLog` stay Prisma
forever (Convex is never the authZ source of truth). **The client data-fetching
stack is now Convex `useQuery` + the `useServerQuery`/`useServerMutation`/
`createSharedResource` keystones end to end — no React Query, no SSE bus.**

## Phase 4 reactive cutover — project page + damage + maintenance (2026-06-13)

Cross-tab collaboration push: "edit in one tab, see it in another with no refresh." The
pattern is consistent and does NOT rewrite the deep composite reads (Prisma still owns
asset/unit/kit/Better-Auth-user joins) — each surface keeps its server-action composite
read and adds a **Convex subscription as the cross-tab change signal** that triggers a
re-fetch when a fingerprint flips.

**Project domain (fully reactive):**
- `convex/projects.ts` + 5 sub-tables (`projectCategories/Groups/Managers/Services/
  Tasks`) + `projectLineItems` + `subHires`: `list`/`getById` switched `requireService`
  → `requireOrgRead`, plus new `listByProject` browser queries.
- `src/hooks/use-projects.ts` — reactive `useProjects`/`useProject` + per-project
  `useProjectCategories/Groups/Managers/Services/Tasks/LineItems/SubHireDocs`.
- Project **list** (`ProjectTable`) is now a PURE Convex read (`useProjects` +
  `useClients` + `useLocations`, client-side filter/sort/paginate).
- Project **detail** (`use-project-detail.ts`) keeps the `getProject` composite + adds a
  `useProject` subscription; an `updatedAt` change triggers `refreshProjectDetail`.
  Financial totals ride this (recalc bumps the project row).
- **Equipment/pricing** (`useProjectEquipmentLiveSync`) fingerprints line-items + groups
  + categories + sub-hires. **Services** (`useProjectServicesLiveSync`), **Tasks**
  (inline TasksPanel watcher), **Sub-hires** (folded into the equipment sync).

**Damage (NEW dual-write + reactive):** was unmirrored. `src/lib/damage-mirror.ts` wired
into the two write actions (`createDamageEvent`, `updateDamageEvent`; chargeBack/resolve
delegate) — NOT into `damage-core.ts` (integration tests drive it, must stay
Convex-free). `convex/damageEvents.ts` → `requireOrgRead`. `scripts/convex-backfill-
damage.ts`. `use-damage.ts` hook + fingerprint watcher on the list.

**Maintenance (NEW dual-write + reactive):** also unmirrored. `src/lib/maintenance-
mirror.ts` wired into all four write sites (create/update/setMaintenanceStatus/delete) +
the damage create path's linked repair record. SCOPE: only the `maintenanceRecord` row
is mirrored — `maintenanceRecordAssets` stays Prisma because the record's `updatedAt`
bumps whenever asset links change (sufficient signal). `convex/maintenanceRecords.ts` →
`requireOrgRead`. Backfill + `use-maintenance.ts` hook + watcher on BOTH the list and the
workshop kanban (the kanban — cards moving columns live — is the highest-value surface).

**Crew scheduling (reactive):** the scheduling cluster (`crewAssignments`, `crewShifts`,
`crewTimeEntries`, `crewAvailabilities`, `crewCertifications`) was already dual-written
via `crew-scheduling-mirror.ts`, so this added only the read layer. `crewAssignments` +
`crewTimeEntries` → `requireOrgRead` + `crewAssignments.listByProject`; `use-crew-
scheduling.ts` hooks; `useProjectCrewLiveSync` on the project crew panel (refreshes crew +
labour cost), org-assignment watcher on the workshop planner, org-time-entry watcher on
the timesheets page. **Availability blocks now sync too:** the Prisma CrewAvailability
model has no `organizationId`, so a DENORMALIZED `organizationId` was hand-added to the
Convex `crewAvailabilities` read model (resolved from crewMember at mirror time) +
`by_organizationId` index + `listByOrg`; the planner watcher fingerprints assignments +
availabilities together. (Hand-added schema field — the generator won't reproduce it;
backfill `convex-backfill-crew-availability-org.ts` stamps existing rows.)

**Stocktake** was already reactive (prior session — `stocktakeDetail.version` vector).

**Self-hosted Convex push gotcha:** no `convex dev` watcher runs; edits to `convex/*.ts`
are NOT live until `npx convex dev --once --env-file .env.local`, which also resets
`NEXT_PUBLIC_CONVEX_URL`/`SITE_URL` away from the Tailscale `roger:3210/3211` host —
restore them after every push, then restart `next dev`.

**Back-office tail (reactive, 2026-06-13):** supplier orders (already dual-written via
`sub-hire-mirror`), plus NEW dual-write mirrors for warehouse closes (`warehouse-close-
mirror`), saved reports (`saved-reports-mirror`), and saved table views (`saved-views-
mirror`). Each flipped to `requireOrgRead`, got a backfill, and a fingerprint watcher in
`use-back-office.ts` wired to: supplier detail page, close-out tab (the "already closed"
banner appears live), reports page (shared reports sync org-wide), and the saved-views
menu. Saved-views create/setDefault re-sync ALL of the user's views for the table because
the txn unsets a prior default — a single-row mirror would leave a stale 2nd default.

**Deliberately NOT made reactive:** WooCommerce + Discord integration config (single-admin
settings; the Discord bot is out-of-process and reads Prisma directly — cross-tab sync is
meaningless) and the notification feed (computed on-read from app state, no stored
`Notification` table — making the bell live is a separate feature, not a migration).

**Reactive coverage now spans every operational + back-office surface.** The only tables
without a *direct* subscription are the `*RecordAssets`/join leaves, which refresh via
their parent's signal (the parent row's `updatedAt` bumps on any nested child write).
Still Prisma-only forever by design: Better Auth, `custom_role`/RBAC, `activityLog`.

## Prod data migration to Convex Cloud (runbook, 2026-06-13)

Prod will use **Convex Cloud** (managed), not the self-hosted Docker backend dev runs.
The hybrid model means "migrate the data" = populate a parity copy of prod Prisma into
the prod Cloud deployment, then keep it in sync via the dual-write (which ships in the app
code). Prisma stays the write source of truth.

**CI change (done):** `.github/workflows/main.yml` replaces the standalone build with
`pnpm exec convex deploy --cmd 'pnpm run build'` + a `CONVEX_DEPLOY_KEY` secret. That
deploys schema+functions to the prod Cloud deployment AND runs the build with the prod
`NEXT_PUBLIC_CONVEX_URL` injected; build only runs if the Convex deploy succeeds.

**Cloud-specific gotcha:** Convex Cloud deployments have their OWN env vars (dashboard /
`npx convex env set`), separate from the app's `.env`. The Phase-5 auth bridge
(`convex/auth.config.ts`) validates Better Auth ES256 JWTs against a trusted issuer/JWKS —
those must be set as **Convex deployment env vars** pointing at prod Better Auth, or every
browser reactive read returns `Unauthorized`.

**Sequence:** (1) create Cloud project + prod deployment, grab `CONVEX_DEPLOY_KEY`; (2) set
the deployment's auth-bridge env vars; (3) merge the Convex branch → `main` (pipeline
deploys the app with dual-write live + functions on Cloud in one shot); (4) run the
backfills **after** the app is deployed so the dual-write is already capturing new writes,
then re-run to heal the deploy-window gap; (5) parity-gate.

**Tooling (new):**
- `pnpm convex:backfill:all` (`scripts/convex-backfill-all.ts`) — runs every backfill in
  order; idempotent, re-runnable.
- `pnpm convex:parity` (`scripts/convex-parity-check.ts` + `convex/parity.ts`) — counts
  every dual-written table Prisma-vs-Convex (Convex side paginated for the per-query read
  limit). Go/no-go gate. Exit 1 on any mismatch.

**★ The parity gate immediately earned its keep:** on first run it caught that
`projectManager` / `projectService` / `projectTask` were NEVER dual-written — so the
services + tasks cross-tab reactivity shipped earlier read an always-empty Convex table.
Fixed with `project-subtable-mirror.ts` (authoritative per-project reconcile, wired into
every mutating action + duplicate/delete). Lesson: **a reactive read is only as good as the
dual-write behind it — always parity-check after wiring a subscription.** Backfills with no
dedicated script (project sub-tables, line-item units) are exactly what the gate surfaces.

## Migration phases (roadmap)

| Phase | Scope | Verification |
|------|-------|--------------|
| **0 Infra** ✅ | Docker stack, empty schema, provider, env | dashboard up, `convex dev` connects |
| **1 Schema** ✅ | 95 models + 65 enums → `defineTable()` | deployed clean, typechecks, tests green |
| **2 Thin CRUD** ✅ | 81 tables × 5 = 405 functions | deployed, typechecks, CRUD round-trip verified |
| **3 Server actions** 🔄 | 86 `"use server"` files call Convex (Clients hard-cutover; Suppliers + Locations + Models + Categories + Check-items + Test-profiles + Brand/Group-templates + Custom-fields + Section-presets + file_upload + crew + doc/service-template + **Kit** + **Asset/Bulk** + **project_category/group** + **project_line_item** + **sub_hire/supplier_order families** + **project** + **crew scheduling sub-tables (infra-only)** dual-write done — CENTRAL GRAPH COMPLETE + DUAL-WRITE SURFACE COMPLETE) | per-domain backfill + cutover; tsc/tests/build green each |
| **4 Frontend** 🔄 | React Query sites → Convex `useQuery` (Clients + Suppliers + Locations + Models + Categories + Check-items + Test-profiles + Custom-fields + crew + **Kit** + **Asset/Bulk registry** done) | table/dropdown/edit live-update on mutation |
| **5 Auth bridge** ✅ | Better Auth → Convex ES256 JWT; user token (org-scoped reads) + service token (trusted backend); browser writes rejected | round-trip 6/6: rejected without a valid token, accepted with; `/cso` clean |
| **6 Decommission** 🔄 | Rewire deferred mirror reads off Prisma + remove React Query + SSE event bus (truncate+backfill resync DONE; supplier FLAT reads rewired; **nested supplier+model+category in ALL line-item trees incl. warehouse + PDF pipeline rewired** via `attachLineItemTree` — line-item-tree dimension COMPLETE; **`model_check_item` + `kit_check_item` now dual-written → warehouse counts + kit join fully off Convex via `attachKitTree`, "Checks" tabs reactive, `crewMembers.icalToken` redacted for browser reads**; **all 7 `*_media` tables now dual-written + reactive-list photo grafts off the mirror via `media-read.ts`; warehouse scan-path single-model reads off the mirror**; **React Query removal IN PROGRESS — `useServerMutation` (writes) + `useServerQuery` (no-liveness reads) keystones; **76 datums off RQ — the no-liveness read tail is now EXHAUSTED** (was 143 files; all 124 remaining `useQuery` calls genuinely reactive): 11 reactive config domains + org-tags + the entire no-liveness tail via `useServerQuery` (count badges, previews, dashboard, crew analytics/pickers, admin, analytics/lookups, supplier/accessory detail, activity/category/calendar/auditor/check-items/members) + 2 read+write islands (saved-views, project-tasks) via `useServerQuery`+`useServerMutation`; classify with a MULTILINE-aware invalidate grep + anchored key attribution. **Reactive tail STARTED: shared write-components `MediaUploader`+`NotesEditor` decoupled from RQ (`queryKey` prop → `onChanged` callback + `useServerMutation`), unblocking all detail-page conversions; clients/[id]+locations/[id] (non-SSE islands) taken fully off RQ via `useServerQuery`+`onChanged={refetch}`; **model + maintenance + crew detail non-SSE pages + same-view island batch off RQ (2026-06-10m); **project cluster fully off RQ (2026-06-11d) via the `createSharedResource` keystone**; **★ RQ removal ALL BUT COMPLETE (2026-06-11e): platform-config tail + assets/kit/crew/test-tag write paths + the last reader composites → 57 → 7 files, and those 7 are the intentional terminus (the `current-role` auth KEEP, the RQ infra `query-provider`/`user-nav`-clear/`use-realtime`-SSE removed at RQ==0, + one test)**; SSE confirmed dead (lowercase entityType vs PascalCase map) so all conversions data-identical; **★ SSE / EventEmitter bus TORN OUT (2026-06-11f): all four files (`events.ts`, `api/realtime/route.ts`, `use-realtime.ts`, `realtime-provider.tsx`) + the `logActivity` emit hook deleted, `<RealtimeProvider>` removed from layout — data-identical since the bus never delivered an update**; **★ REACT QUERY REMOVAL COMPLETE (2026-06-11g): the last holdout — the `current-role` auth datum — converted onto the `createSharedResource` keystone (data-identical; SSE is dead), then `query-provider` deleted, `<QueryProvider>` removed from root + auditor layouts, `user-nav`'s `clear()` dropped, and `@tanstack/react-query` removed from package.json → 6 → 0 files import React Query, dependency gone**); **★ PDF / document / report mirror-read decommission (2026-06-12, Tier 1+2): the true PDF pipeline was already off the mirror, so this closed the remaining document/report/export model+category+location reads — `build-document-data` location → `locations-read` (shape-identical, all 5 DocumentLineItem consumers untouched) + dead `server/documents.ts` deleted + integration test gained a height-reservation guard; `report-engine`/`csv`/`reorder`/`utilization`/`warehouse-close` model+category → new `getModelWithCategoryMap` (display read only — dual-write mirror is fresh so Prisma sorts stay valid); **supplier+location follow-up also done same session — `attachSuppliersToRows`/`attachLocationsToRows` in report-engine + csv/reorder location/preferredSupplier → the 6 scoped document/report/export files have ZERO cross-domain model/category/supplier/location Prisma joins left**. ★ Tier 3 warehouse.ts hot-path model + location joins DONE (2026-06-12): checkout/checkin/scan-log/container model + project/asset-tree location off the mirror via `attachModelToResults`/`graftAssetLocation`, 2237 tests green, live-verified — warehouse.ts has zero cross-domain Prisma relation joins**) | per-subsystem; tsc/tests/build green each. [FEATUREDOCS/53](./53-realtime-sync.md) is now **superseded** (teardown done). **SSE + React Query both fully removed; the whole PDF/document/report/export surface reads model/category/supplier/location/client off Convex.** |

## Error masking & read-path resilience (2026-06-14)

Confirmed root cause of a "random client crash": a browser reactive subscription
ran with **no identity** during a transient window and the Convex guard threw.
The masked pm2 error was `InternalServerError`; the real message (found in the
Convex logs once the guards threw `ConvexError` — see below) was:

```
Uncaught Error: Unauthorized: authentication required.
    at requireOrgReadDoc (convex/lib/auth.ts:103)
    at handler (convex/warehouseDetail.ts:172)   ← warehouseDetail:version (Query)
```

`warehouseDetail.version` is a browser-readable reactive "version vector"
(`useQuery`, gated only on `projectId`, NOT on auth-ready). It throws the instant
`getUserIdentity()` is null. That happens when the browser's `fetchAccessToken`
(`convex-provider.tsx`) returns `null` — which it did on **any** non-ok / thrown
`GET /api/auth/token`. Returning `null` tells Convex "logged out" → it de-auths the
client → every live subscription re-runs with no identity → throws. And
`/api/auth/token` does a DB read on every mint (`definePayload` → org + membership),
so a brief 5xx / cold start / pool stall flips a logged-in user to null for a moment.

**Fix (the actual root cause): `fetchConvexAccessToken` (`src/lib/convex-token-fetch.ts`).**
The token fetch now retries transient failures (5xx / network) and surrenders the
token (returns `null`) ONLY on a genuine 401/403 or after retries are spent — so a
blip no longer de-auths the whole Convex client. Regression test:
`src/lib/convex-token-fetch.test.ts`. **Rule: never collapse a transient auth-token
fetch to null; null means "logged out" to Convex and de-auths every subscription.**

### Follow-up — auth-ready gating closes the connect-time race (`useAuthedQuery`)

The token-fetch resilience above treats one trigger (a transient `null` token
mid-session). It does **not** close the *other* path to the same crash, the one this
section already named: the version vectors are "gated only on `projectId`, NOT on
auth-ready." `ConvexProviderWithAuth` only calls `client.setAuth()` — which is what
**pauses the socket** while the first token is fetched — once `isAuthenticated`
(`!!session` from Better Auth's `useSession()`) flips true. On a hard navigation /
refresh straight onto a detail page (`warehouse/[projectId]`, asset, kit,
stocktake), the route-param-keyed `useQuery(api.<x>Detail.version, { id })` subscribes
on the **first render**, before the session has loaded — so the socket is live but
unauthenticated, `getUserIdentity()` is null, and `requireOrgReadDoc` throws an
**uncaught** `ConvexError` that crashes the page. The `list`/`getById` hooks dodged
this only by accident: their arg is `orgId` (from `useActiveOrganization()`), which
is `undefined` → `"skip"` until the session resolves.

**Fix: `src/hooks/use-authed-query.ts` — `useAuthedQuery`, a drop-in for Convex's
`useQuery` that holds the subscription (`"skip"`) until `useConvexAuth().isAuthenticated`
is true, then runs.** Convex automatically re-runs all subscriptions when auth state
changes, so the query fires the instant the token attaches — no manual refetch. This
also re-skips if auth is later lost (a spent-retry / genuine-401 de-auth), so a
mid-session token loss can no longer throw either. **Every browser Convex read now
goes through `useAuthedQuery`** (all ~70 call sites across `src/hooks/use-*.ts` and the
collaboration/project components), so the whole bug class is closed deterministically
rather than per-query-by-accident — and any new browser query inherits the gate.
The SERVER guards stay strict (`requireOrgRead*` still rejects a genuine anonymous
direct call — the Phase-5 invariant in `convex-phase5-auth-bridge.md`); this only
stops the browser from ever *sending* a read before it holds a token. Regression test:
`src/hooks/use-authed-query.test.tsx`. **Rule: browser Convex reads use
`useAuthedQuery`, never `useQuery` directly — a query keyed off anything available
before the session (route params, SSR props) will otherwise run unauthenticated and
crash.**

Plus two supporting properties of the SERVER-side Convex read path:

**1. Convex masks plain `Error` in prod — throw `ConvexError`.** A function that
throws a plain `throw new Error(...)` in a **production** deployment returns the
caller the generic `{"code":"InternalServerError","message":"Your request couldn't
be completed. Try again later."}`. The real message lands ONLY in the Convex
backend logs (`npx convex logs`), never in the Next.js log or Sentry. The
read-path auth guards in `convex/lib/auth.ts` (`requireOrgRead` /
`requireOrgReadDoc` / `requireService`) therefore throw **`ConvexError`** — its
payload survives the prod boundary, so an auth failure on a server-action read
surfaces its actual reason ("Unauthorized…" / "Forbidden…") instead of the
unactionable mask. **Rule for any new Convex function whose throw should be
diagnosable from the app side: use `ConvexError`, not `Error`.**

**2. Cross-domain reads retry once on a transient blip.** The projects list/detail
hard-depend on Convex round-trips that used to be pure Prisma (`getClientsByOrg`
for the list; `getModelsByOrg`/`getSuppliersByOrg`/`getCategoriesByOrg` via
`buildLineItemAttachMaps` for the detail). With no fallback, a single transient
Convex error (self-hosted cold start, momentary JWKS/network hiccup,
token-refresh boundary) took the whole page down. Those four `*ByOrg` list helpers
now wrap their query in `withConvexReadRetry` (`src/lib/convex-client.ts`) — one
retry after a 150ms backoff, **reads only** (idempotent; never wrap a mutation).
A *persistent* error still throws on the second attempt, so a real outage is never
hidden — this only smooths the "random" single-shot failures. This does NOT
re-introduce a Prisma fallback: a *map miss* still yields `null` (mirror-freshness
invariant preserved); only a *thrown* transient error is retried. Regression tests:
`src/lib/convex-client.test.ts`, `src/lib/convex-auth-guards.test.ts`.

## Conventions

See [`convex/README.md`](../convex/README.md) for the authoritative coding
conventions (domain file layout, the standard 5 functions per entity, orgId
scoping, mandatory indexes, and the Prisma→Convex type mapping table).
