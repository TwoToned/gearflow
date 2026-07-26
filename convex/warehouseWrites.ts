import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen, assertArrayMax } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { assertProjectInOrg } from "./projectLineItems";
import {
  checkinItemsCore,
  checkoutItemsCore,
  checkoutKitFull,
  checkoutKitsBatchCore,
  quickAddCore,
  undeployItemsCore,
  unreturnItemsCore,
  undeprepLineCore,
  undeployKitFull,
  unreturnKitFull,
  undeployKitsBatchCore,
  unreturnKitsBatchCore,
  checkinKitFull,
  checkinKitsBatchCore,
  clearPrepContainerCore,
  ensureContainerOnProjectCore,
  syncContainersBatchCore,
  reassignSerialisedUnitCore,
  reassignKitMemberSerialCore,
  forceReturnAssetCore,
  bulkForceReturnAssetsCore,
  forceReturnKitCore,
  forceReturnKitsBatchCore,
  defaultLocationId,
} from "./warehouseOps";
import { assertNoBlockingCommentsInMutation } from "./lib/blockingCommentsGate";
import { getKitByCuid } from "./lib/kits";
import { enqueueWebhookEvent } from "./lib/webhookEnqueue";

/**
 * Browser-direct WAREHOUSE writes (Phase 3 PR-A — the return/undeploy/container write
 * family). Each guarded `api.warehouseWrites.*` mutation folds the kill-switch +
 * per-user rate limit + RBAC (warehouse:check_in|check_out) + FK/org validation +
 * the SAME extracted `warehouseOps` core + in-mutation audit into ONE transaction.
 *
 * The state machine ALREADY lives in Convex (`warehouseOps.ts`); these mutations reuse
 * its exported `*Core` functions verbatim, so behaviour is byte-identical to the
 * `requireService` mirror the server action called. NO recalc — warehouse is
 * fulfillment/status, not money.
 *
 * Security baseline (the Phase 3 browser
 * bar): `actor` is CLIENT-SUPPLIED but pinned to the verified token identity by
 * `resolveActor` — the cores' trusted `userId` writes (checkedOutById / returnedById /
 * scan-log + audit attribution) use `actor.userId`, NEVER a client arg. Every client
 * FK (project / line item / kit / asset / model) is org-validated at the boundary
 * BEFORE the core runs (by_cuid is a GLOBAL index → a cross-tenant id must be
 * rejected). Batch mutations preserve the server actions' empty-guard / dedupe exactly.
 *
 * Return shape is IDS ONLY — the warehouse page reads a live `warehouseDetail` /
 * `warehousePageBatch` subscription, so the server's `attachModelToResults` re-read
 * waterfall is dropped (no consumer read those model-attached rows).
 *
 * The `requireService` mirrors in `warehouseOps.ts` stay (partial-keep): check-records
 * + the warehouseOps test suite still call them with a SERVICE token.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const returnCond = v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING"));

// ─── FK / org-scope validation helpers (by_cuid is GLOBAL — must org-re-check) ────

async function requireProjectInOrg(ctx: MutationCtx, projectId: string, orgId: string): Promise<void> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError("Project not found");
}

async function requireLineInProject(ctx: MutationCtx, lineItemId: string, orgId: string, projectId: string): Promise<void> {
  const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
  if (!l || l.organizationId !== orgId || l.projectId !== projectId) {
    throw new ConvexError(`Line item ${lineItemId} not found in project`);
  }
}

async function requireKitInOrg(ctx: MutationCtx, kitId: string, orgId: string): Promise<void> {
  const k = await getKitByCuid(ctx, kitId);
  if (!k || k.organizationId !== orgId) throw new ConvexError("Kit not found");
}

async function assertAssetInOrg(ctx: MutationCtx, assetId: string, orgId: string): Promise<void> {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).first();
  if (!asset || asset.organizationId !== orgId) throw new ConvexError("Asset not found");
}

async function assertModelInOrg(ctx: MutationCtx, modelId: string, orgId: string): Promise<void> {
  const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
  if (!m || m.organizationId !== orgId) throw new ConvexError("Model not found");
}

async function assertBulkAssetInOrg(ctx: MutationCtx, bulkAssetId: string, orgId: string): Promise<void> {
  const b = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bulkAssetId)).first();
  if (!b || b.organizationId !== orgId) throw new ConvexError("Bulk asset not found");
}

// The force-return family builds its audit `entityName` from the row's own TAG / NAME.
// These loaders org-validate the client FK AND hand back the doc so the tag/name is
// gathered IN-mutation from ctx.db — never trusted from a client arg.
async function loadAssetInOrg(ctx: MutationCtx, assetId: string, orgId: string) {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).first();
  if (!asset || asset.organizationId !== orgId) throw new ConvexError("Asset not found");
  return asset;
}

async function loadKitInOrg(ctx: MutationCtx, kitId: string, orgId: string) {
  const kit = await getKitByCuid(ctx, kitId);
  if (!kit || kit.organizationId !== orgId) throw new ConvexError("Kit not found");
  return kit;
}

async function assertUnitInOrg(ctx: MutationCtx, unitId: string, orgId: string): Promise<void> {
  const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", unitId)).first();
  if (!u || u.organizationId !== orgId) throw new ConvexError("Unit not found in this organization");
}

// ─────────────────────────────────────────────────────────────────────────────
// checkInItems — unit returns + asset/bulk restores + accessory cascade + rollups.
// Parity: checkInItems server action. warehouse:check_in. One audit row per item.
// ─────────────────────────────────────────────────────────────────────────────
export const checkInItems = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    items: v.array(v.object({
      lineItemId: v.string(),
      assetId: v.optional(v.string()),
      returnCondition: returnCond,
      quantity: v.optional(v.number()),
      notes: v.optional(v.string()),
    })),
    auditIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    for (const it of a.items) {
      await requireLineInProject(ctx, it.lineItemId, a.orgId, a.projectId);
      // Validate the optional client assetId too — returnLineUnits' legacy fallback calls
      // setAssetStatus on it without an org check, so a foreign assetId is a cross-tenant write.
      if (it.assetId) await assertAssetInOrg(ctx, it.assetId, a.orgId);
    }

    const res = await checkinItemsCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, items: a.items, now: a.now,
    });

    for (let i = 0; i < a.items.length; i++) {
      const item = a.items[i];
      const auditId = a.auditIds[i];
      if (!auditId) continue;
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: a.orgId,
        action: "CHECK_IN",
        entityType: "asset",
        entityId: item.lineItemId,
        entityName: `Line item ${item.lineItemId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Checked in item on project (condition: ${item.returnCondition})`,
        projectId: a.projectId,
        createdAt: a.now,
      });
    }

    return res; // { updatedLineIds }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// undeployItems — Deployed → Prepped. Parity: undeployItems. warehouse:check_in.
// ─────────────────────────────────────────────────────────────────────────────
export const undeployItems = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    items: v.array(v.object({ lineItemId: v.string(), assetId: v.optional(v.string()), quantity: v.optional(v.number()) })),
    auditIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    for (const it of a.items) {
      await requireLineInProject(ctx, it.lineItemId, a.orgId, a.projectId);
      if (it.assetId) await assertAssetInOrg(ctx, it.assetId, a.orgId);
    }

    const res = await undeployItemsCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, items: a.items, now: a.now,
    });

    for (let i = 0; i < a.items.length; i++) {
      const item = a.items[i];
      const auditId = a.auditIds[i];
      if (!auditId) continue;
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "asset",
        entityId: item.assetId || item.lineItemId,
        entityName: `Line item ${item.lineItemId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: "Moved item back to Prepped (un-deploy)",
        projectId: a.projectId,
        ...(item.assetId ? { assetId: item.assetId } : {}),
        createdAt: a.now,
      });
    }

    return res; // { updatedLineIds }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// unreturnItems — Returned → Deployed. Parity: unreturnItems. warehouse:check_out.
// ─────────────────────────────────────────────────────────────────────────────
export const unreturnItems = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    items: v.array(v.object({ lineItemId: v.string(), assetId: v.optional(v.string()), quantity: v.optional(v.number()) })),
    auditIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    for (const it of a.items) {
      await requireLineInProject(ctx, it.lineItemId, a.orgId, a.projectId);
      if (it.assetId) await assertAssetInOrg(ctx, it.assetId, a.orgId);
    }

    const res = await unreturnItemsCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, items: a.items, now: a.now,
    });

    for (let i = 0; i < a.items.length; i++) {
      const item = a.items[i];
      const auditId = a.auditIds[i];
      if (!auditId) continue;
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "asset",
        entityId: item.assetId || item.lineItemId,
        entityName: `Line item ${item.lineItemId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: "Moved item back to Deployed (un-return)",
        projectId: a.projectId,
        ...(item.assetId ? { assetId: item.assetId } : {}),
        createdAt: a.now,
      });
    }

    return res; // { updatedLineIds }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// undeprepLine — De-prepped → Returned (re-pack). Parity: undeprepLine. check_out.
// ─────────────────────────────────────────────────────────────────────────────
export const undeprepLine = mutation({
  args: { orgId: v.string(), projectId: v.string(), lineItemId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);

    const res = await undeprepLineCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, lineItemId: a.lineItemId, now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: a.lineItemId,
      entityName: `Line item ${a.lineItemId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Re-packed returned item (un-deprep)",
      projectId: a.projectId,
      createdAt: a.now,
    });

    return res; // { id }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// undeployKit / unreturnKit — whole-kit reverse (singular). Parity: undeployKit /
// unreturnKit. undeploy=check_in, unreturn=check_out.
// ─────────────────────────────────────────────────────────────────────────────
export const undeployKit = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await requireKitInOrg(ctx, a.kitId, a.orgId);

    const res = await undeployKitFull(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitId: a.kitId, now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "kit",
      entityId: a.kitId,
      entityName: `Kit ${a.kitId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Moved kit back to Prepped (un-deploy)",
      projectId: a.projectId,
      kitId: a.kitId,
      createdAt: a.now,
    });

    return res; // { kitId, affectedKitIds }
  },
});

export const unreturnKit = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await requireKitInOrg(ctx, a.kitId, a.orgId);

    const res = await unreturnKitFull(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitId: a.kitId, now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "kit",
      entityId: a.kitId,
      entityName: `Kit ${a.kitId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Moved kit back to Deployed (un-return)",
      projectId: a.projectId,
      kitId: a.kitId,
      createdAt: a.now,
    });

    return res; // { kitId, affectedKitIds }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// undeployKitsBatch / unreturnKitsBatch — bulk whole-kit reverse. Parity: the batch
// server actions (empty-guard throw). One summary audit row when any kit succeeds.
// ─────────────────────────────────────────────────────────────────────────────
export const undeployKitsBatch = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitIds: v.array(v.string()), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);
    if (a.kitIds.length === 0) throw new ConvexError("No kits selected");

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    // Dedupe: the core adjusts kit inventory per occurrence, so a duplicate id would
    // double-apply. Cross-tenant safety comes from the core itself — it operates via each
    // kit's PARENT LINE in this org's project (kitParentLine), so a foreign/ghost kit has
    // no parent line here and lands in `errors` (partial-success), never a cross-org write.
    const unique = [...new Set(a.kitIds)];

    const res = await undeployKitsBatchCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitIds: unique, now: a.now,
    });

    if (res.succeeded.length > 0) {
      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "kit",
        entityId: res.succeeded[0],
        entityName: `${res.succeeded.length} kits`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Moved ${res.succeeded.length} kit(s) back to Prepped (un-deploy)`,
        projectId: a.projectId,
        createdAt: a.now,
      });
    }

    return res; // { succeeded, errors, affectedKitIds }
  },
});

export const unreturnKitsBatch = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitIds: v.array(v.string()), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);
    if (a.kitIds.length === 0) throw new ConvexError("No kits selected");

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    // Dedupe (per-occurrence inventory adjust would double-apply). Cross-tenant safety is
    // the core's kitParentLine (foreign/ghost kit → per-item error, not a cross-org write).
    const unique = [...new Set(a.kitIds)];

    const res = await unreturnKitsBatchCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitIds: unique, now: a.now,
    });

    if (res.succeeded.length > 0) {
      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "kit",
        entityId: res.succeeded[0],
        entityName: `${res.succeeded.length} kits`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Moved ${res.succeeded.length} kit(s) back to Deployed (un-return)`,
        projectId: a.projectId,
        createdAt: a.now,
      });
    }

    return res; // { succeeded, errors, affectedKitIds }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// checkInKit — whole-kit return (singular). Parity: checkInKit. warehouse:check_in.
// ─────────────────────────────────────────────────────────────────────────────
export const checkInKit = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitId: v.string(), returnCondition: returnCond, auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await requireKitInOrg(ctx, a.kitId, a.orgId);

    const res = await checkinKitFull(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitId: a.kitId, returnCondition: a.returnCondition, now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CHECK_IN",
      entityType: "kit",
      entityId: a.kitId,
      entityName: `Kit ${a.kitId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Checked in kit (condition: ${a.returnCondition})`,
      projectId: a.projectId,
      kitId: a.kitId,
      createdAt: a.now,
    });

    return res; // { kitId, affectedKitIds }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// checkInKitsBatch — bulk whole-kit return. Parity: checkInKitsBatch (dedupe by
// kitId keep-first, empty → {succeeded:[],errors:[]}). One audit per succeeded kit.
// ─────────────────────────────────────────────────────────────────────────────
export const checkInKitsBatch = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    items: v.array(v.object({ kitId: v.string(), returnCondition: returnCond, auditId: v.string() })),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    // Dedupe by kitId (keep first occurrence) — checkinKit restores the kit's bulk
    // contents each call, so returning the same kit twice would overstate availability.
    const seen = new Set<string>();
    const uniqueItems = a.items.filter((it) => (seen.has(it.kitId) ? false : (seen.add(it.kitId), true)));
    if (uniqueItems.length === 0) return { succeeded: [] as string[], errors: [] as { kitId: string; message: string }[] };

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    for (const it of uniqueItems) await requireKitInOrg(ctx, it.kitId, a.orgId);

    const res = await checkinKitsBatchCore(ctx, {
      organizationId: a.orgId,
      projectId: a.projectId,
      userId: actor.userId,
      items: uniqueItems.map(({ kitId, returnCondition }) => ({ kitId, returnCondition })),
      now: a.now,
    });

    for (const kitId of res.succeeded) {
      const it = uniqueItems.find((x) => x.kitId === kitId);
      if (!it) continue;
      await writeActivityLog(ctx, {
        id: it.auditId,
        organizationId: a.orgId,
        action: "CHECK_IN",
        entityType: "kit",
        entityId: kitId,
        entityName: `Kit ${kitId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Checked in kit (condition: ${it.returnCondition})`,
        projectId: a.projectId,
        kitId,
        createdAt: a.now,
      });
    }

    return { succeeded: res.succeeded, errors: res.errors };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// clearPrepContainer — strip prepContainer off a container's lines. Parity:
// clearPrepContainer (no audit). warehouse:check_out.
// ─────────────────────────────────────────────────────────────────────────────
export const clearPrepContainer = mutation({
  args: { orgId: v.string(), projectId: v.string(), containerName: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);

    return clearPrepContainerCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, containerName: a.containerName, now: a.now,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureContainerOnProject — idempotent check-then-create of a container line item
// (idempotency via the existing (asset, project, isContainerLineItem) check — the
// line id is minted server-side inside the core). Parity: ensureContainerOnProject
// (no audit). warehouse:check_out. Returns { id, created } (drops the model re-read).
// ─────────────────────────────────────────────────────────────────────────────
export const ensureContainerOnProject = mutation({
  args: { orgId: v.string(), projectId: v.string(), assetId: v.string(), modelId: v.string(), containerName: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await assertAssetInOrg(ctx, a.assetId, a.orgId);
    await assertModelInOrg(ctx, a.modelId, a.orgId);

    return ensureContainerOnProjectCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, assetId: a.assetId, modelId: a.modelId, containerName: a.containerName, now: a.now,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// syncContainersBatch — roll up N containers in one call. Parity: syncContainersBatch
// (dedupe [...new Set()], empty → {results:[]}, no audit). warehouse:check_out.
// ─────────────────────────────────────────────────────────────────────────────
export const syncContainersBatch = mutation({
  args: { orgId: v.string(), projectId: v.string(), containerNames: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    const unique = [...new Set(a.containerNames)];
    if (unique.length === 0) return { results: [] as Array<{ containerName: string; updated: boolean; status?: string }> };

    await requireProjectInOrg(ctx, a.projectId, a.orgId);

    return syncContainersBatchCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, containerNames: unique, userId: actor.userId, now: a.now,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PR-B — reassign + force-return writes. Same bar: kill-switch + rate limit + RBAC +
// boundary FK/org validation + the SAME warehouseOps `*Core` + in-mutation audit.
// reassign* = warehouse:check_out; forceReturn* = warehouse:check_in (per the server
// actions). Force-return audit `entityName` is gathered IN-mutation from ctx.db (tags
// / kit names) — never a client arg. Batches DEDUPE + preserve partial-success (a
// missing / foreign id lands in `errors`; only an empty selection throws up front).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── reassignLineItemUnit — move a serialised unit to a different line (same project
// + model). Parity: reassignLineItemUnit server action. warehouse:check_out. ────────
export const reassignLineItemUnit = mutation({
  args: { orgId: v.string(), projectId: v.string(), unitId: v.string(), targetLineItemId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    // Boundary FK/org validation before the (already-thorough) core: the target line
    // must be in this org + project, and the unit must be in this org (by_cuid is GLOBAL).
    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await requireLineInProject(ctx, a.targetLineItemId, a.orgId, a.projectId);
    await assertUnitInOrg(ctx, a.unitId, a.orgId);

    const res = await reassignSerialisedUnitCore(ctx, a.orgId, a.unitId, a.targetLineItemId, a.now);

    if (res.moved) {
      // `assetTag` is gathered by the core from the asset doc — not a client arg.
      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "asset",
        entityId: res.assetTag ?? a.unitId,
        entityName: res.assetTag ? `Asset ${res.assetTag}` : `Unit ${a.unitId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Reassigned ${res.assetTag ?? "unit"} to a different line`,
        projectId: a.projectId,
        createdAt: a.now,
      });
    }

    return res; // { moved } | { moved, assetTag, fromLineItemId, toLineItemId }
  },
});

// ─── reassignKitMemberSerial — swap which serial fills a kit member's slot (Phase 4).
// Parity: reassignKitMemberSerial server action. warehouse:check_out. ───────────────
export const reassignKitMemberSerial = mutation({
  args: { orgId: v.string(), projectId: v.string(), unitId: v.string(), newAssetId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await assertUnitInOrg(ctx, a.unitId, a.orgId);
    await assertAssetInOrg(ctx, a.newAssetId, a.orgId);

    const res = await reassignKitMemberSerialCore(ctx, a.orgId, a.unitId, a.newAssetId, a.now);

    if (res.moved) {
      // `fromAssetTag` / `toAssetTag` are gathered by the core from the asset docs.
      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "asset",
        entityId: res.toAssetTag ?? a.newAssetId,
        entityName: res.toAssetTag ? `Asset ${res.toAssetTag}` : `Asset ${a.newAssetId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Swapped kit member ${res.fromAssetTag ?? "serial"} → ${res.toAssetTag ?? a.newAssetId}`,
        projectId: a.projectId,
        createdAt: a.now,
      });
    }

    return res; // { moved } | { moved, fromAssetTag, toAssetTag, lineItemId }
  },
});

// ─── forceReturnAsset — return every CHECKED_OUT line for an asset + reset it to
// AVAILABLE. Parity: forceReturnAsset server action. warehouse:check_in. ────────────
export const forceReturnAsset = mutation({
  args: { orgId: v.string(), assetId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    // Load the asset in-org (gathers its TAG for the audit) + guard, mirroring the server.
    const asset = await loadAssetInOrg(ctx, a.assetId, a.orgId);
    if (asset.status === "AVAILABLE") throw new ConvexError("Asset is already available");

    const loc = await defaultLocationId(ctx, a.orgId);
    await forceReturnAssetCore(ctx, a.orgId, a.assetId, actor.userId, a.now, loc);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "FORCE_RETURN",
      entityType: "asset",
      entityId: a.assetId,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Force returned asset ${asset.assetTag} to available`,
      createdAt: a.now,
    });

    return { success: true as const };
  },
});

// ─── forceReturnKit — restore a whole kit + contents to AVAILABLE. Parity:
// forceReturnKit server action. warehouse:check_in. ────────────────────────────────
export const forceReturnKit = mutation({
  args: { orgId: v.string(), kitId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    // Load the kit in-org (gathers its NAME for the audit) + guard, mirroring the server.
    const kit = await loadKitInOrg(ctx, a.kitId, a.orgId);
    if (kit.status === "AVAILABLE") throw new ConvexError("Kit is already available");

    const loc = await defaultLocationId(ctx, a.orgId);
    const affectedKitIds = await forceReturnKitCore(ctx, a.orgId, kit, actor.userId, a.now, loc);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "FORCE_RETURN",
      entityType: "kit",
      entityId: a.kitId,
      entityName: `${kit.assetTag} - ${kit.name}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Force returned kit ${kit.assetTag} and all contents to available`,
      kitId: a.kitId,
      createdAt: a.now,
    });

    return { success: true as const, affectedKitIds };
  },
});

// ─── forceReturnKits — bulk force-return of kits (partial-success). Parity:
// forceReturnKits server action (empty → throw; dedupe; { count, succeeded, errors }).
// warehouse:check_in. ──────────────────────────────────────────────────────────────
export const forceReturnKits = mutation({
  args: { orgId: v.string(), kitIds: v.array(v.string()), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);
    if (a.kitIds.length === 0) throw new ConvexError("No kits selected");

    // Dedupe (the core restores a kit's contents per occurrence). Cross-tenant / ghost
    // safety is the core's per-item org re-check (→ per-item error, never a cross-org write).
    const unique = [...new Set(a.kitIds)];
    const loc = await defaultLocationId(ctx, a.orgId);

    // Gather kit NAMES for the audit IN-mutation (org-checked; a missing / foreign id
    // simply has no name) BEFORE the batch — names are unchanged by the force-return.
    const nameById = new Map<string, string>();
    for (const kitId of unique) {
      const k = await getKitByCuid(ctx, kitId);
      if (k && k.organizationId === a.orgId) nameById.set(k.id, `${k.assetTag} - ${k.name}`);
    }

    const res = await forceReturnKitsBatchCore(ctx, a.orgId, unique, actor.userId, a.now, loc);

    if (res.succeeded.length > 0) {
      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "FORCE_RETURN",
        entityType: "kit",
        entityId: res.succeeded[0],
        entityName: res.succeeded.map((id) => nameById.get(id) ?? id).join(", "),
        userId: actor.userId,
        userName: actor.userName,
        summary: `Bulk force returned ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"} and contents to available`,
        createdAt: a.now,
      });
    }

    return { count: res.succeeded.length, succeeded: res.succeeded, errors: res.errors };
  },
});

// ─── bulkForceReturnAssets — bulk force-return of serialised assets (partial-success).
// Parity: bulkForceReturnAssets server action (empty → throw; only CHECKED_OUT succeed).
// warehouse:check_in. ──────────────────────────────────────────────────────────────
export const bulkForceReturnAssets = mutation({
  args: { orgId: v.string(), assetIds: v.array(v.string()), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);
    if (a.assetIds.length === 0) throw new ConvexError("No assets selected");

    // Dedupe. Only CHECKED_OUT in-org assets succeed (the core skips the rest) — no
    // up-front throw on a foreign / non-checked-out id (partial-success).
    const unique = [...new Set(a.assetIds)];
    const loc = await defaultLocationId(ctx, a.orgId);

    // Gather asset TAGS for the audit IN-mutation (org-checked) BEFORE the batch.
    const tagById = new Map<string, string>();
    for (const assetId of unique) {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).first();
      if (asset && asset.organizationId === a.orgId) tagById.set(asset.id, asset.assetTag);
    }

    const res = await bulkForceReturnAssetsCore(ctx, a.orgId, unique, actor.userId, a.now, loc);

    if (res.succeeded.length > 0) {
      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "FORCE_RETURN",
        entityType: "asset",
        entityId: res.succeeded[0],
        entityName: res.succeeded.map((id) => tagById.get(id) ?? id).join(", "),
        userId: actor.userId,
        userName: actor.userName,
        summary: `Bulk force returned ${res.succeeded.length} assets to available`,
        createdAt: a.now,
      });
    }

    return { count: res.succeeded.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PR-C — the CHECKOUT keystone. Same bar (kill-switch + rate limit + RBAC
// warehouse:check_out + boundary FK/org validation + the SAME warehouseOps `*Core`
// + in-mutation audit), PLUS two carve-outs the server actions ran around the write:
//   1. the blocking-comment SEND-OUT gate (all 4) — now IN the same transaction via
//      `assertNoBlockingCommentsInMutation` (throws ConvexError with the user message);
//   2. the `warehouse.checked_out` webhook ENQUEUE (checkOutItems only) — now IN the
//      mutation via `enqueueWebhookEvent`; delivery stays a cron concern (best-effort,
//      swallowed, never rolls back the gear movement).
// quickAdd adds FK HARDENING: the requireService core inserted client model/asset/bulk
// ids with NO org check (it trusted the server), so the browser write org-validates
// each BEFORE the core. Audit parity matches the server EXACTLY: checkOutItems =
// per-item CHECK_OUT rows; checkOutKit = one; checkOutKitsBatch = one per succeeded
// kit; quickAdd = NO logActivity (scanLog only, written by the core).
// ═══════════════════════════════════════════════════════════════════════════════

const checkoutItemArg = v.object({
  lineItemId: v.string(),
  assetId: v.optional(v.string()),
  quantity: v.optional(v.number()),
  notes: v.optional(v.string()),
  // Narrows this item's accessory cascade to a verified subset (mirrors
  // warehouseOps.ts's checkoutItemArg — issue #794).
  includeAccessoryIds: v.optional(v.array(v.string())),
});

// ─── checkOutItems — the loose-gear / line deploy. Parity: checkOutItems server
// action. warehouse:check_out. Blocking gate + webhook enqueue + per-item audit. ───
export const checkOutItems = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    items: v.array(checkoutItemArg),
    includeAccessories: v.boolean(),
    auditIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    // Carve-out 1: block send-out while any blocking comment on the project is open.
    // Project-wide gate (no line/group scope) — matches the server call exactly.
    await assertNoBlockingCommentsInMutation(ctx, a.orgId, a.projectId, { actionLabel: "check out items" });

    // Boundary FK/org validation (by_cuid is GLOBAL). The optional client assetId is
    // validated too — the core's serialised path can setAssetStatus on it.
    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    for (const it of a.items) {
      await requireLineInProject(ctx, it.lineItemId, a.orgId, a.projectId);
      if (it.assetId) await assertAssetInOrg(ctx, it.assetId, a.orgId);
    }

    const res = await checkoutItemsCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId,
      items: a.items, includeAccessories: a.includeAccessories, now: a.now,
    });

    for (let i = 0; i < a.items.length; i++) {
      const item = a.items[i];
      const auditId = a.auditIds[i];
      if (!auditId) continue;
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: a.orgId,
        action: "CHECK_OUT",
        entityType: "asset",
        entityId: item.assetId || item.lineItemId,
        entityName: `Line item ${item.lineItemId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: "Checked out item on project",
        projectId: a.projectId,
        ...(item.assetId ? { assetId: item.assetId } : {}),
        createdAt: a.now,
      });
    }

    // Carve-out 2: fire the webhook AFTER the gear physically moved. ENQUEUE only —
    // delivery is the cron worker's job. Best-effort: a webhook failure must never
    // roll back the checkout, so it's swallowed (mirrors emitWebhookEvent).
    try {
      await enqueueWebhookEvent(ctx, a.orgId, "warehouse.checked_out", {
        projectId: a.projectId,
        lineItemIds: res.updatedLineIds,
        assetIds: a.items.map((i) => i.assetId).filter((x): x is string => Boolean(x)),
        count: res.updatedLineIds.length,
      }, a.now);
    } catch {
      // Never let an event break the write that produced it.
    }

    return res; // { updatedLineIds }
  },
});

/** Bound the checkout-override reason (issue #794 follow-up) — mirrors
 *  lineItemWrites.ts's assertAccessoryPlanFields reason bound. */
function assertCheckoutOverrideFields(skipped: { accessoryLineItemId: string; tier: "DEFAULT" | "OPTIONAL"; reason: string }[]): void {
  assertArrayMax(skipped, "skipped", 50);
  for (const s of skipped) assertStrLen(s.reason, "skipped.reason", { min: 1, max: 500 });
}

// ─── logAccessoryCheckoutOverride — the warehouse Deploy gate's paper trail
// (issue #794 follow-up). Deploying a line missing its DEFAULT accessories is a
// soft block: the operator can proceed but must record why (a typed reason, or a
// manager-tier role — the UI pre-fills the reason for managers so this mutation
// always receives a non-empty string either way). Missing OPTIONALs work the same
// with preset reasons. Logged to BOTH the activity log (audit trail) AND the
// specific accessory child line's own `notes` field, per the design decision. ───
export const logAccessoryCheckoutOverride = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    parentName: v.string(),
    skipped: v.array(v.object({
      accessoryLineItemId: v.string(),
      tier: v.union(v.literal("DEFAULT"), v.literal("OPTIONAL")),
      reason: v.string(),
    })),
    actor: actorValidator,
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);
    await assertProjectInOrg(ctx, a.projectId, a.orgId);
    assertCheckoutOverrideFields(a.skipped);

    for (const s of a.skipped) {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", s.accessoryLineItemId)).first();
      if (!line || line.organizationId !== a.orgId) continue;
      const mergedNotes = line.notes ? `${line.notes}; Deployed without this accessory: ${s.reason}` : `Deployed without this accessory: ${s.reason}`;
      await ctx.db.patch(line._id, { notes: mergedNotes, updatedAt: a.now });
      await writeActivityLog(ctx, {
        id: createId(),
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "lineItem",
        entityId: line.id,
        entityName: line.description ?? a.parentName,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Deployed ${a.parentName} without ${s.tier === "DEFAULT" ? "default" : "optional"} accessory ${line.description ?? "item"}: ${s.reason}`,
        projectId: a.projectId,
        createdAt: a.now,
      });
    }
    return { logged: a.skipped.length };
  },
});

// ─── checkOutKit — whole-kit deploy (singular). Parity: checkOutKit server action.
// warehouse:check_out. Blocking gate + single audit. ────────────────────────────────
export const checkOutKit = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    await assertNoBlockingCommentsInMutation(ctx, a.orgId, a.projectId, { actionLabel: "check out this kit" });

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await requireKitInOrg(ctx, a.kitId, a.orgId);

    const res = await checkoutKitFull(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitId: a.kitId, now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CHECK_OUT",
      entityType: "kit",
      entityId: a.kitId,
      entityName: `Kit ${a.kitId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Checked out kit with all contents",
      projectId: a.projectId,
      kitId: a.kitId,
      createdAt: a.now,
    });

    return res; // { kitId, affectedKitIds }
  },
});

// ─── checkOutKitsBatch — bulk whole-kit deploy. Parity: checkOutKitsBatch server
// action (dedupe [...new Set()], empty → {succeeded:[],errors:[]}, blocking gate once,
// one audit per succeeded kit, partial-success). warehouse:check_out. ────────────────
export const checkOutKitsBatch = mutation({
  args: { orgId: v.string(), projectId: v.string(), kitIds: v.array(v.string()), auditIds: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    const unique = [...new Set(a.kitIds)];
    if (unique.length === 0) return { succeeded: [] as string[], errors: [] as { kitId: string; message: string }[] };

    // Project-wide blocker gate (kit checkout has no line scope) — checked once.
    await assertNoBlockingCommentsInMutation(ctx, a.orgId, a.projectId, { actionLabel: "check out this kit" });

    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    // Cross-tenant / ghost safety is the core's per-kit kitParentLine (a foreign / ghost
    // kit has no parent line on this org's project → per-item error, never a cross-org
    // write) — matching undeployKitsBatch. No up-front throw on a ghost id.

    const res = await checkoutKitsBatchCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId, kitIds: unique, now: a.now,
    });

    for (let i = 0; i < res.succeeded.length; i++) {
      const kitId = res.succeeded[i];
      const auditId = a.auditIds[i];
      if (!auditId) continue;
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: a.orgId,
        action: "CHECK_OUT",
        entityType: "kit",
        entityId: kitId,
        entityName: `Kit ${kitId}`,
        userId: actor.userId,
        userName: actor.userName,
        summary: "Checked out kit with all contents",
        projectId: a.projectId,
        kitId,
        createdAt: a.now,
      });
    }

    return { succeeded: res.succeeded, errors: res.errors };
  },
});

// ─── quickAddAndCheckOut — add a scanned model/asset to the project + prep it in one
// step. Parity: quickAddAndCheckOut server action (blocking gate; NO logActivity —
// scanLog only, written by the core). warehouse:check_out. ★ FK HARDENING: the core
// inserts client model/asset/bulk ids verbatim (it trusted the server), so this write
// org-validates EACH (by_cuid is GLOBAL) BEFORE the core. Returns { id } only. ────────
export const quickAddAndCheckOut = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    modelId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    prepContainer: v.optional(v.union(v.string(), v.null())),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    await assertNoBlockingCommentsInMutation(ctx, a.orgId, a.projectId, { actionLabel: "check out items" });

    // ★ FK hardening — every client id org-validated before the trusting core runs.
    await requireProjectInOrg(ctx, a.projectId, a.orgId);
    await assertModelInOrg(ctx, a.modelId, a.orgId);
    if (a.assetId) await assertAssetInOrg(ctx, a.assetId, a.orgId);
    if (a.bulkAssetId) await assertBulkAssetInOrg(ctx, a.bulkAssetId, a.orgId);

    return quickAddCore(ctx, {
      organizationId: a.orgId,
      projectId: a.projectId,
      modelId: a.modelId,
      assetId: a.assetId ?? undefined,
      bulkAssetId: a.bulkAssetId ?? undefined,
      quantity: a.quantity ?? undefined,
      prepContainer: a.prepContainer ?? undefined,
      userId: actor.userId,
      now: a.now,
    }); // { id }
  },
});
