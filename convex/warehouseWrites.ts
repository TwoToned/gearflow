import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import {
  checkinItemsCore,
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
} from "./warehouseOps";

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
 * Security baseline (docs/designs/convex-phase5-auth-bridge.md + the Phase 3 browser
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
  const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).first();
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
