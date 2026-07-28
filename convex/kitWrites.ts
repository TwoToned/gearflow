import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import { reserveAssetTagCounter } from "./lib/assetTagCounter";
import { adjustBulkAvailability } from "./lib/inventory";
import { releaseKitMembers, getKitGuarded, assignAssetToKit, releaseAsset, getAssetDoc } from "./kits";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import { getKitByCuid } from "./lib/kits";

/**
 * Native KIT write mutations (Phase 5) — same shape as convex/assetWrites.ts:
 * ADDITIVE (the generated convex/kits.ts service mutations are untouched), each
 * enforcing RBAC(requireOrgPermission) + invariants + atomic audit(writeActivityLog)
 * in one transaction. `actor`/`auditId`/`now` are caller-generated (deterministic).
 * Browser-direct (the NATIVE_KIT_WRITES legacy server-action gate was removed in the cutover).
 *
 * Covers create/update/notes (the clean writes). archive/delete use the existing
 * cascade mutations (kits.archiveCascade / deleteCascade) + their own status guards —
 * a separate slice.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * Mirrors `kitSchema` (src/lib/validations/kit.ts) string-length + weight/price bounds —
 * `v.string()`/`v.number()` only enforce type, not these business constraints, so a
 * browser-direct caller bypassing `useKitWrites()`'s client Zod parse would otherwise
 * skip them entirely (R-8.6.2). `assetTag` presence/uniqueness is checked separately by
 * the dup-tag path; only its length is a shared concern here.
 */
function assertKitFields(f: {
  name?: string;
  assetTag?: string;
  description?: string;
  caseType?: string;
  caseDimensions?: string;
  notes?: string;
  weight?: number;
  purchasePrice?: number;
  xeroAccountCode?: string;
}): void {
  if (f.name != null) assertStrLen(f.name, "name", { min: 1, max: 200 });
  if (f.assetTag != null) assertStrLen(f.assetTag, "assetTag", { min: 1, max: 50 });
  assertStrLen(f.description, "description", { max: 2000 });
  assertStrLen(f.caseType, "caseType", { max: 200 });
  assertStrLen(f.caseDimensions, "caseDimensions", { max: 200 });
  assertStrLen(f.notes, "notes", { max: 2000 });
  assertNumRange(f.weight, "weight", { min: 0 });
  assertNumRange(f.purchasePrice, "purchasePrice", { min: 0 });
  assertStrLen(f.xeroAccountCode, "xeroAccountCode", { max: 50 });
}

const kitPatch = v.object({
  organizationId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  categoryId: v.optional(v.string()),
  status: v.optional(enums.KitStatus),
  condition: v.optional(enums.AssetCondition),
  locationId: v.optional(v.string()),
  weight: v.optional(v.number()),
  caseType: v.optional(v.string()),
  caseDimensions: v.optional(v.string()),
  image: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  notes: v.optional(v.string()),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  customFieldValues: v.optional(v.any()),
  tags: v.optional(v.array(v.string())),
  checkMode: v.optional(enums.KitCheckMode),
  isPrep: v.optional(v.boolean()),
  isActive: v.optional(v.boolean()),
  xeroAccountCode: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isActive: v.optional(v.boolean()),
    xeroAccountCode: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "kit", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    const dup = await ctx.db
      .query("kits")
      .withIndex("by_organizationId_assetTag", (q) =>
        q.eq("organizationId", fields.organizationId).eq("assetTag", fields.assetTag),
      )
      .first();
    if (dup) {
      throw new ConvexError({
        code: "DUPLICATE_ASSET_TAG",
        message: `Asset tag "${fields.assetTag}" already exists`,
      });
    }
    // The assetTag guard is org-scoped and does NOT catch a cross-org cuid collision —
    // dup-guard the client-minted id too (else another org's kit getById .unique() crashes).
    const dupId = await getKitByCuid(ctx, fields.id);
    if (dupId) throw new ConvexError("Kit already exists");
    assertKitFields(fields);

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    if (fields.categoryId) await assertRefInOrg(ctx, "categories", fields.categoryId, fields.organizationId);
    if (fields.locationId) await assertRefInOrg(ctx, "locations", fields.locationId, fields.organizationId);

    await ctx.db.insert("kits", fields);
    // Advance the asset-tag counter (parity — createKit reserved 1 after insert).
    await reserveAssetTagCounter(ctx, fields.organizationId, 1, fields.createdAt ?? fields.updatedAt ?? 0);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "kit",
      entityId: fields.id,
      entityName: fields.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created kit ${fields.assetTag} - ${fields.name}`,
      details: { created: { assetTag: fields.assetTag, name: fields.name } },
      kitId: fields.id,
      createdAt: fields.createdAt ?? fields.updatedAt ?? 0,
    });

    return { id: fields.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    patch: kitPatch,
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, patch, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await getKitByCuid(ctx, id);
    if (!doc) throw new ConvexError("Kit not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    assertKitFields(patch);

    if (patch.assetTag && patch.assetTag !== doc.assetTag) {
      const dup = await ctx.db
        .query("kits")
        .withIndex("by_organizationId_assetTag", (q) =>
          q.eq("organizationId", orgId).eq("assetTag", patch.assetTag!),
        )
        .first();
      if (dup && dup.id !== id) {
        throw new ConvexError({
          code: "DUPLICATE_ASSET_TAG",
          message: `Asset tag "${patch.assetTag}" already exists`,
        });
      }
    }

    // Org-validate client-supplied FKs in the patch (by_cuid is GLOBAL — cross-org refs leak).
    if (patch.categoryId) await assertRefInOrg(ctx, "categories", patch.categoryId, orgId);
    if (patch.locationId) await assertRefInOrg(ctx, "locations", patch.locationId, orgId);

    await ctx.db.patch(doc._id, sanitizeClientSet(patch)); // strip organizationId/id — no cross-tenant reassign

    const finalTag = patch.assetTag ?? doc.assetTag;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "kit",
      entityId: id,
      entityName: finalTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated kit ${finalTag} - ${patch.name ?? doc.name}`,
      kitId: id,
      createdAt: now,
    });

    return { id };
  },
});

export const updateNotesNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await getKitByCuid(ctx, id);
    if (!doc) throw new ConvexError("Kit not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { notes: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "kit",
      entityId: id,
      entityName: doc.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated notes on kit ${doc.assetTag}`,
      kitId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});


/**
 * archiveNative / deleteNative — kit soft-retire / hard-delete with the member-release
 * cascade (releaseKitMembers, the SAME helper the service archiveCascade/deleteCascade
 * use) + audit, atomic. RBAC(kit, delete). The status guard (AVAILABLE only) runs
 * inside the mutation.
 */
export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const kit = await getKitByCuid(ctx, id);
    if (!kit || kit.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Kit not found" });
    if (kit.status !== "AVAILABLE") throw new ConvexError({ code: "KIT_NOT_AVAILABLE", message: "Only AVAILABLE kits can be archived" });
    await releaseKitMembers(ctx, id, orgId, now);
    await ctx.db.patch(kit._id, { isActive: false, status: "RETIRED", updatedAt: now });
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "DELETE", entityType: "kit", entityId: id,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Archived kit ${kit.assetTag} - ${kit.name}`, kitId: id, createdAt: now,
    });
    return { id };
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const kit = await getKitByCuid(ctx, id);
    if (!kit || kit.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Kit not found" });
    if (kit.status !== "AVAILABLE") throw new ConvexError({ code: "KIT_NOT_AVAILABLE", message: "Only AVAILABLE kits can be deleted" });

    // Referencing-line-item guard (org-filtered — by_kitId is GLOBAL). Blocks hard
    // delete if any project line item references the kit (preserve historical data).
    const referencing = (await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect())
      .filter((li) => li.organizationId === orgId).length;
    if (referencing > 0) {
      throw new ConvexError({
        code: "KIT_REFERENCED",
        message: `This kit is referenced by ${referencing} project line item${referencing === 1 ? "" : "s"}. Archive it instead, or remove it from those projects first.`,
      });
    }

    await releaseKitMembers(ctx, id, orgId, now);
    await ctx.db.delete(kit._id);

    // Clean up kit-scoped metadata the member cascade doesn't cover (org-filtered).
    // Files are left in storage (parity with the old cascade).
    const checkItems = (await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect())
      .filter((r) => r.organizationId === orgId);
    for (const r of checkItems) await ctx.db.delete(r._id);
    const mediaRows = (await ctx.db.query("kitMedia").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect())
      .filter((r) => r.organizationId === orgId);
    for (const m of mediaRows) await ctx.db.delete(m._id);

    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "DELETE", entityType: "kit", entityId: id,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Permanently deleted kit ${kit.assetTag} - ${kit.name}`, createdAt: now,
    });
    return { id };
  },
});

/**
 * Kit MEMBER writes (Phase 3 browser-direct — replace kits.addSerializedItems /
 * removeSerializedItem / addBulkItem / removeBulkItem). Each runs the 4 guards +
 * the kit-AVAILABLE + per-asset availability guards (via the shared kits.ts
 * helpers) atomically + an audit row (the old server member ops were unaudited;
 * these consequential inventory changes now log). RBAC(kit, update).
 */

export const addSerializedItemsNative = mutation({
  returns: v.object({ ids: v.array(v.string()) }),
  args: {
    orgId: v.string(),
    kitId: v.string(),
    items: v.array(v.object({ assetId: v.string(), position: v.optional(v.string()) })),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { orgId, kitId, items, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    if (items.length === 0) throw new ConvexError("No items to add");

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const ids: string[] = [];
    for (const it of items) {
      // Mirrors kitSerializedItemSchema's `position` bound (R-8.6.2).
      assertStrLen(it.position, "position", { max: 200 });
      const asset = await getAssetDoc(ctx, it.assetId);
      if (!asset || asset.organizationId !== orgId) throw new ConvexError("Asset not found");
      if (asset.status !== "AVAILABLE") throw new ConvexError(`Asset ${asset.assetTag} is not AVAILABLE`);
      if (asset.kitId) throw new ConvexError(`Asset ${asset.assetTag} is already in another kit`);
      if (asset.parentAssetId) throw new ConvexError(`Asset ${asset.assetTag} is an accessory — detach it first`);
      const id = createId();
      await ctx.db.insert("kitSerializedItems", { id, organizationId: orgId, kitId, assetId: it.assetId, position: it.position, addedById: actor.userId, addedAt: now });
      await assignAssetToKit(ctx, asset, kitId, kit.locationId, now);
      ids.push(id);
    }
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Added ${ids.length} asset${ids.length === 1 ? "" : "s"} to kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { ids };
  },
});

export const removeSerializedItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), kitId: v.string(), assetId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, kitId, assetId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const member = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
      .unique();
    if (!member || member.kitId !== kitId) throw new ConvexError("Kit item not found");
    // Org-check the asset before releasing it (releaseAsset fetches by global cuid).
    const asset = await getAssetDoc(ctx, assetId);
    if (asset && asset.organizationId !== orgId) throw new ConvexError("Asset not found");
    await ctx.db.delete(member._id);
    await releaseAsset(ctx, assetId, now);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Removed an asset from kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { id: member.id };
  },
});

export const addBulkItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(), kitId: v.string(), bulkAssetId: v.string(), quantity: v.number(),
    position: v.optional(v.string()), notes: v.optional(v.string()),
    actor: actorValidator, auditId: v.string(), now: v.number(),
  },
  handler: async (ctx, { orgId, kitId, bulkAssetId, quantity, position, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    if (!Number.isInteger(quantity) || quantity < 1) throw new ConvexError("Quantity must be at least 1");
    // Mirrors kitBulkItemSchema's `position`/`notes` bounds (R-8.6.2).
    assertStrLen(position, "position", { max: 200 });
    assertStrLen(notes, "notes", { max: 500 });

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const id = createId();
    await ctx.db.insert("kitBulkItems", { id, organizationId: orgId, kitId, bulkAssetId, quantity, position, notes, addedById: actor.userId, addedAt: now });
    // Guarded decrement (throws + rolls back if insufficient).
    await adjustBulkAvailability(ctx, orgId, [{ bulkAssetId, delta: -quantity }]);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Added ${quantity}× bulk item to kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { id };
  },
});

export const removeBulkItemNative = mutation({
  returns: v.object({ bulkAssetId: v.string() }),
  args: { orgId: v.string(), kitId: v.string(), bulkItemId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, kitId, bulkItemId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const member = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", bulkItemId)).unique();
    if (!member || member.organizationId !== orgId) throw new ConvexError("Bulk item not found");
    if (member.kitId !== kitId) throw new ConvexError("Bulk item does not belong to this kit");
    await ctx.db.delete(member._id);
    await adjustBulkAvailability(ctx, orgId, [{ bulkAssetId: member.bulkAssetId, delta: member.quantity }]);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Removed a bulk item from kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { bulkAssetId: member.bulkAssetId };
  },
});
