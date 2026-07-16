import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireOrgPermission, requireService } from "./lib/auth";

/**
 * Thin CRUD for WarehouseClose (Convex table "warehouseCloses"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("warehouseCloses")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.optional(v.number()),
    storedCount: v.optional(v.number()),
    damagedCount: v.optional(v.number()),
    lostCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("warehouseCloses", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.optional(v.number()),
    storedCount: v.optional(v.number()),
    damagedCount: v.optional(v.number()),
    lostCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("warehouseCloses", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      closedById: v.optional(v.string()),
      closedAt: v.optional(v.number()),
      storedCount: v.optional(v.number()),
      damagedCount: v.optional(v.number()),
      lostCount: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("warehouseCloses not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("warehouseCloses not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator. Re-add if regenerating
// convex/warehouseCloses.ts via `pnpm convex:crud`. ──────────────────────────

/**
 * Look up the (at most one) close-out for a project. Powers the "already closed"
 * banner — replaces the `prisma.warehouseClose.findFirst` residual read in
 * `getCloseOutSummary` now that warehouseCloses is Convex-only.
 */
export const getByProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("warehouseCloses")
      .withIndex("by_projectId_organizationId", (q) =>
        q.eq("projectId", projectId).eq("organizationId", orgId),
      )
      .first();
  },
});

/**
 * Race-safe close-out insert. Enforces the [projectId, organizationId]
 * uniqueness invariant the dropped Prisma unique constraint used to guarantee:
 * Convex mutations are serializable, so a concurrent close reads the same index
 * range this insert writes → OCC forces the loser to retry and observe the
 * existing row. Returns `{ alreadyClosed }` (rather than throwing on the dup) so
 * the server action maps it to the existing user-facing message.
 */
export const closeOutIfNotClosed = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.number(),
    storedCount: v.number(),
    damagedCount: v.number(),
    lostCount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("warehouseCloses")
      .withIndex("by_projectId_organizationId", (q) =>
        q.eq("projectId", args.projectId).eq("organizationId", args.organizationId),
      )
      .first();
    if (existing) return { alreadyClosed: true as const, id: existing.id };
    await ctx.db.insert("warehouseCloses", args);
    return { alreadyClosed: false as const, id: args.id };
  },
});

/**
 * Browser-direct close-out summary (Phase 3 — replaces the getCloseOutSummary server
 * action in src/server/warehouse-close-read.ts). Composes the project's top-level
 * EQUIPMENT line items with model names + asset tags, categorises stored/damaged/lost/
 * pending, and reports the existing close (if any). The closer's display name comes
 * from the Convex `users` mirror (name or null — the last Prisma seam removed). RBAC =
 * warehouse:close (parity with the deleted requirePermission("warehouse","close")).
 */
export const closeOutSummary = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgPermission(ctx, orgId, "warehouse", "close");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).unique();
    if (!project || project.organizationId !== orgId || project.isTemplate) {
      throw new ConvexError("Project not found");
    }

    const allLines = await ctx.db
      .query("projectLineItems")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    // by_projectId is GLOBAL — org-re-check every row (the project is already org-checked,
    // so this is defence-in-depth against a cross-tenant line under the same projectId).
    const lineItems = allLines.filter(
      (li) => li.organizationId === orgId && li.type === "EQUIPMENT" && li.isKitChild !== true,
    );

    const modelMap = new Map(
      (await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect())
        .map((m) => [m.id, m.name]),
    );
    const assetTagMap = new Map(
      (await ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect())
        .map((a) => [a.id, a.assetTag]),
    );
    const bulkAssetTagMap = new Map(
      (await ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect())
        .map((b) => [b.id, b.assetTag]),
    );

    let storedCount = 0;
    let damagedCount = 0;
    let lostCount = 0;
    let pendingCount = 0;
    const exceptions: Array<{
      lineItemId: string;
      modelName: string;
      assetTag: string | null;
      status: string;
      returnCondition: string | null;
      returnStatus: string | null;
    }> = [];

    for (const item of lineItems) {
      const isReturned = item.status === "RETURNED";
      const modelName = (item.modelId ? modelMap.get(item.modelId) : null) || "Unknown";
      const assetTag =
        (item.assetId ? assetTagMap.get(item.assetId) : null) ||
        (item.bulkAssetId ? bulkAssetTagMap.get(item.bulkAssetId) : null) ||
        null;
      const status = item.status ?? "PENDING";
      const returnCondition = item.returnCondition ?? null;
      const returnStatus = item.returnStatus ?? null;
      const ex = { lineItemId: item.id, modelName, assetTag, status, returnCondition, returnStatus };

      if (!isReturned) {
        pendingCount++;
        exceptions.push(ex);
        continue;
      }

      switch (item.returnStatus) {
        case "DAMAGED":
          damagedCount++;
          exceptions.push(ex);
          break;
        case "LOST":
          lostCount++;
          exceptions.push(ex);
          break;
        case "STORED":
          storedCount++;
          break;
        default:
          if (item.returnCondition === "GOOD") {
            storedCount++;
          } else if (item.returnCondition === "DAMAGED") {
            damagedCount++;
            exceptions.push(ex);
          } else if (item.returnCondition === "MISSING") {
            lostCount++;
            exceptions.push(ex);
          } else {
            pendingCount++;
            exceptions.push(ex);
          }
          break;
      }
    }

    const existingClose = await ctx.db
      .query("warehouseCloses")
      .withIndex("by_projectId_organizationId", (q) => q.eq("projectId", projectId).eq("organizationId", orgId))
      .first();
    let closedBy: string | null = null;
    if (existingClose) {
      const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", existingClose.closedById)).unique();
      closedBy = u?.name || null;
    }

    return {
      totalItems: lineItems.length,
      storedCount,
      damagedCount,
      lostCount,
      pendingCount,
      exceptions,
      canClose: pendingCount === 0,
      alreadyClosed: !!existingClose,
      closedAt: existingClose?.closedAt != null ? new Date(existingClose.closedAt).toISOString() : null,
      closedBy,
    };
  },
});
