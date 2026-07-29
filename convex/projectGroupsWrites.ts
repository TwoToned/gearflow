import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import { computeGroupSuggestedPrice } from "./lib/suggestedPrice";
import { assertLifecycleGuard, lifecycleAuditMetadata } from "./lib/projectLocks";
import { assertStrLen } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Native PROJECT-GROUP write mutations (Phase 3 browser-direct — replaces the
 * create/update/updatePrice/delete/reorder/move ProjectGroup server actions in
 * src/server/project-groups.ts). All gate on `project:manage_line_items` (exact
 * parity with the deleted actions' requirePermission("project","manage_line_items")).
 *
 * These are RECALC-COUPLED + money-adjacent: every write that changes booked
 * revenue folds the in-mutation recalcProjectTotals (byte-for-byte the server's
 * recalculateProjectTotals) into the SAME transaction, so a project's totals are
 * always consistent with its groups/lines. The org default tax rate lives in
 * Postgres (no Convex mirror writer) — read inline from the orgSettings mirror.
 *
 * The requireService mirrors in projectGroups.ts (backfill + create/update/reorder/
 * deleteCascade still called by not-yet-converted category-slots/line-items/projects)
 * are intentionally UNTOUCHED.
 *
 * Suggested-price recompute is the shared computeGroupSuggestedPrice port (equipment
 * bundle only). Dropped the two dead accept* actions (acceptSuggestedPrice /
 * acceptAllSuggestedPrices had no live consumers).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

// ─── Validation (parity with src/lib/validations/project-group.ts) ───────────
const TITLE_MIN = 1;
const TITLE_MAX = 200;
const DESC_MAX = 2000;

function assertValidTitle(title: string) {
  if (title.length < TITLE_MIN) throw new ConvexError("Title is required");
  if (title.length > TITLE_MAX) throw new ConvexError("Title must be at most 200 characters");
}
function assertValidDescription(description: string | undefined) {
  if (description != null && description.length > DESC_MAX) {
    throw new ConvexError("Description must be at most 2000 characters");
  }
}
function assertValidQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ConvexError("Quantity must be an integer of at least 1");
  }
}
function assertValidPrice(price: number) {
  // Number.isFinite first — NaN/Infinity both pass `< 0` and then poison recalcProjectTotals
  // (groupRevenue += num(price) * qty → project.total = NaN). Browser-direct bypasses Zod.
  if (!Number.isFinite(price) || price < 0) throw new ConvexError("Price must be a finite number ≥ 0");
}
function assertValidDiscount(discount: number) {
  // Same anti-poisoning guard as assertValidPrice, plus the upper bound
  // src/lib/validations/project-group.ts / line-item.ts discountField enforces.
  if (!Number.isFinite(discount) || discount < 0 || discount > 999999.99) {
    throw new ConvexError("Discount must be a finite number between 0 and 999999.99");
  }
}

// ─── Collaboration colour (deterministic from userId) ────────────────────────
// Inlined from src/lib/collaboration-colors.ts getUserColor (same as
// projectCategoriesWrites.ts) so the collab event this file writes is
// byte-identical to the one the server action emitted via writeCollabActivityEvent.
const COLLAB_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#0891b2", "#059669", "#65a30d",
  "#d97706", "#0d9488", "#4f46e5", "#9333ea", "#0284c7", "#16a34a",
] as const;
function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

// ─── Shared fetch helpers (by_cuid + by_projectId are GLOBAL — org re-check) ──

/** Fetch a group by cuid, confirm it's the caller's org. */
async function requireGroupInOrg(ctx: MutationCtx, groupId: string, orgId: string): Promise<Doc<"projectGroups">> {
  const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
  if (!g || g.organizationId !== orgId) throw new ConvexError("Group not found");
  return g;
}

/** Fetch a project by cuid, confirm it's the caller's org (org-filter — recalc/
 *  suggested-price sweep by projectId with no org filter, so a foreign project
 *  here would corrupt another org's data). Returns null when absent. */
async function getProjectInOrg(
  ctx: MutationCtx,
  projectId: string,
  orgId: string,
  cache: Map<string, Doc<"projects"> | null>,
): Promise<Doc<"projects"> | null> {
  const cached = cache.get(projectId);
  if (cached !== undefined) return cached;
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  const resolved = p && p.organizationId === orgId ? p : null;
  cache.set(projectId, resolved);
  return resolved;
}

/** Confirm a category cuid is the caller's org (by_cuid is global). Returns the doc. */
async function requireCategoryInOrg(ctx: MutationCtx, categoryId: string, orgId: string): Promise<Doc<"projectCategories">> {
  const c = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", categoryId)).first();
  if (!c || c.organizationId !== orgId) throw new ConvexError("Category not found");
  return c;
}

/**
 * Validate the caller-supplied MOVE/create destination references. A target group or
 * category must belong to the caller's org (by_cuid is global — no org filter) AND resolve
 * to a single project; the caller can't assign a foreign-tenant or cross-project reference
 * onto a line/group. Returns the destination projectId (null when both targets are null =
 * moving to top-level standalone). Callers additionally assert it matches the row's project.
 */
async function resolveDestinationProject(
  ctx: MutationCtx,
  orgId: string,
  targetGroupId: string | null | undefined,
  targetCategoryId: string | null | undefined,
): Promise<string | null> {
  let projectId: string | null = null;
  if (targetGroupId != null) {
    const g = await requireGroupInOrg(ctx, targetGroupId, orgId);
    projectId = g.projectId;
  }
  if (targetCategoryId != null) {
    const c = await requireCategoryInOrg(ctx, targetCategoryId, orgId);
    if (projectId != null && c.projectId !== projectId) {
      throw new ConvexError("Target group and category are in different projects");
    }
    projectId = c.projectId;
  }
  return projectId;
}

/** Org default tax rate from the orgSettings mirror (Postgres-authoritative). */
async function orgDefaultTaxRate(ctx: MutationCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

/**
 * Recompute + persist a group's suggested price by id (org-checked). Prices
 * from the PROJECT's rentalStartDate/rentalEndDate via the shared
 * computeGroupSuggestedPrice best-price-capped derivation (#943) — no more
 * group-level rentalPeriod/rentalQuantity override (retired). No-op if the
 * group is gone / cross-org.
 */
async function recomputeGroupSuggestedById(
  ctx: MutationCtx,
  groupId: string,
  orgId: string,
  projectCache: Map<string, Doc<"projects"> | null>,
  now: number,
): Promise<void> {
  const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
  if (!group || group.organizationId !== orgId) return;
  const project = await getProjectInOrg(ctx, group.projectId, orgId, projectCache);
  const suggested = await computeGroupSuggestedPrice(ctx, {
    projectId: group.projectId,
    groupId,
    orgId,
    rentalStartDate: project?.rentalStartDate ?? undefined,
    rentalEndDate: project?.rentalEndDate ?? undefined,
  });
  await ctx.db.patch(group._id, { suggestedPrice: suggested, updatedAt: now });
}

async function logGroupChange(
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
    metadata?: Record<string, unknown>;
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

// ─────────────────────────────────────────────────────────────────────────────
// createGroupNative — atomic create-at-end within the (projectId, categoryId)
// bucket: max(sortOrder)+1, org-filtered. suggestedPrice:0. NO recalc (a fresh
// empty group books no revenue). Parity: createProjectGroup.
// ─────────────────────────────────────────────────────────────────────────────
export const createGroupNative = mutation({
  returns: v.object({ id: v.string(), sortOrder: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    categoryId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    price: v.optional(v.number()),
    discount: v.optional(v.number()),
    // #1012 — entry shape of the discount above ($ off vs % of `price × quantity`).
    // Display only; `discount` stays the resolved flat dollar amount.
    discountMode: v.optional(enums.DiscountMode),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #793: required once the project is ON_SITE+ and no unlock session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    // The client supplies projectId + categoryId; verify both are the caller's org (and
    // the category is in that project) — else a member could hang a group off another
    // org's/project's id, a cross-tenant dangling reference.
    const project = await getProjectInOrg(ctx, a.projectId, a.orgId, new Map());
    if (!project) throw new ConvexError("Project not found");

    // #791: creating a group while locked defaults it to $0/unpriced (server-
    // enforced). #793: creating a group is a structural mutation at JUSTIFY+.
    const guard = await assertLifecycleGuard(ctx, project, { kind: "structural", justification: a.justification });
    if (guard.defaultToZero) {
      a.price = undefined;
      a.discount = undefined;
      a.discountMode = undefined; // #1012: no amount, no entry shape
    }

    assertValidTitle(a.title);
    assertValidDescription(a.description);
    const quantity = a.quantity ?? 1;
    assertValidQuantity(quantity);
    if (a.price != null) assertValidPrice(a.price);
    if (a.discount != null) assertValidDiscount(a.discount);

    if (a.categoryId != null) {
      const cat = await requireCategoryInOrg(ctx, a.categoryId, a.orgId);
      if (cat.projectId !== a.projectId) throw new ConvexError("Category not found");
    }

    // Idempotent: a retried create with the same cuid short-circuits (no dup row,
    // no second audit — by_cuid is global + non-unique so re-check org on a hit).
    const existing = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (existing) {
      if (existing.organizationId !== a.orgId) throw new ConvexError("Group not found");
      return { id: a.id, sortOrder: existing.sortOrder ?? 0 };
    }

    // by_projectId is GLOBAL — org-filter, then max(sortOrder)+1 within the
    // (project, category) bucket (null category is its own bucket).
    const bucket = a.categoryId ?? null;
    const siblings = (
      await ctx.db
        .query("projectGroups")
        .withIndex("by_projectId", (q) => q.eq("projectId", a.projectId))
        .collect()
    ).filter((g) => g.organizationId === a.orgId && (g.categoryId ?? null) === bucket);
    const sortOrder = siblings.reduce((m, g) => Math.max(m, g.sortOrder ?? -1), -1) + 1;

    // Capture the inserted _id (patch THIS directly if ever needed — never re-query
    // the global cuid to mutate a doc we just inserted).
    await ctx.db.insert("projectGroups", {
      id: a.id,
      organizationId: a.orgId,
      projectId: a.projectId,
      categoryId: a.categoryId || undefined,
      title: a.title,
      description: a.description || undefined,
      quantity,
      price: a.price != null ? a.price : undefined,
      discount: a.discount != null ? a.discount : undefined,
      discountMode: a.discount != null ? a.discountMode : undefined,
      suggestedPrice: 0,
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });

    await logGroupChange(ctx, {
      orgId: a.orgId,
      projectId: a.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "created",
      entityName: a.title,
      summary: `Created group "${a.title}"`,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    return { id: a.id, sortOrder };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateGroupNative — patch title/description/quantity/sortOrder, then recalc
// project totals. Collab `group_updated` UNLESS only sortOrder changed. Audit uses
// the PRE-patch title. Parity: updateProjectGroup.
//
// #943: group-level rentalPeriod/rentalQuantity retired — suggestedPrice is now
// derived purely from the PROJECT's rentalStartDate/rentalEndDate (best-price
// capped, convex/lib/billingDerivation.ts), so nothing on this mutation can
// make it stale anymore. It's recomputed when a line is added/merged into the
// group (recomputeGroupSuggestedNative in lineItemWrites.ts) and when the
// project's rental dates change (recalcAutoPricedLinesNative — the "stale
// price" recalculate flow).
// ─────────────────────────────────────────────────────────────────────────────
export const updateGroupNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    xeroAccountCode: v.optional(v.string()),
    xeroTaxType: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #791/#793: required (one or the other, never both) once locked.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    const group = await requireGroupInOrg(ctx, a.id, a.orgId);

    // #791/#793: this mutation's only fields are title/description/quantity/
    // sortOrder — all structural. Formerly rentalPeriod/rentalQuantity were
    // locked GROUP financial fields routed through the FINANCIAL gate; #943
    // retired both (suggested price now derives purely from the project's own
    // rental dates, see recomputeGroupSuggestedById above), so nothing left on
    // this mutation can touch money.
    const groupProject = await getProjectInOrg(ctx, group.projectId, a.orgId, new Map());
    if (!groupProject) throw new ConvexError("Project not found");
    const guard = await assertLifecycleGuard(ctx, groupProject, {
      kind: "structural",
      justification: a.justification,
    });

    if (a.title !== undefined) assertValidTitle(a.title);
    if (a.description !== undefined) assertValidDescription(a.description || undefined);
    if (a.quantity !== undefined) assertValidQuantity(Number(a.quantity));
    assertStrLen(a.xeroAccountCode, "xeroAccountCode", { max: 50 });
    assertStrLen(a.xeroTaxType, "xeroTaxType", { max: 50 });

    // Patch semantics mirror the server: "" / falsy clears the optional field.
    const patch: Record<string, unknown> = { updatedAt: a.now };
    if (a.title !== undefined) patch.title = a.title;
    if (a.description !== undefined) patch.description = a.description || undefined;
    if (a.quantity !== undefined) patch.quantity = Number(a.quantity);
    if (a.sortOrder !== undefined) patch.sortOrder = Number(a.sortOrder);
    if (a.xeroAccountCode !== undefined) patch.xeroAccountCode = a.xeroAccountCode || undefined;
    if (a.xeroTaxType !== undefined) patch.xeroTaxType = a.xeroTaxType || undefined;
    await ctx.db.patch(group._id, patch);

    // Audit uses the PRE-patch title (parity with the server action).
    await logGroupChange(ctx, {
      orgId: a.orgId,
      projectId: group.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "updated",
      entityName: group.title,
      summary: `Updated group "${group.title}"`,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, group.projectId, a.orgId, taxRate, a.now);

    // Collab feed — skip pure drag-reorders (sortOrder-only). Fire when any
    // provided domain field other than sortOrder changed.
    const providedNonSortOrder =
      a.title !== undefined ||
      a.description !== undefined ||
      a.quantity !== undefined ||
      a.xeroAccountCode !== undefined ||
      a.xeroTaxType !== undefined;
    if (providedNonSortOrder) {
      await ctx.db.insert("activityEvents", {
        orgId: a.orgId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: getUserColor(actor.userId),
        entityType: "project",
        entityId: group.projectId,
        targetType: "group",
        targetId: a.id,
        action: "group_updated",
        summary: `updated group "${group.title}"`,
        createdAt: a.now,
      });
    }

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateGroupPriceNative — set a group's flat price, then recalc project totals.
// Parity: updateGroupPrice.
// ─────────────────────────────────────────────────────────────────────────────
export const updateGroupPriceNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    price: v.number(),
    // Optional — omit to leave the existing discount untouched; pass 0/undefined
    // via the caller's "clear" convention (client always sends a resolved number
    // or leaves the arg out entirely, mirroring how discount already works for
    // patchNative on line items).
    discount: v.optional(v.number()),
    // #1012 — entry shape of the discount above. Only meaningful when `discount`
    // is also supplied; omitted alongside an omitted discount ("leave untouched").
    discountMode: v.optional(enums.DiscountMode),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    assertValidPrice(a.price);
    if (a.discount != null) assertValidDiscount(a.discount);
    const group = await requireGroupInOrg(ctx, a.id, a.orgId);

    // #791: a group's flat price/discount is a locked financial field.
    const priceProject = await getProjectInOrg(ctx, group.projectId, a.orgId, new Map());
    if (!priceProject) throw new ConvexError("Project not found");
    const guard = await assertLifecycleGuard(ctx, priceProject, { kind: "financial" });

    const patch: Record<string, unknown> = { price: a.price, updatedAt: a.now };
    if (a.discount !== undefined) {
      patch.discount = a.discount;
      // #1012: the mode is written with the amount it describes — a discount set
      // back to 0 (or with no mode supplied) drops the stale mode rather than
      // leaving the previous entry shape hanging off a different number.
      patch.discountMode = a.discount > 0 ? a.discountMode : undefined;
    }
    await ctx.db.patch(group._id, patch);

    await logGroupChange(ctx, {
      orgId: a.orgId,
      projectId: group.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "updated",
      entityName: group.title,
      summary: `Set price on group "${group.title}" to $${a.price.toFixed(2)}`,
      metadata: lifecycleAuditMetadata(guard),
    });

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, group.projectId, a.orgId, taxRate, a.now);

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteGroupNative — NULL-OUT groupId on every child line (preserve categoryId →
// items go standalone-in-category), delete the group's categorySlots, delete the
// group, then recalc. Parity: deleteProjectGroup. N = lines moved (in the audit).
// ─────────────────────────────────────────────────────────────────────────────
export const deleteGroupNative = mutation({
  returns: v.object({ ok: v.boolean(), movedLineItems: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #793: required once the project is ON_SITE+ and no unlock session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    const group = await requireGroupInOrg(ctx, a.id, a.orgId);
    const deleteGroupProject = await getProjectInOrg(ctx, group.projectId, a.orgId, new Map());
    if (!deleteGroupProject) throw new ConvexError("Project not found");
    const guard = await assertLifecycleGuard(ctx, deleteGroupProject, { kind: "structural", justification: a.justification });

    // Lines in this group (by_projectId is global — org-filter). Clear groupId only
    // (keep categoryId so items land standalone in the same category).
    const lines = (
      await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", group.projectId))
        .collect()
    ).filter((li) => li.organizationId === a.orgId && li.groupId === a.id);
    for (const li of lines) {
      await ctx.db.patch(li._id, { groupId: undefined, updatedAt: a.now });
    }

    // Cascade: the group's category slots, then the group itself.
    const slots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", a.id))
      .collect();
    for (const s of slots) await ctx.db.delete(s._id);
    await ctx.db.delete(group._id);

    const n = lines.length;
    await logGroupChange(ctx, {
      orgId: a.orgId,
      projectId: group.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "deleted",
      entityName: group.title,
      summary: `Deleted group "${group.title}" — ${n} items moved to standalone`,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, group.projectId, a.orgId, taxRate, a.now);

    return { ok: true, movedLineItems: n };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// reorderGroupsNative — sortOrder = index per id, per-id by_cuid org re-check,
// patch by _id. NO recalc, NO audit (parity: reorderProjectGroups never logged).
// ─────────────────────────────────────────────────────────────────────────────
export const reorderGroupsNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    orderedIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    await resolveActor(ctx, a.actor);

    for (let i = 0; i < a.orderedIds.length; i++) {
      const doc = await ctx.db
        .query("projectGroups")
        .withIndex("by_cuid", (q) => q.eq("id", a.orderedIds[i]))
        .first();
      if (doc && doc.organizationId === a.orgId) {
        await ctx.db.patch(doc._id, { sortOrder: i, updatedAt: a.now });
      }
    }
    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// moveLineItemNative (single) — move one line to a group/category (null clears the
// field). Sub-hire write-back: persist the placement back onto the originating
// sub-hire group/item's target* fields (generateSubHireLineItems reads ONLY those,
// so without this the manual move is silently reverted on the next regenerate).
// Recompute suggested price for BOTH the old and target groups, then recalc.
// Parity: moveLineItemToGroup.
// ─────────────────────────────────────────────────────────────────────────────
export const moveLineItemNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    lineItemId: v.string(),
    orgId: v.string(),
    targetGroupId: v.union(v.string(), v.null()),
    targetCategoryId: v.union(v.string(), v.null()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #793: required once the project is ON_SITE+ and no unlock session is open.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", a.lineItemId)).first();
    if (!line || line.organizationId !== a.orgId) throw new ConvexError("Line item not found");

    const moveProject = await getProjectInOrg(ctx, line.projectId, a.orgId, new Map());
    if (!moveProject) throw new ConvexError("Project not found");
    const guard = await assertLifecycleGuard(ctx, moveProject, { kind: "structural", justification: a.justification });

    // Validate the destination refs are the caller's org + THIS line's project (no
    // cross-tenant / cross-project dangling reference).
    const destProject = await resolveDestinationProject(ctx, a.orgId, a.targetGroupId, a.targetCategoryId);
    if (destProject != null && destProject !== line.projectId) {
      throw new ConvexError("Target is in a different project");
    }

    const oldGroupId = line.groupId ?? null;

    // Apply the move: groupId + categoryId, null → clear (undefined removes the field).
    await ctx.db.patch(line._id, {
      groupId: a.targetGroupId != null ? a.targetGroupId : undefined,
      categoryId: a.targetCategoryId != null ? a.targetCategoryId : undefined,
      updatedAt: a.now,
    });

    // ── Sub-hire write-back (mirrors moveSubHireGroupToCategory) ───────────────
    // The sub-hire group/item tables carry no organizationId — re-check org via the
    // parent subHire (which does), so a doctored line can't cross-tenant-write.
    const subHireGroupId = line.subHireGroupId ?? null;
    const subHireItemId = line.subHireItemId ?? null;
    if (subHireGroupId) {
      const shg = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", subHireGroupId)).first();
      if (!shg) throw new ConvexError("Sub-hire group not found");
      const parent = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", shg.subHireId)).first();
      if (!parent || parent.organizationId !== a.orgId) throw new ConvexError("Sub-hire group not found");
      await ctx.db.patch(shg._id, {
        targetGroupId: a.targetGroupId != null ? a.targetGroupId : undefined,
        targetCategoryId: a.targetCategoryId != null ? a.targetCategoryId : undefined,
      });
    } else if (subHireItemId) {
      const shi = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", subHireItemId)).first();
      if (!shi) throw new ConvexError("Sub-hire item not found");
      const parent = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", shi.subHireId)).first();
      if (!parent || parent.organizationId !== a.orgId) throw new ConvexError("Sub-hire item not found");
      await ctx.db.patch(shi._id, {
        targetGroupId: a.targetGroupId != null ? a.targetGroupId : undefined,
        targetCategoryId: a.targetCategoryId != null ? a.targetCategoryId : undefined,
      });
    }

    // Recompute suggested price for BOTH the old and the target group.
    const projectCache = new Map<string, Doc<"projects"> | null>();
    if (oldGroupId) await recomputeGroupSuggestedById(ctx, oldGroupId, a.orgId, projectCache, a.now);
    if (a.targetGroupId) await recomputeGroupSuggestedById(ctx, a.targetGroupId, a.orgId, projectCache, a.now);

    await logGroupChange(ctx, {
      orgId: a.orgId,
      projectId: line.projectId,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "updated",
      entityName: line.description ?? "Line item",
      summary: `Moved line item to ${a.targetGroupId ? "group" : "standalone"}`,
      metadata: lifecycleAuditMetadata(guard, a.justification),
    });

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, line.projectId, a.orgId, taxRate, a.now);

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// moveLineItemsNative (bulk) — move many lines to the same destination. SKIP
// isKitChild lines. NO sub-hire write-back (asymmetry vs the single move — the
// server bulk path deliberately omitted it). Recompute suggested price for every
// distinct source group + the destination, then recalc EACH affected project once
// (a bulk selection can span projects). Parity: moveLineItemsToGroup.
// ─────────────────────────────────────────────────────────────────────────────
export const moveLineItemsNative = mutation({
  returns: v.object({ moved: v.number(), skipped: v.number() }),
  args: {
    lineItemIds: v.array(v.string()),
    orgId: v.string(),
    targetGroupId: v.union(v.string(), v.null()),
    targetCategoryId: v.union(v.string(), v.null()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    // #793: checked once per distinct project this bulk selection touches.
    justification: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectGroup");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);

    // Validate the destination refs are the caller's org (+ resolve their project) once.
    // A line whose project doesn't match the destination is skipped (can't move a line
    // into another project's group — a cross-project dangling reference).
    const destProject = await resolveDestinationProject(ctx, a.orgId, a.targetGroupId, a.targetCategoryId);

    const affectedGroupIds = new Set<string>();
    const affectedProjectIds = new Set<string>();
    const guardedProjectIds = new Set<string>();
    let skipped = 0;
    let moved = 0;

    for (const id of a.lineItemIds) {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      // Missing / cross-org rows are skipped (parity with listByIdsForOrg dropping them).
      if (!line || line.organizationId !== a.orgId) {
        skipped++;
        continue;
      }
      if (line.isKitChild) {
        skipped++;
        continue;
      }
      if (destProject != null && line.projectId !== destProject) {
        skipped++;
        continue;
      }
      if (!guardedProjectIds.has(line.projectId)) {
        const lineProject = await getProjectInOrg(ctx, line.projectId, a.orgId, new Map());
        if (!lineProject) { skipped++; continue; }
        await assertLifecycleGuard(ctx, lineProject, { kind: "structural", justification: a.justification });
        guardedProjectIds.add(line.projectId);
      }
      if (line.groupId) affectedGroupIds.add(line.groupId);
      await ctx.db.patch(line._id, {
        groupId: a.targetGroupId != null ? a.targetGroupId : undefined,
        categoryId: a.targetCategoryId != null ? a.targetCategoryId : undefined,
        updatedAt: a.now,
      });
      affectedProjectIds.add(line.projectId);
      moved++;
    }

    if (moved === 0) return { moved: 0, skipped };

    if (a.targetGroupId) affectedGroupIds.add(a.targetGroupId);

    // Refresh suggested price for every touched group (sources + destination).
    const projectCache = new Map<string, Doc<"projects"> | null>();
    for (const gid of affectedGroupIds) {
      await recomputeGroupSuggestedById(ctx, gid, a.orgId, projectCache, a.now);
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    for (const pid of affectedProjectIds) {
      await recalcProjectTotals(ctx, pid, a.orgId, taxRate, a.now);
    }

    const firstProject = affectedProjectIds.values().next().value ?? a.lineItemIds[0];
    await logGroupChange(ctx, {
      orgId: a.orgId,
      projectId: firstProject,
      actor,
      auditId: a.auditId,
      now: a.now,
      action: "updated",
      entityName: `${moved} line item${moved === 1 ? "" : "s"}`,
      summary: `Moved ${moved} line item${moved === 1 ? "" : "s"} to ${a.targetGroupId ? "group" : "standalone"}`,
    });

    return { moved, skipped };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  createGroupNative: { danger: "medium" },
  // Delete = high (§9), even though its lines are only unlinked, not deleted.
  deleteGroupNative: { danger: "high" },
  moveLineItemNative: { danger: "medium" },
  moveLineItemsNative: { danger: "medium" },
  reorderGroupsNative: { danger: "low" },
  updateGroupNative: { danger: "medium" },
  updateGroupPriceNative: { danger: "medium" },
};
