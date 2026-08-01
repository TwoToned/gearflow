/**
 * Right-to-erasure hard-delete (#1077, A7, M5) — the ONLY thing that can
 * actually delete an org's Convex domain data. Distinct from archiving
 * (#1075, D12): archive is the automatic terminal state and never destroys;
 * this is a separate, explicitly-invoked action for a genuine erasure
 * request (POLICY §8.12), driven by `scripts/erase-org.ts` (mirrors
 * `scripts/export-org.ts`'s table classification — `scripts/
 * org-export-tables.ts` is the single source of truth for which tables hold
 * per-org domain data, so export and erasure can never drift apart on
 * coverage).
 *
 * Every mutation here is SERVICE-GATED — the script is the only caller, using
 * the trusted backend token, same posture as orgExport.ts's readers.
 *
 * No cursor threading: each call re-queries the (now-shorter) result set from
 * the top after deleting a page, so there's nothing to invalidate. `isDone`
 * just means "fewer rows came back than asked for" — the table is exhausted
 * for this org.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";
import type { Id } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

/** Delete up to `numItems` rows from a DIRECT table (by_organizationId index). */
export const deleteTablePage = mutation({
  args: { table: v.string(), orgId: v.string(), numItems: v.number() },
  handler: async (ctx, { table, orgId, numItems }) => {
    await requireService(ctx);
    const q = ctx.db.query(table as TableNames) as AnyQuery;
    const rows = await q.withIndex("by_organizationId", (qb: AnyQuery) => qb.eq("organizationId", orgId)).take(numItems);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, isDone: rows.length < numItems };
  },
});

/** Delete up to `numItems` rows from a FILTER table (org column, no index). */
export const deleteFilteredPage = mutation({
  args: { table: v.string(), orgId: v.string(), orgField: v.string(), numItems: v.number() },
  handler: async (ctx, { table, orgId, orgField, numItems }) => {
    await requireService(ctx);
    const q = ctx.db.query(table as TableNames) as AnyQuery;
    const rows = await q.filter((qb: AnyQuery) => qb.eq(qb.field(orgField), orgId)).take(numItems);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, isDone: rows.length < numItems };
  },
});

/** Delete every PARENT_JOIN child row (no org column) for the given parent ids. */
export const deleteChildRowsByParentIds = mutation({
  args: {
    table: v.string(),
    indexName: v.string(),
    parentField: v.string(),
    parentIds: v.array(v.string()),
  },
  handler: async (ctx, { table, indexName, parentField, parentIds }) => {
    await requireService(ctx);
    let deleted = 0;
    for (const pid of parentIds) {
      const q = ctx.db.query(table as TableNames) as AnyQuery;
      const rows = await q.withIndex(indexName, (qb: AnyQuery) => qb.eq(parentField, pid)).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

/**
 * Delete the underlying `_storage` bytes for a batch of storageIds. Called
 * BEFORE `deleteFilteredPage` clears the `storedFiles` records themselves —
 * once the record is gone there's nothing left pointing at the blob to erase
 * by. Idempotent: a storageId whose bytes are already gone is silently
 * skipped (mirrors files.ts's deleteFile).
 */
export const deleteStorageBlobs = mutation({
  args: { storageIds: v.array(v.string()) },
  handler: async (ctx, { storageIds }) => {
    await requireService(ctx);
    let deleted = 0;
    for (const id of storageIds) {
      try {
        await ctx.storage.delete(id as Id<"_storage">);
        deleted++;
      } catch {
        // already gone — idempotent, same as files.ts's deleteFile
      }
    }
    return { deleted };
  },
});

const orgErasureDenyReason =
  "Hard-deletes an org's Convex domain data — the genuine right-to-erasure path (#1077, M5). Script-only (scripts/erase-org.ts), never agent-reachable.";

export const agentOps: AgentOpsAnnotations = {
  deleteTablePage: { agentAccess: "denied", reason: orgErasureDenyReason },
  deleteFilteredPage: { agentAccess: "denied", reason: orgErasureDenyReason },
  deleteChildRowsByParentIds: { agentAccess: "denied", reason: orgErasureDenyReason },
  deleteStorageBlobs: { agentAccess: "denied", reason: orgErasureDenyReason },
};
