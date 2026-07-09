import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Model ROI reporting, read off the allocation the recalc pass already wrote.
 *
 * Nothing here recomputes an allocation or reads a live model price. That's what
 * makes `allocatedRevenue` a snapshot: re-pricing a model tomorrow does not restate
 * what a project earned last year.
 *
 * READ BUDGET. Summing allocatedRevenue across every line item of every project
 * does not fit in a Convex query. `projectModelRevenues` (one row per model per
 * project, rebuilt by the same pass) shrinks that to distinct-models-per-project.
 * Fleet reporting is then split across TWO queries — revenue and inventory — so
 * each gets its own read budget rather than sharing one. Both cap their scans and
 * report `truncated` instead of quietly under-reporting. When the caps start
 * biting, the fix is a scheduled org-level aggregate, not a bigger cap.
 */

/** Projects scanned before we admit we're only showing part of the picture. */
const PROJECT_SCAN_CAP = 2000;
/** Counted projects we'll fan out to for rollup rows. */
const COUNTED_PROJECT_CAP = 500;
const MODEL_CAP = 3000;
const ASSET_CAP = 12000;
const BULK_ASSET_CAP = 3000;

/** A project's date for windowing: when the gear went out, else when it was created. */
const projectDate = (p: { rentalStartDate?: number; createdAt?: number }): number =>
  p.rentalStartDate ?? p.createdAt ?? 0;

/** Units of a model we actually own — serialised assets plus bulk stock on hand. */
async function unitsOwnedFor(ctx: QueryCtx, modelId: string): Promise<number> {
  const [assets, bulk] = await Promise.all([
    ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
    ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
  ]);
  // totalQuantity, not availableQuantity: ROI is about the capital we bought, not
  // how much of it happens to be on the shelf right now.
  return (
    assets.filter((a) => a.isActive !== false).length +
    bulk.filter((b) => b.isActive !== false).reduce((s, b) => s + (b.totalQuantity ?? 0), 0)
  );
}

/**
 * One model's earnings, and the projects that produced them.
 *
 * Cheap: the model's rollup rows bound the project fan-out to "projects this model
 * actually appeared in", which is far smaller than "projects".
 */
export const getModelRoi = query({
  args: {
    orgId: v.string(),
    modelId: v.string(),
    statuses: v.array(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, modelId, statuses, from, to }) => {
    await requireOrgRead(ctx, orgId);
    const counted = new Set(statuses);

    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    const rollups = await ctx.db
      .query("projectModelRevenues")
      .withIndex("by_organizationId_modelId", (q) => q.eq("organizationId", orgId).eq("modelId", modelId))
      .collect();

    const projects: {
      projectId: string;
      projectNumber: string;
      name: string;
      status: string;
      date: number | null;
      revenue: number;
    }[] = [];

    for (const r of rollups) {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", r.projectId)).first();
      if (!p || p.isTemplate) continue;
      if (!counted.has(p.status ?? "")) continue;
      const d = projectDate(p);
      if (from != null && d < from) continue;
      if (to != null && d > to) continue;
      projects.push({
        projectId: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        status: p.status ?? "",
        date: p.rentalStartDate ?? null,
        revenue: r.allocatedRevenue,
      });
    }

    projects.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    const revenueCents = projects.reduce((s, p) => s + Math.round(p.revenue * 100), 0);

    return {
      modelId,
      modelName: model?.name ?? "Unknown model",
      replacementCost: model?.replacementCost ?? null,
      unitsOwned: await unitsOwnedFor(ctx, modelId),
      revenue: revenueCents / 100,
      projects,
    };
  },
});

/**
 * Fleet revenue by model, for the counted projects inside the window.
 *
 * Deliberately does NOT join inventory — see `fleetInventory`.
 */
export const fleetRevenue = query({
  args: {
    orgId: v.string(),
    statuses: v.array(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, statuses, from, to }) => {
    await requireOrgRead(ctx, orgId);
    const counted = new Set(statuses);

    const scanned = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .take(PROJECT_SCAN_CAP);

    const inScope = scanned.filter((p) => {
      if (p.isTemplate) return false;
      if (!counted.has(p.status ?? "")) return false;
      const d = projectDate(p);
      return (from == null || d >= from) && (to == null || d <= to);
    });

    const projects = inScope.slice(0, COUNTED_PROJECT_CAP);
    const truncated = scanned.length === PROJECT_SCAN_CAP || inScope.length > COUNTED_PROJECT_CAP;

    const cents = new Map<string, number>();
    const projectCount = new Map<string, number>();
    for (const p of projects) {
      const rows = await ctx.db
        .query("projectModelRevenues")
        .withIndex("by_projectId", (q) => q.eq("projectId", p.id))
        .collect();
      for (const r of rows) {
        cents.set(r.modelId, (cents.get(r.modelId) ?? 0) + Math.round(r.allocatedRevenue * 100));
        projectCount.set(r.modelId, (projectCount.get(r.modelId) ?? 0) + 1);
      }
    }

    return {
      rows: [...cents].map(([modelId, c]) => ({
        modelId,
        revenue: c / 100,
        projectCount: projectCount.get(modelId) ?? 0,
      })),
      projectsCounted: projects.length,
      truncated,
    };
  },
});

/**
 * The capital side: every active model and how many units of it we own.
 *
 * Scans assets org-wide ONCE and tallies, rather than per-model, so models with
 * zero revenue still appear. Those rows are the point of the report as much as the
 * earners are — dead capital doesn't announce itself.
 */
export const fleetInventory = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);

    const [models, assets, bulk] = await Promise.all([
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(MODEL_CAP),
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(ASSET_CAP),
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(BULK_ASSET_CAP),
    ]);

    const units = new Map<string, number>();
    for (const a of assets) {
      if (!a.modelId || a.isActive === false) continue;
      units.set(a.modelId, (units.get(a.modelId) ?? 0) + 1);
    }
    for (const b of bulk) {
      if (!b.modelId || b.isActive === false) continue;
      units.set(b.modelId, (units.get(b.modelId) ?? 0) + (b.totalQuantity ?? 0));
    }

    return {
      rows: models
        .filter((m) => m.isActive !== false)
        .map((m) => ({
          modelId: m.id,
          modelName: m.name,
          manufacturer: m.manufacturer ?? null,
          categoryId: m.categoryId ?? null,
          replacementCost: m.replacementCost ?? null,
          unitsOwned: units.get(m.id) ?? 0,
        })),
      truncated:
        models.length === MODEL_CAP ||
        assets.length === ASSET_CAP ||
        bulk.length === BULK_ASSET_CAP,
    };
  },
});
