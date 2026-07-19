import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertRefInOrg } from "./lib/orgRef";

/**
 * Native CATEGORY write mutations (Phase 3 browser-direct — replaces createCategory/
 * updateCategory/deleteCategory in src/server/categories.ts). Gates on model:*. Standard
 * shape: 4 guards + per-row org re-check + atomic audit. Delete re-implements the old
 * `_count: { children, models }` guard from Convex (no FK cascades — the dropped inbound
 * FKs were SetNull, so deleting just orphans referencing kit.categoryId).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const categoryFields = {
  name: v.string(),
  parentId: v.optional(v.string()),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  sortOrder: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
};

async function logCategory(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; details?: unknown },
) {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: "category",
    entityId: a.id,
    entityName: a.name,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    details: a.details,
    createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    ...categoryFields,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "create");
    const actor = await resolveActor(ctx, a.actor);

    const dup = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Category already exists");

    // Org-validate the client-supplied parent FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.parentId) await assertRefInOrg(ctx, "categories", a.parentId, a.orgId);

    await ctx.db.insert("categories", {
      id: a.id,
      organizationId: a.orgId,
      name: a.name,
      parentId: a.parentId || undefined,
      description: a.description || undefined,
      icon: a.icon || undefined,
      sortOrder: a.sortOrder ?? 0,
      tags: a.tags ?? [],
      suggestedCrewRoles: [],
      createdAt: a.now,
      updatedAt: a.now,
    });
    await logCategory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created category ${a.name}` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    ...categoryFields,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Category not found");

    // Org-validate the client-supplied parent FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.parentId) await assertRefInOrg(ctx, "categories", a.parentId, a.orgId);

    // Clears use `undefined` (Convex removes the optional; the schema rejects null).
    await ctx.db.patch(doc._id, {
      name: a.name,
      parentId: a.parentId || undefined,
      description: a.description || undefined,
      icon: a.icon || undefined,
      sortOrder: a.sortOrder ?? 0,
      tags: a.tags ?? [],
      updatedAt: a.now,
    });
    await logCategory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated category ${a.name}` });
    return { id: a.id };
  },
});

export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Category not found");

    // Delete guards (old Prisma _count): children = categories whose parentId is this
    // id; models = models whose categoryId is this id (both org-scoped).
    const children = (
      await ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect() // r9.8-ok: bounded per-org config/catalog set
    ).filter((c) => c.parentId === a.id);
    if (children.length > 0) throw new ConvexError("Cannot delete category with subcategories");
    const models = (
      await ctx.db.query("models").withIndex("by_categoryId", (q) => q.eq("categoryId", a.id)).collect()
    ).filter((m) => m.organizationId === a.orgId);
    if (models.length > 0) throw new ConvexError("Cannot delete category with models");

    await ctx.db.delete(doc._id);
    await logCategory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: doc.name, summary: `Deleted category ${doc.name}`, details: { deleted: { name: doc.name } } });
    return { id: a.id };
  },
});
