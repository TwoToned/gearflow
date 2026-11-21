/**
 * Phase 16 helpers for the ad-hoc check (`checkRecordWrites.saveAdHocCheck` and its
 * exact reverse `undoAdHocCheckNative`): the D50 condition write and the audit-row
 * "before" snapshot (overseer Q2) the Undo reads back. Every read on a global index is
 * org re-checked; reads are bounded; ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeActivityLog } from "./audit";
import {
  conditionWord,
  resolveCheckCondition,
  type CheckConditionValue,
  type StoredAssetCondition,
} from "./assetCondition";

/** What `saveAdHocCheck` writes into its own audit row's `details` (server-written). */
export interface AdHocCheckDetails {
  kind: "adHocCheck";
  assetId: string;
  /** `null` = the field was absent. */
  conditionBefore: StoredAssetCondition | null;
  conditionAfter: StoredAssetCondition | null;
  conditionChanged: boolean;
  /** The asset's `updatedAt` before a condition write (restored exactly by Undo). */
  updatedAtBefore: number | null;
  recordIds: string[];
  createdMaintenanceIds: string[];
  notes?: string;
}

type ConditionOutcome = Pick<AdHocCheckDetails, "conditionBefore" | "conditionAfter" | "conditionChanged" | "updatedAtBefore">;

/** Rows scanned to find an earlier UNDO of the same forward save. */
const MAX_ENTITY_ROWS = 50;

/**
 * Write `assets.condition` when the check's word differs from the asset's (D50, Q5),
 * plus an `asset` UPDATE activity row naming the change. Returns the snapshot for the
 * forward audit row either way.
 */
export async function applyCheckCondition(
  ctx: MutationCtx,
  a: {
    asset: Doc<"assets">;
    chosen: CheckConditionValue | undefined;
    anyFail: boolean;
    orgId: string;
    actor: { userId: string; userName: string };
    auditId: string;
    now: number;
  },
): Promise<ConditionOutcome> {
  const before = a.asset.condition ?? null;
  const target = resolveCheckCondition(before, a.chosen, a.anyFail);
  const updatedAtBefore = a.asset.updatedAt ?? null;
  if (!target) return { conditionBefore: before, conditionAfter: before, conditionChanged: false, updatedAtBefore };

  await ctx.db.patch(a.asset._id, { condition: target, updatedAt: a.now });
  await writeActivityLog(ctx, {
    id: `${a.auditId}:condition`, organizationId: a.orgId, action: "UPDATE", entityType: "asset",
    entityId: a.asset.id, entityName: a.asset.assetTag, userId: a.actor.userId, userName: a.actor.userName,
    summary: `Condition ${conditionWord(before)} → ${conditionWord(target)} (ad-hoc check)`,
    details: { field: "condition", before, after: target }, assetId: a.asset.id, createdAt: a.now,
  });
  return { conditionBefore: before, conditionAfter: target, conditionChanged: true, updatedAtBefore };
}

function isAdHocDetails(d: unknown): d is AdHocCheckDetails {
  const x = d as Partial<AdHocCheckDetails> | null;
  return !!x && x.kind === "adHocCheck" && typeof x.assetId === "string" && Array.isArray(x.recordIds) && Array.isArray(x.createdMaintenanceIds);
}

/**
 * The forward save's audit row, proven undoable: in this org, an ad-hoc check CREATE
 * carrying the Phase 16 snapshot, saved by `actorUserId`, and not undone already.
 */
export async function loadUndoableAdHocCheck(
  ctx: MutationCtx,
  orgId: string,
  forwardAuditId: string,
  actorUserId: string,
): Promise<{ forward: Doc<"activityLogs">; details: AdHocCheckDetails }> {
  const forward = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", forwardAuditId)).first();
  if (!forward || forward.organizationId !== orgId || forward.action !== "CREATE" || forward.entityType !== "checkRecord" || !isAdHocDetails(forward.details)) {
    throw new ConvexError("This check can't be undone");
  }
  if (forward.userId !== actorUserId) throw new ConvexError("Only the person who saved this check can undo it");
  const siblings = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "checkRecord").eq("entityId", forward.entityId))
    .take(MAX_ENTITY_ROWS);
  if (siblings.some((r) => r.action === "UNDO" && (r.details as { undoOf?: string } | undefined)?.undoOf === forward.id)) {
    throw new ConvexError("This check was already undone");
  }
  return { forward, details: forward.details };
}

/** Exactly the forward save's check records, each still the AD_HOC row on that asset. */
export async function requireUntouchedCheckRecords(
  ctx: MutationCtx,
  orgId: string,
  details: AdHocCheckDetails,
): Promise<Doc<"checkRecords">[]> {
  const out: Doc<"checkRecords">[] = [];
  for (const id of details.recordIds) {
    const r = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!r || r.organizationId !== orgId || r.context !== "AD_HOC" || r.assetId !== details.assetId) {
      throw new ConvexError("This check's records changed since: it can't be undone");
    }
    out.push(r);
  }
  return out;
}
