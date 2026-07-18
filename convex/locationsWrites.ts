import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";

/**
 * Native LOCATION write mutations (Phase 3 browser-direct — replaces createLocation/
 * updateLocation/deleteLocation/updateLocationNotes in src/server/locations.ts). Gates on
 * location:*. Standard shape: 4 guards + per-row org re-check + atomic audit. Invariants
 * re-implemented (no FK cascades): single-default-per-org (clear other defaults before
 * setting one), delete-guards (children / assets / bulkAssets block), and the dropped
 * locationMedia Cascade (remove the location's media rows on delete).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const locationFields = {
  name: v.string(),
  address: v.optional(v.string()),
  latitude: v.optional(v.union(v.number(), v.null())),
  longitude: v.optional(v.union(v.number(), v.null())),
  type: v.optional(enums.LocationType),
  isDefault: v.optional(v.boolean()),
  parentId: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
};

/** Clear isDefault on every other current default in the org (single-default invariant). */
async function unsetOtherDefaults(ctx: MutationCtx, orgId: string, exceptId: string | undefined, now: number) {
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
  for (const l of locs) {
    if (l.isDefault && l.id !== exceptId) await ctx.db.patch(l._id, { isDefault: false, updatedAt: now });
  }
}

async function logLocation(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; details?: unknown },
) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "location",
    entityId: a.id, entityName: a.name, userId: a.actor.userId, userName: a.actor.userName,
    summary: a.summary, details: a.details, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...locationFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "create");
    const actor = await resolveActor(ctx, a.actor);

    const dup = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Location already exists");
    // Org-validate the client-supplied parent FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.parentId) await assertRefInOrg(ctx, "locations", a.parentId, a.orgId);
    if (a.isDefault) await unsetOtherDefaults(ctx, a.orgId, undefined, a.now);

    await ctx.db.insert("locations", {
      id: a.id, organizationId: a.orgId, name: a.name,
      address: a.address || undefined, latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined,
      type: a.type ?? "WAREHOUSE", isDefault: a.isDefault ?? false,
      parentId: a.parentId || undefined, notes: a.notes || undefined, tags: a.tags ?? [],
      createdAt: a.now, updatedAt: a.now,
    });
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created location ${a.name}` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...locationFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");
    // Org-validate the client-supplied parent FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.parentId) await assertRefInOrg(ctx, "locations", a.parentId, a.orgId);
    if (a.isDefault) await unsetOtherDefaults(ctx, a.orgId, a.id, a.now);

    // Clears use `undefined` (schema optionals reject null).
    await ctx.db.patch(doc._id, {
      name: a.name, address: a.address || undefined,
      latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined,
      type: a.type ?? "WAREHOUSE", isDefault: a.isDefault ?? false,
      parentId: a.parentId || undefined, notes: a.notes || undefined, tags: a.tags ?? [], updatedAt: a.now,
    });
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated location ${a.name}` });
    return { id: a.id };
  },
});

export const updateNotesNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), notes: v.union(v.string(), v.null()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "update");
    await resolveActor(ctx, a.actor); // pins identity (no audit row in the original notes path)

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");
    await ctx.db.patch(doc._id, { notes: a.notes || undefined, updatedAt: a.now });
    return { id: a.id };
  },
});

export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");

    // Delete-guards (old Prisma _count): children / assets / bulkAssets block.
    const children = (
      await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect()
    ).filter((l) => l.parentId === a.id);
    if (children.length > 0) throw new ConvexError("Cannot delete location with sub-locations");
    const assets = await ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect();
    const bulk = await ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect();
    if (assets.some((x) => x.locationId === a.id) || bulk.some((x) => x.locationId === a.id)) {
      throw new ConvexError("Cannot delete location with assets assigned to it");
    }

    // locationMedia Cascade re-implementation: remove the location's media rows.
    const media = await ctx.db.query("locationMedia").withIndex("by_locationId", (q) => q.eq("locationId", a.id)).collect();
    for (const m of media) if (m.organizationId === a.orgId) await ctx.db.delete(m._id);

    await ctx.db.delete(doc._id);
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: doc.name, summary: `Deleted location ${doc.name}`, details: { deleted: { name: doc.name } } });
    return { id: a.id };
  },
});
