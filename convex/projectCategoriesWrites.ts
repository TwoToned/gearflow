import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertProjectInOrg } from "./projectLineItems";

/**
 * Native PROJECT-CATEGORY write mutations (Phase 3 browser-direct — replaces the
 * create/update/delete/reorder ProjectCategory server actions in
 * src/server/project-categories.ts). All four gate on `project:manage_line_items`
 * (exact parity with the deleted actions' requirePermission("project","manage_line_items")).
 *
 * These are fully browser-direct with NO server round-trip: the category/group/slot/
 * line-item tables are all Convex-native, so the create-at-end / cascade / reorder that
 * the server actions split across N Convex calls now run as ONE atomic mutation each
 * (serializable across every doc they touch — OCC retries the loser of a write-write
 * race). Standard shape: 4 guards + resolveActor + per-row org re-check on every
 * by_cuid / global-index fetch + atomic writeActivityLog (where the server logActivity'd).
 *
 * The existing `requireService` mirrors in projectCategories.ts (backfill + the
 * deleteAllForProject project-delete cascade) are intentionally UNTOUCHED.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const NAME_MIN = 1;
const NAME_MAX = 100; // src/lib/validations/project-category.ts

/** Validate a category name (parity with projectCategorySchema: min 1, max 100). */
function assertValidName(name: string) {
  if (name.length < NAME_MIN) throw new ConvexError("Name is required");
  if (name.length > NAME_MAX) throw new ConvexError("Name must be at most 100 characters");
}

// ─── Collaboration colour (deterministic from userId) ────────────────────────
// Inlined from src/lib/collaboration-colors.ts getUserColor so the collab activity
// event written inside updateCategoryNative is byte-identical to the one the server
// action emitted via writeCollabActivityEvent (which derived the colour the same way).
// 12 distinct hues, skipping red/orange (reserved for error/warning semantics).
const COLLAB_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#0891b2", "#059669", "#65a30d",
  "#d97706", "#0d9488", "#4f46e5", "#9333ea", "#0284c7", "#16a34a",
] as const;

function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

/** Fetch a category by cuid and confirm it belongs to the caller's org (by_cuid is global). */
async function requireCategoryInOrg(ctx: MutationCtx, categoryId: string, orgId: string) {
  const cat = await ctx.db
    .query("projectCategories")
    .withIndex("by_cuid", (q) => q.eq("id", categoryId))
    .first();
  if (!cat || cat.organizationId !== orgId) throw new ConvexError("Category not found");
  return cat;
}

async function logCategoryChange(
  ctx: MutationCtx,
  args: {
    orgId: string;
    projectId: string;
    actor: Actor;
    auditId: string;
    now: number;
    action: string;
    entityName: string;
    summary: string;
  },
) {
  await writeActivityLog(ctx, {
    id: args.auditId,
    organizationId: args.orgId,
    action: args.action,
    entityType: "project",
    entityId: args.projectId,
    projectId: args.projectId,
    entityName: args.entityName,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary: args.summary,
    createdAt: args.now,
  });
}

/**
 * Atomic create-at-end: compute max(sortOrder)+1 across the project's categories and
 * insert in one transaction (no read-max-then-insert TOCTOU). Caller supplies the cuid.
 * by_cuid short-circuit keeps it idempotent under a retried/duplicate submit.
 */
export const createCategoryNative = mutation({
  returns: v.object({ id: v.string(), sortOrder: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    name: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, projectId, name, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "projectCategory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);
    assertValidName(name);
    // Client-supplied projectId: prove it's the caller's org before inserting a category
    // that references it (by_cuid/by_projectId are GLOBAL — else a member could attach a
    // category to another org's project).
    await assertProjectInOrg(ctx, projectId, orgId);

    // Idempotent: a retried create with the same cuid short-circuits (no dup row,
    // no second audit — the by_cuid index is global so re-check org on a hit).
    const existing = await ctx.db
      .query("projectCategories")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (existing) {
      if (existing.organizationId !== orgId) throw new ConvexError("Category not found");
      return { id, sortOrder: existing.sortOrder ?? 0 };
    }

    // by_projectId is a GLOBAL index — org-filter before computing max(sortOrder).
    const siblings = (
      await ctx.db
        .query("projectCategories")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter((c) => c.organizationId === orgId);
    const sortOrder = siblings.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1;

    await ctx.db.insert("projectCategories", {
      id,
      organizationId: orgId,
      projectId,
      name,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });

    await logCategoryChange(ctx, {
      orgId,
      projectId,
      actor,
      auditId,
      now,
      action: "created",
      entityName: name,
      summary: `Created category "${name}"`,
    });

    return { id, sortOrder };
  },
});

/**
 * Patch a category's name / sortOrder. Strips organizationId + id (never client-set).
 * When the name changes, ALSO records the collaboration activity event the server
 * action wrote via writeCollabActivityEvent (atomic here instead of a second call).
 */
export const updateCategoryNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    name: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, name, sortOrder, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "projectCategory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const category = await requireCategoryInOrg(ctx, id, orgId);
    if (name !== undefined) assertValidName(name);

    const patch: { name?: string; sortOrder?: number; updatedAt: number } = { updatedAt: now };
    if (name !== undefined) patch.name = name;
    if (sortOrder !== undefined) patch.sortOrder = sortOrder;
    await ctx.db.patch(category._id, patch);

    // Parity: the server logged the PRE-patch name (category.name) as entityName +
    // in the summary — replicated verbatim here.
    await logCategoryChange(ctx, {
      orgId,
      projectId: category.projectId,
      actor,
      auditId,
      now,
      action: "updated",
      entityName: category.name,
      summary: `Updated category "${category.name}"`,
    });

    // Realtime collaboration feed event (only on a rename) — uses the NEW name,
    // exactly like the server's writeCollabActivityEvent(action: "category_updated").
    if (name !== undefined) {
      await ctx.db.insert("activityEvents", {
        orgId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: getUserColor(actor.userId),
        entityType: "project",
        entityId: category.projectId,
        targetType: "category",
        targetId: id,
        action: "category_updated",
        summary: `renamed a category to "${name}"`,
        createdAt: now,
      });
    }

    return { ok: true };
  },
});

/**
 * Atomic cascade delete of a category. Folds in the line-item null-out the server
 * action did as a separate step, so the whole thing is one transaction:
 *   1. groups = projectGroups by_categoryId (org-filtered)
 *   2. affected top-level lines = projectLineItems where
 *      (groupId ∈ groupIds) OR (categoryId === categoryId && groupId == null), org-filtered
 *   3. clear categoryId + groupId (+ updatedAt) on each affected line
 *   4. for each group: delete its categorySlots (by_projectGroupId) then the group
 *   5. delete the category's categorySlots (by_projectCategoryId)
 *   6. delete the category
 * N = count of affected lines (goes into the audit summary).
 */
export const deleteCategoryNative = mutation({
  returns: v.object({ ok: v.boolean(), movedLineItems: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "projectCategory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const category = await requireCategoryInOrg(ctx, id, orgId);

    // 1. Groups in this category (by_categoryId is global — org-filter).
    const groups = (
      await ctx.db
        .query("projectGroups")
        .withIndex("by_categoryId", (q) => q.eq("categoryId", id))
        .collect()
    ).filter((g) => g.organizationId === orgId);
    const groupIds = new Set(groups.map((g) => g.id));

    // 2. Affected top-level lines (by_projectId is global — org-filter).
    const affected = (
      await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", category.projectId))
        .collect()
    ).filter(
      (li) =>
        li.organizationId === orgId &&
        ((li.groupId != null && groupIds.has(li.groupId)) ||
          (li.categoryId === id && li.groupId == null)),
    );

    // 3. Null out categoryId + groupId on each affected line (moves to uncategorized).
    for (const li of affected) {
      await ctx.db.patch(li._id, { categoryId: undefined, groupId: undefined, updatedAt: now });
    }

    // 4. Delete each group's slots then the group itself.
    for (const g of groups) {
      const gslots = await ctx.db
        .query("categorySlots")
        .withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", g.id))
        .collect();
      for (const s of gslots) await ctx.db.delete(s._id);
      await ctx.db.delete(g._id);
    }

    // 5. Delete the category's own slots.
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", id))
      .collect();
    for (const s of catSlots) await ctx.db.delete(s._id);

    // 6. Delete the category.
    await ctx.db.delete(category._id);

    const n = affected.length;
    await logCategoryChange(ctx, {
      orgId,
      projectId: category.projectId,
      actor,
      auditId,
      now,
      action: "deleted",
      entityName: category.name,
      summary: `Deleted category "${category.name}" — ${n} items moved to uncategorized`,
    });

    return { ok: true, movedLineItems: n };
  },
});

/**
 * Atomic reorder: sortOrder = index for each id, in one transaction. Per-id by_cuid
 * fetch + org re-check (by_cuid is global). NO audit — parity with the server reorder,
 * which never called logActivity.
 */
export const reorderCategoriesNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    orderedIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, { orgId, orderedIds, now, actor: suppliedActor }) => {
    await assertWritesEnabled(ctx, "projectCategory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    await resolveActor(ctx, suppliedActor);

    for (let i = 0; i < orderedIds.length; i++) {
      const doc = await ctx.db
        .query("projectCategories")
        .withIndex("by_cuid", (q) => q.eq("id", orderedIds[i]))
        .first();
      if (doc && doc.organizationId === orgId) {
        await ctx.db.patch(doc._id, { sortOrder: i, updatedAt: now });
      }
    }
    return { ok: true };
  },
});
