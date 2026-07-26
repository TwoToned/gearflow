import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * WS2 (#941) — two-window date model backfill.
 * See FEATUREDOCS/10 (Projects) and FEATUREDOCS/11 (Availability) for the full
 * two-window design.
 *
 * Expand-contract (house pattern, mirrors convex/backfillKitUnits.ts): the schema
 * already has `projectStartDate`/`projectStartTime`/`projectEndDate`/
 * `projectEndTime` alongside the still-present, now-deprecated `loadInDate`/
 * `loadInTime`/`loadOutDate`/`loadOutTime`/`eventStartDate`/`eventEndDate`. This
 * page pages the `projects` table and, for every project with `loadInDate` or
 * `loadOutDate` set but its `project*` counterpart still unset, copies:
 *
 *   projectStartDate = loadInDate   (time carried: projectStartTime = loadInTime)
 *   projectEndDate   = loadOutDate  (time carried: projectEndTime   = loadOutTime)
 *
 * `eventStartDate`/`eventEndDate` are DROPPED, not migrated — there is no
 * replacement field for them in the two-window model (the decision doc is
 * explicit: "event start/end dates deleted"). A project whose ONLY dates were
 * event dates ends up with no project-window override, the same outcome as
 * a project that never had load-in/out — its window falls back to `rentalStartDate`/
 * `rentalEndDate` at read time via `getProjectWindow`, exactly as intended.
 *
 * Idempotent: `projectStartDate`/`projectEndDate` already set means "the
 * backfill already touched this project OR a wizard write already diverged
 * it" — either way, never clobber. SERVICE-only. `apply=false` is a dry-run
 * that only counts. Paginated because one query can't scan a large table.
 *
 * Driver: scripts/convex-backfill-project-window.ts (pages the cursor until done).
 */
export const backfillProjectWindowPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let updated = 0;
    for (const project of res.page) {
      const needsStart = project.loadInDate != null && project.projectStartDate == null;
      const needsEnd = project.loadOutDate != null && project.projectEndDate == null;
      if (!needsStart && !needsEnd) continue;
      scanned++;
      if (!apply) continue;

      const patch: Record<string, number | string> = {};
      if (needsStart) {
        patch.projectStartDate = project.loadInDate!;
        if (project.loadInTime != null) patch.projectStartTime = project.loadInTime;
      }
      if (needsEnd) {
        patch.projectEndDate = project.loadOutDate!;
        if (project.loadOutTime != null) patch.projectEndTime = project.loadOutTime;
      }
      await ctx.db.patch(project._id, patch);
      updated++;
    }
    return { scanned, updated, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
