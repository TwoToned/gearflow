import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { writeActivityLog } from "./lib/audit";
import { bumpAssetCounters } from "./lib/counters";
import * as enums from "./lib/validators";

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
    await assertWritesEnabled(ctx, "asset"); // browser-direct kill-switch
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
    await bumpAssetCounters(ctx, orgId, asset, { isActive: false, status: "RETIRED" });

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
    await bumpAssetCounters(ctx, orgId, asset, null);

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

// Patchable asset fields (mirrors convex/assets.ts assetSet — kept local so a CRUD
// regen of assets.ts can't clobber the native-write path). Reused by updateNative.
const assetSet = v.object({
  modelId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  customName: v.optional(v.string()),
  status: v.optional(enums.AssetStatus),
  condition: v.optional(enums.AssetCondition),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  purchaseSupplier: v.optional(v.string()),
  supplierId: v.optional(v.string()),
  purchaseOrderNumber: v.optional(v.string()),
  supplierOrderId: v.optional(v.string()),
  warrantyExpiry: v.optional(v.number()),
  notes: v.optional(v.string()),
  locationId: v.optional(v.string()),
  customFieldValues: v.optional(v.any()),
  lastTestAndTagDate: v.optional(v.number()),
  nextTestAndTagDate: v.optional(v.number()),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  kitId: v.optional(v.string()),
  parentAssetId: v.optional(v.string()),
});
const ASSET_NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

/**
 * createNative — insert an asset with the dup-tag guard + CREATE audit in ONE
 * transaction. RBAC(asset,create). The dup guard (by_organizationId_assetTag) and
 * the audit are now atomic with the insert, closing the check-then-write race two
 * concurrent creates of the same tag hit in the server-action path. Zod + custom-
 * field validation + the Postgres tag counter + T&T auto-register stay in the server
 * action (create is a form submit, not a client-direct optimistic write). Throws
 * ConvexError({code:"DUPLICATE_ASSET_TAG"}) → mapped to UserFacingError by the caller.
 */
export const createNative = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, auditId, ...fields } = args;
    await requireOrgPermission(ctx, fields.organizationId, "asset", "create");

    const dup = await ctx.db
      .query("assets")
      .withIndex("by_organizationId_assetTag", (q) =>
        q.eq("organizationId", fields.organizationId).eq("assetTag", fields.assetTag),
      )
      .first();
    if (dup) {
      throw new ConvexError({
        code: "DUPLICATE_ASSET_TAG",
        message: `Asset tag "${fields.assetTag}" already exists.`,
      });
    }

    await ctx.db.insert("assets", fields);
    await bumpAssetCounters(ctx, fields.organizationId, null, fields);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "asset",
      entityId: fields.id,
      entityName: fields.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created asset ${fields.assetTag}`,
      details: { created: { assetTag: fields.assetTag, modelId: fields.modelId } },
      assetId: fields.id,
      createdAt: fields.createdAt ?? fields.updatedAt ?? 0,
    });

    return { id: fields.id };
  },
});

/**
 * updateNative — apply a set/clear patch (the patchAsset clear-to-null pattern) with
 * the tag-change dup guard + UPDATE audit, all in one transaction. RBAC(asset,update).
 * The server action still does Zod + custom-field validation (+ builds set/clear) and
 * the T&T backfill; the dup guard + audit move here (atomic).
 */
export const updateNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    set: assetSet,
    clear: v.array(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "asset", "update");

    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Asset not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // DUP GUARD only when the tag changed (mirrors updateAsset).
    if (set.assetTag && set.assetTag !== doc.assetTag) {
      const dup = await ctx.db
        .query("assets")
        .withIndex("by_organizationId_assetTag", (q) =>
          q.eq("organizationId", orgId).eq("assetTag", set.assetTag!),
        )
        .first();
      if (dup && dup.id !== id) {
        throw new ConvexError({
          code: "DUPLICATE_ASSET_TAG",
          message: `Asset tag "${set.assetTag}" already exists.`,
        });
      }
    }

    // Apply set (+ clear-to-null) — the patchAsset pattern.
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      await bumpAssetCounters(ctx, orgId, doc, { ...doc, ...set });
    } else {
      const { _id, _creationTime, ...rest } = doc;
      const merged: Record<string, unknown> = { ...rest, ...set };
      for (const k of clear) {
        if (ASSET_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(doc._id, merged as typeof rest);
      await bumpAssetCounters(ctx, orgId, doc, merged);
    }

    const finalTag = set.assetTag ?? doc.assetTag;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: finalTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated asset ${finalTag}`,
      assetId: id,
      createdAt: now,
    });

    return { id };
  },
});
