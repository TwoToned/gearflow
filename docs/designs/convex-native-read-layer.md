# Convex-Native Read Layer — Migration Design

**Status:** IN PROGRESS — Phases 0–3 COMPLETE (reads native). Phase 4 in flight (4 PRs
open). Phase 5 (native writes) is the next major phase.
**Author:** autoplan research session, 2026-06-28
**Related:** [[convex-phase5-auth-bridge]], [[convex-hybrid-migration]], `perf-convex-efficiency-2026-06.md`, memory `perf-round-trip-bundles.md`

---

## ▶ NEXT SESSION — START HERE (2026-07-02)

**Phase 4 COMPLETE + Phase 5 write-inversion COMPLETE.** The remaining work is the
optional polish (see "Phase 5 remaining" below) + Phases 6–7. Full resume context +
per-PR detail in the memory file `convex-native-read-layer.md`.

**Phase 4 — DONE + DEPLOYED (PRs #323–329):** the faked-reactivity read layer is
deleted — `use-reactive-server-query.ts` + all version vectors + doorbells gone; the
warehouse landing list migrated native (`convex/warehouseList.ts`); dead dashboard
server actions pruned. (`use-server-query.ts` / `use-shared-resource.ts` stay — used by
100+ no-liveness reads + auth-adjacent surfaces.)

**Phase 5 write-inversion — DONE (PRs #330–342):** EVERY asset / kit / crew / project /
line-item write is native — RBAC (`requireOrgPermission`) + invariants + **atomic Convex
audit** (`writeActivityLog`) inside the mutation. Files: `convex/{asset,kit,crew,project,
lineItem}Writes.ts` + `convex/lib/audit.ts`; guard widened to `QueryCtx | MutationCtx`;
`src/lib/native-writes.ts` = per-domain flags + `ConvexError`→`UserFacingError` mapping.
~50 convex-tests (RBAC matrix + every invariant + audit rows). Each domain gated behind a
**runtime** env flag (`NATIVE_{ASSET,KIT,CREW,PROJECT,LINEITEM}_WRITES`, default OFF,
flippable via Coolify with **no rebuild** since the gate is server-side).

**Option A for the money writes (line-items / projects):** the cross-project
availability/double-booking checks + accessory/kit expansion + `recalculateProjectTotals`
stay SERVER-SIDE. recalc already runs *post-write* (never in the write txn), so totals are
byte-identical → **parity by construction**. addLineItem/addKitLineItem reuse the exact
existing expansion helpers (`expandAccessoryChildLines`, extracted `createKitLineItemCore`)
— zero duplication.

**Phase 5 remaining (optional polish, NOT done):** `reorderLineItems` (bulk sort-order);
the delete/archive CASCADES (`deleteProject`, `deleteCrewMember`, kit archive/delete —
multi-table, keep the existing cascade mutations); **5d optimistic client**
(`useMutation().withOptimisticUpdate` — the UX layer); **audit-read migration** (move the
activity-log screens to Convex `activityLogs` so the transitional Postgres `logActivity`
dual-writes can be dropped). Then Phases 6 (crons/actions) + 7 (search).

**⚠️ Before flipping any `NATIVE_*_WRITES` flag live:** dogfood on a preview, and for
line-items/projects do a totals parity check (native vs server-action → same Convex state
+ same audit row). Flags are all OFF today — merging changed nothing in prod.

---

### (superseded) NEXT SESSION — 2026-07-01

**Goal: finish Phase 4 (delete remaining legacy read layer) + execute Phase 5 (native
writes, domain-by-domain).** Full resume context in the memory file
`convex-native-read-layer.md` (PR list, live state, gotchas).

**Done:** Phase 0 (plumbing) + Phase 1 (project-detail native + RBAC guard + members/
customRoles mirror + convex-test) + **Phase 2 COMPLETE** (equipment tab, warehouse/kit/
asset detail all native) + **Phase 3 COMPLETE** (all 6 dashboard reads native, counter
tables). **All 6 `NEXT_PUBLIC_NATIVE_*` flags set `true` in GitHub repo vars (2026-07-01).**

**Phase 4 IN FLIGHT (2026-07-01, 4 PRs open):**
- **#323** — retire the version-vector detail read path: collapse kit/asset/warehouse
  DETAIL pages to native-only; delete the `version` exports in `convex/{kit,asset,
  warehouse}Detail.ts`, the `use{Kit,Asset,WarehouseProject}DetailVersion` wrappers, and
  the 3 `convex-roundtrip-*-detail.ts` scripts (they validated only the deleted vectors).
- **#324** — retire the equipment-tab doorbell: collapse the 6 shared-resource reads +
  delete `useProjectEquipmentLiveSync`. KEPT the `invalidate()`/`refresh*` chokepoint
  (the add-form + sub-hire dialog still READ those shared stores).
- **#325** — collapse the 6 dashboard reads to native-only.
- **#326** — collapse project-detail read to native-only; `refreshProjectDetail` kept
  as a no-op (native subscription is reactive).

**Phase 4 REMAINING (handoff):**
- `use-reactive-server-query.ts` **stays** — still imported by the **warehouse LANDING
  list** (`warehouse/page.tsx`), which was never migrated to native. Migrating that list
  (a `getProjects` version-vector read) is the prerequisite to deleting the hook.
- `use-server-query.ts` **stays** — used by 100+ no-liveness one-shot reads (badges,
  admin, pickers). Not a Phase-4 target.
- `use-shared-resource.ts` **stays** — still backs SSO/org-members/custom-roles/profile/
  templates/project-services/crew + the equipment add-form/sub-hire dialog reads.
- **Dead server actions to prune (verify-then-delete):** `getUpcomingProjects` +
  `getMyBlockingComments` are now zero-importer. `getDashboardStats`/`getSubHireDashboardStats`
  only referenced in comments. `getRecentActivity` (used by `maintenance-record-asset-read.ts`)
  and `getMyHomeData` (int test) must stay. Do these as one small "prune dead dashboard
  reads" PR after #325 merges.

**Core insight (unchanged):** native = ONE backend-local Convex composite over a
reactive `useQuery`, replacing the browser → Next → Convex-HTTP-tower → serialize path.

**Hard gotchas:** Convex module filenames camelCase, NO hyphens (broke prod deploy
once). `NEXT_PUBLIC_*` flags are build-inlined → Dockerfile ARG + build-image.yml
build-arg + GitHub repo var + a rebuild (runtime env does nothing) — **note: because
they're build-inlined, an env-var rollback in prod ALSO needs a rebuild, so it's no
faster than a git revert; that's why Phase 4 can safely collapse the flags**. Use
`useAuthedQuery`. `pnpm add --ignore-workspace`; copy `.env`/`.env.local` from main;
`DATABASE_URL=<placeholder> pnpm exec prisma generate` before `tsc`; `pnpm exec convex
codegen` after convex edits. CI `next build` verifies client-safety. One PR per slice,
deploy is async (poll `https://flow.rvlt.app` for 200/307).

**⚠️ Live-state sequencing:** the running prod container predates the flag-set (repo
vars set 2026-07-01 AFTER the last build), so native reads have **not run in prod yet**.
Merging ANY Phase 4 PR triggers a rebuild that both flips native reads live AND removes
that surface's fallback. Smoke-test the affected surface after the first merge deploys.

See **§Phase 5 execution plan (2026-07-01)** below before starting native writes.

---

## TL;DR

Today GearFlow uses Convex as an **HTTP database behind Next.js server actions**: every read is `browser → server action → ConvexHttpClient (HTTP) → compose in JS → serialize() → browser`, and "reactivity" is faked by subscribing to a cheap Convex **version-vector** query that re-runs the server action when it ticks. The goal is to make reads **native**: `browser → useQuery (WebSocket subscription) → Convex composite query → browser`, client-cached and reactive, deleting the faked-reactivity machinery.

**The two findings that change the plan vs. the intake hypothesis:**

1. **The auth crux is ~60% already solved.** The Phase 5 auth bridge is built and deployed: `convex/auth.config.ts` validates Better Auth ES256 JWTs, `ctx.auth.getUserIdentity()` works inside Convex today, and `requireOrgRead`/`requireOrgReadDoc` already enforce **org-scoping** on browser reads (`convex/lib/auth.ts:90-118`). The JWT already carries `orgId` + `role` claims (`src/lib/auth.ts` jwt plugin). What's missing is **RBAC** (resource/action permission checks) inside Convex — today only org-scoping is enforced for reads; full `requirePermission` RBAC stays in Prisma server actions.

2. **For a surface whose writes already hit Convex, you can go native on READS without touching WRITES — and reactivity still works.** Convex invalidation is keyed on *what Convex data changed*, not *who wrote it*. Where the server-action write already calls `convex.mutation(...)`, it **already pushes live updates to every `useQuery` subscriber over the WebSocket** ([docs.convex.dev/functions/query-functions]). This is **verified for the project-equipment spike target** — its writes (line-items, project-groups, categories, sub-hires, warehouse, assets) are Convex-native and awaited (`src/server/line-items.ts:370,637,917`). **It is NOT universal:** membership/role writes (`src/server/org-members.ts:109,172,214`), custom-role writes (`src/server/custom-roles.ts:61,119,164`), org-calendar settings (`src/server/org-calendar.ts:53,82,113`), and `logActivity` (`src/lib/activity-log.ts:22`) are **Postgres-only**. A page that reads those tables can't become reactive until those writes also reach Convex. **So every surface migration begins with a per-surface write-dependency audit** (§4): list each source table the composite reads and prove every write to it mutates Convex synchronously, or the field is intentionally non-reactive.

**Therefore the core migration is read-first, page-by-page, gated on a write-dependency audit.** For audited-safe surfaces, keep writes on server actions (they retain `requirePermission` + `logActivity` audit, and already trigger reactive push). Move reads to **new browser-safe composite queries** (DTOs with field allowlists — the existing `projectEquipment.bundle` is deliberately service-only and must NOT be exposed as-is, §3.4/H1), with RBAC enforced in Convex via one new guard backed by **fail-closed-mirrored** `members`/`customRoles`. Delete the version-vector + shared-resource read layer surface-by-surface.

**Scope (two layers).** Phases 0–4 are the **read migration** — the reactive, near-instant app, ~6–8 weeks, the core commitment. Phases 5–7 are the **"Convex baked in, not bolted on" arc** (user-approved Tiers A–D, 2026-06-28): native writes with **atomic audit + invariants inside the mutation** (Convex becomes the domain layer, not just a write target), background jobs/side-effects as Convex crons+actions, and native search indexes — another ~6–9 weeks, sequenced after reads because writes carry the integrity risk. **Auth stays in Postgres** (Tier E / `@convex-dev/better-auth` is explicitly out of scope — alpha dependency, and the auth/domain split is a clean boundary, not an afterthought).

---

## 1. Current-state diagnosis (with evidence)

### 1.1 The read path

Canonical server-action read (`src/server/*.ts`):

```
getConvexClient()           // ConvexHttpClient + SERVICE token — src/lib/convex-client.ts:26-42
  → convex.query(api.x)     // HTTP, often Promise.all of 5-7 reads
  → compose/join in JS      // cross-domain joins, tree building
  → serialize()             // Prisma Decimal→number — src/lib/serialize.ts:8-23
  → return to browser
```

Examples: `getDashboardStats` does `Promise.all` over **7** Convex reads then composes in JS (`src/server/dashboard.ts:29-72`); `getKit` does `Promise.all` over **7** scoped reads + JS composition (`src/server/kits.ts:82-101`); `getMyHomeData` joins a Convex `clients` list onto projects in JS and calls `serialize()` (`src/server/dashboard.ts:120-121`).

`getConvexClient` is a process-global `ConvexHttpClient` carrying a **service token** (full access), with a 150ms single-retry wrapper for JWKS cold-start races (`src/lib/convex-client.ts:60-67`).

### 1.2 The faked-reactivity machinery

Three coexisting mechanisms (this is already a **hybrid** — further along than "everything is faked"):

| Mechanism | File | Reactivity | Used for |
|---|---|---|---|
| `useReactiveServerQuery({ watch: version })` | `src/hooks/use-reactive-server-query.ts:1-142` | Cross-user, via version-vector `useQuery` | Detail pages (kit, asset, project, warehouse) |
| `useServerQuery({ queryKey, queryFn })` | `src/hooks/use-server-query.ts:1-147` | None (one-shot, optional poll) | Counts, badges, aggregates |
| `createSharedResource(...).use(key)` | `src/hooks/use-shared-resource.ts:1-127` | None; writer calls `refresh(key)` | Multi-reader/writer (equipment tab) |
| `useAuthedQuery(api.table.q, ...)` | (native Convex) | **Native** WebSocket subscription | Collaboration locks, comment counts, equipment live-sync |

`useReactiveServerQuery` watches a "version vector" — a cheap `useQuery` against e.g. `convex/warehouseDetail.ts:155-197` that returns content **signatures** folding in every mutable field of the watched rows. When a write changes any watched row, the Convex mirror updates, the signature changes, Convex pushes the new vector, and the hook **re-runs the unmodified server action** (`use-reactive-server-query.ts:81,116-125`). It is a real WebSocket subscription used as a *change-notification doorbell* that triggers an HTTP refetch — paying for the WebSocket but throwing away its payload.

**No client-side query cache across navigation.** `useServerQuery` clears data on key change (`use-server-query.ts:139`); `useSharedResource` dedupes within a session via a module-level `Map` but is not a persisted cache. Navigate away and back → full refetch.

### 1.3 Round-trip counts on hot surfaces (on load)

- **Dashboard** (`src/app/(app)/dashboard/page.tsx:60-65`): **6** independent `useServerQuery` reads (`getDashboardStats`, `getUpcomingProjects`, `getRecentActivity`, `getSubHireDashboardStats`, `getMyHomeData`, `getMyBlockingComments`). `getDashboardStats` alone fans out to 7 Convex HTTP reads behind the action.
- **Project detail / equipment tab** (`src/components/projects/equipment-tab.tsx:129-141` + `src/hooks/use-project-equipment.ts:34-63`): **6** shared-resource composites (categories, uncatItems, uncatSubHireGroups, uncatProjectGroups, overbooked, subHires) + **1** live-sync driver watching 4 Convex tables + **2** native subscriptions (locks, comment counts).
- **Warehouse detail** (`src/app/(app)/warehouse/[projectId]/page.tsx`): **1** version-vector subscription + **1** `useReactiveServerQuery` (`getProjectForWarehouse`) + **1** one-shot read = 3 round trips, plus on-demand scan reads.

### 1.4 What specifically caps performance

1. **Every navigation pays a cold HTTP round trip** (no client cache) — the server tier re-fetches and re-composes everything.
2. **Double transport** on reactive pages: a WebSocket subscription (version vector) *plus* an HTTP refetch on every tick.
3. **Server-tier composition + `serialize()`** adds a hop and CPU the native model removes entirely.
4. **Fan-out actions** (`getDashboardStats` = 7 reads) serialize through one Node process per request rather than executing as one transaction in Convex.

The recent perf PRs (#290–296, memory `perf-round-trip-bundles.md`) already attacked #4 by collapsing composites into single backend-local bundle queries (`convex/projectEquipment.ts`, `convex/overbooking.ts`, `convex/availabilityCheck.ts`). **Those bundle queries are the foundation for native composites** — they already read everything for a composite inside one Convex query.

---

## 2. Target architecture

### 2.1 Native read path

```
useQuery(api.projectDetail.bundle, { projectId })   // WebSocket subscription
  → Convex composite query (ctx-passing helpers)    // org-scope + RBAC enforced HERE
  → returns page-sized plain object                 // no serialize() tier
  → ConvexQueryCacheProvider keeps it warm across nav
```

- **Reads:** `useQuery` / `usePaginatedQuery` subscriptions. One **page-sized composite per surface**, composed inside a single Convex query with plain `ctx`-passing helper functions (not many `ctx.runQuery` hops — each is its own transaction; guidelines `:90-96`).
- **Client cache:** wrap the app in `ConvexQueryCacheProvider` (`convex-helpers/react/cache/provider`) so subscriptions survive unmount and reload instantly on back-navigation ([stack.convex.dev/magic-caching]). Tradeoff: more open subscriptions = more bandwidth; it buys UX, not DB cost.
- **Writes:** **unchanged** — stay on server actions (`requirePermission` → `convex.mutation` → `logActivity` → return). The mutation already pushes the reactive delta to all `useQuery` subscribers. Optimistic UX is added later, selectively, via native `useMutation().withOptimisticUpdate` only where audit logging can move into Convex.
- **Reactivity:** delete the version vector. Native `useQuery` *is* the subscription.

### 2.2 Before/after — project detail (the spike target)

**Before:**
```
mount equipment-tab
  → useProjectEquipmentLiveSync (4 Convex table subs as doorbell)
  → 6× useSharedResource composites (each: HTTP → server action → ConvexHttpClient → compose → serialize)
  → on any edit: Convex push → refresh(key) → 6 HTTP refetches
  → navigate away + back: 6 cold refetches
```

**After:**
```
mount equipment-tab
  → useQuery(api.projectEquipment.browserBundle, { projectId })  // NEW browser-safe DTO query
  →   (RBAC-checked via requireOrgPermission; returns allowlisted fields only — NOT the
  →    service-only api.projectEquipment.bundle, which exposes projectLineItemUnits)
  → usePaginatedQuery for long line-item lists (see §6 limits — required, not optional)
  → on any edit (server-action write still): Convex push updates the subscription in place
  → navigate away + back: served instantly from ConvexQueryCacheProvider, re-subscribes in background
```

Net: 6 composites + 1 doorbell + server-tier compose/serialize → **1 cached subscription**, reactivity preserved, writes untouched.

### 2.3 Consistency

Convex gives a **single global consistent snapshot for reads over Convex tables** — all `useQuery` subscriptions reflect the same logical Convex timestamp, so a write never leaves the Convex-derived parts of a page half-stale ([docs.convex.dev/client/react]). Within that boundary this is strictly stronger than today's per-hook refetch model, where 6 shared resources can refetch at slightly different times.

**Boundary caveat (per dual-voice review):** this consistency does **not** extend to data still in Postgres. Any surface that joins Postgres-only data (org settings, attached Prisma user fields beyond the mirror, activity-log pages) into a Convex-derived view is a **mixed-source surface** and has no cross-store snapshot guarantee. Each migrated surface must document its consistency boundary. Correction from the latest repo pass: the dashboard `getRecentActivity` tile does **not** read Postgres `activityLog`; it composes Convex scan/test-tag/maintenance rows and attaches Prisma `user` names (`src/server/dashboard.ts:196-274`). A native version is possible if those user fields come from the existing Convex `users` mirror/DTOs. The separate activity-log screens (`src/server/activity-log.ts`) and `logActivity` write path remain Postgres-only until Phase 5.

---

## 3. The auth/permissions-into-Convex design (the crux), resolved

### 3.1 What exists today

- **Bridge:** `convex/auth.config.ts` registers one `customJwt` provider (ES256, `applicationID: "convex"`, issuer = `BETTER_AUTH_URL`). Validates both the **service token** (`sub="gearflow-service"`, `svc:true`) and the **user token** (real `sub`, `orgId`, `role` claims).
- **Guards (`convex/lib/auth.ts`):** `getAuthContext` returns `{kind:"service"}` | `{kind:"user", userId, orgId, role}` | `null`. `requireService` (all writes), `requireOrgRead(ctx, orgId)` and `requireOrgReadDoc(ctx, doc)` (org-scoped reads). Service detection is strict (subject **and** `svc===true`); a non-service token carrying `svc` is rejected.
- **What's enforced for browser reads today:** org-scoping only. A user token can read any BROWSER_READABLE table for **its own org**. Sensitive columns (e.g. `crewMembers.icalToken`) are redacted for non-service callers (`redactFields`, `convex/lib/auth.ts:69-76`).
- **RBAC model (Prisma side):** `requirePermission(resource, action)` reads the `member` row, resolves `custom:<id>` roles from `customRole.permissions` (JSON), and calls `hasPermission(role, resource, action, customPermissions)` against a static map of 18 resources × the current built-in permission profiles (`owner`, `admin`, `manager`, `member`, `warehouse`, `viewer`; `staff` is legacy/removed and not in `rolePermissions`). Note the distinction: `ORG_ROLES`/assignable UI roles currently exclude `warehouse`, but the permission profile still exists and must remain parity-tested if any mirrored row can carry it (`src/lib/org-context.ts:88-116`, `src/lib/permissions.ts`).

### 3.2 The gap

Native browser reads need the **same** RBAC that server actions enforce, but inside Convex. Today Convex can't make that decision — it has the user's `role` claim but **not the permission map**, and **not custom-role permissions** (only `members` identity is implied; `customRoles` are Prisma-only).

### 3.3 Resolved approach: mirror membership + RBAC, check in a Convex helper

**Decision: enforce RBAC inside Convex for reads, keep it for writes in Prisma.** Concretely:

> **Supersedes [[convex-phase5-auth-bridge]] for the read path.** That doc recommended "Option 1: RBAC stays in server actions; Convex enforces org-scoping only," chosen when native reads weren't on the table. This migration's whole point is native browser reads, which *require* RBAC at the Convex boundary — so we deliberately adopt the Phase-5 doc's "Option 2." The Phase-5 invariant "Convex is never the authZ source of truth for **writes**" still holds: writes keep their Prisma `requirePermission` authority. Confirmed by the user at the autoplan gate (2026-06-28): Full RBAC in Convex.

1. **Make the permission map isomorphic.** `src/lib/permissions.ts` is already a pure static map (`rolePermissions`, `hasPermission`). Move the pure logic into a shared module importable by **both** `src/` and `convex/` (e.g. `src/lib/permissions-core.ts` with no server-only imports; Convex imports it). One source of truth for "role Z can do action A on resource R." No behavioural change — just relocation. (Verify no `"use server"` / Prisma imports leak in; per CLAUDE.md, validation/pure modules must not live in `"use server"` files.)

2. **Mirror `members` + `customRoles` into Convex — FAIL-CLOSED, not best-effort.** The schema tables already exist (`convex/schema.ts:117,143`) but have **no writers**. Unlike the `users` mirror (one chokepoint, best-effort, error-swallowed because identity is non-security), **membership/role mirrors are part of the authorization-change contract**: a revoke/demote/permission-removal that fails to reach Convex would leave a stale mirrored row that keeps granting native reads (a fail-open hole both reviewers flagged independently). Therefore:
   - Mirror writes for **revocation/demotion/permission-removal MUST fail closed** — the restrictive Convex mirror update happens before the Prisma source-of-truth change (§3.3.4). If that Convex write throws, the Prisma change must not proceed. If Prisma later throws after Convex already became more restrictive, that is temporary over-denial and must be reconciled, not silently ignored. Additive grants can commit Prisma first and mirror afterward with retry because a lagging mirror denies too much, not too little.
   - **Every** membership/role write site must call the mirror — these are scattered, not one chokepoint. Verified grep hits include `src/server/org-members.ts`, `src/server/custom-roles.ts`, `src/server/settings.ts`, `src/server/site-admin.ts`, `src/server/user-profile.ts`, `src/server/sso.ts`, `src/lib/sso-provisioning.ts`, and `src/lib/auth.ts`. If invitation acceptance or org import creates/updates members in another path, that path must be included too. A nightly parity reconcile (reuse Phase A/B/C tooling) is a backstop, not the primary control.
   - `customRoles.permissions` is `v.string()` in the Convex schema today (`convex/schema.ts:143`). **Lower-risk default: keep it as the JSON string and `JSON.parse` + validate inside the guard** (mirrors Prisma's `resolvePermissions`, `src/lib/org-context.ts:70,77`). Storing a validated object instead is a deliberate schema change — only if you want the parse to happen once at mirror time.

3. **Add one guard** `requireOrgPermission(ctx, orgId, resource, action)` in `convex/lib/auth.ts`. **The sketch below is corrected from the first draft — both reviewers caught real bugs** (wrong index names, missing `JSON.parse`, `.unique()` vs Prisma's duplicate-tolerant `findFirst`, custom-role lookup not org-scoped):
   ```ts
   export async function requireOrgPermission(ctx, orgId, resource, action) {
     const auth = await getAuthContext(ctx);
     if (!auth) throw new ConvexError("Unauthorized: authentication required.");
     if (auth.kind === "service") return;                 // trusted server already checked
     if (auth.orgId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
     // NOTE: requires a NEW compound index by_org_user on members ([organizationId, userId]).
     // Use .first() not .unique(): Prisma Member has no @@unique([orgId,userId]) and every
     // server-action path uses findFirst (src/lib/org-context.ts:94) — .unique() would throw
     // InternalServerError on any duplicate (mirror double-write), diverging from Prisma.
     const member = await ctx.db.query("members")
       .withIndex("by_org_user", q => q.eq("organizationId", orgId).eq("userId", auth.userId))
       .first();
     if (!member) throw new ConvexError("Forbidden: not a member.");
     let perms = null;                                    // PermissionMap object, not a string
     if (member.role.startsWith("custom:")) {
       const custom = await ctx.db.query("customRoles")
         .withIndex("by_cuid", q => q.eq("id", member.role.slice(7)))   // index is by_cuid, not by_id
         .first();
       if (!custom || custom.organizationId !== orgId)    // scope by org, mirror src/server/custom-roles.ts:35
         throw new ConvexError("Forbidden: role no longer exists.");
       perms = typeof custom.permissions === "string"     // Prisma parses JSON (org-context.ts:70,77)
         ? JSON.parse(custom.permissions) : custom.permissions;
     }
     if (!hasPermission(member.role, resource, action, perms))
       throw new ConvexError("Forbidden: insufficient permissions.");
   }
   ```
   Throws `ConvexError` (never plain `Error`) per CLAUDE.md. The new browser-safe composite queries call this once at the top. (`hasPermission` is verified import-free/pure — `src/lib/permissions.ts` has no imports — so the isomorphic relocation is genuinely low-risk.)

**Why mirror membership rather than trust the JWT `role` claim?** Convex guidelines `:181-182` are explicit: never authorize from a client-supplied identifier; derive identity from `ctx.auth.getUserIdentity()` and re-read the authoritative row. The `role` claim is only as fresh as the last token mint — and the user token has a **5-minute TTL** (`USER_TOKEN_TTL`, `src/lib/auth.ts:156,180`), so trusting the claim would let a revoked role linger up to a token lifetime. The mirrored row is the authoritative check; the claim is at most a hint.

#### 3.3.4 Mirror write-ordering contract — the security property that makes "fail-closed" real

Saying the mirror "fails closed" is not enough — Prisma and Convex **cannot share a transaction**, so the *order* of the two writes determines the failure mode. The naive order is fail-OPEN:

```ts
await prisma.member.delete(...)      // access revoked in the source of truth
await convex.mutation(api.membersMirror.delete, ...)  // if THIS throws → Convex STILL grants reads
```

The rule, by change direction:

- **Restrictive changes** (revoke, demote, custom-role permission removal, custom-role deletion, ownership demotion): **apply the more-restrictive state to Convex FIRST, then commit the Prisma source-of-truth change.** If Prisma then fails, you have temporary over-*denial* (Convex denies, Prisma still grants) — safe; reconcile later. You can never end up with Convex granting what Prisma revoked.
- **Additive changes** (new member, promotion, additive permission): **commit Prisma first, mirror to Convex after.** A lagging/failed mirror denies too much, not too little — safe; a short retry is fine.
- **`transferOwnership`** (simultaneously a demotion of the old owner and a promotion of the new): treat the demotion as restrictive — demote the old owner in Convex **before** the Prisma transaction (or use a dedicated mirror mutation that writes the safe intermediate state) — then commit Prisma, then promote the new owner in Convex.

**Invariant (must be tested):** *a failed mirror operation must never leave Convex granting a permission Prisma has revoked.* The nightly reconcile is a backstop for drift, not the primary control — the ordering is.

**Why keep writes in Prisma RBAC *for the read migration (Phases 0–4)*?** Three reasons, all evidence-backed:
- `logActivity` writes **only** to Postgres `activityLog` (`src/lib/activity-log.ts:20-32`); moving writes client-side loses the audit trail unless audit also moves to Convex.
- Convex mutations today carry **zero** RBAC — they `requireService` and trust the caller (`convex/assets.ts:130-133`). Field-level/resource RBAC lives server-side.
- Server-action writes **already** trigger the reactive push, so there is no reactivity reason to move them *for reads to work*.

This is the stance for the read migration, not forever. **Phase 5 (Tiers A+B) deliberately moves writes, RBAC, invariants, and audit into Convex mutations** — atomically — which is what makes Convex the domain layer rather than a write target. It's sequenced after reads because writes are the higher-risk surface, not because it's out of scope.

### 3.4 Boundary consistency

- **Mirrored into Convex (read-only replicas):** `users` (exists), `members` + `customRoles` (schema tables exist at `convex/schema.ts:117,143` but need **writers** + a compound `by_org_user` index + validated permission shape). Written service-only on the Prisma write that changes them; idempotent `createIfMissing`/upsert; **failures fail-closed for revocation/demotion** (§3.3.2), best-effort only for additive grants.
- **Stays Prisma-only (source of truth):** Better Auth (`user`, `session`, `account`, `verification`, `jwks`), `organization`, `member`, `invitation`, `customRole`, `ssoProvider`, `pendingSSOApproval`, `activityLog`.
- **Drift control:** the mirror is one-way; revocation paths fail closed (above); a nightly parity check (reuse the existing backfill/parity tooling from the Phase A/B/C work) is a backstop that reconciles `members`/`customRoles` the same way `users` is reconciled.

### 3.5 Browser-safe composites are DTOs, not raw docs (HIGH — both reviewers)

The existing composite bundles are **deliberately service-only**. `convex/projectEquipment.bundle` carries an explicit comment *"Do NOT relax to `requireOrgRead` (would expose units to user tokens)"* and returns raw `projectLineItemUnits` + full asset rows (`convex/projectEquipment.ts:21,57`). Convex's only redaction mechanism today, `redactFields` (`convex/lib/auth.ts:69`), is **shallow** and applied **only** by the generated CRUD layer (which redacts just `crewMembers.icalToken`, `scripts/generate-convex-crud.cjs:87`) — composite queries bypass it entirely.

**Rule:** every browser-facing composite is a **NEW** query returning **DTOs with an explicit per-entity field allowlist**, never raw Convex docs. The service bundles stay service-only and untouched. Each browser composite ships with a test asserting sensitive/service-only fields (unit internals, tokens, costs not meant for the role) are absent. This is design + per-entity allowlist work, **not** a one-line guard swap — the single biggest under-scoped item in the first draft.

### 3.5.1 Execution progress — Phases 1–2 (2026-06-28)

Phase 0/1 landed earlier (PRs #297–304: client plumbing, isomorphic RBAC core
`convex/lib/permissionsCore.ts`, `requireOrgPermission` + members/customRoles
mirror, convex-test harness, `projectDetail.bundle`, `projectEquipment.browserBundle`,
the client-safe `project-equipment-reconstruct.ts`, and the flag-gated native
`useProjectDetail`). Phase 2 continued:

- **`equipmentTab.bundle` referenced-only** (#310, merged): models/suppliers/categories
  point-read by referenced ids, never whole-org `.collect()` (mirrors the assets/bulks/kits
  fix).
- **`overbooking-core.ts`** (#311, merged): the overbooked math extracted client-safe —
  `computeStockBreakdown`, `projectMatchesWindow`, `indexProjectsById`,
  `sumBookingsByModel`, `reconstructOverbookedStatus`, `relevantOverbookModelIds`.
  `availability.ts`/`availability-read.ts` re-export them; `computeOverbookedStatus`
  is now a thin IO wrapper delegating to the core. This is the shared foundation for
  every overbooked view.
- **Project-detail finished** (#312, merged): `enrichProjectDetailOverbooked` ports the
  overbooked-flag enrichment (the documented gap) — applies the map onto top-level line
  items + one child level exactly as `getProject`, passing the SAME nested array to
  `reconstructOverbookedStatus` so the kit-children-nested quirk is preserved. Also fixed
  the native loading flash: `useNativeProjectDetail` returns `notFound`, and
  `use-project-detail` holds `isLoading` true while the orgId source (`useProject`) is
  still resolving (was flashing "Project not found" during auth resolution). Ready to flip
  `NEXT_PUBLIC_NATIVE_PROJECT_DETAIL` live.
- **Equipment editing tab native cutover** (#313, open): `equipment-tab-reconstruct.ts`
  reconstructs all six views (getProjectCategories tree + mixedGroups slot ordering,
  uncat items/sub-hire-groups/project-groups, overbooked via the core, getSubHires slice)
  from one `equipmentTab.bundle` subscription; `useNativeEquipmentTab` + `equipment-tab.tsx`
  select native vs the six server resources behind `NEXT_PUBLIC_NATIVE_EQUIPMENT` (default
  off; build-arg plumbed). Writes stay server actions (their `convex.mutation` pushes the
  reactive delta — the `useProjectEquipmentLiveSync` doorbell is retired on this path).

**Pattern established for the remaining Phase-2 surfaces** (warehouse/kit/asset/finance):
referenced-only browser composite → client-safe pure reconstruction module (zero server
imports; reuse the attach/tree helpers; unit-test parity) → `useNative*` hook + flag-gated
consumer select → CI `next build` verifies client-safety → user flips the flag + verifies live.

**Phase 2 COMPLETE (2026-06-29).** All detail surfaces migrated, each flag-gated default-off:
- **Warehouse** (#314): `warehouseDetail.bundle` + `warehouse-detail-reconstruct.ts` — reproduces
  `buildWarehouseLineItems` (FLAT EQUIPMENT tree w/ units, model/kit check-item counts, asset on
  lines AND units). Write-dep audit passed (`warehouseOps` mutations patch units in Convex →
  reactive). `NEXT_PUBLIC_NATIVE_WAREHOUSE`.
- **Kit** (#315): `kitDetail.bundle` + `kit-detail-reconstruct.ts` — **thin DTOs** (page reads a
  small subset of each sub-entity, traced; `maintenanceRecords` omitted-unused). `NEXT_PUBLIC_NATIVE_KIT`.
- **Asset** (#316): `assetDetail.bundle` + `asset-detail-reconstruct.ts` — the largest (~14 sub-entities),
  thin DTOs incl. the `AssetAccessoriesManager` shapes; `scanLogs` omitted-unused; serialized assets
  only (bulk path untouched). `NEXT_PUBLIC_NATIVE_ASSET`. Adversarial review caught + fixed a dropped
  `childBulkItems.allocationMode` badge field.
- **Finance / other project tabs:** the Financials tab's `FinancialSummary` reads `project.*` +
  `project.categories` straight off the native project-detail composite — already covered by
  `NEXT_PUBLIC_NATIVE_PROJECT_DETAIL`. `ProjectCostsPanel` + the services/tasks/notes/files sub-panels
  have their own smaller reads (minor, deferred — not core detail composites).

**Thin-DTO refinement to the pattern:** trace the consumer's actual field usage (Explore subagent),
produce only those fields, and cast `native → typeof scServer` in the page so existing typed access
compiles. Far less work than porting full Prisma mappers, and safe because the cast bridges types
while the consumed fields are produced at runtime. Adversarially review the trimmed reconstructions —
a missed consumed field is a silent runtime gap the type system won't catch under the cast.

Five flags now plumbed (Dockerfile ARG/ENV + build-image.yml build-arg):
`NEXT_PUBLIC_NATIVE_{PROJECT_DETAIL, EQUIPMENT, WAREHOUSE, KIT, ASSET}` — set the matching GitHub repo
variable to `true` + rebuild to flip each live (project-detail also needs the members backfill on prod).

**Phase 3 CORE COMPLETE (2026-06-29)** — the §3.6 counter mini-design + native dashboard stats:
- **#318 (merged):** `dashboardCounters` table + `convex/dashboardCounters.ts` (`computeCounters`,
  `reconcile`, **`reconcileIfStale`**, `bump`, `getByOrg`) + `dashboardStats.bundle` + backfill +
  convex-test parity. The native stats tile reads the six counters O(1) + computes the two date-derived
  metrics (`maintenanceDue`, `overdueReturns`) at read from bounded indexed queries. Behind
  `NEXT_PUBLIC_NATIVE_DASHBOARD`.
- **#319:** native sub-hire stats tile (`dashboardSubHire.bundle` — bounded, no counter).
- **Maintenance mechanism — reconcile-on-view, NOT per-write bumps:** the counted dimensions change
  across many writes incl. the GENERATED asset CRUD (can't hand-edit) and ~a dozen asset-status
  transitions in `warehouseOps`, so atomic per-write bumps would be invasive + fragile. Instead the
  dashboard hook fires `reconcileIfStale` on view, throttled to ≤ once/`maxAge` per org — O(1) on the
  hot read path, zero write-site risk, fresh-enough for a stats overview. `bump` is kept for a future
  targeted hook. Reconcile reads are bounded per-org (pagination is future hardening for huge tenants).
- **The remaining 4 reads — now native too (#320):** `getUpcomingProjects` / `getMyHomeData` /
  `getMyBlockingComments` → `convex/dashboardLists.ts` (`upcoming` / `home` / `blocking`); the user
  identity for `home`/`blocking` comes from `getAuthContext(ctx)` inside the query. `getRecentActivity`
  → `convex/dashboardActivity.bundle`: scan logs + test records bounded to the newest 10 via org+time
  composite indexes (`assetScanLogs.by_organizationId_scannedAt` added; `testTagRecords` already had
  `by_organizationId_testDate`), user names off the `users` mirror. **All 6 dashboard reads are native
  — Phase 3 complete.** (Convex queries can't return `Date` objects; dates stay epoch-ms and the
  consumers wrap with `new Date()`.)

To flip `NEXT_PUBLIC_NATIVE_DASHBOARD`: run `pnpm convex:backfill:dashboard-counters` on prod first.

### 3.6 Dashboard counters are a mini-domain, not a sub-bullet (review point 4)

`getDashboardStats` derives counts across **seven domains** — assets, bulk assets, projects, maintenance records, project line items, crew members, crew assignments (`src/server/dashboard.ts:29-66`) — today by whole-org `.collect()` + JS counting. A native reactive port cannot `.collect().length` (Convex has no count operator and would hit the 32k-doc/16 MiB limits on a large tenant), so the counts must come from **maintained denormalized counter tables**. That is a write-path obligation, not a read swap, and needs its own scoped design before Phase 3 starts:

- **Counter table schema** (e.g. `dashboardCounters` keyed by `organizationId` + metric, or per-domain rollup rows).
- **Which writes bump which counters** — every mutation that changes a counted dimension must update the counter in the same transaction: asset create/delete/status-change (total + checked-out + utilization), bulk-asset quantity/status, project create/status/date-change (active + overdue), maintenance create/resolve (due), crew member + assignment writes.
- **Status/date-derived counts** (active vs overdue projects, overdue returns) — define exactly when a row transitions a counter; date-based "overdue" may need a scheduled re-evaluation (Phase 6 cron) since nothing *writes* at the moment a date passes.
- **Backfill script** (compute initial counters from current data) and a **parity/reconcile script** (recompute from source, compare, alert on drift).
- **Tests** proving counter values equal the current JS-derived values for a fixture org.

Until this design exists, dashboard stats stay on the server-action read — do not half-migrate them.

---

## 4. Phased, incremental migration plan

Each phase is independently shippable and reversible. **Phases 0–4 = the read migration** (the core commitment; reads convert page-by-page, legacy read layer deleted last). **Phases 5–7 = the full "Convex baked in" arc** (native writes + atomic audit, background jobs, search). The boundary matters: you get the reactive, near-instant app from Phases 0–4 alone; Phases 5–7 are what make Convex *foundational* rather than a fast read cache. **Auth stays in Postgres** (Tier E is out of scope — see end of §4).

### Phase 0 — Native client plumbing (no surface changes)
**Goal:** the app can run native `useQuery` with the user's auth, cached, alongside everything that exists.
- **The authed browser client already exists — reuse it.** `ConvexProviderWithAuth` is wired in `src/components/providers/convex-provider.tsx` with a retry-hardened token fetch (`fetchConvexAccessToken`: 3 attempts, 150ms backoff, only de-auths on real 401/403, never on transient 5xx — a subtle correctness win already solved). `useAuthedQuery` is built on it (collaboration uses it). Verify, don't rebuild.
- **Net-new — be precise (review point 3):** `convex-helpers` is **not in `package.json`** today, and the provider **alone does NOT make ordinary `convex/react` `useQuery` cached.** Concretely:
  - Install `convex-helpers`; verify the exact import path against TypeScript (likely `convex-helpers/react/cache`) rather than guessing.
  - Wrap the app in `ConvexQueryCacheProvider` inside the existing Convex provider tree (inside `GlobalErrorBoundary`, per CLAUDE.md layout rule).
  - **Use the cached replacement hooks** (`useQuery`/`useQueries` from the cache package) on migrated surfaces that need keep-alive caching — NOT the default `convex/react` hooks, which the provider doesn't touch.
  - **Preserve the auth gating from `useAuthedQuery`** — queries stay skipped until `useConvexAuth().isAuthenticated`, so we don't reintroduce the "query before token attaches" crash class the codebase already solved.
  - Configure a bounded TTL / entry count if the library supports it; do NOT assume a one-shot `convexClient.query()` warms this cache.
  - **`preloadQuery`/`usePreloadedQuery` (SSR) stays OUT of the core migration** unless a separate auth-reviewed design mints a **per-request USER JWT** for the preload. The service token must never be used for SSR preload — it bypasses per-user read scoping (would render another user's/role's data server-side). `usePaginatedQuery` is also net-new but lower-risk.
- Make `permissions.ts` isomorphic (§3.3.1). Pure relocation (verified import-free); unit tests move with it.
- **Ship/reversible:** additive only; nothing reads through it yet. Revert = remove provider.
- **Effort:** ~1–2 days.

### Phase 1 — De-risking spike: project detail, end-to-end native reads + in-Convex RBAC
**Goal:** prove the whole stack on one hot, complex page. Split into ordered sub-deliverables (the first draft's single 3–5d estimate was too coarse — both reviewers):
- **1a — Write-dependency audit.** Confirm every table the equipment composite reads is written to Convex synchronously (verified: line-items/groups/categories/sub-hires/warehouse/assets are awaited Convex mutations). Carve out anything Postgres-only.
- **1b — RBAC mirror + revocation tests.** Mirror `members` + `customRoles` using the **write-ordering contract (§3.3.4)**, not just "best-effort"; add the `by_org_user` compound index **as a schema migration** (`members` today has only `by_organizationId` + `by_userId`); backfill (reuse `scripts/convex-backfill-*.ts`). Add the corrected `requireOrgPermission` guard.
  - **Mechanical write-site audit gate (not a prose reminder).** Membership/custom-role writes are scattered across **8+ files** — verified by grep, more than the first draft listed:
    ```bash
    rg "prisma\.(member|customRole)\.(create|update|delete)|tx\.(member|customRole)\.(create|update|delete)" src
    ```
    Confirmed hits: `src/server/org-members.ts`, `custom-roles.ts`, `settings.ts`, `site-admin.ts`, `user-profile.ts` (leave-org), `sso.ts`, `src/lib/sso-provisioning.ts`, `src/lib/auth.ts` (auto-create member on registration). **Every hit must be** routed through the mirror helper, explicitly annotated non-auth-affecting, or covered by a separate migration path. Add a lint-style test running this grep so a future membership write can't silently bypass the mirror.
  - **Parity tests are the gate:** for a matrix of roles (owner/manager/member/warehouse/viewer + a custom role; no `staff` — it's legacy) assert identical allow/deny in Convex vs the server action, plus "removed member's existing subscription stops authorizing immediately," "custom-role permission removal takes effect immediately," and a **restrictive-ordering test** proving a failed mirror write never leaves Convex over-granting.
- **1c — Browser-safe equipment composite (DTO).** New `api.projectEquipment.browserBundle` returning allowlisted fields only (§3.5); leave the service bundle untouched; port the pure tree/count composition (`line-item-count-read.ts` is already pure; `project-line-item-read.ts` tree builder needs porting) into `ctx`-helpers. Field-absence tests for unit internals.
- **1d — UI cutover.** Convert `equipment-tab.tsx` reads to native `useQuery` + `usePaginatedQuery` (required for long line-item lists, not optional — §6 limits). **Leave all writes on server actions.** Delete this page's version-vector usage + its 6 shared resources + live-sync doorbell.
- **Verify:** edit from a second tab/user → live update with no refetch; back-nav is instant; the RBAC parity matrix passes. (Use a genuinely-denied pair for the deny assertion — e.g. **viewer vs `asset:create`** or `project:manage_line_items`; viewer DOES have `project:read`, `src/lib/permissions.ts:329`, so "viewer denied project:read" is wrong.)
- **Ship/reversible:** one page; feature-flag the tab's data source for instant rollback to the server-action path.
- **Effort:** ~5–7 days (this is the spike; 1b+1c carry most of the reusable scaffolding + the real risk).

### Phase 2 — Roll out remaining detail surfaces
Ordered by traffic and by how much version-vector machinery they retire: **warehouse detail → kit detail → asset detail → project finance/other tabs.** Each: build/extend the composite query with `requireOrgPermission`, convert reads to `useQuery`, delete that surface's version vector (`convex/warehouseDetail.ts`, `convex/kitDetail.ts`, `convex/assetDetail.ts` `version`/`listVersion` exports) once no consumer remains.
- **Ship/reversible:** per surface, behind the same flag pattern.
- **Effort:** ~1.5–3 days per surface.

### Phase 3 — Dashboard + list/aggregate surfaces
Convert the **6** dashboard `useServerQuery` reads (`src/app/(app)/dashboard/page.tsx:61-66`) — `getDashboardStats`, `getUpcomingProjects`, `getRecentActivity`, `getSubHireDashboardStats`, `getMyHomeData`, `getMyBlockingComments`. (Distinct count: 6 page-level reads; **`getDashboardStats` *internally* fans out to 7 Convex reads** — keep the two numbers separate.) **This is the highest Convex-limit risk in the whole migration:** `getDashboardStats` reads **whole-org collections** (`getAssetsByOrg`, `getBulkAssetsByOrg`, `getProjectsByOrg`, `getLineItemsByOrg`, …) and counts in JS (`src/server/dashboard.ts:29-66`). A naive native port `.collect()`s every line item + asset in the org into one query — squarely into the 32k-doc / 16 MiB / 1s wall for a large tenant. Dashboard counts must come from **maintained counter tables**, not a `.collect().length` composite (guidelines `:245-246`) — and **that is its own mini-design (§3.6), not a sub-bullet.**
- **Carve-out correction:** the dashboard **recent activity** tile is not the same as the Postgres `activityLog`. `getRecentActivity` currently reads Convex scan/test-tag/maintenance data, then attaches Prisma user names (`src/server/dashboard.ts:196-274`). It can migrate natively if the user-name joins are served from the Convex `users` mirror and the DTO remains field-allowlisted. The **separate activity-log pages/export** (`src/server/activity-log.ts`) remain Postgres-only and are not migratable to reactive native reads until audit moves into Convex (Phase 5c).
- Counts/badges with **no liveness need** can stay `useServerQuery` or become cheap `useQuery` — decide per datum.
- **Effort:** ~1–2 weeks (the counter mini-design + its write-path wiring is the cost, not the read swap).

### Phase 4 — Delete the legacy read layer (only what's actually dead)
Delete per-consumer, only after grep proves zero remaining importers — **not** the whole file wholesale. Specifically:
- `use-reactive-server-query.ts` + the `convex/*Detail.ts` `version`/`listVersion` exports: delete once every detail surface is migrated.
- **`use-shared-resource.ts` — narrow the claim (review point 5).** It's used well beyond equipment: SSO settings/providers, group/service templates, custom roles, org members, organization/profile/platform-name, and project detail/services/crew/conflicts. **Several are Prisma/auth-adjacent and will NOT become native Convex reads during Phases 0–4.** Delete only the dead detail/equipment-specific consumers after grep; **keep `use-shared-resource.ts` itself until every remaining Prisma-backed consumer has a replacement.**
- `use-server-query.ts`: delete only if fully retired (some no-liveness badges may legitimately keep it).
- `serialize()` calls + dead `src/lib/*-read.ts` helpers: remove per now-dead path.
- **Ship/reversible:** pure deletion after consumers are gone; revert = restore files.
- **Effort:** ~1–2 days (spread across phases as consumers retire, not one big-bang delete).

> **Phases 0–4 are the read migration (the core commitment). Phases 5–7 below are the "Convex baked in, not bolted on" arc** — they make Convex own the full transaction (write + rule + audit), the background jobs, and search. They are sequenced AFTER reads deliberately: writes are where data integrity lives, so we prove the reactive model on the lower-risk read path first, then move writes domain-by-domain. Tiers A–D approved by the user (2026-06-28); Tier E (auth into Convex) explicitly excluded.

### Phase 5 — Native writes + audit-in-Convex + invariants-in-mutations (Tiers A+B)
**Goal:** Convex owns the whole write transaction — the mutation, the permission check, the business invariants, AND the audit entry — atomically. This is the jump from "Convex is a store I write to" to "Convex is the domain layer."
Per domain (assets → line-items → kits → projects → crew → …), one domain per shippable slice:
- **5a — RBAC into the mutation.** Extend `requireOrgPermission` to mutations; the Convex mutation enforces the same resource/action check the server action did (`src/lib/org-context.ts:88`). Today mutations only `requireService` and trust the caller (`convex/assets.ts:130-133`) — this closes that.
- **5b — Invariants/validation into the mutation (Tier B).** Move the domain rules that today live in server actions + `src/lib/validations/` into the Convex mutation so they're transactional and **cannot be bypassed** by any caller. (Zod schemas stay as the client-form contract; the mutation re-checks the invariants server-side — defence in depth, not duplication of UI validation.)
- **5c — Audit into the same mutation.** Write the audit entry to Convex `activityLogs` (table exists, `convex/schema.ts:1346`, currently zero writers) **inside the same mutation transaction** as the data write. Today `logActivity` is a separate Postgres write that can drift (`src/lib/activity-log.ts:20-32`); folding it into the mutation makes data+audit atomic. **This unblocks the dedicated activity-log screens/export as reactive native reads** (`src/server/activity-log.ts`). The dashboard `getRecentActivity` tile is a different mixed timeline and can migrate earlier if its user-name joins use the Convex `users` mirror.
- **5d — Native optimistic write on the client.** Swap the server-action call for `useMutation(api.x.create).withOptimisticUpdate(...)` so the edit lands in the UI instantly, rolls back on failure, and reconciles to the server result. Follow the optimistic-update pitfalls (§Appendix: never mutate `localStore`, treat client ids as throwaway, match server sort order for paginated inserts).
- **Migrate the Postgres-only write paths flagged in §1/§3** (`org-members.ts`, `custom-roles.ts`, `org-calendar.ts`) into Convex here too — that retires the mirror's fail-closed complexity (once membership/roles are written natively in Convex, there's no Prisma→Convex mirror to keep in sync).
- **Ship/reversible:** per domain, behind a write-path flag (server-action write vs native mutation). Each domain independently revertible.
- **Risk:** **High** — writes are where data corruption happens. Gate each domain on a write-parity test (same inputs → same resulting Convex state + same audit entry, native vs server action) before flipping the flag.
- **Effort:** ~4–6 weeks across all domains, incremental.

### Phase 5 execution plan (2026-07-01) — de-risked implementation notes

Grounded in the current code (`src/server/assets.ts`, `convex/assets.ts`,
`convex/lib/auth.ts`, `src/lib/activity-log.ts`). Read before touching writes.

**★ The load-bearing safety constraint: 5a+5b+5c must land TOGETHER per mutation.**
Convex `query`/`mutation` are PUBLIC — any authenticated user token can call them.
Today asset mutations `requireService(ctx)`, which rejects every user token, so the
server action (service token) is the only caller and its `requirePermission` +
dup-guard + custom-field validation + `logActivity` are unbypassable. The moment you
relax `requireService` → `requireOrgPermission` to enable native writes, a user with
`asset:create` can call `api.assets.create` **directly from the browser**, bypassing
every invariant + the audit row. Therefore you can NEVER ship 5a alone. The minimum
safe unit is: relax the guard **and** move the invariants (5b) **and** write the audit
row (5c) into that mutation, in one change. (`requireOrgPermission` still early-returns
for the service token, so the existing server-action path keeps working unchanged.)

**Recommended shape — additive NEW native mutations, not in-place relaxation.** Keep
the generated service mutations (`api.assets.create` etc.) exactly as they are (live
server-action path untouched, zero risk). Add NEW mutations (e.g.
`convex/assets.ts` `createNative` / `updateNative` / `removeNative`, or a `convex/
assetWrites.ts` module) that enforce `requireOrgPermission` + invariants + audit, and
are called ONLY by the flag'd client path. This isolates all risk behind the flag and
gives a trivial rollback (don't call them).

**Widen the guard (safe, do first):** `requireOrgPermission(ctx: QueryCtx | MutationCtx, …)`
— it only uses `ctx.auth` + `ctx.db.query`, both present on `MutationCtx`. Pure type
widening, no behaviour change. Add a convex-test that a mutation ctx enforces the same
role matrix (mirror `convex/rbac.test.ts`).

**Audit-in-mutation (5c) — the actor problem.** `activityLogs` (schema `convex/
schema.ts:1350`, ZERO writers today) needs `userId` + `userName`. A **service-token**
call carries no user identity; a **user-token** native call does (`getAuthContext(ctx)
→ {userId}`), but not the display name. Resolution: the mutation takes an explicit
`actor: { userId, userName }` arg. The server-action path passes the actor it already
has (from `getOrgContext`); the native client path passes the current user (or the
mutation derives `userId` from `getAuthContext` and looks `userName` up in the `users`
mirror). Write the row with `ctx.db.insert("activityLogs", …)` **in the same mutation**
so data+audit are atomic (fixes today's drift where `logActivity` is a separate Postgres
write that silently swallows failures, `activity-log.ts:29`). Add a shared helper
`convex/lib/audit.ts writeActivityLog(ctx, entry)`.

**Convex determinism caveats for the audit/id/timestamp:** `Date.now()` IS allowed in
mutations (unlike queries), but `Math.random()`/`crypto`-based `createId()` (cuid2) is
NOT deterministic — generate the activityLog `id` in the caller and pass it as an arg
(the server action already does this pattern for asset ids), OR use the Convex doc
`_id`. Match Prisma's `activityLog` id shape (cuid string) for parity if the audit
screens later read both stores during the transition.

**Per-mutation invariant port (5b) — asset specifics:** `createAsset` needs the
dup-tag guard (`getAssetByAssetTag` → in-mutation `by_assetTag` index lookup),
`resolveAssetCustomFields` (reads active ASSET custom-field defs — port to a ctx
helper), and the test&tag auto-register side-effect (defer to Phase 6 `ctx.scheduler`,
or replicate the `testTagAssets.createIfMissing` call in-mutation). `updateAsset` needs
the dup-guard only when the tag changes. `deleteAsset` needs the orphan guards (no line
items / not in a kit / no children) + the T&T retire. These are the real work; write a
convex-test per invariant.

**5d optimistic:** only after 5a–5c land + parity passes. `useMutation(api.assetWrites.
createNative).withOptimisticUpdate(...)`. Never mutate `localStore`; client ids are
throwaway; guard on "query loaded"; match the `assets.list` sort for inserts.

**recalculateProjectTotals (money — line-items domain only, NOT assets):** decide when
you reach line-items. Option (a) internal Convex mutation via `ctx.scheduler.runAfter(0,
…)` after the write (atomic-ish, fully native); option (b) keep server-side, client
fires it after the optimistic write. Whichever — gate on a totals parity test before
flipping the flag. Assets have no recalc, which is why assets is the right pattern-prover.

**Write-parity gate (per domain, before flipping any flag):** same inputs → identical
resulting Convex state + identical audit entry, native mutation vs server action. Build
it as a convex-test that runs both paths against the same in-memory backend and diffs
the resulting docs + the `activityLogs` row.

**Also in Phase 5 (retires mirror complexity):** migrate the Postgres-only membership/
customRole/org-calendar writes into Convex; then flip the `members`/`customRoles` guard
reads from fail-closed-mirror to authoritative (no more Prisma→Convex mirror to sync).

**Sequence:** assets (pattern-prover) → line-items (money, recalc decision) → kits →
projects → crew. One domain per PR, per-domain `NEXT_PUBLIC_NATIVE_*_WRITES` flag.

### Phase 6 — Convex background jobs & side-effects (Tier C)
**Goal:** stop using Next.js as the scheduler/glue for things Convex does natively.
- **Scheduled work → Convex crons** (`convex/crons.ts`): overdue-return checks, maintenance reminders, sub-hire due dates, anything currently on an external/Next cron. Durable, transactional, observable in the Convex dashboard.
- **Post-write side-effects → Convex actions via `ctx.scheduler.runAfter(0, ...)`:** email (Resend), notifications, webhook fan-out. The mutation commits, then schedules the action — so the side-effect can't fire on a rolled-back write. (Actions run in the Node runtime for external I/O; keep them thin, call back into mutations for DB writes.)
- **Reuse:** the existing mirror/scheduler patterns from the Phase A/B/C work.
- **Ship/reversible:** per job; the old Next.js path stays until the Convex one is verified.
- **Risk:** Low–Med (mostly mechanical; watch action idempotency on retries).
- **Effort:** ~1–2 weeks.

### Phase 7 — Native search (Tier D)
**Goal:** reactive, indexed search instead of JS filtering / `.collect()` + filter.
- Add Convex **search indexes** (`searchIndex` in `convex/schema.ts`) for the hot lookups: asset tag/serial search, project name, kit name, client name. Replace the in-JS filtering currently behind asset/project pickers with `withSearchIndex` queries.
- Results become **live** (a new matching row appears without a refetch) and stay within Convex limits (no whole-table `.collect()`).
- **Ship/reversible:** per search surface; additive index, old path stays until cutover.
- **Risk:** Low.
- **Effort:** ~3–5 days (depends how many search surfaces exist).

### NOT in scope — Tier E (auth into Convex)
Running Better Auth *inside* Convex via `@convex-dev/better-auth` (to remove Postgres entirely) is **explicitly out of scope** (user decision, 2026-06-28). The component is early-alpha with a history of breaking migrations (0.8→0.12); adopting it would trade a working, deployed, secure auth system for a pre-1.0 dependency, with a single front-door cutover (no per-surface rollback). **Auth stays in Postgres + Better Auth.**

This costs you nothing on the "baked in" goal: after Phases 5–7, Convex owns reads, writes, business rules, audit, background jobs, and search. Auth-in-Postgres behind the existing JWT bridge is a clean, defensible boundary that mature Convex apps run in production — not the thing that makes Convex feel bolted-on. If the component reaches a stable 1.0 and the team wants a single backend later, revisit it then as its own initiative.

---

## 5. Reused / Rewritten / Deleted

| Asset | Disposition | Notes |
|---|---|---|
| Convex domain schema (96 tables) | **REUSE** | Sound; no changes. Add `members`, `customRoles` mirror tables + indexes. |
| Convex mutations (`requireService`) | **REUSE (P0–4) → EXTEND (P5)** | Untouched for the read migration. Phase 5 adds `requireOrgPermission` + invariants + atomic audit so they become the domain layer. |
| Bundle queries (`projectEquipment`, `overbooking`, `availabilityCheck`) | **TEMPLATE, not reuse** | Service-only by design (expose units/raw docs). Keep them service-only; build NEW browser-safe DTO composites alongside (§3.5), reusing their composition logic — not exposing them directly. |
| `ConvexProviderWithAuth` + `fetchConvexAccessToken` (`src/components/providers/convex-provider.tsx`) | **REUSE** | Authed browser client + retry-hardened token fetch already built. |
| User mirror (`user-mirror.ts` + `convex/users.ts`) | **REUSE as template** | Pattern for the new members/customRoles mirror. |
| Auth bridge (`auth.config.ts`, `convex/lib/auth.ts`) | **REUSE / EXTEND** | Add `requireOrgPermission`. Org-scoping + service model unchanged. |
| `permissions.ts` (`hasPermission`, role map) | **RELOCATE** | Into isomorphic core importable by `convex/`. No logic change. |
| Pure composition helpers (`line-item-count-read.ts`, asset predicates) | **PORT** | Move into `ctx`-passing Convex helpers. |
| Impure read helpers (`project-line-item-read.ts` tree builder) | **REWRITE** | Reimplement as Convex composite-query helpers. |
| Server-action writes + `requirePermission` + `logActivity` | **KEEP (P0–4) → REWRITE (P5)** | Preserved through the read migration. Phase 5 moves them into native Convex mutations (RBAC + invariants + atomic audit); `logActivity`→Convex `activityLogs`. |
| `logActivity` / Postgres `activityLog` | **KEEP (P0–4) → MIGRATE (P5c)** | Audit moves into the Convex mutation transaction; unblocks the dedicated activity-log screens/export as reactive native reads. |
| External crons + Next.js side-effect glue (email, notifications) | **REWRITE (P6)** | → Convex `crons.ts` + actions via `ctx.scheduler`. |
| JS/Postgres-filter search behind pickers | **REWRITE (P7)** | → Convex `searchIndex` + `withSearchIndex` (live results). |
| Better Auth + Postgres auth tables + JWT bridge | **KEEP** | Auth stays in Postgres. Tier E (auth into Convex) is out of scope — the clean auth/domain boundary is not what makes Convex feel bolted-on. |
| `use-reactive-server-query.ts` | **DELETE** (Phase 4) | Replaced by native `useQuery`. |
| `use-shared-resource.ts` | **PARTIAL DELETE / KEEP UNTIL LAST CONSUMER** (Phase 4+) | Delete dead equipment/detail consumers as they migrate. Keep the helper itself while Prisma/auth-adjacent consumers remain (SSO, org members, custom roles, profile/org/platform-name, etc.). |
| Version-vector queries (`*Detail.ts` `version`) | **DELETE** (per surface) | Native subscription is the doorbell. |
| `serialize()` on read paths | **DELETE** (per path) | Convex returns plain values to `useQuery`. |

---

## 6. Risks, rollback, effort

| Risk | Likelihood | Mitigation |
|---|---|---|
| **★ RBAC parity correctness at the Convex boundary** (the single highest-risk item — both reviewers) — the guard, the index, the JSON parse, `.first()` vs `.unique()`, org-scoped custom-role lookup, AND browser composites leaking service-only fields | High likelihood if rushed / High impact | Corrected guard sketch (§3.3.3); browser DTOs with allowlists (§3.5); the Phase 1b parity matrix + field-absence tests are the **gate before any rollout** — the first-draft sketch would have failed them on day one. |
| **Mirror is fail-OPEN on revocation** — revoked/demoted member keeps reading if the mirror write silently failed | Med / High impact | Revocation/demotion/permission-removal mirror writes **fail closed** (§3.3.2/§3.3.4); cover all scattered write sites found by the mechanical grep (`org-members.ts`, `custom-roles.ts`, `settings.ts`, `site-admin.ts`, `user-profile.ts`, `sso.ts`, `sso-provisioning.ts`, `auth.ts`, plus invitation/org-import paths if present); guard re-reads the mirrored row not the JWT claim; nightly reconcile is a backstop only. |
| **Non-Convex writes break reactivity silently** — a migrated page reads a Postgres-only table | Med | Per-surface write-dependency audit (Phase 1a) is mandatory before each surface; membership/customRole/org-calendar/activityLog are known Postgres-only. |
| **Composite exceeds Convex limits** (32k docs / 16 MiB / 1s) — worst on the **dashboard whole-org aggregates**, not the detail pages | Med (High on dashboard) | Counter tables for dashboard stats (not `.collect().length`); keep composites page-sized; `usePaginatedQuery` for long lists; index don't `.filter`. |
| **Re-render storms** on large subscribed lists | Med | Paginate; split high-churn fields into own tables (guidelines `:159-160`); `React.memo` rows by `_id`. |
| **Double-fetch** (SSR + client subscription) | Low | Accept SSR→hydrate/client subscription for the read migration. Do **not** use `preloadQuery`/`usePreloadedQuery` until a separate auth-reviewed design mints a per-request user JWT; the service token would bypass per-user scoping. |
| **Query-cache bandwidth** (subscriptions survive unmount) | Low | Bounded by cache expiry; it's a UX/cost tradeoff, monitor. |
| **Token refresh on WebSocket client** | Low | Verify `ConvexProviderWithAuth` refresh in Phase 0; already exercised by `useAuthedQuery`. |
| **Write corruption during Phase 5 (Tiers A+B)** — native mutations diverge from server-action behaviour (missed invariant, wrong audit) | Med / High impact | Per-domain write-parity test (same inputs → same Convex state + same audit) gates each flag flip; one domain per slice; write-path flag for instant rollback. Writes are the higher-risk surface — this is why Phase 5 is sequenced after reads, not bundled in. |
| **Optimistic-update bugs** (Phase 5d) — UI shows a state the server rejects | Low–Med | Follow Convex's rules (never mutate `localStore`, client ids throwaway, match server sort order); rollback is automatic on mutation failure. |

**Rollback strategy:** every surface conversion sits behind a per-surface data-source flag; flipping it restores the server-action read path with zero schema/write changes. The mirror tables and `requireOrgPermission` are additive (writes and server actions ignore them), so they can ship and sit dormant. Phase 4 deletions are the only irreversible-ish step and happen only after every consumer is migrated.

**Total rough effort:**
- **Read migration (Phases 0–4): ~6–8 weeks** (Phase 0: 1–2d; Phase 1 spike: 5–7d; Phase 2: ~2–3 weeks across surfaces; Phase 3: ~1–2 weeks incl. the counter mini-design; Phase 4: 1–2d). The first draft's 3–5 weeks underweighted the RBAC mirror across scattered write sites, the browser-DTO redaction work, and the dashboard counter-table design — three reviewers flagged it as optimistic.
- **Baked-in arc (Phases 5–7): ~6–9 weeks more** (Phase 5 native writes+audit+invariants: 4–6 wk incremental; Phase 6 jobs/side-effects: 1–2 wk; Phase 7 search: 3–5d).
- **Grand total ~12–17 weeks** for the full Convex-native vision (Tiers A–D). Tier E (auth) excluded. The read migration delivers the reactive, near-instant app on its own at ~6–8 weeks; the rest is what makes Convex foundational.

---

## 7. Explicit "do NOT touch" list

**Do NOT touch at all (entire migration):**
- **Better Auth** (`src/lib/auth.ts`, sessions, org/jwt/sso/passkey plugins, Postgres auth tables) — auth stays in Postgres; Tier E is out of scope. The identity provider is correct and is the JWT source the bridge already trusts.
- **The Convex domain schema shape** (96 tables) — sound; changes are additive only (`members`/`customRoles` mirror tables in the read phase; `searchIndex`/counter tables later).

**Do NOT touch during the READ migration (Phases 0–4); deliberately changed later:**
- **Convex mutations** — untouched through Phase 4; Phase 5 extends them (RBAC + invariants + atomic audit).
- **The service-token write path** (`requireService`, `getConvexClient` service mint) — intact through Phase 4; Phase 5 adds user-token mutation auth alongside it.
- **`logActivity` / `activityLog`** — Prisma-backed through Phase 4; Phase 5c moves it into the Convex mutation.
- **`requirePermission` in server actions** — the write-path RBAC authority through Phase 4; Phase 5a moves enforcement into the mutation.

The rule: **nothing on the write side moves until the read migration has proven the reactive model.** Reads first (lower risk), then writes domain-by-domain.

---

## 8. Pre-Phase-1 implementation gate

Hard acceptance test before the Phase 1 UI cutover (1d) — all must pass:

- [ ] `requireOrgPermission` implemented, with parity tests against `requirePermission`/`hasPermission` across the role matrix (owner/manager/member/warehouse/viewer + a custom role).
- [ ] `members.by_org_user` compound index added (schema migration).
- [ ] All membership/custom-role write sites audited via the §3.3.4 grep; each is mirrored, annotated non-auth-affecting, or on a separate migration path; a lint-style test enforces it going forward.
- [ ] Restrictive mirror-write ordering (§3.3.4) implemented and tested — a failed mirror write never leaves Convex over-granting.
- [ ] Custom-role permission update/removal test proves active browser subscriptions stop authorizing immediately.
- [ ] Removed-member test proves an existing subscription stops authorizing.
- [ ] Browser DTO bundle tests prove service-only/raw fields (units, tokens) are absent.
- [ ] Convex Helpers cache usage compiles and uses the actual cached hook API (`convex-helpers/react/cache`), with auth gating preserved.
- [ ] Equipment native-read path sits behind a data-source flag for instant rollback.

---

## Appendix — Convex anti-patterns this codebase currently exhibits (and the fix)

| Anti-pattern (Convex docs/guidelines) | Where | Native fix |
|---|---|---|
| `ConvexHttpClient` per-request for everything, no subscriptions | all `src/server/*.ts` reads | `useQuery` subscriptions |
| Composing pure DB reads in a separate server tier | server actions | one Convex composite query with `ctx` helpers |
| `serialize()` on the way out | `src/lib/serialize.ts` consumers | Convex returns plain values |
| Refetch everything on navigation | no client cache | `ConvexQueryCacheProvider` |
| WebSocket subscription used only as an HTTP doorbell | `use-reactive-server-query.ts` | the subscription *is* the data |

Sources: [docs.convex.dev/understanding/best-practices], [docs.convex.dev/client/react/optimistic-updates], [stack.convex.dev/queries-that-scale], [stack.convex.dev/magic-caching], `convex/_generated/ai/guidelines.md`.

---

## Appendix — Dual-voice review hardening (2026-06-28)

This doc was reviewed adversarially by Codex and an independent Claude eng subagent, both reading the actual repo. They converged (high consensus) on the same code-verified findings, applied above:

- **Scoped the "reads-without-writes" thesis** — true for the equipment spike (Convex-native writes) but NOT for Postgres-only writes (membership/customRole/org-calendar/activityLog). Added the mandatory per-surface write-dependency audit (Phase 1a).
- **Made the RBAC mirror fail-closed on revocation** (was fail-open) and enumerated the scattered write sites.
- **Corrected the `requireOrgPermission` guard** — added the missing `by_org_user` compound index, `by_cuid` (not `by_id`), `JSON.parse` of custom-role permissions, `.first()` (not `.unique()`, matching Prisma's duplicate tolerance), and org-scoped custom-role lookup.
- **Browser composites must be DTOs with field allowlists** (§3.5) — the existing service bundles expose `projectLineItemUnits` and bypass `redactFields`; cannot be exposed as-is.
- **Flagged the dashboard whole-org aggregates** as the top Convex-limit risk → counter tables, not `.collect().length`; later corrected the activity-feed wording to distinguish dashboard `getRecentActivity` from the Postgres `activityLog` screens.
- **Fixed the wrong parity assertion** (viewer has `project:read`) and **raised the read-migration effort** beyond the first draft, now estimated at ~6–8 weeks.
- Confirmed reuse wins: `ConvexProviderWithAuth` + retry-hardened token fetch already exist; `permissions.ts` is import-free/pure.

### Third review pass — independent audit (2026-06-28)

A third independent reviewer (code-grounded) hardened the implementation details. All accepted:

- **Mirror write-ordering contract (§3.3.4)** — "fail-closed" needed concrete dual-write ordering (restrictive→Convex-first, additive→Prisma-first, `transferOwnership` special-cased). This closed the actual stale-permission read-leak hole; the single most valuable fix.
- **Expanded write-site audit to a mechanical grep gate (Phase 1b)** — grep confirmed **8** files write `member`/`customRole` (not the ~half first listed): `org-members`, `custom-roles`, `settings`, `site-admin`, `user-profile`, `sso`, `sso-provisioning`, `auth.ts`. Added a lint-style enforcement test.
- **Convex cache API made precise (Phase 0)** — `convex-helpers` isn't installed; the provider alone doesn't cache `convex/react` `useQuery`; must use the cache package's hooks + preserve auth gating; `preloadQuery` SSR kept out (service token would bypass per-user scoping).
- **Dashboard counters split into a mini-design (§3.6)** — counter schema, per-write update obligations, status/date transitions, backfill, reconcile, parity tests.
- **Narrowed Phase 4 deletion** — `use-shared-resource.ts` has broad Prisma/auth-adjacent usage; delete dead consumers only, keep the file until all migrate.
- **Corrected my own error:** dashboard is **6** page-level `useServerQuery` reads (`getDashboardStats` internally fans to 7) — the earlier dual-voice "6→7" correction was wrong; reverted. Effort nudged to ~6–8 wk (reads) / ~12–17 wk (full A–D).
- Added the reviewer's **pre-Phase-1 implementation gate (§8)** verbatim as the acceptance test.
