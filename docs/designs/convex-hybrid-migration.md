# Convex Hybrid Migration — GearFlow

**Design Doc** — Replace Prisma + PostgreSQL + React Query + SSE with self-hosted Convex as the data layer, keeping business logic in Next.js server actions.

**Author:** Vera
**Date:** 9 June 2026
**Effort:** ~3 months (Phases 1-5)

---

## 📖 Reference Docs

**Any Claude Code session working on this migration MUST read these before starting:**

| Doc | Why |
|-----|-----|
| `CODING.md` | **Best practices, conventions, gotchas.** Read this FIRST — it covers code style, naming, patterns, and everything Claude needs to generate code that fits GearFlow. |
| `CLAUDE.md` | Project-level instructions: git discipline, shadcn/ui rules, Prisma conventions, deploy pipeline. Never commit to main. |
| `ARCHITECTURE.md` | Feature doc registry — tells you what FEATUREDOCS/ covers for each subsystem. |
| `FEATUREDOCS/53-realtime-sync.md` | The current SSE + EventEmitter system being replaced. Understand what goes away. |
| `FEATUREDOCS/28-patterns.md` | Key code patterns, gotchas, and conventions used across the codebase. |
| `DESIGN.md` | Visual design system — only relevant for UI work (Phases 4+). |

If `CODING.md` doesn't exist yet, read `CLAUDE.md` + `FEATUREDOCS/28-patterns.md` instead — they contain the same conventions.

---

## The Why

GearFlow's current real-time sync (SSE + EventEmitter + React Query invalidation) is single-process and doesn't survive restarts. Convex's reactive database tracks query-to-document dependencies at the engine level — when data changes, every subscribed client gets the update instantly, with zero staleTime tuning, zero manual invalidation, zero "reload the container."

This plan keeps business logic (permissions, validation, activity logging, PDF generation) in Next.js server actions. Convex handles the data layer + real-time propagation. Thin CRUD stubs in Convex, fat business logic in server actions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Server                        │
│                                                          │
│  Server Action (permissions, validation, logging)        │
│    ↓ calls fetchMutation("projects:update") via HTTP     │
│    ↓ also writes to ActivityLog in PostgreSQL (existing) │
│                                                          │
│  Frontend (useQuery("projects:list")) ← auto-subsribes   │
│    via Convex WebSocket — data arrives INSTANTLY         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Self-Hosted Convex Backend                  │
│              (Docker: ghcr.io/get-convex/convex-backend) │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │  Thin CRUD       │  │  Convex Schema               │  │
│  │  Queries/Mutations│  │  (95 models → Convex tables) │  │
│  │  (5-10 lines ea)  │  │                              │  │
│  └────────┬────────┘  └──────────┬───────────────────┘  │
│           │                      │                       │
│           ▼                      ▼                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Convex Reactive Engine                            │  │
│  │  • Tracks query dependencies                       │  │
│  │  • Re-evaluates on data change                     │  │
│  │  • Pushes diffs via WebSocket                      │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                 │
│                         ▼                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │  PostgreSQL (via POSTGRES_URL env var)              │  │
│  │  • Convex manages its own schema within this DB     │  │
│  │  • Same PostgreSQL instance, different database     │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### What Stays in Next.js

| Component | Reason |
|-----------|--------|
| Permissions (`requirePermission`, 84 sites) | Server action layer, enforced before calling Convex |
| Activity log / audit trail (68 sites) | Still writes to `activityLog` table in PostgreSQL |
| Zod validation + React Hook Form | Frontend-only, no change |
| PDF generation (pdfme) | V8 sandbox can't run native modules |
| Discord bot | Standalone pm2 process, uses Prisma → eventual Convex client |
| WooCommerce webhooks | External → needs to call Convex mutations |
| Resend email notifications | Server action → Resend API, no Convex involvement |
| Google Maps integration | Frontend-only |
| Cron / scheduling | Convex has built-in scheduling — migrate over time |

---

## Migration Phases

### Phase 0: Infrastructure (1 week)

Deploy self-hosted Convex alongside existing GearFlow.

```
- Docker compose with backend + dashboard
- POSTGRES_URL pointing to a NEW database on the existing PostgreSQL instance
  (e.g. gearflow_convex — separate from gearflow which Prisma uses)
- S3 bucket config for file storage (reuse existing gearflow-uploads)
- DNS routing: convex-api.twotoned.com.au → backend:3210
- Dashboard: convex-dash.twotoned.com.au → dashboard:6791
- INSTANCE_SECRET + admin key generation
- Health checks: curl /version returns 200
```

**New infra file:** `docker-compose.convex.yml` in the repo root.

### Phase 1: Schema Conversion (2 weeks)

Convert all 95 Prisma models and 65 enums to Convex schema.

Each Prisma model becomes a `defineTable()` in `convex/schema.ts`. Each enum becomes a Convex `v.union(v.literal(...))`.

**Mapping rules:**
- `String @id @default(cuid())` → `v.id("tableName")` (Convex auto-generates IDs)
- `String @unique` → Convex index with `isUnique: true`
- `DateTime` → `v.number()` (Convex stores dates as Unix milliseconds)
- `Decimal` → `v.number()`
- `Json` → `v.any()`
- `Boolean @default(false)` → `v.optional(v.boolean())`
- `X[]` relations → Store foreign key as `v.id("X")`, query via index
- Relations (hasMany, belongsTo) → Convex doesn't have native joins. Store foreign key IDs. Query via indexes + collect pattern.
- Multi-field unique constraints → Convex compound indexes
- Partial indexes → Not directly supported. Filter in query handler.

**Model complexity:**
- Simple (string + number fields, no complex relations): ~50 models — straightforward conversion
- Medium (enums, optional fields, foreign keys): ~30 models — needs index planning
- Complex (polymorphic relations, composite keys, Json columns): ~15 models — needs custom query logic

**Strategy:**
- Group models into domains (Asset, Project, Org, Auth, etc.)
- Convert one domain at a time
- Each domain gets its own `convex/<domain>.ts` file with schema + queries + mutations

### Phase 2: Thin CRUD Functions (1 week)

Write ~80 thin Convex queries and mutations. These are 5-10 line stubs:

```typescript
// convex/projects.ts
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// ─── Queries ────────────────────────────────────────────────

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .filter((q) => q.eq(q.field("isTemplate"), false))
      .order("desc")
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ─── Mutations ──────────────────────────────────────────────

export const create = mutation({
  args: { orgId: v.string(), name: v.string(), /* ... full shape */ },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projects", args);
  },
});

export const update = mutation({
  args: { id: v.id("projects"), updates: v.object({ /* partial fields */ }) },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, args.updates);
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});
```

**Pattern by entity:**
- Each entity gets: `list`, `getById`, `create`, `update`, `remove`
- Complex entities (Project, Asset, Kit) may need additional: `search`, `count`, `listByStatus`
- Bulk operations get their own mutations (e.g. `bulkCreate`, `bulkUpdate`)
- Report-style queries (aggregations, rollups) stay as server actions that call Convex queries + post-process in Node.js

### Phase 3: Server Action Integration (3 weeks)

Modify all 86 "use server" files to call Convex mutations via `fetchMutation()` instead of Prisma.

```typescript
// src/server/projects.ts — BEFORE
import { prisma } from "@/lib/prisma";
export async function updateProject(formData: FormData) {
  "use server";
  await requirePermission("project", "update");
  const data = validatedSchema.parse(formData);
  const project = await prisma.project.update({ where: { id: data.id }, data });
  // events.emit() happens inside logActivity()
  return serialize(project);
}

// src/server/projects.ts — AFTER
import { fetchMutation } from "convex/nextjs";
export async function updateProject(formData: FormData) {
  "use server";
  await requirePermission("project", "update");
  const data = validatedSchema.parse(formData);
  const project = await fetchMutation("projects:update", {
    id: data.id,
    updates: data,
  });
  // Activity log still writes to PostgreSQL via Prisma (unchanged)
  return serialize(project);
}
```

**Key rules:**
- Server actions still validate, check permissions, log activity (as today)
- The `logActivity()` call stays — it still writes to the PostgreSQL `activityLog` table AND emits the pg_notify (for backward compat during migration)
- Server actions call Convex mutations via HTTP (`fetchMutation`/`fetchQuery` from `convex/nextjs`)
- The Convex `NEXT_PUBLIC_CONVEX_URL` env var points to the self-hosted backend
- `CONVEX_SELF_HOSTED_ADMIN_KEY` is used for auth (server-side admin key, not user-scoped)

### Phase 4: Frontend Rewrite (4 weeks)

Replace React Query `useQuery`/`useMutation` with Convex's `useQuery`/`useMutation` across 177 sites.

```tsx
// BEFORE — React Query
import { useQuery } from "@tanstack/react-query";
function ProjectDetail({ id }) {
  const { data } = useQuery({
    queryKey: ["project", orgId, id],
    queryFn: () => fetchProject(id),
    staleTime: 15000,
  });
  // ...
}

// AFTER — Convex
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
function ProjectDetail({ id }) {
  const data = useQuery(api.projects.getById, { id });
  // Auto-revalidates on every mutation. No staleTime.
  // ...
}
```

**Migration strategy:**
- Converts one domain/feature at a time
- Start with read-heavy pages (dashboard, project list, asset grid) — biggest real-time win
- Then write-heavy pages (project editor, warehouse, kits)
- Leave rarely-changing pages (settings, admin) for last
- During migration, both React Query and Convex hooks coexist — unused React Query hooks get removed incrementally

**Component hooks to create (convex/hooks/):**
- `useProjects(orgId)` → useQuery for projects list
- `useProject(id)` → useQuery for single project
- `useLineItems(projectId)` → useQuery for line items
- `useAsset(id)` → useQuery for single asset
- etc. — one hook per entity type

These are thin wrappers over `useQuery(api.*)` — mostly for consistent code patterns and potential future caching layers.

### Phase 5: Auth Bridge (2 weeks)

Better Auth handles user sessions (login, 2FA, passkeys, SSO). Convex needs to know who the user is for mutation-level auth enforcement.

**Approach: Admin key for server-side, user auth optional:**

Since all mutations are called FROM server actions (which already enforce permissions via `requirePermission`), the Convex mutations themselves don't need per-user auth. They trust the caller — which is the server action that already verified the user.

```typescript
// Server action calls Convex with admin auth
import { fetchMutation } from "convex/nextjs";

const project = await fetchMutation("projects:update", {
  id: data.id,
  updates: data,
}, {
  adminToken: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY,
});
```

**This means:**
- Convex mutations are callable only with admin key (server-side only)
- No user auth token flows from browser → Convex (browser never calls Convex directly for mutations)
- All write authorization happens in server actions
- Convex queries are public to anyone with the deployment URL — BUT queries only return scoped data (by orgId, which comes from server-issued args)

**Future enhancement:** For truly direct browser→Convex patterns (optimistic updates, real-time collaboration), pass a signed user identity token from Better Auth → Convex. Convex validates the JWT. This is Phase 6 material.

### Phase 6: Decommission (1 week)

Once all 177 client sites and 86 server actions are migrated:
- Remove `@tanstack/react-query` and `@tanstack/react-query-devtools` from dependencies
- Remove `event-bus.ts`, `activity-log.ts` real-time emission, SSE route
- Remove the Prisma adapter-pg connection hardening
- Remove Prisma entirely? No — Prisma still needed for:
  - Activity log writes (historical + new records)
  - Discord bot (until it's migrated)
  - Migration rollback safety net
- Update FEATUREDOCS/53-realtime-sync.md → mark as superseded
- Update ARCHITECTURE.md with Convex data layer

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `docker-compose.convex.yml` | Convex backend + dashboard containers |
| `convex/schema.ts` | All 95 Convex table definitions |
| `convex/projects.ts` | Project queries + mutations |
| `convex/assets.ts` | Asset queries + mutations |
| `convex/kits.ts` | Kit queries + mutations |
| `convex/line-items.ts` | ProjectLineItem queries + mutations |
| `convex/warehouse.ts` | Warehouse queries + mutations |
| `convex/auth.ts` | Auth helpers (optional, Phase 6) |
| `convex/_generated/` | Convex CLI auto-generated types |
| `convex/hooks/use-projects.ts` | React hooks wrapping Convex queries |
| `convex/hooks/use-assets.ts` | " |
| `convex/hooks/use-kits.ts` | " |
| `convex/hooks/use-line-items.ts` | " |
| `convex/hooks/use-warehouse.ts` | " |
| `convex/README.md` | Convex conventions for this project |
| `src/lib/convex-client.ts` | Convex HTTP client singleton (admin key) |
| `src/env.ts` add: `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `NEXT_PUBLIC_CONVEX_URL` |

### Modified Files (high-impact)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | No change — still source of truth for activity log + Discord bot |
| `src/server/**/*.ts` (86 files) | Replace Prisma calls with `fetchMutation()` |
| `src/components/**/*.tsx` (177+ sites) | Replace `useQuery()` from React Query with `useQuery()` from Convex |
| `package.json` | Add `convex` dependency, remove `@tanstack/react-query` (Phase 6) |
| `.env.example` | Add Convex env vars |
| `ARCHITECTURE.md` | Update feature table |
| `FEATUREDOCS/53-realtime-sync.md` | Mark as superseded |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Convex document model doesn't map well to relational data | Blocked on complex queries (reports, aggregations) | Keep complex reports as server actions that call multiple Convex queries + post-process. Don't fight the model. |
| Dual data sources during migration (Prisma + Convex) | Stale reads, inconsistent state | Migrate one domain at a time. During migration for domain X, ALL reads AND writes go through Convex. Never split a domain across both. |
| Self-hosted Convex stability under load | Production incidents | Run side-by-side for 2 weeks before cutting over. Load test with realistic data volume. |
| Auth hole: Convex mutations exposed to anyone with URL | Data leak | Use admin key for all server-action→Convex calls. Never expose Convex URL + admin key to the browser. Convex dashboard is internal-only. |
| Convex version lock / open-source licensing | Future migration risk | Convex is self-hosted but licensed by Convex Inc. Pin version tags in docker-compose. Keep PostgreSQL accessible for emergency data recovery. |
| Developer velocity slowdown during migration | No features for weeks | One domain at a time, ship each domain independently. Don't cut over all at once. |

---

## Stretch Goals (Phase 7+)

- **Direct browser mutations** — Skip server actions for simple writes. Pass Better Auth JWT → Convex as user identity. Optimistic updates built-in.
- **Convex scheduling** — Replace external cron with Convex cron for T&T expiry, maintenance reminders.
- **Convex file storage** — Replace S3 pre-signed URL pipeline with Convex file storage.
- **Discord bot migration** — Bot reads from Convex instead of Prisma.
- **Remove Prisma entirely** — Only possible once activity log and Discord bot are migrated. Prisma 7 codegen + adapter-pg + 3,500-line schema deletes cleanly.