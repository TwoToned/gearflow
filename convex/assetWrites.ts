import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";

/**
 * Native ASSET write mutations (Phase 5 — Convex becomes the domain layer, not just
 * a write target).
 *
 * ADDITIVE + ISOLATED: the generated service mutations in convex/assets.ts are left
 * untouched, so the live server-action write path is unchanged. These new mutations
 * are the native path — each enforces, in ONE transaction:
 *   • RBAC (requireOrgPermission — 5a): the same resource/action the server action's
 *     requirePermission checked, now unbypassable at the Convex boundary. Because
 *     Convex mutations are PUBLIC, this is what makes it safe for a browser/user token
 *     to call the mutation directly (5d optimistic) — relaxing requireService without
 *     this would open a hole.
 *   • Domain invariants (5b): per-mutation (dup-tag guards, status rules, …).
 *   • Atomic audit (5c): the activityLogs row is written in the same transaction as
 *     the data change via writeActivityLog, so data + audit can't drift.
 *
 * `actor` carries the acting user for the audit trail (a service-token call has no
 * user identity of its own, so the caller passes it; a user-token call can pass its
 * own id). `auditId` + `now` are caller-generated (a Convex mutation can't mint a
 * cuid — Math.random is non-deterministic) and keep the write deterministic.
 *
 * `updateNotesNative` is the mechanism-prover: the simplest asset write (notes-only,
 * no cross-entity invariant) exercising the full RBAC + atomic-audit pattern that the
 * heavier create/update/delete mutations will reuse.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const updateNotesNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, notes, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "asset", "update");

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    // Defence in depth: the RBAC guard already checked the token's org, but the
    // asset must belong to it too (a valid member of org A can't edit org B's asset).
    if (asset.organizationId !== orgId) {
      throw new ConvexError("Forbidden: organization mismatch.");
    }

    // `undefined` clears the field (matches updateAssetNotes' clear-to-null).
    await ctx.db.patch(asset._id, { notes: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated notes on asset ${asset.assetTag}`,
      assetId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});

/**
 * archiveNative — soft-retire an asset (isActive:false + status RETIRED) and retire
 * any linked test&tag entries, all in one transaction. RBAC(asset,update). Mirrors
 * archiveAsset (src/server/assets.ts:865); adds an audit row (the server action
 * wrote none — an intentional improvement, not a parity break on data state).
 */
export const archiveNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "asset", "update");

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    if (asset.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Retire linked T&T entries (Convex-only write — same as archiveAsset).
    const linkedTT = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id))
      .collect();
    for (const tt of linkedTT) {
      await ctx.db.patch(tt._id, { status: "RETIRED", isActive: false, updatedAt: now });
    }

    await ctx.db.patch(asset._id, { isActive: false, status: "RETIRED", updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Archived asset ${asset.assetTag}`,
      details: { archived: true },
      assetId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});

/**
 * deleteNative — hard-delete an asset. Enforces the orphan guards transactionally
 * (mirrors deleteAsset, src/server/assets.ts:771): reject if it's referenced by any
 * project line item, is a kit member, or has serialized/bulk accessory children.
 * Retires linked T&T entries, then removes the row + writes the DELETE audit — all
 * atomic, so the guards can't race the delete. RBAC(asset,delete).
 *
 * Throws a distinct ConvexError code per guard so the client can surface the exact
 * reason (the mirror/UI reads `error.data`).
 */
export const deleteNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "asset", "delete");

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    if (asset.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    const lineItems = await ctx.db
      .query("projectLineItems")
      .withIndex("by_assetId", (q) => q.eq("assetId", id))
      .collect();
    if (lineItems.some((li) => li.organizationId === orgId)) {
      throw new ConvexError({ code: "ASSET_IN_USE", message: "This asset is referenced by project line items." });
    }

    const kitMember = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id))
      .first();
    if (kitMember) {
      throw new ConvexError({ code: "ASSET_IN_KIT", message: "This asset is part of a kit." });
    }

    const childAssets = await ctx.db
      .query("assets")
      .withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id))
      .collect();
    const childBulk = await ctx.db
      .query("assetBulkChildren")
      .withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id))
      .collect();
    if (childAssets.some((c) => c.organizationId === orgId) || childBulk.some((c) => c.organizationId === orgId)) {
      throw new ConvexError({ code: "ASSET_HAS_ACCESSORIES", message: "This asset has accessories attached." });
    }

    // Retire linked T&T entries (Convex-only write — same as deleteAsset).
    const linkedTT = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id))
      .collect();
    for (const tt of linkedTT) {
      await ctx.db.patch(tt._id, { status: "RETIRED", isActive: false, updatedAt: now });
    }

    await ctx.db.delete(asset._id);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted asset ${asset.assetTag}`,
      details: { deleted: { assetTag: asset.assetTag } },
      assetId: id,
      createdAt: now,
    });

    return { id };
  },
});
