import { v } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * #1243 Phase 1 — expand-migrate backfill: one child `projectTasks` row (subtask,
 * `parentId` set) per non-empty `checklist` item, so the flat `checklist` JSON blob
 * has a real, queryable equivalent. This is the "migrate" half of the expand-
 * contract migration described in `convex/schema.ts`'s `projectTasks.checklist`
 * comment: `checklist` itself is dropped in a SEPARATE follow-up, exactly one
 * release after this backfill ships (Convex functions deploy ahead of the app
 * image, so the field must still be readable for at least one release after this
 * runs). See FEATUREDOCS/50.
 *
 * A child inherits `organizationId`/`projectId` from its parent and gets no
 * `stage`/`sourceKey` (matches the schema comment). `status` maps from the
 * checklist item's `done` boolean; `sortOrder` preserves the checklist's original
 * ordering among the new subtasks. The checklist item's own `id` is PRESERVED as
 * the new row's `id` (design doc §10.4's explicit acceptance criterion) — ids are
 * client-generated via `crypto.randomUUID()` (`tasks-panel.tsx`), so they're
 * already globally unique; a fresh id is generated only in the defensive case
 * where one is missing or already taken by an unrelated row.
 *
 * Idempotent — skips any parent that ALREADY has at least one subtask
 * (`by_parentId`), whether from a prior run of this backfill or a subtask created
 * some other way post-widen, so re-runs never duplicate. A parent with an absent
 * or empty `checklist` is skipped entirely (nothing to migrate).
 *
 * SERVICE-only, paginated (one query can't scan a large table — mirrors
 * backfillClientContacts.ts / backfillKitUnits.ts). `apply=false` is a dry-run
 * that only counts.
 *
 * Driver: scripts/convex-backfill-checklist-subtasks.ts (pages the cursor until
 * isDone). NOT executed against production from this repo/session — a human runs
 * the driver with real Convex credentials when Phase 1's UI is ready to render
 * subtasks (task readers already exclude `parentId` rows from flat lists — see
 * FEATUREDOCS/50 — so running this backfill today would already be safe, but
 * there is no consumer to show the migrated data until the peek-panel subtask UI
 * ships).
 */

interface RawChecklistItem { id?: string; text?: string; done?: unknown }

export const backfillChecklistSubtasksPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projectTasks").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0; // parents that NEED a backfill (non-empty checklist, no existing subtask)
    let created = 0; // subtask rows created (only when apply) — 1 parent can yield N subtasks
    for (const parent of res.page) {
      const checklist = (parent.checklist as RawChecklistItem[] | null | undefined) ?? [];
      if (!Array.isArray(checklist) || checklist.length === 0) continue;

      // Idempotent — a parent that already has ANY subtask is left alone.
      const already = await ctx.db.query("projectTasks").withIndex("by_parentId", (q) => q.eq("parentId", parent.id)).first();
      if (already) continue;

      scanned++;
      if (!apply) continue;

      const now = Date.now();
      // completedAt for an already-done item is the parent's own updatedAt (when the
      // checklist itself was last saved), not migration time — matches design doc §10.4.
      const doneCompletedAt = parent.updatedAt ?? parent.createdAt ?? now;
      let sortOrder = 0;
      for (const item of checklist) {
        const title = item.text?.trim();
        if (!title) continue; // a checklist item with no text has nothing to migrate

        const done = !!item.done;
        let id = item.id?.trim();
        if (!id || (await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id as string)).first())) {
          id = createId(); // missing or already taken — fall back to a fresh id
        }
        await ctx.db.insert("projectTasks", {
          id,
          organizationId: parent.organizationId,
          projectId: parent.projectId,
          parentId: parent.id,
          title,
          status: done ? "DONE" : "TODO",
          kind: "task",
          sortOrder: sortOrder++,
          completedAt: done ? doneCompletedAt : undefined,
          createdAt: now,
          updatedAt: now,
        });
        created++;
      }
    }
    return { scanned, created, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
