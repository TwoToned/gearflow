import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Native reads for the activity-log SCREENS (Phase 5c audit-read migration). Parity
 * target: src/server/activity-log.ts (getActivityLogs / getEntityActivityLog /
 * exportActivityLogCSV), which read Postgres `activityLog`. Org-scoping only
 * (`requireOrgRead`) — the server actions gate on `getOrgContext()`, no extra
 * permission, so any org member may view the log.
 *
 * Windowing: the list/export queries scan the org's most-recent `SCAN_CAP` rows off
 * the `by_organizationId_createdAt` index (desc) and filter/paginate in JS. This
 * mirrors the export's existing 10k cap and keeps every read bounded (Convex read
 * limits). For these orgs the log fits well within the window; `capped` is returned so
 * the UI/caller can tell when it didn't. Entity lookups use the entity index directly
 * (a single entity's history is always small).
 */

const SCAN_CAP = 10000;

type LogDoc = {
  id: string;
  organizationId: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  userId?: string;
  userName: string;
  summary: string;
  details?: unknown;
  metadata?: unknown;
  projectId?: string;
  assetId?: string;
  kitId?: string;
  createdAt?: number;
};

const filterArgs = {
  entityType: v.optional(v.string()),
  action: v.optional(v.string()),
  userId: v.optional(v.string()),
  entityId: v.optional(v.string()),
  projectId: v.optional(v.string()),
  assetId: v.optional(v.string()),
  search: v.optional(v.string()),
  startDateMs: v.optional(v.number()),
  endDateMs: v.optional(v.number()),
};

/** Apply the same predicates Prisma's `where` did, in JS over the scanned window. */
function applyFilters(
  rows: LogDoc[],
  f: {
    entityType?: string;
    action?: string;
    userId?: string;
    entityId?: string;
    projectId?: string;
    assetId?: string;
    search?: string;
    startDateMs?: number;
    endDateMs?: number;
  },
): LogDoc[] {
  const search = f.search?.toLowerCase();
  return rows.filter((r) => {
    if (f.entityType && r.entityType !== f.entityType) return false;
    if (f.action && r.action !== f.action) return false;
    if (f.userId && r.userId !== f.userId) return false;
    if (f.entityId && r.entityId !== f.entityId) return false;
    if (f.projectId && r.projectId !== f.projectId) return false;
    if (f.assetId && r.assetId !== f.assetId) return false;
    if (search && !r.summary.toLowerCase().includes(search)) return false;
    const ts = r.createdAt ?? 0;
    if (f.startDateMs != null && ts < f.startDateMs) return false;
    if (f.endDateMs != null && ts > f.endDateMs) return false;
    return true;
  });
}

/** The org's most-recent rows off the createdAt index, newest first, bounded. */
async function scanWindow(ctx: QueryCtx, orgId: string): Promise<LogDoc[]> {
  return (await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_createdAt", (q) => q.eq("organizationId", orgId))
    .order("desc")
    .take(SCAN_CAP)) as unknown as LogDoc[];
}

/** Join the Convex `users` mirror for {id,name,image}; null when absent (Prisma parity). */
async function attachUsers(ctx: QueryCtx, rows: LogDoc[]) {
  const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const entries = await Promise.all(
    ids.map(async (uid) => {
      const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", uid)).first();
      return [uid, u] as const;
    }),
  );
  const byId = new Map(entries);
  return rows.map((r) => {
    const u = r.userId ? byId.get(r.userId) : undefined;
    return {
      ...r,
      // Match the serialized Prisma Date shape (ISO string) so the screen renders
      // identically on either read path.
      createdAt: new Date(r.createdAt ?? 0).toISOString(),
      user: u ? { id: u.id, name: u.name, image: u.image ?? null } : null,
    };
  });
}

export const list = query({
  args: {
    orgId: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sort: v.optional(v.string()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    ...filterArgs,
  },
  handler: async (ctx, args) => {
    await requireOrgRead(ctx, args.orgId);
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 50;
    const sort = args.sort ?? "createdAt";
    const order = args.order ?? "desc";

    const window = await scanWindow(ctx, args.orgId);
    const filtered = applyFilters(window, args);

    // Sort. The window is already createdAt-desc; honor other sort keys in JS.
    if (sort === "createdAt") {
      if (order === "asc") filtered.reverse();
    } else {
      filtered.sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[sort] ?? "");
        const bv = String((b as unknown as Record<string, unknown>)[sort] ?? "");
        return order === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const items = await attachUsers(ctx, pageRows);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      capped: window.length >= SCAN_CAP,
    };
  },
});

export const listByEntity = query({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, entityType, entityId, limit }) => {
    await requireOrgRead(ctx, orgId);
    const rows = (await ctx.db
      .query("activityLogs")
      .withIndex("by_organizationId_entityType_entityId", (q) =>
        q.eq("organizationId", orgId).eq("entityType", entityType).eq("entityId", entityId),
      )
      .collect()) as unknown as LogDoc[];
    rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const total = rows.length;
    const items = await attachUsers(ctx, rows.slice(0, limit ?? 5));
    return { items, total };
  },
});

/** Raw rows for CSV export (newest-first). CSV assembly stays server-side. */
export const exportRows = query({
  args: { orgId: v.string(), ...filterArgs },
  handler: async (ctx, args) => {
    await requireOrgRead(ctx, args.orgId);
    const window = await scanWindow(ctx, args.orgId);
    const filtered = applyFilters(window, args);
    return filtered.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt ?? 0).toISOString(),
    }));
  },
});
