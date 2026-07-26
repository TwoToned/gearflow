import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Browser-facing reads for ServiceSchedule (WS6 #945). Writes live in
 * `serviceSchedulesWrites.ts`. Small, admin-created catalog table (one row per
 * model+cadence) — a plain org-scoped collect is bounded the same way
 * `crewRoles`/`models`/other catalog tables are (see docs/exceptions.md's
 * R-8.3.3 rows for that reasoning class).
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const schedules = await ctx.db
      .query("serviceSchedules")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small admin-created catalog table — see docs/exceptions.md R-8.3.3
      .collect();

    const modelIds = [...new Set(schedules.map((s) => s.modelId))];
    const modelDocs = await Promise.all(
      modelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    const modelById = new Map(
      modelDocs.filter((m): m is NonNullable<typeof m> => !!m && m.organizationId === orgId).map((m) => [m.id, m]),
    );

    return schedules
      .map((s) => ({
        id: s.id,
        modelId: s.modelId,
        modelName: modelById.get(s.modelId)?.name ?? "(deleted model)",
        name: s.name,
        intervalMonths: s.intervalMonths,
        anchorDate: new Date(s.anchorDate).toISOString(),
        instructions: s.instructions ?? null,
        isActive: s.isActive ?? true,
      }))
      .sort((a, b) => a.modelName.localeCompare(b.modelName) || a.name.localeCompare(b.name));
  },
});
