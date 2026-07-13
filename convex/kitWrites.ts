import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import { releaseKitMembers } from "./kits";
import * as enums from "./lib/validators";

/**
 * Native KIT write mutations (Phase 5) — same shape as convex/assetWrites.ts:
 * ADDITIVE (the generated convex/kits.ts service mutations are untouched), each
 * enforcing RBAC(requireOrgPermission) + invariants + atomic audit(writeActivityLog)
 * in one transaction. `actor`/`auditId`/`now` are caller-generated (deterministic).
 * Gated live behind NATIVE_KIT_WRITES in src/server/kits.ts.
 *
 * Covers create/update/notes (the clean writes). archive/delete use the existing
 * cascade mutations (kits.archiveCascade / deleteCascade) + their own status guards —
 * a separate slice.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

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
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

export const createNative = mutation({
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

    await ctx.db.insert("kits", fields);

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

    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Kit not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

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

    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
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
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
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
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!kit || kit.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Kit not found" });
    if (kit.status !== "AVAILABLE") throw new ConvexError({ code: "KIT_NOT_AVAILABLE", message: "Only AVAILABLE kits can be deleted" });
    await releaseKitMembers(ctx, id, orgId, now);
    await ctx.db.delete(kit._id);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "DELETE", entityType: "kit", entityId: id,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Deleted kit ${kit.assetTag} - ${kit.name}`, kitId: id, createdAt: now,
    });
    return { id };
  },
});
