import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNoBlockingCommentsInMutation } from "./lib/blockingCommentsGate";
import { runPredictiveMaintenance, type PmPlanEntry } from "./lib/checkPredictiveMaintenanceCore";
import { completeCheckAndDeprepLineCore, prepItemCore } from "./checkRecordOps";
import { checkinItemsCore } from "./warehouseOps";
import * as enums from "./lib/validators";

/**
 * Browser-direct CHECK-RECORD writes (Phase 3 — the densest warehouse-check state
 * machine). Replaces the 7 composite writes in src/server/check-records.ts
 * (completeCheckAndDeprep / completeCheckAndPack / completeCheckAndFlag /
 * completeCheckAndStore / saveAdHocCheck / saveKitLevelChecks / saveChildItemChecks).
 *
 * Each mutation folds what was 3 separate round-trips — (1) the check-record insert,
 * (2) the line/unit state transition, (3) the predictive-maintenance create — into
 * ONE atomic Convex mutation. Because ctx.db sees the mutation's own writes, the
 * predictive-maintenance read counts the FAIL record written earlier THIS call (the
 * same inclusion the old post-commit sequence had), and a check that flags +
 * auto-creates maintenance can no longer half-commit.
 *
 * Security bar (exact order): assertWritesEnabled(warehouse) → enforceBrowserWriteLimit
 * → requireOrgPermission(warehouse, <action>) → resolveActor. Then a per-row org
 * re-check on EVERY doc fetched by the GLOBAL by_cuid index (line / asset / bulk / kit /
 * records / maintenance). ConvexError only. writeActivityLog is in-transaction (the
 * verb + entityType match the deleted server action). RBAC per write:
 *   deprep / pack / flag → warehouse:check_out
 *   store               → warehouse:check_in
 *   adHoc               → warehouse:scan
 *   kitLevel / childItem → warehouse:check_out (PREP) | warehouse:check_in (RETURN)
 *
 * PARTIAL-KEEP: the requireService `checkRecordOps` / `checkRecords` / `warehouseOps`
 * mutations stay — int-tests + the ~13 OTHER check-records exports drive them. This
 * file only EXTRACTS `*Core` fns from them (prepItemCore / completeCheckAndDeprepLineCore
 * live in checkRecordOps; checkinItemsCore in warehouseOps).
 *
 * Client mints all ids (each check's recordId, each failed-item's maintenance triple,
 * auditId) + passes `now` (a single stamp) as epoch-ms.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const returnCond = v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING"));
const flagType = v.union(v.literal("FLAGGED_FAULTY"), v.literal("FLAGGED_TT_OVERDUE"));
const checkContextPrepReturn = v.union(v.literal("PREP"), v.literal("RETURN"));

/** One submitted check + its client-minted record id. */
const checkArg = v.object({
  recordId: v.string(),
  checkItemId: v.string(),
  result: enums.CheckResult,
  value: v.optional(v.string()),
  notes: v.optional(v.string()),
  photos: v.optional(v.array(v.string())),
});
type CheckArg = {
  recordId: string;
  checkItemId: string;
  result: "PASS" | "FAIL" | "NOTES_ONLY";
  value?: string;
  notes?: string;
  photos?: string[];
};

/** One client-minted maintenance-id bundle per DISTINCT failed check item id. */
const pmEntryArg = v.object({
  checkItemId: v.string(),
  maintenanceId: v.string(),
  maintenanceLinkId: v.string(),
  auditId: v.string(),
});

// ─── boundary FK/org validators (by_cuid is GLOBAL — must org-re-check) ──────────

/** Fetch a line, org- + project-scoped. Returns the doc (groupId / assetId / bulkAssetId). */
async function requireLineInProject(
  ctx: MutationCtx,
  lineItemId: string,
  orgId: string,
  projectId: string,
): Promise<Doc<"projectLineItems">> {
  const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).unique();
  if (!l || l.organizationId !== orgId || l.projectId !== projectId) {
    throw new ConvexError("Line item not found in project");
  }
  return l;
}

/** Fetch a line, org-scoped only (parity: saveChildItemChecks validates org, not project). */
async function requireLineInOrg(ctx: MutationCtx, lineItemId: string, orgId: string): Promise<Doc<"projectLineItems">> {
  const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).unique();
  if (!l || l.organizationId !== orgId) throw new ConvexError("Line item not found");
  return l;
}

async function assertAssetInOrg(ctx: MutationCtx, assetId: string, orgId: string): Promise<void> {
  const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
  if (!a || a.organizationId !== orgId) throw new ConvexError("Asset not found");
}

async function assertBulkAssetInOrg(ctx: MutationCtx, bulkAssetId: string, orgId: string): Promise<void> {
  const b = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bulkAssetId)).unique();
  if (!b || b.organizationId !== orgId) throw new ConvexError("Bulk asset not found");
}

async function assertKitInOrg(ctx: MutationCtx, kitId: string, orgId: string): Promise<void> {
  const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).unique();
  if (!k || k.organizationId !== orgId) throw new ConvexError("Kit not found");
}

/**
 * Insert the submitted check records at their client-minted ids (idempotent per
 * cuid). Port of `saveCheckRecords` + `checkRecords.createManyIfMissing`:
 *   • label/type snapshots come from the org's check items (Convex — CheckItem is
 *     Convex-only since Phase B). A submitted check whose item isn't in the org
 *     rejects (matches the server's "Check item … not found").
 *   • dup-guard on by_cuid (GLOBAL): a record id owned by ANOTHER org is rejected
 *     (the recurring cross-tenant class); a same-org id is an idempotent retry → skip.
 */
async function insertCheckRecords(
  ctx: MutationCtx,
  a: {
    orgId: string;
    context: "PREP" | "RETURN" | "AD_HOC";
    lineItemId?: string;
    assetId?: string;
    bulkAssetId?: string;
    kitId?: string;
    checks: CheckArg[];
    performedById: string;
    now: number;
  },
): Promise<void> {
  if (a.checks.length === 0) return;
  const wanted = new Set(a.checks.map((c) => c.checkItemId));
  const orgCheckItems = await ctx.db
    .query("checkItems")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)) // r9.8-ok: bounded per-org config/catalog set
    .collect();
  const itemMap = new Map(
    orgCheckItems.filter((ci) => wanted.has(ci.id)).map((ci) => [ci.id, { label: ci.label, type: ci.type ?? "PASS_FAIL" }]),
  );

  for (const check of a.checks) {
    const dup = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", check.recordId)).unique();
    if (dup) {
      if (dup.organizationId !== a.orgId) throw new ConvexError("Check record id collision");
      continue; // same-org idempotent retry
    }
    const ci = itemMap.get(check.checkItemId);
    if (!ci) throw new ConvexError(`Check item ${check.checkItemId} not found`);
    await ctx.db.insert("checkRecords", {
      id: check.recordId,
      organizationId: a.orgId,
      context: a.context,
      ...(a.lineItemId ? { lineItemId: a.lineItemId } : {}),
      ...(a.assetId ? { assetId: a.assetId } : {}),
      ...(a.bulkAssetId ? { bulkAssetId: a.bulkAssetId } : {}),
      ...(a.kitId ? { kitId: a.kitId } : {}),
      checkItemId: check.checkItemId,
      checkItemLabelSnapshot: ci.label,
      checkItemTypeSnapshot: ci.type,
      result: check.result,
      ...(check.value ? { value: check.value } : {}),
      ...(check.notes ? { notes: check.notes } : {}),
      ...(check.photos && check.photos.length ? { photos: check.photos } : {}),
      performedById: a.performedById,
      performedAt: a.now,
    });
  }
}

// ─── completeCheckAndDeprep (parity: completeCheckAndDeprep) ─── warehouse:check_out
export const completeCheckAndDeprep = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    checks: v.array(checkArg),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    const line = await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);

    const resolvedAssetId = a.assetId || line.assetId || "";
    const resolvedBulkAssetId = a.bulkAssetId || line.bulkAssetId || undefined;
    // Validate the RESOLVED ids (client id OR the line fallback) — the reused cores
    // scope/patch by the resolved asset with no org check of their own.
    if (resolvedAssetId) await assertAssetInOrg(ctx, resolvedAssetId, a.orgId);
    if (resolvedBulkAssetId) await assertBulkAssetInOrg(ctx, resolvedBulkAssetId, a.orgId);

    // 1. RETURN-context check records.
    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: "RETURN", lineItemId: a.lineItemId,
      assetId: resolvedAssetId || undefined, bulkAssetId: resolvedBulkAssetId,
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    // 2. Reset line prepStatus PENDING + scoped ACCESSORY child cascade (re-validates
    //    RETURNED status + PACKED/PENDING prepStatus). NO predictive maintenance.
    await completeCheckAndDeprepLineCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, lineItemId: a.lineItemId,
      ...(resolvedAssetId ? { resolvedAssetId } : {}), now: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "asset",
      entityId: a.lineItemId, entityName: "Line item", userId: actor.userId, userName: actor.userName,
      summary: "Deprep return check complete — item returned to inventory",
      projectId: a.projectId, ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}), createdAt: a.now,
    });

    return { success: true as const };
  },
});

// ─── completeCheckAndPack (parity: completeCheckAndPack) ─── warehouse:check_out
export const completeCheckAndPack = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    prepContainer: v.optional(v.union(v.string(), v.null())),
    includeAccessoryIds: v.optional(v.array(v.string())),
    checks: v.array(checkArg),
    maintenancePlan: v.array(pmEntryArg),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    const line = await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);

    // Blocking-comment gate BEFORE the transition (parity: assertNoBlockingComments
    // scoped to this line + its group).
    await assertNoBlockingCommentsInMutation(ctx, a.orgId, a.projectId, {
      lineItemId: a.lineItemId, groupId: line.groupId, actionLabel: "complete the check & pack",
    });

    const resolvedAssetId = a.assetId || line.assetId || "";
    const resolvedBulkAssetId = a.bulkAssetId || line.bulkAssetId || undefined;
    // Validate the RESOLVED ids (client id OR the line fallback) — the reused cores
    // scope/patch by the resolved asset with no org check of their own.
    if (resolvedAssetId) await assertAssetInOrg(ctx, resolvedAssetId, a.orgId);
    if (resolvedBulkAssetId) await assertBulkAssetInOrg(ctx, resolvedBulkAssetId, a.orgId);

    // 1. PREP-context check records.
    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: "PREP", lineItemId: a.lineItemId,
      assetId: resolvedAssetId || undefined, bulkAssetId: resolvedBulkAssetId,
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    // 2. Prep — create/mark the unit (matches the server's prepItem call: assetId only,
    //    bulk derived from the line when no serialised asset).
    await prepItemCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, lineItemId: a.lineItemId,
      ...(a.assetId ? { assetId: a.assetId } : {}),
      prepContainer: a.prepContainer ?? undefined,
      ...(a.includeAccessoryIds ? { includeAccessoryIds: a.includeAccessoryIds } : {}),
    });

    // 3. Predictive maintenance on FAIL (atomic — no swallow).
    await runFailPredictiveMaintenance(ctx, a.orgId, actor, resolvedAssetId, a.checks, a.maintenancePlan, a.now);

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "asset",
      entityId: resolvedAssetId || a.lineItemId, entityName: `Line item ${a.lineItemId}`,
      userId: actor.userId, userName: actor.userName, summary: "Completed checks and prepped item",
      projectId: a.projectId, ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}), createdAt: a.now,
    });

    return { success: true as const };
  },
});

// ─── completeCheckAndFlag (parity: completeCheckAndFlag) ─── warehouse:check_out
export const completeCheckAndFlag = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    flagType,
    checks: v.array(checkArg),
    maintenancePlan: v.array(pmEntryArg),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_out");
    const actor = await resolveActor(ctx, a.actor);

    const line = await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);

    const resolvedAssetId = a.assetId || line.assetId || "";
    const resolvedBulkAssetId = a.bulkAssetId || line.bulkAssetId || undefined;
    // Validate the RESOLVED ids (client id OR the line fallback) — the reused cores
    // scope/patch by the resolved asset with no org check of their own.
    if (resolvedAssetId) await assertAssetInOrg(ctx, resolvedAssetId, a.orgId);
    if (resolvedBulkAssetId) await assertBulkAssetInOrg(ctx, resolvedBulkAssetId, a.orgId);

    // 1. PREP-context check records.
    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: "PREP", lineItemId: a.lineItemId,
      assetId: resolvedAssetId || undefined, bulkAssetId: resolvedBulkAssetId,
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    // 2. Flag the line (inline patch — the line was org-checked above).
    await ctx.db.patch(line._id, { prepStatus: a.flagType, updatedAt: a.now });

    // 3. Predictive maintenance on FAIL.
    await runFailPredictiveMaintenance(ctx, a.orgId, actor, resolvedAssetId, a.checks, a.maintenancePlan, a.now);

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "asset",
      entityId: resolvedAssetId || a.lineItemId, entityName: `Line item ${a.lineItemId}`,
      userId: actor.userId, userName: actor.userName,
      summary: `Flagged item as ${a.flagType === "FLAGGED_FAULTY" ? "faulty" : "T&T overdue"}`,
      projectId: a.projectId, ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}), createdAt: a.now,
    });

    return { success: true as const };
  },
});

// ─── completeCheckAndStore (parity: completeCheckAndStore) ─── warehouse:check_in
export const completeCheckAndStore = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    condition: returnCond,
    notes: v.optional(v.string()),
    checks: v.array(checkArg),
    maintenancePlan: v.array(pmEntryArg),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    const actor = await resolveActor(ctx, a.actor);

    const line = await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);

    const resolvedAssetId = a.assetId || line.assetId || "";
    const resolvedBulkAssetId = a.bulkAssetId || line.bulkAssetId || undefined;
    // checkinItemsCore → returnLineUnits → setAssetStatus patches the RESOLVED asset
    // (falling back to line.assetId) with no org check of its own. Validate the resolved
    // ids here so a line carrying a foreign asset/bulk ref can't flip another org's status.
    if (resolvedAssetId) await assertAssetInOrg(ctx, resolvedAssetId, a.orgId);
    if (resolvedBulkAssetId) await assertBulkAssetInOrg(ctx, resolvedBulkAssetId, a.orgId);

    // 1. RETURN-context check records.
    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: "RETURN", lineItemId: a.lineItemId,
      assetId: resolvedAssetId || undefined, bulkAssetId: resolvedBulkAssetId,
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    // 2. Return via the canonical check-in core (returnLineUnits + rollup + accessory
    //    cascade + scan log + asset status). Matches the server: assetId only, quantity 1.
    await checkinItemsCore(ctx, {
      organizationId: a.orgId, projectId: a.projectId, userId: actor.userId,
      items: [{
        lineItemId: a.lineItemId,
        ...(a.assetId ? { assetId: a.assetId } : {}),
        returnCondition: a.condition, quantity: 1,
        ...(a.notes ? { notes: a.notes } : {}),
      }],
      now: a.now,
    });

    // 3. Predictive maintenance on FAIL.
    await runFailPredictiveMaintenance(ctx, a.orgId, actor, resolvedAssetId, a.checks, a.maintenancePlan, a.now);

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "CHECK_IN", entityType: "asset",
      entityId: resolvedAssetId || a.lineItemId, entityName: `Line item ${a.lineItemId}`,
      userId: actor.userId, userName: actor.userName,
      summary: `Completed check and stored item (condition: ${a.condition})`,
      projectId: a.projectId, ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}), createdAt: a.now,
    });

    return { success: true as const };
  },
});

// ─── saveAdHocCheck (parity: saveAdHocCheck) ─── warehouse:scan
export const saveAdHocCheck = mutation({
  args: {
    orgId: v.string(),
    assetId: v.string(),
    bulkAssetId: v.optional(v.string()),
    checks: v.array(checkArg),
    maintenancePlan: v.array(pmEntryArg),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", "scan");
    const actor = await resolveActor(ctx, a.actor);

    await assertAssetInOrg(ctx, a.assetId, a.orgId);
    if (a.bulkAssetId) await assertBulkAssetInOrg(ctx, a.bulkAssetId, a.orgId);

    // 1. AD_HOC check records (no line item, no state transition).
    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: "AD_HOC", assetId: a.assetId,
      ...(a.bulkAssetId ? { bulkAssetId: a.bulkAssetId } : {}),
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    // 2. Predictive maintenance on FAIL.
    await runFailPredictiveMaintenance(ctx, a.orgId, actor, a.assetId, a.checks, a.maintenancePlan, a.now);

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "CREATE", entityType: "checkRecord",
      entityId: a.checks[0]?.recordId || a.assetId, entityName: "Ad-hoc check on asset",
      userId: actor.userId, userName: actor.userName,
      summary: `Performed ad-hoc check (${a.checks.length} items)`,
      assetId: a.assetId, createdAt: a.now,
    });

    return { success: true as const };
  },
});

// ─── saveKitLevelChecks (parity: saveKitLevelChecks) ─── check_out (PREP) | check_in (RETURN)
// No state transition (deploy/return handled elsewhere), NO predictive maintenance, NO audit.
export const saveKitLevelChecks = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    kitId: v.string(),
    lineItemId: v.string(),
    context: checkContextPrepReturn,
    checks: v.array(checkArg),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", a.context === "PREP" ? "check_out" : "check_in");
    const actor = await resolveActor(ctx, a.actor);

    // The check record carries kitId + lineItemId — org-check both (cross-tenant guard).
    await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);
    await assertKitInOrg(ctx, a.kitId, a.orgId);

    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: a.context, lineItemId: a.lineItemId, kitId: a.kitId,
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    return { success: true as const };
  },
});

// ─── saveChildItemChecks (parity: saveChildItemChecks) ─── check_out (PREP) | check_in (RETURN)
// No state transition (checkout/checkin handled elsewhere), NO audit. Predictive
// maintenance runs on FAIL (parity).
export const saveChildItemChecks = mutation({
  args: {
    orgId: v.string(),
    projectId: v.string(),
    lineItemId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    context: checkContextPrepReturn,
    checks: v.array(checkArg),
    maintenancePlan: v.array(pmEntryArg),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "warehouse", a.context === "PREP" ? "check_out" : "check_in");
    const actor = await resolveActor(ctx, a.actor);

    // Parity: the server validates ORG only for the child line (kit children carry the
    // same projectId, so this is safe; matching the server avoids a false rejection).
    const line = await requireLineInOrg(ctx, a.lineItemId, a.orgId);
    if (a.assetId) await assertAssetInOrg(ctx, a.assetId, a.orgId);
    if (a.bulkAssetId) await assertBulkAssetInOrg(ctx, a.bulkAssetId, a.orgId);

    const resolvedAssetId = a.assetId || line.assetId || "";
    const resolvedBulkAssetId = a.bulkAssetId || line.bulkAssetId || undefined;

    await insertCheckRecords(ctx, {
      orgId: a.orgId, context: a.context, lineItemId: a.lineItemId,
      assetId: resolvedAssetId || undefined, bulkAssetId: resolvedBulkAssetId,
      checks: a.checks, performedById: actor.userId, now: a.now,
    });

    // Predictive maintenance on FAIL (only when a specific asset resolved).
    if (resolvedAssetId) {
      await runFailPredictiveMaintenance(ctx, a.orgId, actor, resolvedAssetId, a.checks, a.maintenancePlan, a.now);
    }

    return { success: true as const };
  },
});

/**
 * Shared predictive-maintenance trigger: filter the submitted checks to FAILs, pair
 * each distinct failed check item id with its client-minted maintenance triple, and
 * run the core. A no-op when there are no fails or no resolved asset.
 */
async function runFailPredictiveMaintenance(
  ctx: MutationCtx,
  orgId: string,
  actor: { userId: string; userName: string },
  assetId: string,
  checks: CheckArg[],
  plan: PmPlanEntry[],
  now: number,
): Promise<void> {
  if (!assetId) return;
  const failed = new Set(checks.filter((c) => c.result === "FAIL").map((c) => c.checkItemId));
  if (failed.size === 0) return;
  // EVERY distinct failed check item MUST carry a client-minted maintenance plan entry.
  // Deriving `failed` server-side (from the submitted checks) and requiring a matching
  // entry stops a caller from silently disabling mandatory predictive maintenance by
  // omitting the plan — the ids are client-minted for determinism, but WHICH items get
  // a PM chance is authoritative here, not client-controlled.
  const planByItem = new Map(plan.map((e) => [e.checkItemId, e]));
  const entries: PmPlanEntry[] = [];
  for (const checkItemId of failed) {
    const entry = planByItem.get(checkItemId);
    if (!entry) {
      throw new ConvexError("Missing maintenance plan entry for failed check item: " + checkItemId);
    }
    entries.push(entry);
  }
  await runPredictiveMaintenance(ctx, {
    orgId, userId: actor.userId, userName: actor.userName, assetId, plan: entries, now,
  });
}
