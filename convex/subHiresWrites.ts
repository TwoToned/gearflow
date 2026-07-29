import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import { recalcSubHireTotals, upsertSupplierModelRate } from "./lib/subHireTotals";
import { regenerateSubHireLines } from "./lib/subHireLineGen";
import { reserveSubHireOrderNumberCounter } from "./lib/subHireOrderCounter";
import { assertStrLen } from "./lib/fieldGuards";
import { createId } from "@paralleldrive/cuid2";
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
 * PR-2 (this file, appended below) adds the LAST writes of the domain: GROUP CRUD
 * (createSubHireGroup / updateSubHireGroup / deleteSubHireGroup / setItemGroup),
 * placement (updateSubHirePlacement), order pricing (updateSubHireOrderPricing), and
 * orchestration (changeSubHireProject, duplicateSubHire). After PR-2, the server file
 * retains ONLY the reads + the media trio (removeSubHireMedia's cross-table refCount
 * union guard is not portable to a native mutation).
 *
 * The requireService mirrors in subHires.ts / subHireItems.ts / subHireGroups.ts are
 * intentionally UNTOUCHED (backfill still routes through them).
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

/**
 * WS7 #946 — validate a `subHires.supplierOrderId` FK: org-checked (by_cuid is
 * GLOBAL) AND same-supplier (the order's supplierId must equal the sub-hire's
 * CURRENT-OR-INCOMING supplierId) — a link across two different suppliers would be
 * a data-integrity footgun (quoting one supplier, invoicing another). Returns the
 * order doc so callers can read its total/status for the link response.
 */
async function requireLinkableSupplierOrder(
  ctx: MutationCtx,
  supplierOrderId: string,
  orgId: string,
  subHireSupplierId: string,
): Promise<Doc<"supplierOrders">> {
  const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", supplierOrderId)).first();
  if (!order || order.organizationId !== orgId) throw new ConvexError("Purchase order not found");
  if (order.supplierId !== subHireSupplierId) {
    throw new ConvexError("The purchase order's supplier must match the sub-hire's supplier");
  }
  return order;
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

/** Recalc a project's totals when the sub-hire has one (no-op otherwise). Reads the
 *  org default tax rate (Postgres-authoritative) from the orgSettings mirror. */
async function recalcProjectIfAny(ctx: MutationCtx, projectId: string | null, orgId: string, now: number): Promise<void> {
  if (!projectId) return;
  const taxRate = await orgDefaultTaxRate(ctx, orgId);
  await recalcProjectTotals(ctx, projectId, orgId, taxRate, now);
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
    // R-8.6.2: mirror subHireSchema's bounds (client Zod validation is bypassable by
    // any caller hitting this Native mutation directly).
    assertStrLen(a.supplierReference, "Supplier reference", { max: 200 });
    assertStrLen(a.notes, "Notes", { max: 2000 });
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
    assertStrLen(a.supplierReference, "Supplier reference", { max: 200 }); // R-8.6.2: mirror subHireSchema
    assertStrLen(a.notes, "Notes", { max: 2000 });

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

    // WS7 #946 — changing the supplier invalidates any existing PO link (the asset-
    // form `supplierOrderId` precedent, issue #789): a link asserts both sides name
    // the SAME supplier, so a supplier change on either side must clear it rather
    // than leave a now-mismatched FK dangling.
    if (existing.supplierOrderId && a.supplierId !== existing.supplierId) {
      patch.supplierOrderId = undefined;
    }

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
// linkSubHireToSupplierOrderNative / unlinkSubHireFromSupplierOrderNative — WS7
// #946's explicit FK set/clear (kept separate from updateSubHireNative, the same
// way attachInvoiceNative/removeInvoiceNative got their own mutations rather than
// being folded into a general order update — a 1:1 link is its own small lifecycle).
// Regenerates the sub-hire's project lines so `projectLineItems.supplierOrderId`
// picks up the (new) link immediately. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const linkSubHireToSupplierOrderNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), supplierOrderId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const head = await requireSubHireInOrg(ctx, a.id, a.orgId);
    const order = await requireLinkableSupplierOrder(ctx, a.supplierOrderId, a.orgId, head.supplierId);

    await ctx.db.patch(head._id, { supplierOrderId: a.supplierOrderId, updatedAt: a.now });
    await regenerateSubHireLines(ctx, head.id, a.orgId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: head.id, entityName: head.orderNumber,
      summary: `Linked sub-hire ${head.orderNumber} to purchase order ${order.orderNumber}`,
    });

    return { id: a.id };
  },
});

export const unlinkSubHireFromSupplierOrderNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const head = await requireSubHireInOrg(ctx, a.id, a.orgId);
    if (!head.supplierOrderId) return { id: a.id }; // idempotent — nothing to unlink

    await ctx.db.patch(head._id, { supplierOrderId: undefined, updatedAt: a.now });
    await regenerateSubHireLines(ctx, head.id, a.orgId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: head.id, entityName: head.orderNumber,
      summary: `Unlinked sub-hire ${head.orderNumber} from its purchase order`,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteSubHireNative — reject if any linked project line is CHECKED_OUT; inline
// cascade-delete the linked project lines (top-level + children, NO units — sub-hire
// lines have none), then the sub-hire's items + groups + head; recalc the project.
// Deleting the sub-hire row simply removes the (one-directional) FK with it — the
// linked supplierOrder carries no back-reference, so it is orphaned, never
// cascade-deleted (spec: WS7 #946). Parity: deleteSubHire. subHire:delete.
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
  assertStrLen(a.description, "Description", { max: 500 }); // R-8.6.2: mirror subHireItemSchema
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

// ─────────────────────────────────────────────────────────────────────────────
// PR-2 — GROUP CRUD + placement + order-pricing + setItemGroup + orchestration
// (changeSubHireProject + duplicate). Money cascade helpers (PR-0, byte-parity):
// recalcSubHireTotals → regenerateSubHireLines → recalcProjectTotals. Which of the
// three each write funnels through mirrors the server's syncSubHireToProject wiring.
// ─────────────────────────────────────────────────────────────────────────────

// Shared group-input args (create + update). cost/charge/targets accept explicit null
// (the pickers send one-of-null); numeric fields validated before insert/patch.
const groupInputArgs = {
  title: v.string(),
  quantity: v.optional(v.number()),
  cost: v.optional(v.union(v.number(), v.null())),
  charge: v.optional(v.union(v.number(), v.null())),
  discount: v.optional(v.number()),
  showOnQuote: v.optional(v.boolean()),
  showOnDocs: v.optional(v.boolean()),
  sortOrder: v.optional(v.number()),
  targetCategoryId: v.optional(v.union(v.string(), v.null())),
  targetGroupId: v.optional(v.union(v.string(), v.null())),
};

function assertGroupMoney(a: { title: string; quantity?: number; cost?: number | null; charge?: number | null; discount?: number }) {
  if (!a.title) throw new ConvexError("Group title is required");
  assertStrLen(a.title, "Group title", { max: 200 }); // R-8.6.2: mirror subHireGroupSchema
  assertIntMin1(a.quantity ?? 1, "Quantity");
  if (a.cost != null) assertFiniteMin0(a.cost, "Cost");
  if (a.charge != null) assertFiniteMin0(a.charge, "Charge");
  assertDiscount(a.discount ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// createSubHireGroupNative — insert group (nextSort over the sub-hire's groups) +
// regenerate project lines + recalc project (NO subhire-totals recalc, matching the
// server's syncSubHireToProject wiring). Parity: createSubHireGroup. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const createSubHireGroupNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), subHireId: v.string(), ...groupInputArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const head = await requireSubHireInOrg(ctx, a.subHireId, a.orgId);
    assertGroupMoney(a);
    const projectId = head.projectId ?? null;
    if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
    if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);

    // Idempotent retry: same cuid + same parent → skip; a collision with an unrelated group is
    // a hard error. COLLECT all matches (by_cuid is global + non-unique).
    const dups = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", a.id)).collect();
    for (const d of dups) if (d.subHireId !== a.subHireId) throw new ConvexError("Sub-hire group already exists");
    if (dups.length > 0) return { id: a.id };

    const existing = await ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", a.subHireId)).collect();
    const nextSort = a.sortOrder ?? (existing.reduce((m, g) => Math.max(m, g.sortOrder ?? 0), -1) + 1);

    await ctx.db.insert("subHireGroups", {
      id: a.id,
      subHireId: a.subHireId,
      title: a.title,
      quantity: a.quantity ?? 1,
      ...(a.cost != null ? { cost: a.cost } : {}),
      ...(a.charge != null ? { charge: a.charge } : {}),
      discount: a.discount ?? 0,
      showOnQuote: a.showOnQuote ?? true,
      showOnDocs: a.showOnDocs ?? false,
      sortOrder: nextSort,
      ...(a.targetCategoryId ? { targetCategoryId: a.targetCategoryId } : {}),
      ...(a.targetGroupId ? { targetGroupId: a.targetGroupId } : {}),
    });

    await regenerateSubHireLines(ctx, a.subHireId, a.orgId, a.now);
    await recalcProjectIfAny(ctx, projectId, a.orgId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "CREATE", entityId: a.subHireId, entityName: head.orderNumber,
      summary: `Created group "${a.title}" on ${head.orderNumber}`,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHireGroupNative — patch group (set/clear per source) + recalc subhire
// totals + regenerate lines + recalc project. Parity: updateSubHireGroup. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHireGroupNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { groupId: v.string(), orgId: v.string(), ...groupInputArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const group = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", a.groupId)).first();
    if (!group) throw new ConvexError("Sub-hire group not found");
    // The group table carries no org — org-check via the parent sub-hire head.
    const head = await requireSubHireInOrg(ctx, group.subHireId, a.orgId);
    assertGroupMoney(a);
    const projectId = head.projectId ?? null;
    if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
    if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);

    // set/clear mirrors the server: title/quantity/discount/showOn* always set (zod-defaulted);
    // cost/charge/sortOrder/targets set-or-clear only when the key is provided (undefined = keep).
    const patch: Record<string, unknown> = {
      title: a.title,
      quantity: a.quantity ?? 1,
      discount: a.discount ?? 0,
      showOnQuote: a.showOnQuote ?? true,
      showOnDocs: a.showOnDocs ?? false,
    };
    if (a.sortOrder !== undefined) patch.sortOrder = a.sortOrder;
    if (a.cost !== undefined) patch.cost = a.cost === null ? undefined : a.cost;
    if (a.charge !== undefined) patch.charge = a.charge === null ? undefined : a.charge;
    if (a.targetCategoryId !== undefined) patch.targetCategoryId = a.targetCategoryId ? a.targetCategoryId : undefined;
    if (a.targetGroupId !== undefined) patch.targetGroupId = a.targetGroupId ? a.targetGroupId : undefined;
    await ctx.db.patch(group._id, patch);

    await recalcSubHireTotals(ctx, head.id, a.orgId, a.now);
    await regenerateSubHireLines(ctx, head.id, a.orgId, a.now);
    await recalcProjectIfAny(ctx, projectId, a.orgId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: head.id, entityName: head.orderNumber,
      summary: `Updated group "${a.title}" on ${head.orderNumber}`,
    });

    return { id: a.groupId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteSubHireGroupNative — ungroup children (clear item.groupId) + delete group +
// regenerate lines + recalc project. Parity: deleteSubHireGroup. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteSubHireGroupNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { groupId: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const group = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", a.groupId)).first();
    if (!group) throw new ConvexError("Sub-hire group not found");
    const head = await requireSubHireInOrg(ctx, group.subHireId, a.orgId);
    const projectId = head.projectId ?? null;

    // Ungroup children (by_groupId is GLOBAL, but groupId is the group's unique cuid → all
    // matches belong to this group; filter on the parent sub-hire defensively), then delete.
    const children = (
      await ctx.db.query("subHireItems").withIndex("by_groupId", (q) => q.eq("groupId", a.groupId)).collect()
    ).filter((it) => it.subHireId === head.id);
    for (const it of children) await ctx.db.patch(it._id, { groupId: undefined });
    await ctx.db.delete(group._id);

    await regenerateSubHireLines(ctx, head.id, a.orgId, a.now);
    await recalcProjectIfAny(ctx, projectId, a.orgId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "DELETE", entityId: head.id, entityName: head.orderNumber,
      summary: `Deleted group from ${head.orderNumber}`,
    });

    return { id: a.groupId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// setItemGroupNative — move an item into a group (validate the target is in the SAME
// sub-hire) or ungroup (null) + regenerate lines + recalc project. NO audit (parity).
// Parity: setItemGroup. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const setItemGroupNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { itemId: v.string(), orgId: v.string(), groupId: v.union(v.string(), v.null()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    await resolveActor(ctx, a.actor);

    const item = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", a.itemId)).first();
    if (!item) throw new ConvexError("Sub-hire item not found");
    const head = await requireSubHireInOrg(ctx, item.subHireId, a.orgId);
    const projectId = head.projectId ?? null;

    // The target group must belong to the SAME sub-hire (or null to ungroup).
    if (a.groupId) await assertSubHireGroupInParent(ctx, a.groupId, item.subHireId);
    await ctx.db.patch(item._id, { groupId: a.groupId ? a.groupId : undefined });

    await regenerateSubHireLines(ctx, head.id, a.orgId, a.now);
    await recalcProjectIfAny(ctx, projectId, a.orgId, a.now);

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHireOrderPricingNative — patch pricingMode + orderTotalCost/Charge
// (set-or-clear) + recalc subhire totals + recalc project. NO line regen (parity).
// Parity: updateSubHireOrderPricing. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHireOrderPricingNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    subHireId: v.string(),
    orgId: v.string(),
    pricingMode: enums.SubHirePricingMode,
    orderTotalCost: v.optional(v.union(v.number(), v.null())),
    orderTotalCharge: v.optional(v.union(v.number(), v.null())),
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
    if (a.orderTotalCost != null) assertFiniteMin0(a.orderTotalCost, "Order total cost");
    if (a.orderTotalCharge != null) assertFiniteMin0(a.orderTotalCharge, "Order total charge");

    // pricingMode always set; orderTotalCost/Charge set when present, else cleared.
    const patch: Record<string, unknown> = { pricingMode: a.pricingMode, updatedAt: a.now };
    patch.orderTotalCost = a.orderTotalCost != null ? a.orderTotalCost : undefined;
    patch.orderTotalCharge = a.orderTotalCharge != null ? a.orderTotalCharge : undefined;
    await ctx.db.patch(head._id, patch);

    await recalcSubHireTotals(ctx, head.id, a.orgId, a.now);
    await recalcProjectIfAny(ctx, head.projectId ?? null, a.orgId, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: a.subHireId, entityName: head.orderNumber,
      summary: `Changed pricing mode to ${a.pricingMode} on ${head.orderNumber}`,
    });

    return { id: a.subHireId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSubHirePlacementNative — 3-way: patch the order defaults (on head), a group's
// target*, or an item's target* (per entityType) + regenerate lines + recalc project.
// Every provided target validated against the sub-hire's project. NO audit (parity).
// Parity: updateSubHirePlacement. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSubHirePlacementNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    entityType: v.union(v.literal("order"), v.literal("group"), v.literal("item")),
    entityId: v.string(),
    orgId: v.string(),
    targetCategoryId: v.optional(v.union(v.string(), v.null())),
    targetGroupId: v.optional(v.union(v.string(), v.null())),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    await resolveActor(ctx, a.actor);

    let subHireId: string;
    let projectId: string | null;

    if (a.entityType === "order") {
      const head = await requireSubHireInOrg(ctx, a.entityId, a.orgId);
      subHireId = head.id;
      projectId = head.projectId ?? null;
      if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
      if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);
      await ctx.db.patch(head._id, {
        defaultTargetCategoryId: a.targetCategoryId ? a.targetCategoryId : undefined,
        defaultTargetGroupId: a.targetGroupId ? a.targetGroupId : undefined,
        updatedAt: a.now,
      });
    } else if (a.entityType === "group") {
      const group = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", a.entityId)).first();
      if (!group) throw new ConvexError("Sub-hire group not found");
      const head = await requireSubHireInOrg(ctx, group.subHireId, a.orgId);
      subHireId = head.id;
      projectId = head.projectId ?? null;
      if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
      if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);
      await ctx.db.patch(group._id, {
        targetCategoryId: a.targetCategoryId ? a.targetCategoryId : undefined,
        targetGroupId: a.targetGroupId ? a.targetGroupId : undefined,
      });
    } else {
      const item = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", a.entityId)).first();
      if (!item) throw new ConvexError("Sub-hire item not found");
      const head = await requireSubHireInOrg(ctx, item.subHireId, a.orgId);
      subHireId = head.id;
      projectId = head.projectId ?? null;
      if (a.targetGroupId) await assertTargetGroup(ctx, a.targetGroupId, a.orgId, projectId);
      if (a.targetCategoryId) await assertTargetCategory(ctx, a.targetCategoryId, a.orgId, projectId);
      await ctx.db.patch(item._id, {
        targetCategoryId: a.targetCategoryId ? a.targetCategoryId : undefined,
        targetGroupId: a.targetGroupId ? a.targetGroupId : undefined,
      });
    }

    await regenerateSubHireLines(ctx, subHireId, a.orgId, a.now);
    await recalcProjectIfAny(ctx, projectId, a.orgId, a.now);

    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// changeSubHireProjectNative — validate the new project is in org; delete the OLD
// project's linked sub-hire lines (inline cascade); move the projectId FK; on
// CONFIRMED/ON_HIRE regenerate the NEW project's lines; recalc BOTH projects.
// Parity: changeSubHireProject. subHire:update.
// ─────────────────────────────────────────────────────────────────────────────
export const changeSubHireProjectNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { subHireId: v.string(), orgId: v.string(), newProjectId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "update");
    const actor = await resolveActor(ctx, a.actor);

    const subHire = await requireSubHireInOrg(ctx, a.subHireId, a.orgId);
    const oldProjectId = subHire.projectId ?? null;
    const newProject = await requireProjectInOrg(ctx, a.newProjectId, a.orgId);
    const label = await supplierLabel(ctx, subHire.supplierId, a.orgId);
    const previousStatus = subHire.status ?? "DRAFT";

    // Delete the OLD project's lines for this sub-hire. Iterate TOP-LEVEL (!isKitChild)
    // only so each child is deleted once via its parent (sub-hire lines have no units).
    if (oldProjectId) {
      const oldLines = (
        await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", oldProjectId)).collect()
      ).filter((l) => l.organizationId === a.orgId && l.subHireId === a.subHireId);
      for (const line of oldLines) {
        if (line.isKitChild) continue;
        const kids = (
          await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", line.id)).collect()
        ).filter((c) => c.organizationId === a.orgId);
        for (const c of kids) await ctx.db.delete(c._id);
        await ctx.db.delete(line._id);
      }
    }

    // Move the FK + CLEAR every placement target: the head defaults, each group's, and each
    // item's targetGroupId/targetCategoryId were validated against the OLD project. Carrying
    // them into the new project would place regenerated lines in another project's groups (a
    // cross-project dangling reference). Clearing them lands the moved sub-hire uncategorized
    // in the new project — the user re-places it there. (The deleted server action left the
    // stale targets, a latent bug; changeSubHireProject has no UI consumer, so this is safe.)
    await ctx.db.patch(subHire._id, {
      projectId: a.newProjectId,
      defaultTargetGroupId: undefined,
      defaultTargetCategoryId: undefined,
      updatedAt: a.now,
    });
    for (const g of await ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", a.subHireId)).collect()) {
      if (g.targetGroupId != null || g.targetCategoryId != null) {
        await ctx.db.patch(g._id, { targetGroupId: undefined, targetCategoryId: undefined });
      }
    }
    for (const it of await ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", a.subHireId)).collect()) {
      if (it.targetGroupId != null || it.targetCategoryId != null) {
        await ctx.db.patch(it._id, { targetGroupId: undefined, targetCategoryId: undefined });
      }
    }

    if (previousStatus === "CONFIRMED" || previousStatus === "ON_HIRE") {
      await regenerateSubHireLines(ctx, a.subHireId, a.orgId, a.now);
    }

    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    if (oldProjectId) await recalcProjectTotals(ctx, oldProjectId, a.orgId, taxRate, a.now);
    await recalcProjectTotals(ctx, a.newProjectId, a.orgId, taxRate, a.now);

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", entityId: a.subHireId, entityName: `${subHire.orderNumber} (${label})`,
      summary: `Moved sub-hire ${subHire.orderNumber} to project ${newProject.projectNumber}`,
    });

    return { id: a.subHireId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// duplicateSubHireNative — reserve a fresh order number (atomic counter) + insert a
// new DRAFT head (createdById = actor.userId, NO project) + copy groups + items with
// fresh cuids (group ids minted inline, mapped so item.groupId re-points). Placement
// targets NOT copied. supplierOrderId NOT copied (WS7 #946 — a duplicated sub-hire
// starts unlinked; the source order was raised for the ORIGINAL sub-hire's items).
// NO recalc (no project). Parity: duplicateSubHire. subHire:create.
// ─────────────────────────────────────────────────────────────────────────────
export const duplicateSubHireNative = mutation({
  returns: v.object({ id: v.string(), orderNumber: v.string() }),
  args: { id: v.string(), orgId: v.string(), sourceId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "subHire");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "subHire", "create");
    const actor = await resolveActor(ctx, a.actor);

    const source = await requireSubHireInOrg(ctx, a.sourceId, a.orgId);

    // Idempotent retry: same new-head cuid + same org → return; a foreign-org collision is a
    // hard error. COLLECT all matches (by_cuid is global + non-unique).
    const dups = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", a.id)).collect();
    for (const d of dups) if (d.organizationId !== a.orgId) throw new ConvexError("Sub-hire already exists");
    if (dups.length > 0) return { id: a.id, orderNumber: dups[0].orderNumber };

    const [srcGroups, srcItems] = await Promise.all([
      ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", a.sourceId)).collect(),
      ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", a.sourceId)).collect(),
    ]);

    const { orderNumber } = await reserveSubHireOrderNumberCounter(ctx, a.orgId, a.now);

    await ctx.db.insert("subHires", {
      id: a.id,
      organizationId: a.orgId,
      supplierId: source.supplierId,
      createdById: actor.userId,
      orderNumber,
      status: "DRAFT",
      ...(source.pricingMode ? { pricingMode: source.pricingMode } : {}),
      ...(source.orderTotalCost != null ? { orderTotalCost: source.orderTotalCost } : {}),
      ...(source.orderTotalCharge != null ? { orderTotalCharge: source.orderTotalCharge } : {}),
      showOnDocs: source.showOnDocs ?? false,
      ...(source.notes ? { notes: source.notes } : {}),
      ...(source.totalCost != null ? { totalCost: source.totalCost } : {}),
      ...(source.totalCharge != null ? { totalCharge: source.totalCharge } : {}),
      createdAt: a.now,
      updatedAt: a.now,
    });

    // Copy groups with fresh cuids (mapped old→new so item.groupId re-points). Placement
    // targets are NOT copied (a fresh DRAFT starts uncategorized — parity).
    const groupIdMap = new Map<string, string>();
    for (const g of srcGroups) groupIdMap.set(g.id, createId());
    for (const g of srcGroups) {
      await ctx.db.insert("subHireGroups", {
        id: groupIdMap.get(g.id)!,
        subHireId: a.id,
        title: g.title,
        ...(g.quantity != null ? { quantity: g.quantity } : {}),
        ...(g.cost != null ? { cost: g.cost } : {}),
        ...(g.charge != null ? { charge: g.charge } : {}),
        ...(g.showOnQuote != null ? { showOnQuote: g.showOnQuote } : {}),
        ...(g.showOnDocs != null ? { showOnDocs: g.showOnDocs } : {}),
        ...(g.sortOrder != null ? { sortOrder: g.sortOrder } : {}),
      });
    }
    for (const it of srcItems) {
      const newGroupId = it.groupId ? groupIdMap.get(it.groupId) : undefined;
      await ctx.db.insert("subHireItems", {
        id: createId(),
        subHireId: a.id,
        ...(newGroupId ? { groupId: newGroupId } : {}),
        ...(it.modelId ? { modelId: it.modelId } : {}),
        description: it.description,
        ...(it.quantity != null ? { quantity: it.quantity } : {}),
        ...(it.unitCost != null ? { unitCost: it.unitCost } : {}),
        ...(it.unitCharge != null ? { unitCharge: it.unitCharge } : {}),
        ...(it.pricingType ? { pricingType: it.pricingType } : {}),
        ...(it.duration != null ? { duration: it.duration } : {}),
        ...(it.discount != null ? { discount: it.discount } : {}),
        ...(it.showOnQuote != null ? { showOnQuote: it.showOnQuote } : {}),
        ...(it.showOnDocs != null ? { showOnDocs: it.showOnDocs } : {}),
        ...(it.sortOrder != null ? { sortOrder: it.sortOrder } : {}),
      });
    }

    await logSubHire(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "CREATE", entityId: a.id, entityName: orderNumber,
      summary: `Duplicated sub-hire from ${source.orderNumber} to ${orderNumber}`,
      details: { sourceId: a.sourceId },
    });

    return { id: a.id, orderNumber };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addSubHireItemNative: { danger: "medium" },
  // Deletes the OLD project's linked lines unconditionally (unlike deleteSubHireNative,
  // it does NOT guard against a CHECKED_OUT line before doing so) and regenerates the
  // NEW project's lines — a warehouse-movement-adjacent structural rewrite across two
  // projects' documents.
  changeSubHireProjectNative: { danger: "high" },
  createSubHireGroupNative: { danger: "medium" },
  createSubHireNative: { danger: "medium" },
  deleteSubHireGroupNative: { danger: "high" },
  deleteSubHireNative: { danger: "high" },
  duplicateSubHireNative: { danger: "medium" },
  linkSubHireToSupplierOrderNative: { danger: "medium" },
  removeSubHireItemNative: { danger: "high" },
  reorderSubHireItemsNative: { danger: "low" },
  // Reassigns an item's group — trivially reversible, no money change.
  setItemGroupNative: { danger: "low" },
  unlinkSubHireFromSupplierOrderNative: { danger: "medium" },
  updateSubHireGroupNative: { danger: "medium" },
  updateSubHireItemNative: { danger: "medium" },
  updateSubHireNative: { danger: "medium" },
  updateSubHireOrderPricingNative: { danger: "medium" },
  // Payment-status change — recoverable, not a void/issue action (rubric example).
  updateSubHirePaymentStatusNative: { danger: "medium" },
  // Placement (target category/group) reassignment — trivially reversible.
  updateSubHirePlacementNative: { danger: "low" },
  // RETURNED/CANCELLED are terminal (VALID_TRANSITIONS has no way out) and CONFIRMED
  // commits the order against a project — same lock-lifecycle-sensitive shape as
  // projectWrites.updateStatusNative.
  updateSubHireStatusNative: { danger: "high" },
};
