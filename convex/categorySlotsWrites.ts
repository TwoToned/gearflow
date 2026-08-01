import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import { assertLifecycleGuard, lifecycleAuditMetadata, type LifecycleGuardResult } from "./lib/projectLocks";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Native CROSS-TYPE CATEGORY-SLOT write mutations (Phase 3 browser-direct —
 * replaces moveSubHireGroupToCategory / moveProjectGroupToCategory /
 * reorderMixedGroupsInCategory / createCategoryAndPlaceGroup in
 * src/server/category-slots.ts).
 *
 * CategorySlot owns the canonical cross-type sortOrder for the interleaved
 * ProjectGroup + SubHireGroup list inside a ProjectCategory. These four
 * mutations are the only writers of that ordering + placement. They are
 * RECALC-COUPLED (a placement move can change booked equipment revenue — a
 * grouped sub-hire's charge shifts category), so every write that changes a
 * project's revenue folds the in-mutation recalcProjectTotals (byte-for-byte
 * the server's recalculateProjectTotals) into the SAME transaction. Reordering
 * display slots does NOT change revenue → no recalc (parity with the server
 * reorder). The org default tax rate lives in Postgres (no Convex mirror
 * writer) — read inline from the orgSettings mirror.
 *
 * RBAC parity with the deleted actions:
 *   - moveSubHireGroupToCategory  → project:manage_line_items + subHire:update
 *   - moveProjectGroupToCategory  → project:manage_line_items
 *   - reorderMixedGroupsInCategory→ project:manage_line_items + subHire:update
 *   - createCategoryAndPlaceGroup → project:manage_line_items
 *
 * The `requireService` mirrors in categorySlots.ts (backfill + the slot
 * upsert/reorder helpers still called by not-yet-converted paths) are
 * intentionally UNTOUCHED. by_cuid / by_projectId / by_projectGroupId etc. are
 * GLOBAL indexes — every fetch is org-re-checked. categorySlots / subHireGroups
 * / subHireItems carry NO organizationId, so their org is authorised via the
 * parent project / sub-hire. Every caller-supplied target category/group/
 * sub-hire-group ref is org + project validated up front (the cross-tenant /
 * cross-project dangling-reference class).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const NAME_MIN = 1;
const NAME_MAX = 100; // src/lib/validations/category-slot.ts createCategoryAndPlaceGroupSchema

function assertValidName(name: string) {
  if (name.length < NAME_MIN) throw new ConvexError("Name is required");
  if (name.length > NAME_MAX) throw new ConvexError("Name must be at most 100 characters");
}

// ─── Slot-id prefixes ──────────────────────────────────────────────────────
const PG_PREFIX = "pg-";
const SHG_PREFIX = "shg-";
const LI_PREFIX = "li-";
function parseSlotId(
  id: string,
): { kind: "projectGroup"; id: string } | { kind: "subHireGroup"; id: string } | { kind: "lineItem"; id: string } | null {
  if (id.startsWith(PG_PREFIX)) return { kind: "projectGroup", id: id.slice(PG_PREFIX.length) };
  if (id.startsWith(SHG_PREFIX)) return { kind: "subHireGroup", id: id.slice(SHG_PREFIX.length) };
  if (id.startsWith(LI_PREFIX)) return { kind: "lineItem", id: id.slice(LI_PREFIX.length) };
  return null;
}

// ─── Shared fetch helpers (by_cuid + by_projectId are GLOBAL — org re-check) ──

/** Fetch a project group by cuid, confirm it's the caller's org. */
async function requireGroupInOrg(ctx: MutationCtx, groupId: string, orgId: string): Promise<Doc<"projectGroups">> {
  const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
  if (!g || g.organizationId !== orgId) throw new ConvexError("Project group not found");
  return g;
}

/** Confirm a category cuid is the caller's org (by_cuid is global). Returns the doc. */
async function requireCategoryInOrg(ctx: MutationCtx, categoryId: string, orgId: string): Promise<Doc<"projectCategories">> {
  const c = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", categoryId)).first();
  if (!c || c.organizationId !== orgId) throw new ConvexError("Category not found");
  return c;
}

/**
 * Resolve a sub-hire group by cuid + its parent sub-hire, and org-check via the
 * parent (subHireGroups carry NO organizationId). Returns both docs. Throws if
 * missing / cross-org so a doctored group id can't reach another tenant's data.
 */
async function requireSubHireGroupInOrg(
  ctx: MutationCtx,
  subHireGroupId: string,
  orgId: string,
): Promise<{ group: Doc<"subHireGroups">; subHire: Doc<"subHires"> }> {
  const group = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", subHireGroupId)).first();
  if (!group) throw new ConvexError("Sub-hire group not found");
  const subHire = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", group.subHireId)).first();
  if (!subHire || subHire.organizationId !== orgId) throw new ConvexError("Sub-hire group not found");
  return { group, subHire };
}

/** Fetch a project by cuid, confirm it's the caller's org. Returns null when absent/foreign. */
async function getProjectInOrg(ctx: MutationCtx, projectId: string, orgId: string): Promise<Doc<"projects"> | null> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  return p && p.organizationId === orgId ? p : null;
}

/** Org default tax rate from the orgSettings mirror (Postgres-authoritative). */
async function orgDefaultTaxRate(ctx: MutationCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

async function logSlotChange(
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
    metadata?: unknown;
  },
): Promise<void> {
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
    metadata: args.metadata,
    createdAt: args.now,
  });
}

// ─── Slot management (inline ports of the requireService mirrors) ─────────────

/** Reject a client-minted slot cuid that already exists (by_cuid is global + non-unique):
 *  a reused id would double-insert and break `.unique()` reads — possibly cross-org. */
async function assertSlotIdFree(ctx: MutationCtx, slotId: string): Promise<void> {
  const dup = await ctx.db.query("categorySlots").withIndex("by_cuid", (q) => q.eq("id", slotId)).first();
  if (dup) throw new ConvexError("Slot already exists");
}

/**
 * Atomic move of a project-group slot: delete every existing slot for the group,
 * then create one at max(sortOrder)+1 in the destination category (null → the
 * group leaves every category). Single transaction = concurrency-safe. Port of
 * categorySlots.upsertSlotForProjectGroup.
 */
async function upsertSlotForProjectGroup(
  ctx: MutationCtx,
  projectGroupId: string,
  destCategoryId: string | null,
  newSlotId: string,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("categorySlots")
    .withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", projectGroupId))
    .collect();
  for (const slot of existing) await ctx.db.delete(slot._id);
  if (destCategoryId) {
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", destCategoryId))
      .collect();
    const maxSort = catSlots.reduce((m, s) => Math.max(m, s.sortOrder), -1);
    await assertSlotIdFree(ctx, newSlotId);
    await ctx.db.insert("categorySlots", {
      id: newSlotId,
      projectCategoryId: destCategoryId,
      projectGroupId,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/** As above, for a sub-hire group. Port of categorySlots.upsertSlotForSubHireGroup. */
async function upsertSlotForSubHireGroup(
  ctx: MutationCtx,
  subHireGroupId: string,
  destCategoryId: string | null,
  newSlotId: string,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("categorySlots")
    .withIndex("by_subHireGroupId", (q) => q.eq("subHireGroupId", subHireGroupId))
    .collect();
  for (const slot of existing) await ctx.db.delete(slot._id);
  if (destCategoryId) {
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", destCategoryId))
      .collect();
    const maxSort = catSlots.reduce((m, s) => Math.max(m, s.sortOrder), -1);
    await assertSlotIdFree(ctx, newSlotId);
    await ctx.db.insert("categorySlots", {
      id: newSlotId,
      projectCategoryId: destCategoryId,
      subHireGroupId,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * As above, for a standalone (non-grouped) top-level line item. A line item
 * only occupies a slot while it's a standalone member of a category —
 * `moveLineItemNative` (projectGroupsWrites.ts) calls this on every move,
 * with `destCategoryId: null` whenever the line item becomes grouped
 * (targetGroupId set) or uncategorised, clearing any stale slot the same way
 * a group leaving a category clears its own. Exported for that cross-file
 * call — no circular import (projectGroupsWrites.ts doesn't export anything
 * this file needs). Port pattern: upsertSlotForProjectGroup/
 * upsertSlotForSubHireGroup above.
 */
export async function upsertSlotForLineItem(
  ctx: MutationCtx,
  lineItemId: string,
  destCategoryId: string | null,
  newSlotId: string,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("categorySlots")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
    .collect();
  for (const slot of existing) await ctx.db.delete(slot._id);
  if (destCategoryId) {
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", destCategoryId))
      .collect();
    const maxSort = catSlots.reduce((m, s) => Math.max(m, s.sortOrder), -1);
    await assertSlotIdFree(ctx, newSlotId);
    await ctx.db.insert("categorySlots", {
      id: newSlotId,
      projectCategoryId: destCategoryId,
      lineItemId,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// moveSubHireGroupToCategory — move a sub-hire group into a category (or to
// uncategorised when categoryId is null). Patches subHireGroups.targetCategoryId,
// syncs the group's top-level line items' categoryId, upserts its category slot,
// then recalc. Deliberately does NOT regenerate the sub-hire line items
// (placement is metadata). Parity: src/server/category-slots.moveSubHireGroupToCategory.
// ─────────────────────────────────────────────────────────────────────────────
export const moveSubHireGroupToCategory = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    groupId: v.string(),
    orgId: v.string(),
    categoryId: v.union(v.string(), v.null()),
    slotId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // Required once the sub-hire's project is JUSTIFY+ and no unlock session is
    // open — this mutation previously bypassed the lifecycle lock entirely.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "categorySlot");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const { group, subHire } = await requireSubHireGroupInOrg(ctx, a.groupId, a.orgId);
    const projectId = subHire.projectId ?? null;
    let guard: LifecycleGuardResult | null = null;
    if (projectId != null) {
      const project = await getProjectInOrg(ctx, projectId, a.orgId);
      if (!project) throw new ConvexError("Project not found");
      guard = await assertLifecycleGuard(ctx, project, { kind: "structural", justification: a.justification });
    }

    // Validate the destination category is the caller's org + this sub-hire's project.
    let destCategoryId: string | null = null;
    if (a.categoryId != null) {
      const category = await requireCategoryInOrg(ctx, a.categoryId, a.orgId);
      if (projectId != null && category.projectId !== projectId) {
        throw new ConvexError("Cannot move sub-hire group across projects");
      }
      destCategoryId = category.id;
    }

    // 1. Sub-hire group placement (Convex-only).
    await ctx.db.patch(group._id, {
      targetCategoryId: destCategoryId != null ? destCategoryId : undefined,
    });

    // 2. Keep the synthetic parent line items' categoryId in sync (top-level lines
    //    for this sub-hire group). by_projectId is GLOBAL — org-filter.
    if (projectId != null) {
      const lines = (
        await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
      ).filter(
        (li) =>
          li.organizationId === a.orgId &&
          li.subHireGroupId === a.groupId &&
          !li.isKitChild &&
          li.parentLineItemId == null,
      );
      for (const li of lines) {
        await ctx.db.patch(li._id, {
          categoryId: destCategoryId != null ? destCategoryId : undefined,
          updatedAt: a.now,
        });
      }
    }

    // 3. CategorySlot upsert (atomic — delete existing + create in dest).
    await upsertSlotForSubHireGroup(ctx, a.groupId, destCategoryId, a.slotId, a.now);

    // 4. Recalc + audit (only when the sub-hire is attached to a project).
    if (projectId != null) {
      const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
      await recalcProjectTotals(ctx, projectId, a.orgId, taxRate, a.now);
      await logSlotChange(ctx, {
        orgId: a.orgId,
        projectId,
        actor,
        auditId: a.auditId,
        now: a.now,
        action: "updated",
        entityName: `Sub-hire group ${a.groupId}`,
        summary: destCategoryId
          ? `Moved sub-hire group to category ${destCategoryId}`
          : `Moved sub-hire group to uncategorised`,
        metadata: guard ? lifecycleAuditMetadata(guard, a.justification) : undefined,
      });
    }

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// moveProjectGroupToCategory — move a project group into a different category
// (or to uncategorised when categoryId is null). Patches projectGroups.categoryId,
// syncs member line items' categoryId, upserts its category slot, then recalc.
// No-op fast path when already in the destination. Parity:
// src/server/category-slots.moveProjectGroupToCategory.
// ─────────────────────────────────────────────────────────────────────────────
export const moveProjectGroupToCategory = mutation({
  returns: v.object({ ok: v.boolean(), noop: v.optional(v.boolean()) }),
  args: {
    groupId: v.string(),
    orgId: v.string(),
    categoryId: v.union(v.string(), v.null()),
    slotId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // Required once the group's project is JUSTIFY+ and no unlock session is
    // open — this mutation previously bypassed the lifecycle lock entirely.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "categorySlot");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    const group = await requireGroupInOrg(ctx, a.groupId, a.orgId);
    const project = await getProjectInOrg(ctx, group.projectId, a.orgId);
    if (!project) throw new ConvexError("Project not found");
    const guard = await assertLifecycleGuard(ctx, project, { kind: "structural", justification: a.justification });

    // Validate the destination category is the caller's org + this group's project.
    let destCategoryId: string | null = null;
    let destCategoryName: string | null = null;
    if (a.categoryId != null) {
      const category = await requireCategoryInOrg(ctx, a.categoryId, a.orgId);
      if (category.projectId !== group.projectId) {
        throw new ConvexError("Cannot move project group across projects");
      }
      destCategoryId = category.id;
      destCategoryName = category.name;
    }

    // No-op fast path (already in the destination).
    if ((group.categoryId ?? null) === destCategoryId) {
      return { ok: true, noop: true };
    }

    // 1. Keep member line items' categoryId in sync. by_projectId is GLOBAL — org-filter.
    const lines = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", group.projectId)).collect()
    ).filter((li) => li.organizationId === a.orgId && li.groupId === a.groupId);
    for (const li of lines) {
      await ctx.db.patch(li._id, {
        categoryId: destCategoryId != null ? destCategoryId : undefined,
        updatedAt: a.now,
      });
    }

    // 2. Group placement (null clears the field → uncategorised).
    await ctx.db.patch(group._id, {
      categoryId: destCategoryId != null ? destCategoryId : undefined,
      updatedAt: a.now,
    });

    // 3. CategorySlot upsert.
    await upsertSlotForProjectGroup(ctx, a.groupId, destCategoryId, a.slotId, a.now);

    // 4. Recalc + audit.
    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, group.projectId, a.orgId, taxRate, a.now);
    await logSlotChange(ctx, {
      orgId: a.orgId,
      projectId: group.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "updated",
      entityName: `Project group ${group.title}`,
      summary: destCategoryName
        ? `Moved project group to category ${destCategoryName}`
        : `Moved project group to uncategorised`,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// reorderMixedGroupsInCategory — rewrite the cross-type sortOrder of the mixed
// ProjectGroup + SubHireGroup list inside one category. Each item carries its
// prefixed id (pg-/shg-) + a fresh slot cuid to mint the slot when one doesn't
// exist yet. sortOrder = the item's position in `items`. Every target group is
// org + project validated. NO recalc / NO audit (display order only — parity
// with the server reorder). Parity: src/server/category-slots.reorderMixedGroupsInCategory.
// ─────────────────────────────────────────────────────────────────────────────
export const reorderMixedGroupsInCategory = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    categoryId: v.string(),
    items: v.array(v.object({ prefixedId: v.string(), newSlotId: v.string() })),
    now: v.number(),
    actor: actorValidator,
    // Required once this category's project is JUSTIFY+ and no unlock session is
    // open — this mutation previously bypassed the lifecycle lock entirely.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "categorySlot");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    await resolveActor(ctx, a.actor);

    const category = await requireCategoryInOrg(ctx, a.categoryId, a.orgId);
    const categoryProject = await getProjectInOrg(ctx, category.projectId, a.orgId);
    if (!categoryProject) throw new ConvexError("Project not found");
    await assertLifecycleGuard(ctx, categoryProject, { kind: "structural", justification: a.justification });

    // Parse every prefixed id up front (a bare/malformed id is a client bug).
    const parsed = a.items.map((item) => {
      const slot = parseSlotId(item.prefixedId);
      if (!slot) throw new ConvexError("Slot ID must be prefixed with 'pg-', 'shg-', or 'li-'");
      return { ...slot, newSlotId: item.newSlotId };
    });
    const projectGroupIds = parsed.filter((s) => s.kind === "projectGroup").map((s) => s.id);
    const subHireGroupIds = parsed.filter((s) => s.kind === "subHireGroup").map((s) => s.id);
    const lineItemIds = parsed.filter((s) => s.kind === "lineItem").map((s) => s.id);

    // Reject a duplicated group in the ordering: a slot-less group appearing twice would
    // otherwise insert TWO slots (the just-inserted _id isn't threaded back into the map),
    // breaking the one-slot-per-group invariant.
    if (new Set(a.items.map((i) => i.prefixedId)).size !== a.items.length) {
      throw new ConvexError("Duplicate group in reorder list");
    }

    // Validate: every project group belongs to this category's project + org.
    if (projectGroupIds.length > 0) {
      const projGroups = (
        await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", category.projectId)).collect()
      ).filter((g) => g.organizationId === a.orgId);
      const groupIdSet = new Set(projGroups.map((g) => g.id));
      for (const id of projectGroupIds) {
        if (!groupIdSet.has(id)) throw new ConvexError("One or more project groups do not belong to this project");
      }
    }

    // Validate: every sub-hire group resolves to a sub-hire in this org + project.
    for (const id of subHireGroupIds) {
      const { subHire } = await requireSubHireGroupInOrg(ctx, id, a.orgId);
      if (subHire.projectId !== category.projectId) {
        throw new ConvexError("One or more sub-hire groups do not belong to this project");
      }
    }

    // Validate: every line item belongs to this org, is standalone (no group/
    // sub-hire-group), and already sits in THIS category — a reorder call
    // only reshuffles the category's existing top-level members; moving a
    // line item's category is `moveLineItemNative`'s job, not this one's.
    if (lineItemIds.length > 0) {
      for (const id of lineItemIds) {
        const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
        if (!li || li.organizationId !== a.orgId) throw new ConvexError("Line item not found");
        if (li.groupId || li.subHireGroupId) {
          throw new ConvexError("One or more line items are not standalone in this category");
        }
        if (li.categoryId !== a.categoryId) {
          throw new ConvexError("One or more line items do not belong to this category");
        }
      }
    }

    // Rewrite slot sortOrder = position in `items` (missing slots are minted).
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", a.categoryId))
      .collect();
    const slotByPg = new Map(catSlots.filter((s) => s.projectGroupId).map((s) => [s.projectGroupId!, s]));
    const slotByShg = new Map(catSlots.filter((s) => s.subHireGroupId).map((s) => [s.subHireGroupId!, s]));
    const slotByLi = new Map(catSlots.filter((s) => s.lineItemId).map((s) => [s.lineItemId!, s]));

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      const existing =
        item.kind === "projectGroup" ? slotByPg.get(item.id)
        : item.kind === "subHireGroup" ? slotByShg.get(item.id)
        : slotByLi.get(item.id);
      if (existing) {
        await ctx.db.patch(existing._id, { sortOrder: i, updatedAt: a.now });
        continue;
      }
      await assertSlotIdFree(ctx, item.newSlotId);
      await ctx.db.insert("categorySlots", {
        id: item.newSlotId,
        projectCategoryId: a.categoryId,
        sortOrder: i,
        createdAt: a.now,
        updatedAt: a.now,
        ...(item.kind === "projectGroup"
          ? { projectGroupId: item.id }
          : item.kind === "subHireGroup"
            ? { subHireGroupId: item.id }
            : { lineItemId: item.id }),
      });
    }

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// createCategoryAndPlaceGroup — atomic: create a new ProjectCategory (create-at-end
// max(sortOrder)+1) AND place a single group (project OR sub-hire) inside it via a
// fresh slot, syncing the group's line items' categoryId. Client mints the category,
// slot + audit cuids. Parity: src/server/category-slots.createCategoryAndPlaceGroup.
// ─────────────────────────────────────────────────────────────────────────────
export const createCategoryAndPlaceGroup = mutation({
  returns: v.object({
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  args: {
    categoryId: v.string(),
    slotId: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    name: v.string(),
    slot: v.object({
      projectGroupId: v.optional(v.union(v.string(), v.null())),
      subHireGroupId: v.optional(v.union(v.string(), v.null())),
    }),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "categorySlot");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    assertValidName(a.name);

    const project = await getProjectInOrg(ctx, a.projectId, a.orgId);
    if (!project) throw new ConvexError("Project not found");

    const projectGroupId = a.slot.projectGroupId ?? null;
    const subHireGroupId = a.slot.subHireGroupId ?? null;
    // XOR: exactly one target group (mirrors the server's Zod superRefine).
    if (!!projectGroupId === !!subHireGroupId) {
      throw new ConvexError("slot must reference exactly one of projectGroupId or subHireGroupId");
    }

    // Validate the target group belongs to this org + project.
    let projGroupDoc: Doc<"projectGroups"> | null = null;
    let subHireGroupDoc: Doc<"subHireGroups"> | null = null;
    if (projectGroupId) {
      projGroupDoc = await requireGroupInOrg(ctx, projectGroupId, a.orgId);
      if (projGroupDoc.projectId !== a.projectId) {
        throw new ConvexError("Project group not found in this project");
      }
    } else if (subHireGroupId) {
      const { group, subHire } = await requireSubHireGroupInOrg(ctx, subHireGroupId, a.orgId);
      if (subHire.projectId !== a.projectId) {
        throw new ConvexError("Sub-hire group not found in this project");
      }
      subHireGroupDoc = group;
    }

    // 1. Create the category at end (idempotent by cuid — a retried submit reuses it).
    let sortOrder: number;
    const existingCat = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", a.categoryId)).first();
    if (existingCat) {
      // Org AND project must match — else a reused category cuid from another project would
      // place this project's group + lines into a different project's category.
      if (existingCat.organizationId !== a.orgId || existingCat.projectId !== a.projectId) {
        throw new ConvexError("Category not found");
      }
      sortOrder = existingCat.sortOrder ?? 0;
    } else {
      const siblings = (
        await ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect()
      ).filter((c) => c.organizationId === a.orgId);
      sortOrder = siblings.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1;
      await ctx.db.insert("projectCategories", {
        id: a.categoryId,
        organizationId: a.orgId,
        projectId: a.projectId,
        name: a.name,
        sortOrder,
        createdAt: a.now,
        updatedAt: a.now,
      });
    }

    // 2. Delete any existing slot for this group (re-categorise leaks otherwise).
    if (projectGroupId) {
      const slots = await ctx.db.query("categorySlots").withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", projectGroupId)).collect();
      for (const s of slots) await ctx.db.delete(s._id);
    } else if (subHireGroupId) {
      const slots = await ctx.db.query("categorySlots").withIndex("by_subHireGroupId", (q) => q.eq("subHireGroupId", subHireGroupId)).collect();
      for (const s of slots) await ctx.db.delete(s._id);
    }

    // 3. Create the slot at position 0 in the new category.
    await assertSlotIdFree(ctx, a.slotId);
    await ctx.db.insert("categorySlots", {
      id: a.slotId,
      projectCategoryId: a.categoryId,
      sortOrder: 0,
      projectGroupId: projectGroupId ?? undefined,
      subHireGroupId: subHireGroupId ?? undefined,
      createdAt: a.now,
      updatedAt: a.now,
    });

    // 4. Update group placement + sync member line items' categoryId.
    const lines = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect()
    ).filter((li) => li.organizationId === a.orgId);
    if (projectGroupId && projGroupDoc) {
      await ctx.db.patch(projGroupDoc._id, { categoryId: a.categoryId, updatedAt: a.now });
      for (const li of lines.filter((li) => li.groupId === projectGroupId)) {
        await ctx.db.patch(li._id, { categoryId: a.categoryId, updatedAt: a.now });
      }
    } else if (subHireGroupId && subHireGroupDoc) {
      await ctx.db.patch(subHireGroupDoc._id, { targetCategoryId: a.categoryId });
      for (const li of lines.filter(
        (li) => li.subHireGroupId === subHireGroupId && !li.isKitChild && li.parentLineItemId == null,
      )) {
        await ctx.db.patch(li._id, { categoryId: a.categoryId, updatedAt: a.now });
      }
    }

    // 5. Audit + recalc.
    await logSlotChange(ctx, {
      orgId: a.orgId,
      projectId: a.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "created",
      entityName: a.name,
      summary: `Created category "${a.name}" and placed a group inside`,
    });

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, a.projectId, a.orgId, taxRate, a.now);

    return {
      id: a.categoryId,
      organizationId: a.orgId,
      projectId: a.projectId,
      name: a.name,
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  // Revenue-affecting placement moves (recalc-coupled) — recoverable, ordinary edits.
  createCategoryAndPlaceGroup: { danger: "medium" },
  moveProjectGroupToCategory: { danger: "medium" },
  moveSubHireGroupToCategory: { danger: "medium" },
  // Display-order only — no recalc, no revenue effect.
  reorderMixedGroupsInCategory: { danger: "low" },
};
