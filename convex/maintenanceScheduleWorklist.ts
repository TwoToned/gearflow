import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";
import { isCheckoffRow, computeCheckoffProgress } from "./lib/maintenanceRecordAssetKind";
import { resolveModelAssetType } from "./lib/availabilityCore";

/**
 * WS6 #945 — `/maintenance/due` worklist read. T&T-dashboard shape
 * (test-and-tag/page.tsx precedent): stat tiles + sections per schedule. Each
 * section is the schedule's single OPEN generated cycle (if any) — a schedule
 * not yet due, or whose cycle already completed with nothing new generated
 * yet, contributes no section. Enriches only the rendered rows (this org's
 * open cycles + their model/asset data), mirroring `testTagAssets.
 * dashboardStats`'s discipline — never the whole org's assets/bulkAssets.
 */

const TERMINAL = new Set(["COMPLETED", "CANCELLED"]);
const DUE_SOON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — same "due soon" horizon as the T&T dashboard's own window

export const dueWorklist = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);

    const schedules = (
      await ctx.db.query("serviceSchedules").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect() // r9.8-ok: small admin-created catalog table, same class as crewRoles/models — see docs/exceptions.md
    ).filter((s) => s.isActive !== false);

    let overdue = 0;
    let dueSoon = 0;
    let inProgress = 0;
    const sections: Record<string, unknown>[] = [];

    for (const schedule of schedules) {
      const cycles = await ctx.db
        .query("maintenanceRecords")
        .withIndex("by_serviceScheduleId", (q) => q.eq("serviceScheduleId", schedule.id))
        .collect();
      const open = cycles.find((r) => !TERMINAL.has(r.status ?? "SCHEDULED"));
      if (!open) continue;

      const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", schedule.modelId)).unique();
      if (!model || model.organizationId !== orgId) continue;

      const status = open.status ?? "SCHEDULED";
      const dueDate = open.scheduledDate ?? nowMs;
      if (status === "IN_PROGRESS" || status === "AWAITING_PARTS" || status === "QA") inProgress++;
      else if (dueDate < nowMs) overdue++;
      else if (dueDate - nowMs <= DUE_SOON_WINDOW_MS) dueSoon++;

      const checkoffRows = (
        await ctx.db
          .query("maintenanceRecordAssets")
          .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", open.id))
          .collect()
      ).filter(isCheckoffRow);
      const progress = computeCheckoffProgress(checkoffRows);
      const snapshot = open.poolQuantitySnapshot ?? 0;

      const [assetsRaw, bulkRaw] = await Promise.all([
        ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", model.id)).collect(),
        ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", model.id)).collect(),
      ]);
      const activeAssets = assetsRaw.filter((a) => a.organizationId === orgId && a.isActive !== false);
      const activeBulk = bulkRaw.filter((b) => b.organizationId === orgId && b.isActive !== false);
      const assetType = resolveModelAssetType(model.assetType, activeBulk.length > 0, activeAssets.length > 0);

      const base = {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        modelId: model.id,
        modelName: model.name,
        recordId: open.id,
        dueDate: new Date(dueDate).toISOString(),
        status,
        poolQuantitySnapshot: snapshot,
        progress: Math.min(progress, snapshot || progress),
      };

      if (assetType === "BULK") {
        const bulk = activeBulk[0] ?? null;
        sections.push({
          ...base,
          isBulk: true,
          bulkAssetId: bulk?.id ?? null,
          bulkAssetTag: bulk?.assetTag ?? null,
        });
      } else {
        const checkedOffIds = new Set(checkoffRows.filter((r) => r.assetId != null).map((r) => r.assetId));
        const units = activeAssets
          .slice()
          .sort((a, b) => a.assetTag.localeCompare(b.assetTag))
          .map((a) => ({
            assetId: a.id,
            assetTag: a.assetTag,
            customName: a.customName ?? null,
            checkedOff: checkedOffIds.has(a.id),
          }));
        sections.push({ ...base, isBulk: false, units });
      }
    }

    return {
      stats: { overdue, dueSoon, inProgress },
      sections,
    };
  },
});
