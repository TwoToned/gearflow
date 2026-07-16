/**
 * Predictive-maintenance core — the in-transaction port of
 * `checkPredictiveMaintenance` (src/server/check-records.ts). After a warehouse
 * check submits FAIL results, this looks at the asset's recent history for each
 * failed check item and, if it has failed ≥2 of the last 3 checks, auto-creates a
 * PREVENTATIVE / SCHEDULED maintenance record + a maintenanceRecordAssets link.
 *
 * Runs INSIDE the calling check mutation's transaction (ctx.db sees the check
 * records just written this same call, so the current FAIL counts toward the
 * threshold — exactly as the old post-commit sequence did). Atomicity is the point:
 * a check that flags AND auto-creates maintenance can no longer half-commit. It is
 * therefore NOT wrapped in a swallow — any error rolls the whole check back.
 *
 * ── PREVENTATIVE / SCHEDULED, deliberately ──
 * Unlike maintenanceWrites (AWAITING_PARTS/IN_PROGRESS/QA HOLD the asset), a
 * SCHEDULED record does NOT hold the asset — so this NEVER touches asset.status.
 * Mirrors the server action, which likewise created a SCHEDULED record and left the
 * inventory asset alone.
 *
 * Security: every doc fetched by the GLOBAL `by_cuid` / `by_assetId` index is
 * org-re-checked (the caller already ran the mutation security bar). All ids
 * (maintenanceId / link id / auditId) are CLIENT-minted, passed one per failed
 * check item; dup-guarded (cross-org collision rejected, same-pair idempotent).
 * ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { writeActivityLog } from "./audit";

/** One client-minted id bundle per DISTINCT failed check item id. */
export interface PmPlanEntry {
  checkItemId: string;
  maintenanceId: string;
  maintenanceLinkId: string;
  auditId: string;
}

export async function runPredictiveMaintenance(
  ctx: MutationCtx,
  args: {
    orgId: string;
    userId: string;
    userName: string;
    assetId: string;
    plan: PmPlanEntry[];
    now: number;
  },
): Promise<void> {
  const { orgId, userId, userName, assetId, plan, now } = args;
  if (!assetId || plan.length === 0) return;

  for (const entry of plan) {
    // Last 3 records for this asset + check item (org-scoped composite index),
    // newest-first — mirrors checkRecords.listRecentByAssetAndCheckItem.
    const recent = (
      await ctx.db
        .query("checkRecords")
        .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
        .collect()
    )
      .filter((r) => r.checkItemId === entry.checkItemId)
      .sort((a, b) => (b.performedAt ?? 0) - (a.performedAt ?? 0))
      .slice(0, 3);

    const failCount = recent.filter((r) => r.result === "FAIL").length;
    if (failCount < 2) continue;

    // Asset + check item + model — each org re-checked (by_cuid is GLOBAL).
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
    if (!asset || asset.organizationId !== orgId) continue;
    const checkItem = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", entry.checkItemId)).unique();
    if (!checkItem || checkItem.organizationId !== orgId) continue;
    const model = asset.modelId
      ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId!)).unique()
      : null;
    const modelName = model?.name ?? "";

    // Dedup: skip if an active (SCHEDULED / IN_PROGRESS) auto record for this
    // check item already links the asset. Reads the fresh link + record state.
    const titleNeedle = `[Auto] ${checkItem.label}`;
    const links = await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
      .collect();
    let alreadyExists = false;
    for (const l of links) {
      const rec = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", l.maintenanceRecordId)).unique();
      if (!rec || rec.organizationId !== orgId) continue; // org re-check
      const status = rec.status ?? "SCHEDULED";
      if ((status === "SCHEDULED" || status === "IN_PROGRESS") && rec.title.includes(titleNeedle)) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) continue;

    // Insert the maintenance record at the client-minted id. A legitimate idempotent
    // retry is ALREADY caught above by the (asset, [Auto] label) dedup — so any row
    // still holding this id here is an UNRELATED record (cross-org injection OR a
    // same-org id reused for a different record, which would silently suppress this
    // mandatory auto-maintenance). Reject the collision unconditionally.
    const mDup = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", entry.maintenanceId)).unique();
    if (mDup) throw new ConvexError("Maintenance record id already exists");

    const title = `[Auto] ${checkItem.label} — ${asset.assetTag}`;
    await ctx.db.insert("maintenanceRecords", {
      id: entry.maintenanceId,
      organizationId: orgId,
      type: "PREVENTATIVE",
      status: "SCHEDULED",
      title,
      description: `Automatically created: "${checkItem.label}" failed ${failCount} of last ${recent.length} checks on ${modelName} (${asset.assetTag}).`,
      reportedById: userId,
      scheduledDate: now,
      createdAt: now,
      updatedAt: now,
    });

    // Link the asset (idempotent on the (record, asset) pair; a foreign link-id is
    // a genuine collision → reject, mirroring maintenanceWrites.insertLink).
    const pair = await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", entry.maintenanceId).eq("assetId", assetId))
      .first();
    if (!pair) {
      const idDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", entry.maintenanceLinkId)).unique();
      if (idDup) throw new ConvexError("Maintenance link id collision");
      await ctx.db.insert("maintenanceRecordAssets", {
        id: entry.maintenanceLinkId,
        maintenanceRecordId: entry.maintenanceId,
        assetId,
      });
    }

    await writeActivityLog(ctx, {
      id: entry.auditId,
      organizationId: orgId,
      action: "CREATE",
      entityType: "maintenance",
      entityId: entry.maintenanceId,
      entityName: title,
      userId,
      userName,
      summary: "Auto-created maintenance for repeated check failure",
      assetId,
      createdAt: now,
    });
  }
}
