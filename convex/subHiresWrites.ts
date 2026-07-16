import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import { recalcSubHireTotals, upsertSupplierModelRate } from "./lib/subHireTotals";
import { regenerateSubHireLines } from "./lib/subHireLineGen";
import { reserveSubHireOrderNumberCounter } from "./lib/subHireOrderCounter";
import * as enums from "./lib/validators";

/**
 * Native SUB-HIRE write mutations (Phase 3 browser-direct — PR-1 of 2, replaces the
 * subHire CRUD + status/payment + item CRUD server actions in src/server/sub-hires.ts).
 * All gate on `subHire:<action>` (exact parity with the deleted actions'
 * requirePermission("subHire", <action>) — create for createSubHire, delete for
 * deleteSubHire, update for everything else).
 *
 * These are the LAST + heaviest money domain: every item/status write funnels through
 * the server's syncSubHireToProject (recalcSubHireTotals → regenerateSubHireLines →
 * recalcProjectTotals). The three helpers (PR-0, byte-parity verified) fold that whole
 * cascade into the SAME transaction. The org default tax rate lives in Postgres (no
 * Convex mirror writer) — read inline from the orgSettings mirror.
 *
 * STAYS SERVER-SIDE (PR-2 or read-path): GROUP CRUD (createSubHireGroup /
 * updateSubHireGroup / deleteSubHireGroup / setItemGroup), placement
 * (updateSubHirePlacement), order pricing (updateSubHireOrderPricing),
 * changeSubHireProject, duplicateSubHire, and all media + supplier-rate reads.
 *
 * The requireService mirrors in subHires.ts / subHireItems.ts / subHireGroups.ts are
 * intentionally UNTOUCHED (PR-2 group writes + backfill still route through them).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

// ─── Status machine (byte-parity with src/server/sub-hires.ts L52-58) ────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ON_HIRE", "RETURNED", "CANCELLED"],
  ON_HIRE: ["RETURNED", "CANCELLED"],
  RETURNED: [],
  CANCELLED: [],
};

// ─── Validation helpers (mirror src/lib/validations/sub-hire.ts) ──────────────
function assertFiniteMin0(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new ConvexError(`${label} cannot be negative`);
}
function assertDiscount(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new ConvexError("Discount cannot be negative");
  if (value > 100) throw new ConvexError("Discount cannot exceed 100%");
}
function assertIntMin1(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new ConvexError(`${label} must be at least 1`);
}

// ─── FK / org-scope validation helpers (by_cuid / by_projectId are GLOBAL) ────

/** Fetch a sub-hire head by cuid, confirm it's the caller's org (defence-in-depth:
 *  the item/group tables carry NO organizationId, so their org-check is via this head). */
async function requireSubHireInOrg(ctx: MutationCtx, id: string, orgId: string): Promise<Doc<"subHires">> {
  const sh = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!sh || sh.organizationId !== orgId) throw new ConvexError("Sub-hire not found");
  return sh;
}

async function requireSupplierInOrg(ctx: MutationCtx, supplierId: string, orgId: string): Promise<Doc<"suppliers">> {
  const s = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", supplierId)).first();
  if (!s || s.organizationId !== orgId) throw new ConvexError("Supplier not found");
  return s;
}

async function requireProjectInOrg(ctx: MutationCtx, projectId: string, orgId: string): Promise<Doc<"projects">> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError("Project not found");
  return p;
}

async function assertModelInOrg(ctx: MutationCtx, modelId: string, orgId: string): Promise<void> {
  const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
  if (!m || m.organizationId !== orgId) throw new ConvexError("Model not found");
}

/** A sub-hire group referenced as an item's parent must belong to THIS sub-hire (org
 *  via the head, already validated by the caller). */
async function assertSubHireGroupInParent(ctx: MutationCtx, groupId: string, subHireId: string): Promise<void> {
  const g = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
  if (!g || g.subHireId !== subHireId) throw new ConvexError("Sub-hire group not found");
}

/** A placement target project GROUP must be the caller's org AND (when the sub-hire has
 *  a project) belong to that project — no cross-tenant / cross-project dangling reference. */
async function assertTargetGroup(ctx: MutationCtx, groupId: string, orgId: string, projectId: string | null): Promise<void> {
  // A placement target only makes sense once the sub-hire has a project; reject a target on
  // a project-less sub-hire (else it could reference a group from ANY project in the org).
  if (projectId == null) throw new ConvexError("Cannot place a sub-hire with no project");
  const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", groupId)).first();
  if (!g || g.organizationId !== orgId || g.projectId !== projectId) throw new ConvexError("Target group not found");
}

/** A placement target project CATEGORY must be the caller's org AND belong to the
 *  sub-hire's (non-null) project. */
async function assertTargetCategory(ctx: MutationCtx, categoryId: string, orgId: string, projectId: string | null): Promise<void> {
  if (projectId == null) throw new ConvexError("Cannot place a sub-hire with no project");
  const c = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", categoryId)).first();
  if (!c || c.organizationId !== orgId || c.projectId !== projectId) throw new ConvexError("Target category not found");
}

/** Org default tax rate from the orgSettings mirror (Postgres-authoritative). */
async function orgDefaultTaxRate(ctx: MutationCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

/** Supplier display name for the audit label (org-checked; "" when absent — parity). */
async function supplierLabel(ctx: MutationCtx, supplierId: string, orgId: string): Promise<string> {
  const s = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", supplierId)).first();
  return s && s.organizationId === orgId ? s.name : "";
}

/**
 * The full money cascade every item/status write funnels through (server's
 * syncSubHireToProject = recalcSubHireTotals → regenerateSubHireLines →
 * recalcProjectTotals). regenerateSubHireLines no-ops without a project; recalc no-ops
 * if the project is gone. Reads the sub-hire head fresh so a just-deleted item is seen.
 */
async function syncSubHireToProject(ctx: MutationCtx, subHireId: string, orgId: string, projectId: string | null, now: number): Promise<void> {
  await recalcSubHireTotals(ctx, subHireId, orgId, now);
  await regenerateSubHireLines(ctx, subHireId, orgId, now);
  if (projectId) {
    const taxRate = await orgDefaultTaxRate(ctx, orgId);
    await recalcProjectTotals(ctx, projectId, orgId, taxRate, now);
  }
}

async function logSubHire(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; entityId: string; entityName: string; summary: string; details?: unknown },
): Promise<void> {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: "subHire",
    entityId: a.entityId,
    entityName: a.entityName,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    ...(a.details !== undefined ? { details: a.details } : {}),
    createdAt: a.now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// createSubHireNative — reserve order number (atomic counter) + insert head
// (createdById = actor.userId). NO recalc (a fresh DRAFT books nothing).
// Parity: createSubHire. subHire:create.
// ─────────────────────────────────────────────────────────────────────────────
export const createSubHireNative = mutation({
  returns: v.object({ id: v.string(), orderNumber: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    supplierId: v.string(),
    projectId: v.optional(v.string()),
    supplierReference: v.optional(v.string()),
    hireStart: v.optional(v.number()),
    hireEnd: v.optional(v.number()),
    showOnDocs: v.boolean(),
    notes: v.optional(v.string()),
    defaultTargetCategoryId: v.optional(v.string()),
    defaultTargetGroupId: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "create");
    const actor = await resolveActor(ctx, a.actor);

    // FK: supplier + (optional) project must be the caller's org; default placement
    // targets must belong to that project (no cross-tenant/-project dangling reference).
    const supplier = await requireSupplierInOrg(ctx, a.supplierId, a.orgId);
    const projectId = a.projectId || null;
    if (projectId) await requireProjectInOrg(ctx, projectId, a.orgId);
    if (a.defaultTargetGroupId) await assertTargetGroup(ctx, a.defaultTargetGroupId, a.orgId, projectId);
    if (a.defaultTargetCategoryId) await assertTargetCategory(ctx, a.defaultTargetCategoryId, a.orgId, projectId);

    // Idempotent ONLY for a true retry (same id, same org). by_cuid is global + non-unique,
    // so COLLECT all matches: any foreign-org collision is a hard error; a same-org row is the
    // retry. (.first() could return the wrong one under a collision.)
    const dups = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", a.id)).collect();
    for (const d of dups) if (d.organizationId !== a.orgId) throw new ConvexError("Sub-hire already exists");
    if (dups.length > 0) return { id: a.id, orderNumber: dups[0].orderNumber };

    const { orderNumber } = await reserveSubHireOrderNumberCounter(ctx, a.orgId, a.now);

    await ctx.db.insert("subHires", {
      id: a.id,
      organizationId: a.orgId,
      supplierId: a.supplierId,
      ...(projectId ? { projectId } : {}),
      createdById: actor.userId,
      orderNumber,
      ...(a.supplierReference ? { supplierReference: a.supplierReference } : {}),
      status: "DRAFT",
      ...(a.hireStart != null ? { hireStart: a.hireStart } : {}),
      ...(a.hireEnd != null ? { hireEnd: a.hireEnd } : {}),
      showOnDocs: a.showOnDocs,
      ...(a.notes ? { notes: a.notes } : {}),
      ...(a.defaultTargetCategoryId ? { defaultTargetCategoryId: a.defaultTargetCategoryId } : {}),
      ...(a.defaultTargetGroupId ? { defaultTargetGroupId: a.defaultTargetGroupId } : {}),
      createdAt: a.now,
      updatedAt: a.now,
    });

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "CREATE", entityId: a.id, entityName: `${orderNumber} (${supplier.name})`,
      summary: `Created sub-hire ${orderNumber}`,
    });

    return { id: a.id, orderNumber };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHireNative — patch head with the server's exact set/clear semantics:
// supplierId/showOnDocs always set; projectId/hireStart/hireEnd/notes CLEAR when
// absent; supplierReference/defaultTarget* untouched when absent (set-or-clear when
// present). org/id anchors (organizationId/createdById/orderNumber/id) are never
// patched. NO recalc. Parity: updateSubHire. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHireNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    supplierId: v.string(),
    showOnDocs: v.boolean(),
    projectId: v.optional(v.string()),
    hireStart: v.optional(v.number()),
    hireEnd: v.optional(v.number()),
    notes: v.optional(v.string()),
    supplierReference: v.optional(v.string()),
    defaultTargetCategoryId: v.optional(v.string()),
    defaultTargetGroupId: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const existing = await requireSubHireInOrg(ctx, a.id, a.orgId);

    // FK: new supplier. projectId is NOT changed here (see the safe-merge note below), so any
    // placement default is validated against the sub-hire's EXISTING project.
    await requireSupplierInOrg(ctx, a.supplierId, a.orgId);
    const existingProjectId = existing.projectId ?? null;
    if (a.defaultTargetGroupId) await assertTargetGroup(ctx, a.defaultTargetGroupId, a.orgId, existingProjectId);
    if (a.defaultTargetCategoryId) await assertTargetCategory(ctx, a.defaultTargetCategoryId, a.orgId, existingProjectId);

    // SAFE PARTIAL MERGE (deliberate deviation from the server's clear-when-absent).
    // The ONLY caller (the supplier-reference blur) sends just {supplierId, supplierReference,
    // showOnDocs}; the server's clear-on-absent would then WIPE projectId/hireStart/hireEnd/
    // notes/defaultTarget* on every such edit — a destructive latent bug (prod is dark, never
    // hit). Going browser-direct, we set ONLY the fields the caller provided and never clear a
    // field by omission. projectId changes go through changeSubHireProject (with the line
    // cascade); it is NOT settable here (no cascade path).
    const patch: Record<string, unknown> = {
      supplierId: a.supplierId,
      showOnDocs: a.showOnDocs,
      updatedAt: a.now,
    };
    if (a.hireStart != null) patch.hireStart = a.hireStart;
    if (a.hireEnd != null) patch.hireEnd = a.hireEnd;
    if (a.notes != null) patch.notes = a.notes;
    if (a.supplierReference != null) patch.supplierReference = a.supplierReference;
    if (a.defaultTargetCategoryId != null) patch.defaultTargetCategoryId = a.defaultTargetCategoryId;
    if (a.defaultTargetGroupId != null) patch.defaultTargetGroupId = a.defaultTargetGroupId;

    await ctx.db.patch(existing._id, patch);

    const label = await supplierLabel(ctx, a.supplierId, a.orgId);
    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: a.id, entityName: `${existing.orderNumber} (${label})`,
      summary: `Updated sub-hire ${existing.orderNumber}`,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteSubHireNative — reject if any linked project line is CHECKED_OUT; inline
// cascade-delete the linked project lines (top-level + children, NO units — sub-hire
// lines have none), then the sub-hire's items + groups + head; recalc the project.
// Parity: deleteSubHire. subHire:delete.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteSubHireNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const subHire = await requireSubHireInOrg(ctx, a.id, a.orgId);
    const projectId = subHire.projectId ?? null;
    const label = await supplierLabel(ctx, subHire.supplierId, a.orgId);

    // Linked project lines (by_subHireId is GLOBAL → org-filter).
    const linkedLines = (
      await ctx.db.query("projectLineItems").withIndex("by_subHireId", (q) => q.eq("subHireId", a.id)).collect()
    ).filter((li) => li.organizationId === a.orgId);

    if (linkedLines.some((li) => li.status === "CHECKED_OUT")) {
      throw new ConvexError("Cannot delete sub-hire with checked-out items");
    }

    // Cascade the linked lines. Iterate TOP-LEVEL (!isKitChild) only so each child is
    // deleted once via its parent (mirrors regenerateSubHireLines' cleanup; sub-hire
    // lines have no fulfillment units).
    for (const line of linkedLines) {
      if (line.isKitChild) continue;
      const children = (
        await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", line.id)).collect()
      ).filter((c) => c.organizationId === a.orgId);
      for (const c of children) await ctx.db.delete(c._id);
      await ctx.db.delete(line._id);
    }

    // Delete the sub-hire's items + groups + head.
    const items = await ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", a.id)).collect();
    for (const it of items) await ctx.db.delete(it._id);
    const groups = await ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", a.id)).collect();
    for (const g of groups) await ctx.db.delete(g._id);
    await ctx.db.delete(subHire._id);

    if (projectId) {
      const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
      await recalcProjectTotals(ctx, projectId, a.orgId, taxRate, a.now);
    }

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "DELETE", entityId: a.id, entityName: `${subHire.orderNumber} (${label})`,
      summary: `Deleted sub-hire ${subHire.orderNumber}`,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHireStatusNative — VALID_TRANSITIONS guard + "project required to confirm"
// guard; patch status; on →CONFIRMED regenerate project lines; recalc if project.
// Parity: updateSubHireStatus. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHireStatusNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), status: enums.SubHireStatus, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const subHire = await requireSubHireInOrg(ctx, a.id, a.orgId);
    const previousStatus = subHire.status ?? "DRAFT";

    const validTargets = VALID_TRANSITIONS[previousStatus] ?? [];
    if (!validTargets.includes(a.status)) {
      throw new ConvexError(`Cannot transition from ${previousStatus} to ${a.status}`);
    }
    if (a.status === "CONFIRMED" && !subHire.projectId) {
      throw new ConvexError("Assign a project before confirming");
    }

    await ctx.db.patch(subHire._id, { status: a.status, updatedAt: a.now });

    // CONFIRMED regenerates the project lines (parity). Every path recalcs the project.
    if (a.status === "CONFIRMED") {
      await regenerateSubHireLines(ctx, a.id, a.orgId, a.now);
    }
    if (subHire.projectId) {
      const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
      await recalcProjectTotals(ctx, subHire.projectId, a.orgId, taxRate, a.now);
    }

    const label = await supplierLabel(ctx, subHire.supplierId, a.orgId);
    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: a.id, entityName: `${subHire.orderNumber} (${label})`,
      summary: `Changed sub-hire ${subHire.orderNumber} status to ${a.status}`,
      details: { previousStatus, newStatus: a.status },
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHirePaymentStatusNative — patch paymentStatus. NO recalc.
// Parity: updateSubHirePaymentStatus. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHirePaymentStatusNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), paymentStatus: enums.SubHirePaymentStatus, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const subHire = await requireSubHireInOrg(ctx, a.id, a.orgId);
    await ctx.db.patch(subHire._id, { paymentStatus: a.paymentStatus, updatedAt: a.now });

    const label = await supplierLabel(ctx, subHire.supplierId, a.orgId);
    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: a.id, entityName: `${subHire.orderNumber} (${label})`,
      summary: `Updated payment status to ${a.paymentStatus.replace(/_/g, " ").toLowerCase()} on ${subHire.orderNumber}`,
    });

    return { id: a.id };
  },
});

// Shared item-input args (add + update). Money fields validated before insert/patch;
// the totals + project lines are recomputed by the helpers (client totals never trusted).
const itemInputArgs = {
  modelId: v.optional(v.string()),
  groupId: v.optional(v.string()),
  description: v.string(),
  quantity: v.number(),
  unitCost: v.number(),
  unitCharge: v.number(),
  pricingType: enums.PricingType,
  duration: v.number(),
  discount: v.number(),
  showOnQuote: v.optional(v.boolean()),
  showOnDocs: v.optional(v.boolean()),
  targetCategoryId: v.optional(v.string()),
  targetGroupId: v.optional(v.string()),
};

function assertItemMoney(a: { description: string; quantity: number; unitCost: number; unitCharge: number; duration: number; discount: number }) {
  if (!a.description) throw new ConvexError("Description is required");
  assertIntMin1(a.quantity, "Quantity");
  assertFiniteMin0(a.unitCost, "Cost");
  assertFiniteMin0(a.unitCharge, "Charge");
  assertIntMin1(a.duration, "Duration");
  assertDiscount(a.discount);
}

// ─────────────────────────────────────────────────────────────────────────────
// addSubHireItemNative — insert item (nextSort over the sub-hire's items) + supplier
// rate memory (if model) + the full money cascade (recalc totals → regenerate lines →
// recalc project). Parity: addSubHireItem. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const addSubHireItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    subHireId: v.string(),
    ...itemInputArgs,
    description: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const head = await requireSubHireInOrg(ctx, a.subHireId, a.orgId);
    assertItemMoney(a);

    const projectId = head.projectId ?? null;
    if (a.modelId) await assertModelInOrg(ctx, a.modelId, a.orgId);
    if (a.groupId) await assertSubHireGroupInParent(ctx, a.groupId, a.subHireId);
    if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
    if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);

    // Idempotent retry: same cuid + same parent → skip; a collision with an unrelated item is
    // a hard error. COLLECT all matches (by_cuid is global + non-unique).
    const dups = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", a.id)).collect();
    for (const d of dups) if (d.subHireId !== a.subHireId) throw new ConvexError("Sub-hire item already exists");
    if (dups.length > 0) return { id: a.id };

    const existingItems = await ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", a.subHireId)).collect();
    const nextSort = existingItems.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), -1) + 1;

    await ctx.db.insert("subHireItems", {
      id: a.id,
      subHireId: a.subHireId,
      ...(a.groupId ? { groupId: a.groupId } : {}),
      ...(a.modelId ? { modelId: a.modelId } : {}),
      description: a.description,
      quantity: a.quantity,
      unitCost: a.unitCost,
      unitCharge: a.unitCharge,
      pricingType: a.pricingType,
      duration: a.duration,
      discount: a.discount,
      showOnQuote: a.showOnQuote ?? true,
      showOnDocs: a.showOnDocs ?? head.showOnDocs ?? false,
      ...(a.targetCategoryId ? { targetCategoryId: a.targetCategoryId } : {}),
      ...(a.targetGroupId ? { targetGroupId: a.targetGroupId } : {}),
      sortOrder: nextSort,
    });

    if (a.modelId) {
      await upsertSupplierModelRate(ctx, { orgId: a.orgId, supplierId: head.supplierId, modelId: a.modelId, unitCost: a.unitCost, pricingType: a.pricingType, now: a.now });
    }
    await syncSubHireToProject(ctx, a.subHireId, a.orgId, projectId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "CREATE", entityId: a.subHireId, entityName: head.orderNumber,
      summary: `Added item "${a.description}" to ${head.orderNumber}`,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHireItemNative — patch item (set/clear per source) + supplier rate memory
// (if model) + full money cascade. Parity: updateSubHireItem. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHireItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    itemId: v.string(),
    orgId: v.string(),
    ...itemInputArgs,
    description: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const item = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", a.itemId)).first();
    if (!item) throw new ConvexError("Sub-hire item not found");
    // The item table carries no org — org-check via the parent sub-hire head.
    const head = await requireSubHireInOrg(ctx, item.subHireId, a.orgId);
    assertItemMoney(a);

    const projectId = head.projectId ?? null;
    if (a.modelId) await assertModelInOrg(ctx, a.modelId, a.orgId);
    if (a.groupId) await assertSubHireGroupInParent(ctx, a.groupId, item.subHireId);
    if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
    if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);

    // set/clear mirrors the server: scalar fields always set; modelId set-or-clear
    // unconditionally; groupId/target* set-or-clear only when provided (undefined = keep).
    const patch: Record<string, unknown> = {
      description: a.description,
      quantity: a.quantity,
      unitCost: a.unitCost,
      unitCharge: a.unitCharge,
      pricingType: a.pricingType,
      duration: a.duration,
      discount: a.discount,
      showOnQuote: a.showOnQuote,
      showOnDocs: a.showOnDocs,
    };
    patch.modelId = a.modelId ? a.modelId : undefined;
    if (a.groupId !== undefined) patch.groupId = a.groupId ? a.groupId : undefined;
    if (a.targetCategoryId !== undefined) patch.targetCategoryId = a.targetCategoryId ? a.targetCategoryId : undefined;
    if (a.targetGroupId !== undefined) patch.targetGroupId = a.targetGroupId ? a.targetGroupId : undefined;
    await ctx.db.patch(item._id, patch);

    if (a.modelId) {
      await upsertSupplierModelRate(ctx, { orgId: a.orgId, supplierId: head.supplierId, modelId: a.modelId, unitCost: a.unitCost, pricingType: a.pricingType, now: a.now });
    }
    await syncSubHireToProject(ctx, item.subHireId, a.orgId, projectId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: item.subHireId, entityName: head.orderNumber,
      summary: `Updated item "${a.description}" on ${head.orderNumber}`,
    });

    return { id: a.itemId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// removeSubHireItemNative — guard CHECKED_OUT; delete item; full money cascade.
// Parity: removeSubHireItem. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const removeSubHireItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { itemId: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const item = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", a.itemId)).first();
    if (!item) throw new ConvexError("Sub-hire item not found");
    const head = await requireSubHireInOrg(ctx, item.subHireId, a.orgId);
    const projectId = head.projectId ?? null;

    // Reject if the item's project line is checked out (by_subHireId is GLOBAL → org-filter).
    if (projectId) {
      const lines = (
        await ctx.db.query("projectLineItems").withIndex("by_subHireId", (q) => q.eq("subHireId", head.id)).collect()
      ).filter((li) => li.organizationId === a.orgId);
      if (lines.some((li) => li.subHireItemId === a.itemId && li.status === "CHECKED_OUT")) {
        throw new ConvexError("Cannot remove item with checked-out line items");
      }
    }

    // Delete first so the regenerate below reads it as gone.
    await ctx.db.delete(item._id);
    await syncSubHireToProject(ctx, head.id, a.orgId, projectId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "DELETE", entityId: head.id, entityName: head.orderNumber,
      summary: `Removed item from ${head.orderNumber}`,
    });

    return { id: a.itemId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// reorderSubHireItemsNative — sortOrder = index per id (org via head + parent match).
// Empty → no-op. NO recalc, NO audit (parity: reorderSubHireItems never logged).
// Parity: reorderSubHireItems. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const reorderSubHireItemsNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { orgId: v.string(), subHireId: v.string(), itemIds: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    await resolveActor(ctx, a.actor);
    if (a.itemIds.length === 0) return { ok: true };

    // Establish org ownership of the parent (item table has no org column).
    await requireSubHireInOrg(ctx, a.subHireId, a.orgId);

    for (let i = 0; i < a.itemIds.length; i++) {
      const doc = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", a.itemIds[i])).first();
      if (doc && doc.subHireId === a.subHireId) {
        await ctx.db.patch(doc._id, { sortOrder: i });
      }
    }
    return { ok: true };
  },
});
