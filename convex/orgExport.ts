/**
 * Semantic per-org export (READ-ONLY) — the migration-gate safety + portability
 * artifact. Distinct from the raw full-deployment snapshot: this is a versioned,
 * validated, org-scoped dump assembled by `scripts/export-org.ts`.
 *
 * Every query here is SERVICE-GATED (`requireService`). The table name is passed
 * as a string and cast — these are deliberately GENERIC readers so the script can
 * drive all 76 direct + filtered + parent-join tables through one code path. The
 * authoritative table classification lives in `scripts/org-export-tables.ts`
 * (shared with the coverage test); this file stays dumb on purpose.
 *
 * Throws `ConvexError` (never plain `Error`) so the payload survives the prod
 * boundary instead of being masked to InternalServerError. See convex/lib/auth.ts.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";
import { requireService } from "./lib/auth";

// Loose query-builder type: the generic table name is a runtime string, so the
// per-table index/field names can't be statically checked. We cast at the call
// site; these aliases keep the casts readable and localised.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

const CURSOR = v.union(v.string(), v.null());

/**
 * Generic paginated read for a DIRECT table (one with a `by_organizationId`
 * index). Page via that index; the script loops on `continueCursor` until
 * `isDone`.
 */
export const exportTablePage = query({
  args: { table: v.string(), orgId: v.string(), cursor: CURSOR, numItems: v.number() },
  handler: async (ctx, { table, orgId, cursor, numItems }) => {
    await requireService(ctx);
    const q = ctx.db.query(table as TableNames) as AnyQuery;
    const res = await q
      .withIndex("by_organizationId", (qb: AnyQuery) => qb.eq("organizationId", orgId))
      .paginate({ cursor, numItems });
    return { page: res.page, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/**
 * Generic paginated read for a table with an org column but NO
 * `by_organizationId` index: full-table scan + `.filter()` on the given org
 * field (default `organizationId`). Used for `storedFiles` (field
 * `organizationId`) and the collaboration tables `commentThreads` / `comments` /
 * `reviewMarkers` (field `orgId`). A page may return fewer than `numItems`
 * matching rows — the script loops until `isDone`.
 */
export const scanTableFiltered = query({
  args: {
    table: v.string(),
    orgId: v.string(),
    orgField: v.optional(v.string()),
    cursor: CURSOR,
    numItems: v.number(),
  },
  handler: async (ctx, { table, orgId, orgField, cursor, numItems }) => {
    await requireService(ctx);
    const field = orgField ?? "organizationId";
    const q = ctx.db.query(table as TableNames) as AnyQuery;
    const res = await q
      .filter((qb: AnyQuery) => qb.eq(qb.field(field), orgId))
      .paginate({ cursor, numItems });
    return { page: res.page, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/**
 * Collect PARENT-JOIN children (rows with no org column) whose FK ∈ the given
 * parent-id batch. `indexName` is the child's single-field index on `parentField`
 * (e.g. `by_orderId` / `orderId`). The script chunks `parentIds` to bound each
 * call. Children of a single org are small, so a per-parent `.collect()` is safe.
 */
export const childRowsByParentIds = query({
  args: {
    table: v.string(),
    indexName: v.string(),
    parentField: v.string(),
    parentIds: v.array(v.string()),
  },
  handler: async (ctx, { table, indexName, parentField, parentIds }) => {
    await requireService(ctx);
    const out: unknown[] = [];
    for (const pid of parentIds) {
      const q = ctx.db.query(table as TableNames) as AnyQuery;
      const rows = await q
        .withIndex(indexName, (qb: AnyQuery) => qb.eq(parentField, pid))
        .collect();
      out.push(...rows);
    }
    return out;
  },
});

/** The single `organizations` row, exported separately as `orgRow`. */
export const getOrgRow = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("organizations")
      .withIndex("by_cuid", (qb) => qb.eq("id", orgId))
      .unique();
  },
});

/**
 * All organization ids. The script uses this to default to the single org (and
 * to fail loudly if the deployment unexpectedly holds more than one).
 */
export const listOrgIds = query({
  args: {},
  handler: async (ctx) => {
    await requireService(ctx);
    const orgs = await ctx.db.query("organizations").collect(); // r9.8-ok: tenant-count table, admin/script-only listing
    return orgs.map((o) => o.id);
  },
});

/**
 * Independent paginated COUNT used by the post-write validation pass. Mirrors the
 * two paginated read shapes (direct index vs filtered scan) but returns only page
 * counts, so the script sums them without re-materialising every row. A count
 * that disagrees with the exported row count means the export loop dropped or
 * duplicated a page — the script exits non-zero.
 */
export const countTable = query({
  args: {
    table: v.string(),
    orgId: v.string(),
    orgField: v.optional(v.string()),
    cursor: CURSOR,
    numItems: v.number(),
  },
  handler: async (ctx, { table, orgId, orgField, cursor, numItems }) => {
    await requireService(ctx);
    const q = ctx.db.query(table as TableNames) as AnyQuery;
    let scoped: AnyQuery;
    if (orgField) {
      scoped = q.filter((qb: AnyQuery) => qb.eq(qb.field(orgField), orgId));
    } else {
      scoped = q.withIndex("by_organizationId", (qb: AnyQuery) => qb.eq("organizationId", orgId));
    }
    const res = await scoped.paginate({ cursor, numItems });
    return { count: res.page.length, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
