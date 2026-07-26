import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { bumpProjectCounters } from "./lib/counters";
import { checkinItemsCore } from "./warehouseOps";
import { syncLineItemRollup, assetStatusFromReturnCondition } from "./lib/fulfillment";
import { distributeReturn, type CheckInItem } from "./lib/bulkCheckin";

/**
 * Org-wide returns-station writes (issue #944 WS5) — the project-less scan/batch
 * return mutations. Same security bar as the rest of the warehouse write family
 * (convex/warehouseWrites.ts): assertWritesEnabled → enforceBrowserWriteLimit →
 * requireOrgPermission(warehouse, check_in) → resolveActor, then per-row org
 * re-check on every doc fetched by a GLOBAL by_cuid index.
 *
 * ── The client-trust surface this closes ──
 * The project-scoped `warehouseWrites.checkInItems` takes `projectId` as a CLIENT
 * arg and org/line-scopes it at the boundary. A project-less station has no
 * project selection UI to derive that arg from in the first place — so instead of
 * trusting a client-supplied projectId, these mutations take ONLY `lineItemId`
 * and derive `projectId` themselves from the line row (`loadLineInOrg`), which is
 * itself org-checked (by_cuid is a GLOBAL index). There is no argument anywhere
 * in this file the caller could set to point a return at a different project's
 * line than the one it's actually returning to.
 *
 * ── Reuses the existing check-in engine ──
 * The actual state transition is `warehouseOps.checkinItemsCore` — the SAME core
 * `warehouseWrites.checkInItems` calls (return condition routing, scan log,
 * accessory cascade, rollup). This file is authorization + FK/org validation +
 * project derivation + audit + the two returns-station-specific extras: batch
 * partial-success and the last-unit-returned auto-advance side effect.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const returnCond = v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING"));
const BATCH_CAP = 100;
const NOTES_MAX = 2000;

function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : (e.data as { message?: string })?.message ?? "Unknown error";
  return e instanceof Error ? e.message : "Unknown error";
}

async function loadLineInOrg(ctx: MutationCtx, orgId: string, lineItemId: string) {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
  if (!line || line.organizationId !== orgId) throw new ConvexError(`Line item ${lineItemId} not found`);
  return line;
}

async function assertAssetInOrg(ctx: MutationCtx, assetId: string, orgId: string): Promise<void> {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).first();
  if (!asset || asset.organizationId !== orgId) throw new ConvexError("Asset not found");
}

async function assertBulkAssetInOrg(ctx: MutationCtx, bulkAssetId: string, orgId: string): Promise<void> {
  const b = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bulkAssetId)).first();
  if (!b || b.organizationId !== orgId) throw new ConvexError("Bulk asset not found");
}

async function loadProjectInOrg(ctx: MutationCtx, orgId: string, projectId: string) {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError("Project not found");
  return p;
}

/** This project's CHECKED_OUT lines carrying the given bulk asset — org-checked,
 *  bounded to one project (by_projectId_status, same index checkInBulkTotals
 *  uses). Matches every line referencing the tag regardless of accessory-child
 *  status, mirroring returnsLookup.resolveBulk's org-wide unit scan so a scan's
 *  reported "outstanding" and the write's actual distribution never disagree. */
async function candidateBulkLines(ctx: MutationCtx, orgId: string, projectId: string, bulkAssetId: string) {
  const rows = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId_status", (q) => q.eq("projectId", projectId).eq("status", "CHECKED_OUT"))
    .collect();
  return rows.filter((r) => r.organizationId === orgId && r.bulkAssetId === bulkAssetId);
}

async function toBulkCheckInItem(ctx: MutationCtx, line: Doc<"projectLineItems">): Promise<CheckInItem> {
  const units = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", line.id)).collect();
  const outstanding =
    units.length > 0
      ? units.reduce((s, u) => (u.status === "CHECKED_OUT" ? s + Math.max(0, (u.quantity ?? 0) - (u.returnedQuantity ?? 0)) : s), 0)
      : Math.max(0, (line.checkedOutQuantity ?? 0) - (line.returnedQuantity ?? 0));
  return {
    lineItemId: line.id,
    modelId: line.modelId ?? null,
    modelName: null,
    modelNumber: null,
    assetId: null,
    bulkAssetId: line.bulkAssetId ?? null,
    subHireId: line.subHireId ?? null,
    isCustomItem: !!line.isCustomItem,
    childKind: line.childKind ?? null,
    sortOrder: line.sortOrder ?? 0,
    outstanding,
    itemType: "OWNED_BULK",
  };
}

type ReturnItemArg = {
  lineItemId: string;
  assetId?: string;
  bulkAssetId?: string;
  quantity?: number;
  returnCondition: "GOOD" | "DAMAGED" | "MISSING";
  notes?: string;
};

/** One item's return — shared by returnScanNative and each iteration of
 *  returnBatchNative. Derives + returns `projectId` (never trusts a client one). */
async function returnCore(
  ctx: MutationCtx,
  orgId: string,
  actor: Actor,
  now: number,
  item: ReturnItemArg,
  auditId: string,
): Promise<{ projectId: string; updatedLineIds: string[] }> {
  assertStrLen(item.notes, "notes", { max: NOTES_MAX });

  const line = await loadLineInOrg(ctx, orgId, item.lineItemId);
  if (line.status === "CANCELLED") throw new ConvexError(`Line item ${item.lineItemId} is cancelled`);
  if (item.assetId) await assertAssetInOrg(ctx, item.assetId, orgId);
  if (item.bulkAssetId) await assertBulkAssetInOrg(ctx, item.bulkAssetId, orgId);

  const res = await checkinItemsCore(ctx, {
    organizationId: orgId,
    projectId: line.projectId, // ★ SERVER-DERIVED — never a client arg (see file header).
    userId: actor.userId,
    items: [{ lineItemId: item.lineItemId, assetId: item.assetId, returnCondition: item.returnCondition, quantity: item.quantity, notes: item.notes }],
    now,
  });

  await writeActivityLog(ctx, {
    id: auditId,
    organizationId: orgId,
    action: "CHECK_IN",
    entityType: "asset",
    entityId: item.assetId || item.bulkAssetId || item.lineItemId,
    entityName: `Line item ${item.lineItemId}`,
    userId: actor.userId,
    userName: actor.userName,
    summary: `Returned item via returns station (condition: ${item.returnCondition})`,
    projectId: line.projectId,
    ...(item.assetId ? { assetId: item.assetId } : {}),
    createdAt: now,
  });

  return { projectId: line.projectId, updatedLineIds: res.updatedLineIds };
}

/**
 * When a project's LAST outstanding CHECKED_OUT line just returned, auto-advance
 * it to RETURNED (existing status-mutation semantics, feeds batch close-out).
 * Patches the project directly inside this warehouse-authorized transaction
 * rather than calling `projectWrites.updateStatusNative` (which separately gates
 * on `project:update` — a dedicated `warehouse` role has check_in but only
 * `project:read`, so routing through that mutation would make this side effect
 * silently fail for exactly the role this station is built for). The single
 * `warehouse:check_in` gate already checked at the top of the calling mutation is
 * the authority for every table this whole transaction touches, matching how
 * `warehouseOps` cores already write `assets`/`projectLineItems` without a
 * separate per-table permission re-check.
 */
async function maybeAutoAdvanceProject(ctx: MutationCtx, orgId: string, projectId: string, actor: Actor, now: number): Promise<boolean> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== orgId) return false;
  if (project.status !== "CHECKED_OUT" && project.status !== "ON_SITE") return false;

  // Existence check only (not a collect) — any remaining CHECKED_OUT line blocks
  // the advance.
  const stillOut = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId_status", (q) => q.eq("projectId", projectId).eq("status", "CHECKED_OUT"))
    .first();
  if (stillOut) return false;

  await ctx.db.patch(project._id, { status: "RETURNED", updatedAt: now });
  await bumpProjectCounters(ctx, orgId, project, { ...project, status: "RETURNED" });
  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: orgId,
    action: "UPDATE",
    entityType: "project",
    entityId: project.id,
    entityName: project.name,
    userId: actor.userId,
    userName: actor.userName,
    summary: "Auto-advanced to Returned — last outstanding item returned via the returns station",
    projectId: project.id,
    createdAt: now,
  });
  return true;
}

// ─── returnScanNative — single scan-and-return ──────────────────────────────
export const returnScanNative = mutation({
  returns: v.object({ updatedLineIds: v.array(v.string()), projectId: v.string(), autoAdvanced: v.boolean() }),
  args: {
    orgId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    returnCondition: returnCond,
    notes: v.optional(v.string()),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    const { projectId, updatedLineIds } = await returnCore(ctx, a.orgId, actor, a.now, a, a.auditId);
    const autoAdvanced = await maybeAutoAdvanceProject(ctx, a.orgId, projectId, actor, a.now);

    return { updatedLineIds, projectId, autoAdvanced };
  },
});

// ─── returnBulkNative — bulk-tag scan, one project (spec: "revive
// distributeReturn with a project-scoped compound key") ─────────────────────
// A bulk asset tag has no single `lineItemId` to route through returnScanNative
// — it can span multiple lines within the SAME project (e.g. a top-level bulk
// line and a bulk accessory child both carrying the same bulkAssetId). This
// re-derives the project's candidate lines server-side (never trusts a client
// line breakdown), groups them, and distributes `quantity` across them via the
// SAME `distributeReturn` engine `warehouseOps.checkInBulkTotals` uses —
// scoped to exactly one (projectId, bulkAssetId) pair, which is the
// project-scoped compound key the multi-project resolver needed revived.
export const returnBulkNative = mutation({
  returns: v.object({ distributed: v.number(), updatedLineIds: v.array(v.string()), autoAdvanced: v.boolean() }),
  args: {
    orgId: v.string(),
    bulkAssetId: v.string(),
    projectId: v.string(),
    quantity: v.number(),
    returnCondition: returnCond,
    notes: v.optional(v.string()),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);
    assertStrLen(a.notes, "notes", { max: NOTES_MAX });

    await assertBulkAssetInOrg(ctx, a.bulkAssetId, a.orgId);
    await loadProjectInOrg(ctx, a.orgId, a.projectId);

    const lines = await candidateBulkLines(ctx, a.orgId, a.projectId, a.bulkAssetId);
    const items = await Promise.all(lines.map((l) => toBulkCheckInItem(ctx, l)));
    const { allocations, distributed } = distributeReturn(items, a.quantity);
    if (distributed <= 0) {
      throw new ConvexError("Nothing outstanding to return for this item on this project");
    }

    const res = await checkinItemsCore(ctx, {
      organizationId: a.orgId,
      projectId: a.projectId, // ★ SERVER-DERIVED — the client only supplies bulkAssetId + a project it was told about by the resolver, never a raw line.
      userId: actor.userId,
      items: allocations.map((al) => ({ lineItemId: al.lineItemId, returnCondition: a.returnCondition, quantity: al.quantity, notes: a.notes })),
      now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CHECK_IN",
      entityType: "asset",
      entityId: a.bulkAssetId,
      entityName: `Bulk asset ${a.bulkAssetId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Returned ${distributed}x bulk item via returns station (condition: ${a.returnCondition})`,
      projectId: a.projectId,
      createdAt: a.now,
    });

    const autoAdvanced = await maybeAutoAdvanceProject(ctx, a.orgId, a.projectId, actor, a.now);

    return { distributed, updatedLineIds: res.updatedLineIds, autoAdvanced };
  },
});

// ─── returnBatchNative — multi-select batch return ──────────────────────────
// Cap 100 items, server-enforced (client's multi-select is not trusted for the
// bound). Per-item try/catch with labelled results — exceptions never block the
// dock, so one bad item in a batch must not fail the other 99. One batch audit.
export const returnBatchNative = mutation({
  returns: v.array(v.object({
    lineItemId: v.string(),
    success: v.boolean(),
    error: v.optional(v.string()),
    projectId: v.optional(v.string()),
  })),
  args: {
    orgId: v.string(),
    items: v.array(v.object({
      lineItemId: v.string(),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      returnCondition: returnCond,
      notes: v.optional(v.string()),
      auditId: v.string(),
    })),
    batchAuditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    if (a.items.length === 0) throw new ConvexError("No items selected");
    if (a.items.length > BATCH_CAP) throw new ConvexError(`Maximum ${BATCH_CAP} items per batch return`);

    const results: Array<{ lineItemId: string; success: boolean; error?: string; projectId?: string }> = [];
    const touchedProjects = new Set<string>();

    for (const item of a.items) {
      try {
        const { projectId } = await returnCore(ctx, a.orgId, actor, a.now, item, item.auditId);
        touchedProjects.add(projectId);
        results.push({ lineItemId: item.lineItemId, success: true, projectId });
      } catch (e) {
        results.push({ lineItemId: item.lineItemId, success: false, error: errorMessage(e) });
      }
    }

    for (const projectId of touchedProjects) {
      await maybeAutoAdvanceProject(ctx, a.orgId, projectId, actor, a.now);
    }

    const successCount = results.filter((r) => r.success).length;
    if (successCount > 0) {
      await writeActivityLog(ctx, {
        id: a.batchAuditId,
        organizationId: a.orgId,
        action: "CHECK_IN",
        entityType: "asset",
        entityId: a.items[0].lineItemId,
        entityName: `${successCount} item(s)`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Batch returned ${successCount} of ${a.items.length} item(s) via returns station`,
        createdAt: a.now,
      });
    }

    return results;
  },
});

// ─── correctReturnConditionNative — post-hoc "mark damaged / missing" ───────
// Condition defaults to GOOD at scan time and is never prompted mid-scan (spec).
// A session-list row can be corrected afterwards; by that point the unit is
// already RETURNED (not CHECKED_OUT), so re-running checkinItemsCore would be a
// silent no-op (returnLineUnits only flips units that are still CHECKED_OUT).
// This patches the already-returned unit/line's condition + re-derives the
// asset's status from the corrected condition, then re-syncs the line rollup.
export const correctReturnConditionNative = mutation({
  returns: v.object({ updated: v.boolean() }),
  args: {
    orgId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    unitId: v.optional(v.string()),
    returnCondition: returnCond,
    notes: v.optional(v.string()),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);
    assertStrLen(a.notes, "notes", { max: NOTES_MAX });

    const line = await loadLineInOrg(ctx, a.orgId, a.lineItemId);

    let unit: Doc<"projectLineItemUnits"> | null = null;
    if (a.unitId) {
      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", a.unitId!)).first();
      if (!u || u.organizationId !== a.orgId || u.lineItemId !== a.lineItemId) throw new ConvexError("Unit not found on this line");
      unit = u;
    } else if (a.assetId) {
      unit = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId_assetId", (q) => q.eq("lineItemId", a.lineItemId).eq("assetId", a.assetId!)).first();
    }

    if (!unit) {
      if (line.status !== "RETURNED") throw new ConvexError("Item has not been returned yet");
      await ctx.db.patch(line._id, { returnCondition: a.returnCondition, returnNotes: a.notes || line.returnNotes, updatedAt: a.now });
    } else {
      if (unit.status !== "RETURNED") throw new ConvexError("Item has not been returned yet");
      await ctx.db.patch(unit._id, { returnCondition: a.returnCondition, returnNotes: a.notes || unit.returnNotes, updatedAt: a.now });
      if (unit.assetId) {
        const newStatus = assetStatusFromReturnCondition(a.returnCondition);
        const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", unit!.assetId!)).first();
        if (asset && asset.organizationId === a.orgId) {
          await ctx.db.patch(asset._id, { status: newStatus, updatedAt: a.now });
        }
      }
    }
    await syncLineItemRollup(ctx, a.lineItemId);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: a.assetId || a.lineItemId,
      entityName: `Line item ${a.lineItemId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Corrected return condition to ${a.returnCondition}`,
      projectId: line.projectId,
      ...(a.assetId ? { assetId: a.assetId } : {}),
      createdAt: a.now,
    });

    return { updated: true };
  },
});
