import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * One-off repair — release line items whose `groupId` points at a group that no
 * longer exists.
 *
 * Why they exist: `deleteGroupNative` used to release a deleted group's lines by
 * reading the LIVE version's lines, so deleting a group while working in a
 * non-live version left that version's lines with a dangling `groupId`. Such a
 * line is hidden in the equipment tab (no group to nest under) yet still billed
 * and still printed on the quote as an ungrouped item. The delete is fixed; this
 * repairs the rows it already orphaned.
 *
 * What it does: clears `groupId` on an orphaned line and nothing else —
 * `categoryId` is kept, exactly like a normal group delete, so the line
 * reappears as a standalone item in its category where it can be edited or
 * removed. It does not change any amount: an orphaned line already bills as a
 * standalone line, so no recalc is needed.
 *
 * "Orphaned" = `groupId` set, and no `projectGroups` row with that id in the
 * line's own organization. Same paginated-mutation + apply-flag shape as
 * `backfillProjectLiveRevision.ts`. Idempotent — a repaired line has no
 * `groupId`, so a re-run reports 0. SERVICE-only.
 *
 * Driver: scripts/convex-repair-orphaned-group-lines.ts (dry-run by default).
 */
const SAMPLE_LIMIT = 100;

export const repairOrphanedGroupLinesPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    orphaned: v.number(),
    released: v.number(),
    sample: v.array(
      v.object({
        lineId: v.string(),
        projectId: v.string(),
        versionId: v.union(v.string(), v.null()),
        groupId: v.string(),
        description: v.union(v.string(), v.null()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projectLineItems").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let orphaned = 0;
    let released = 0;
    const sample: Array<{
      lineId: string;
      projectId: string;
      versionId: string | null;
      groupId: string;
      description: string | null;
    }> = [];

    for (const line of res.page) {
      if (!line.groupId) continue;
      scanned++;
      const groupId = line.groupId;
      // by_cuid is global — a group in another org does not count as this line's group.
      const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
      if (group && group.organizationId === line.organizationId) continue;
      orphaned++;
      if (sample.length < SAMPLE_LIMIT) {
        sample.push({
          lineId: line.id,
          projectId: line.projectId,
          versionId: line.versionId ?? null,
          groupId,
          description: line.description ?? null,
        });
      }
      if (!apply) continue;
      await ctx.db.patch(line._id, { groupId: undefined, updatedAt: Date.now() });
      released++;
    }
    return { scanned, orphaned, released, sample, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
