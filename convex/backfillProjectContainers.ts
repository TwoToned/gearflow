import { v } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";

type Ctx = MutationCtx;

/**
 * #1296 packing containers — build plan phase 1d backfill (mirrors
 * backfillKitUnits.ts's shape). Prod has two kinds of pre-#1296 rows with no
 * `projectContainers` counterpart at all: a container's own line item
 * (`isContainerLineItem: true`, `prepContainer` = its label, created by the
 * old `ensureContainerOnProjectCore`), and content units/lines carrying the
 * same free-text label with no id behind it. Per `(project version, distinct
 * label)`: reuse an existing container LINE if one carries that label (kind
 * ASSET/CUSTOM per `isCustomItem`), else mint a fresh CUSTOM one — the same
 * decision `resolveOrCreateContainerByLabel` (fulfillment.ts) makes for a
 * live legacy-arg call, extended here to check for a line to reuse first
 * (a live call never needs to — see its own comment).
 *
 * Two stages, run in order (a line-only container has no unit to drive
 * stage 1's scan):
 *   1. `backfillProjectContainersUnitsPage` — pages `projectLineItemUnits`,
 *      stamps `containerId` on every unit still carrying only the label.
 *   2. `backfillProjectContainersLinesPage` — pages `projectLineItems`,
 *      creates the container for any `isContainerLineItem` line stage 1
 *      never reached (no content unit ever referenced its label).
 *
 * SERVICE-only. Idempotent — a label already resolved to a container in its
 * version is reused (never a duplicate), so re-runs are safe. `apply=false`
 * dry-run only counts. Paginated — a large table can't be scanned in one
 * query. Nothing is ever deleted (`prepContainer` stays readable — phase 5
 * narrows it once this backfill is confirmed in prod, CLAUDE.md's
 * widen->migrate->narrow rule).
 *
 * Driver: scripts/convex-backfill-project-containers.ts.
 */

async function lineByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}

/** Find-or-create the container for a `(version, label)` pair, reusing an
 *  existing container LINE (the old ensureContainerOnProjectCore shape) when
 *  one carries that exact label, else minting a fresh CUSTOM container + line
 *  item. Idempotent — checks for an already-backfilled container first. */
async function findOrCreateContainerForLabel(
  ctx: Ctx,
  args: { organizationId: string; projectId: string; versionId: string; label: string; now: number },
): Promise<string> {
  const containersInVersion = (
    await ctx.db.query("projectContainers").withIndex("by_versionId", (q) => q.eq("versionId", args.versionId)).collect()
  ).filter((c) => c.organizationId === args.organizationId);
  const existing = containersInVersion.find((c) => c.label === args.label);
  if (existing) return existing.id;

  const linesInVersion = (
    await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", args.versionId)).collect()
  ).filter((l) => l.organizationId === args.organizationId);
  const containerLine = linesInVersion.find((l) => l.isContainerLineItem && l.prepContainer === args.label && !l.containerId);

  const containerId = createId();
  if (containerLine) {
    await ctx.db.patch(containerLine._id, { containerId, updatedAt: args.now });
    await ctx.db.insert("projectContainers", {
      id: containerId, organizationId: args.organizationId, projectId: args.projectId, versionId: args.versionId, lineageId: containerId,
      kind: containerLine.isCustomItem ? "CUSTOM" : "ASSET",
      assetId: containerLine.assetId, bulkAssetId: containerLine.bulkAssetId,
      label: args.label, lineItemId: containerLine.id, sortOrder: 0, createdAt: args.now, updatedAt: args.now,
    });
    return containerId;
  }

  const lineItemId = createId();
  const lineSort = linesInVersion.reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
  await ctx.db.insert("projectLineItems", {
    id: lineItemId, organizationId: args.organizationId, projectId: args.projectId, versionId: args.versionId, lineageId: lineItemId,
    type: "EQUIPMENT", isCustomItem: true, description: args.label,
    quantity: 1, sortOrder: lineSort, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PACKED",
    prepContainer: args.label, containerId, isContainerLineItem: true, createdAt: args.now, updatedAt: args.now,
  });
  const containerSort = containersInVersion.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1;
  await ctx.db.insert("projectContainers", {
    id: containerId, organizationId: args.organizationId, projectId: args.projectId, versionId: args.versionId, lineageId: containerId,
    kind: "CUSTOM", label: args.label, lineItemId, sortOrder: containerSort, createdAt: args.now, updatedAt: args.now,
  });
  return containerId;
}

export const backfillProjectContainersUnitsPage = mutation({
  args: { cursor: v.union(v.string(), v.null()), apply: v.boolean(), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projectLineItemUnits").paginate({ cursor, numItems: numItems ?? 300 });
    const now = Date.now();

    let scanned = 0;
    let backfilled = 0;
    for (const unit of res.page) {
      if (!unit.prepContainer || unit.containerId) continue; // no label, or already backfilled/native
      const line = await lineByCuid(ctx, unit.lineItemId);
      if (!line || !line.versionId) continue; // pre-#1228 row with no version — out of scope
      scanned++;
      if (!apply) continue;

      const containerId = await findOrCreateContainerForLabel(ctx, {
        organizationId: unit.organizationId, projectId: line.projectId, versionId: line.versionId, label: unit.prepContainer, now,
      });
      await ctx.db.patch(unit._id, { containerId, updatedAt: now });
      backfilled++;
    }
    return { scanned, backfilled, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const backfillProjectContainersLinesPage = mutation({
  args: { cursor: v.union(v.string(), v.null()), apply: v.boolean(), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projectLineItems").paginate({ cursor, numItems: numItems ?? 300 });
    const now = Date.now();

    let scanned = 0;
    let backfilled = 0;
    for (const line of res.page) {
      if (!line.isContainerLineItem || !line.prepContainer || line.containerId || !line.versionId) continue;
      scanned++;
      if (!apply) continue;

      await findOrCreateContainerForLabel(ctx, {
        organizationId: line.organizationId, projectId: line.projectId, versionId: line.versionId, label: line.prepContainer, now,
      });
      backfilled++;
    }
    return { scanned, backfilled, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Post-run assertion (build plan phase 1d): zero units with a `prepContainer`
 *  and no `containerId`. Bounded scan — the driver calls this once at the
 *  very end, after both stages report `scanned: 0` on a fresh page. */
export const countUnbackfilledUnits = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projectLineItemUnits").paginate({ cursor, numItems: numItems ?? 500 });
    const unbackfilled = res.page.filter((u) => u.prepContainer && !u.containerId).length;
    return { unbackfilled, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
