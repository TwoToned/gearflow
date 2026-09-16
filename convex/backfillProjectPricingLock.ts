import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import { listProjectQuotes, projectLiveRevision, effectiveQuoteStatus, isLiveQuoteStatus } from "./lib/quoteState";
import { isConfirmedOrLater } from "./lib/projectLocks";

/**
 * #1230 forward migration — Phase 4 of "Project versioning v2" (parent
 * #1221). The one-time "translate the OLD derived lock state into the NEW
 * stored boolean" step: every project that existed before this phase shipped
 * had its lock state derived on read (status tier + a live SENT/ACCEPTED
 * quote); a project created after this phase needs no backfill at all — the
 * flag starts absent (= false) and only a real event (`sendNative`, a
 * CONFIRMED transition) ever raises it going forward.
 *
 * Same shape as `backfillProjectVersions.ts` — paginated, `apply`-gated,
 * idempotent by construction (a project already `pricingLocked: true` is
 * skipped; re-running finds nothing left to do).
 *
 * A project is locked iff EITHER:
 *   1. its status (`isConfirmedOrLater`) is CONFIRMED or later, OR
 *   2. its LIVE revision's quote (`projectLiveRevision`) is currently SENT,
 *      ACCEPTED, or EXPIRED (`isLiveQuoteStatus` — the same "client is
 *      holding this document" test `quotesWrites.ts` itself uses).
 *
 * This mirrors exactly the two ways `pricingLocked` gets raised going
 * forward (a CONFIRMED status transition, or `sendNative`) — the backfill is
 * "run those same two checks once against history," not a new third rule.
 *
 * Never LOWERS the flag — a project that doesn't match either condition is
 * simply left `pricingLocked` absent (false), which is already correct.
 *
 * Driver: none yet (SERVICE-only, invoked the same way
 * `backfillProjectVersions.ts` is — via the Convex dashboard or a one-off
 * script — until an operator driver is written).
 */

async function projectNeedsLock(ctx: MutationCtx | QueryCtx, project: Doc<"projects">): Promise<boolean> {
  if (project.pricingLocked === true) return false; // already migrated / already locked

  if (isConfirmedOrLater(project.status)) return true;

  const liveRevision = projectLiveRevision(project);
  const quotes = await listProjectQuotes(ctx, project.organizationId, project.id);
  const now = Date.now();
  return quotes.some((q) => q.version === liveRevision && isLiveQuoteStatus(effectiveQuoteStatus(q, now)));
}

export const backfillProjectPricingLockPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    locked: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 100 });

    const tally = { scanned: 0, locked: 0 };
    for (const project of res.page) {
      if (project.isTemplate) continue; // a template has no quote/status lifecycle to lock
      tally.scanned++;
      const needsLock = await projectNeedsLock(ctx, project);
      if (!needsLock) continue;

      tally.locked++;
      if (apply) {
        await ctx.db.patch(project._id, {
          pricingLocked: true,
          pricingLockedAt: project.updatedAt ?? project.createdAt ?? Date.now(),
          pricingLockedById: BACKFILL_SYSTEM_USER_ID,
          pricingLockedByName: "System (backfill)",
        });
      }
    }
    return { ...tally, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const BACKFILL_SYSTEM_USER_ID = "system";

/**
 * Verification — every project matching the lock predicate above must read
 * `pricingLocked: true` after a full apply run, and nothing else should have
 * been touched. Paginated like the migration itself.
 */
const EMPTY_COUNTS = {
  totalProjects: 0,
  projectsNeedingLockButUnlocked: 0,
};
type VerifyCounts = typeof EMPTY_COUNTS;

export const verifyProjectPricingLock = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({
    totalProjects: v.number(),
    projectsNeedingLockButUnlocked: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 100 });

    const totals: VerifyCounts = { ...EMPTY_COUNTS };
    for (const project of res.page) {
      if (project.isTemplate) continue;
      totals.totalProjects++;
      if (await projectNeedsLock(ctx, project)) totals.projectsNeedingLockButUnlocked++;
    }
    return { ...totals, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Guard used by an eventual driver so a mismatch between the counted project
 *  total and the operator's `--expect-projects` halts BEFORE anything is
 *  written. Exported (and unit-tested) — mirrors
 *  `backfillProjectVersions.ts`'s `assertExpectedProjectCount`. */
export function assertExpectedProjectCount(counted: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (counted !== expected) {
    throw new ConvexError(
      `Refusing to migrate: expected ${expected} project(s), found ${counted}. ` +
        "Re-run the dry run and confirm the figure before applying.",
    );
  }
}
