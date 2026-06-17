import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * One-off cleanup for the June-2026 feature-removal effort.
 *
 * When a table is removed from the Convex schema, its existing documents are
 * NOT deleted — they orphan (still on disk, no longer typed/queryable through
 * the schema). These helpers delete those orphaned documents.
 *
 * Only the tables that were FULLY removed are listed. Tables kept by decision
 * (crewRoles / crewSkills — D1; documentTemplates — D4) are intentionally
 * absent, and the allowlist guard refuses anything not in this set.
 *
 * Best run while the tables are still in the schema (i.e. before the removal
 * PRs' Convex deploy) for fully-typed access; the `as any` cast also lets it
 * work afterwards against orphaned tables. Idempotent + re-runnable.
 */
export const REMOVED_TABLES = [
  "stocktakes",
  "stocktakeItems",
  "savedReports",
  "crewCertifications",
  "discordIntegrations",
  "discordAccountLinks",
  "discordLinkTokens",
  "discordOutboxes",
  "damageEvents",
] as const;

const ALLOWED = new Set<string>(REMOVED_TABLES);

/**
 * Delete one bounded batch from an allowlisted removed table.
 * Returns { table, deleted, done }. Drive in a loop until done === true.
 */
export const purgeBatch = internalMutation({
  args: { table: v.string(), batchSize: v.optional(v.number()) },
  handler: async (ctx, { table, batchSize }) => {
    if (!ALLOWED.has(table)) {
      throw new ConvexError(
        `purge refused: "${table}" is not an allowlisted removed table`,
      );
    }
    const limit = Math.min(batchSize ?? 500, 2000);
    // `as any`: the table may already have left the schema (orphaned), so it is
    // not in the typed TableNames union — but the documents still exist on disk.
    const docs = await ctx.db
      .query(table as never)
      .take(limit);
    for (const doc of docs) {
      await ctx.db.delete((doc as { _id: never })._id);
    }
    return { table, deleted: docs.length, done: docs.length < limit };
  },
});

/** Per-table remaining document counts (capped scan) — to verify the purge. */
export const pendingCounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, number> = {};
    for (const table of REMOVED_TABLES) {
      // Cap the scan so a huge orphaned table can't blow the read limit; any
      // value >= cap means "still has data, keep purging".
      const rows = await ctx.db.query(table as never).take(2001);
      out[table] = rows.length;
    }
    return out;
  },
});
