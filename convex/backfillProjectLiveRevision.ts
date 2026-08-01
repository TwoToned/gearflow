import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * #1080/#1085 forward migration — stamp `projects.liveRevision` onto every
 * non-template project that doesn't have one yet.
 *
 * BELT-AND-BRACES, not a correctness dependency: `projectLiveRevision()`
 * (convex/lib/quoteState.ts) already coalesces an absent `liveRevision` to
 * `revision`, so every pre-#1085 project reads correctly with or without this
 * having run. It exists so the field is materialized on every row rather than
 * left permanently implicit, matching `backfillQuoteRevisions.ts`'s precedent
 * for `revision` itself.
 *
 * Same paginated-mutation + apply-flag shape as
 * `backfillStripProjectDepositPercent.ts`. Idempotent — a project that
 * already has `liveRevision` set is skipped. SERVICE-only.
 *
 * Driver: scripts/convex-backfill-project-live-revision.ts.
 */
export const backfillProjectLiveRevisionPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let updated = 0;
    for (const project of res.page) {
      if (project.isTemplate) continue; // templates carry no revision at all
      if (project.liveRevision != null) continue; // already migrated
      scanned++;
      if (!apply) continue;
      await ctx.db.patch(project._id, { liveRevision: project.revision ?? 1 });
      updated++;
    }
    return { scanned, updated, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/**
 * Verification — proves zero non-template projects are missing
 * `liveRevision` after a full apply run. Paginated like the migration itself
 * so it can't blow the read limit on a large org; the driver accumulates
 * across pages.
 */
export const verifyProjectLiveRevision = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({
    nonTemplateProjects: v.number(),
    projectsMissingLiveRevision: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 300 });

    let nonTemplateProjects = 0;
    let projectsMissingLiveRevision = 0;
    for (const project of res.page) {
      if (project.isTemplate) continue;
      nonTemplateProjects++;
      if (project.liveRevision == null) projectsMissingLiveRevision++;
    }
    return { nonTemplateProjects, projectsMissingLiveRevision, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
