import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

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

/**
 * Convex allows ~16k document reads per query. These caps exist so a big org gets a
 * TRUNCATED result it can see, instead of a thrown query it can't. Every cap below
 * is chosen so the worst-case sum stays under that ceiling — raising one in
 * isolation trades a visible warning for a hard failure.
 */
const PROJECT_SCAN_CAP = 1500;
/** Counted projects we'll fan out to for rollup rows. */
const COUNTED_PROJECT_CAP = 300;
/** Rollup rows read across the whole fan-out, not per project. */
const ROLLUP_READ_BUDGET = 10_000;
const MODEL_CAP = 2000;
const ASSET_CAP = 9000;
const BULK_ASSET_CAP = 2000;
/** Rollup rows for one model — i.e. projects that model ever appeared in. */
const MODEL_ROLLUP_CAP = 2000;
/** Units of a single model scanned before we stop counting. */
const UNIT_SCAN_CAP = 5000;

/** A project's date for windowing: when the gear went out, else when it was created. */
const projectDate = (p: { rentalStartDate?: number; createdAt?: number }): number =>
  p.rentalStartDate ?? p.createdAt ?? 0;

/**
 * Statuses where the money is real enough to attribute. A quote is not revenue —
 * and that policy has to live HERE, not only in the server action that usually
 * calls these queries. A browser-held user token can call a Convex query directly,
 * so a caller asking for QUOTED revenue must get nothing rather than a pipeline
 * number dressed up as earnings.
 */
const ATTRIBUTABLE_STATUSES = new Set([
  "COMPLETED",
  "INVOICED",
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
]);

const countableStatuses = (requested: readonly string[]): Set<string> =>
  new Set(requested.filter((s) => ATTRIBUTABLE_STATUSES.has(s)));

/** A cost field is only a signal if it's a real positive number — mirrors the
 * long-standing "a zero replacement cost is unknown, not free capital" rule
 * (src/lib/roi.test.ts), now applied uniformly to every field in the fallback chain. */
const positiveCost = (v: number | null | undefined): number | null => (v != null && v > 0 ? v : null);

type CostModel = { defaultPurchasePrice?: number | null; replacementCost?: number | null } | null | undefined;

/**
 * One serialised asset's contribution to fleet cost: what we actually paid for it,
 * else the model's general purchase price, else its replacement cost. Falls
 * through to 0 (no signal) rather than inventing a number — see FEATUREDOCS/57 and
 * gearflow#798 for why this chain, not `replacementCost` alone.
 */
const assetCost = (asset: { purchasePrice?: number | null }, model: CostModel): number =>
  positiveCost(asset.purchasePrice) ?? positiveCost(model?.defaultPurchasePrice) ?? positiveCost(model?.replacementCost) ?? 0;

/**
 * Units of a model we actually own, and what it cost to acquire them.
 *
 * Serialised assets sum their OWN cost (mixed sources allowed — some units priced,
 * some falling back). Bulk stock is unchanged: `replacementCost × totalQuantity`,
 * out of scope for gearflow#798 (`bulkAssets.purchasePricePerUnit` is a separate,
 * already-per-unit field a future issue can wire up).
 *
 * `fleetCost` is `null`, never `0`, when there is no capital to measure — no units
 * owned, or units owned but not one of them (nor the model) carries any cost
 * signal. A raw sum of $0 contributions is indistinguishable from "unpriced"; this
 * is the ONE place that ambiguity gets resolved, so every caller downstream just
 * sees a trustworthy null.
 *
 * `by_modelId` is NOT org-scoped. Every row it returns must be filtered on
 * `organizationId` or this counts another tenant's fleet.
 */
async function fleetCapitalFor(
  ctx: QueryCtx,
  orgId: string,
  modelId: string,
  model: CostModel,
): Promise<{ unitsOwned: number; fleetCost: number | null; truncated: boolean }> {
  // Bounded: `.collect()` on a global index is unbounded, and blowing the read limit
  // throws the whole report. An undercounted denominator OVERSTATES payback, so a
  // truncated count has to be visible rather than quietly optimistic.
  const [assets, bulk] = await Promise.all([
    ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).take(UNIT_SCAN_CAP),
    ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).take(UNIT_SCAN_CAP),
  ]);
  const mine = <T extends { organizationId: string; isActive?: boolean }>(r: T) =>
    r.organizationId === orgId && r.isActive !== false;
  const myAssets = assets.filter(mine);
  const myBulk = bulk.filter(mine);

  // totalQuantity, not availableQuantity: ROI is about the capital we bought, not
  // how much of it happens to be on the shelf right now.
  const bulkUnits = myBulk.reduce((s, b) => s + (b.totalQuantity ?? 0), 0);
  const unitsOwned = myAssets.length + bulkUnits;

  const assetCostSum = myAssets.reduce((s, a) => s + assetCost(a, model), 0);
  const bulkCostSum = (positiveCost(model?.replacementCost) ?? 0) * bulkUnits;
  const fleetCostRaw = assetCostSum + bulkCostSum;

  return {
    unitsOwned,
    fleetCost: unitsOwned > 0 && fleetCostRaw > 0 ? fleetCostRaw : null,
    truncated: assets.length === UNIT_SCAN_CAP || bulk.length === UNIT_SCAN_CAP,
  };
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
    await requireOrgReadFor(ctx, orgId, "reports");
    const counted = countableStatuses(statuses);

    // `by_cuid` is a global index. Without the org check, a caller authorised for
    // their OWN org could pass another org's modelId and read its name, replacement
    // cost and unit count. requireOrgRead validates the caller, not the model.
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    if (model && model.organizationId !== orgId) {
      throw new ConvexError(`model ${modelId} is not in org ${orgId}`);
    }

    // +1 so a full page is distinguishable from a page that exactly fits.
    const rollups = await ctx.db
      .query("projectModelRevenues")
      .withIndex("by_organizationId_modelId", (q) => q.eq("organizationId", orgId).eq("modelId", modelId))
      .take(MODEL_ROLLUP_CAP + 1);
    const rollupsTruncated = rollups.length > MODEL_ROLLUP_CAP;

    const projects: {
      projectId: string;
      projectNumber: string;
      name: string;
      status: string;
      date: number | null;
      revenue: number;
    }[] = [];

    for (const r of rollups.slice(0, MODEL_ROLLUP_CAP)) {
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
    const capital = await fleetCapitalFor(ctx, orgId, modelId, model);

    return {
      modelId,
      modelName: model?.name ?? "Unknown model",
      replacementCost: model?.replacementCost ?? null,
      unitsOwned: capital.unitsOwned,
      fleetCost: capital.fleetCost,
      revenue: revenueCents / 100,
      projects,
      truncated: rollupsTruncated || capital.truncated,
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
    /** Lower the rollup-row budget (e.g. for a cheaper query). Clamped — never raised. */
    rollupBudget: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, statuses, from, to, rollupBudget }) => {
    await requireOrgReadFor(ctx, orgId, "reports");
    const counted = countableStatuses(statuses);
    const budget = Math.max(1, Math.min(ROLLUP_READ_BUDGET, rollupBudget ?? ROLLUP_READ_BUDGET));

    // RANGE-SCAN the window, don't take a prefix and filter it. `.take()` returns an
    // index prefix; the window is on rentalStartDate, and creation order does not
    // track rental date (a project entered today can be for a gig last year). Taking
    // the first N projects by any other ordering reads the wrong ones entirely, and
    // narrowing the window — which the truncation banner tells you to do — cannot
    // help, because the in-window projects were never read.
    //
    // Trade-off: a project with NO rentalStartDate is outside this index range, so a
    // windowed report omits it. The all-time view (no bounds) still sees everything.
    const windowed = from != null || to != null;
    const scanned = windowed
      ? await ctx.db
          .query("projects")
          .withIndex("by_organizationId_rentalStartDate", (q) => {
            const base = q.eq("organizationId", orgId);
            if (from != null && to != null) return base.gte("rentalStartDate", from).lte("rentalStartDate", to);
            if (from != null) return base.gte("rentalStartDate", from);
            return base.lte("rentalStartDate", to!);
          })
          .order("desc")
          .take(PROJECT_SCAN_CAP)
      : await ctx.db
          .query("projects")
          .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
          .order("desc")
          .take(PROJECT_SCAN_CAP);

    const inScope = scanned.filter((p) => {
      if (p.isTemplate) return false;
      if (!counted.has(p.status ?? "")) return false;
      // Redundant inside the range scan; load-bearing for the all-time path, which
      // has no bounds to scan against.
      const d = projectDate(p);
      return (from == null || d >= from) && (to == null || d <= to);
    });

    const projects = inScope.slice(0, COUNTED_PROJECT_CAP);
    let truncated = scanned.length === PROJECT_SCAN_CAP || inScope.length > COUNTED_PROJECT_CAP;

    const cents = new Map<string, number>();
    const projectCount = new Map<string, number>();
    let projectsCounted = 0;
    // Rollup rows are the unbounded term: capping the PROJECT count doesn't cap the
    // documents read, because a project can carry any number of models. Budget the
    // rows themselves, and stop with `truncated` rather than blowing the read limit
    // and throwing — a thrown report is strictly worse than a partial one.
    let rowsRead = 0;

    for (const p of projects) {
      const remaining = budget - rowsRead;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      // Fetch one MORE than the budget allows, so "exactly filled the budget" is
      // distinguishable from "had more to give". Taking exactly `remaining` on the
      // last project would read a partial page, exit the loop normally, and leave
      // `truncated` false while a model's revenue quietly went missing.
      const rows = await ctx.db
        .query("projectModelRevenues")
        .withIndex("by_projectId", (q) => q.eq("projectId", p.id))
        .take(remaining + 1);

      if (rows.length > remaining) {
        // Don't ingest a half-read project: a partial total is a wrong total, and
        // it looks exactly like a project whose gear underperformed.
        truncated = true;
        break;
      }

      rowsRead += rows.length;
      projectsCounted++;
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
      projectsCounted,
      truncated,
    };
  },
});

/**
 * Groups in counted-status projects that carry real gear but have no flat price.
 *
 * `recalcProjectTotals` bills grouped equipment as `group.price × group.quantity` —
 * a grouped line item's own `lineTotal` never reaches revenue (see
 * FEATUREDOCS/57-revenue-allocation-roi.md). An unpriced group containing gear
 * therefore reports $0 for that gear in BOTH the project's own total AND ROI — this
 * is the #1 cause of "ROI is lower than what we actually sold". It's the single
 * most actionable data-quality signal for this report, so it gets its own query
 * rather than being buried in a per-project drill-down.
 *
 * `suggestedPrice` (cost-weighted, computed the same way the group-price UI
 * suggests one) is returned as a hint of what the group is probably worth — never
 * treated as the answer, since it's a cost proxy, not what the client was actually
 * charged.
 */
export const zeroPricedGroups = query({
  args: {
    orgId: v.string(),
    statuses: v.array(v.string()),
  },
  handler: async (ctx, { orgId, statuses }) => {
    await requireOrgReadFor(ctx, orgId, "reports");
    const counted = countableStatuses(statuses);

    const scanned = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(PROJECT_SCAN_CAP);

    const inScope = scanned.filter((p) => !p.isTemplate && counted.has(p.status ?? ""));

    const rows: {
      projectId: string;
      projectNumber: string;
      projectName: string;
      groupId: string;
      groupTitle: string;
      gearLineCount: number;
      suggestedPrice: number | null;
    }[] = [];
    let rowsRead = 0;
    let truncated = scanned.length === PROJECT_SCAN_CAP;

    for (const p of inScope) {
      if (rowsRead >= ROLLUP_READ_BUDGET) {
        truncated = true;
        break;
      }
      const [groups, lines] = await Promise.all([
        ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", p.id)).collect(),
        ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", p.id)).collect(),
      ]);
      rowsRead += groups.length + lines.length;

      for (const g of groups) {
        if (Number(g.price ?? 0) > 0) continue;
        const gearLines = lines.filter(
          (l) =>
            l.groupId === g.id &&
            l.status !== "CANCELLED" &&
            l.isOptional !== true &&
            l.isCustomItem !== true &&
            l.modelId != null,
        );
        if (gearLines.length === 0) continue;
        rows.push({
          projectId: p.id,
          projectNumber: p.projectNumber,
          projectName: p.name,
          groupId: g.id,
          groupTitle: g.title,
          gearLineCount: gearLines.length,
          suggestedPrice: g.suggestedPrice ?? null,
        });
      }
    }

    return { rows, truncated };
  },
});

/**
 * The capital side: every active model, how many units of it we own, and what it
 * cost to acquire them (see `fleetCapitalFor` for the per-asset/bulk cost chain).
 *
 * Scans assets org-wide ONCE and tallies per model, rather than querying per model,
 * so models with zero revenue still appear. Those rows are the point of the report
 * as much as the earners are — dead capital doesn't announce itself.
 */
export const fleetInventory = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "reports");

    const [models, assets, bulk] = await Promise.all([
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(MODEL_CAP),
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(ASSET_CAP),
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(BULK_ASSET_CAP),
    ]);
    const modelsById = new Map(models.map((m) => [m.id, m]));

    const units = new Map<string, number>();
    const costRaw = new Map<string, number>();
    for (const a of assets) {
      if (!a.modelId || a.isActive === false) continue;
      units.set(a.modelId, (units.get(a.modelId) ?? 0) + 1);
      costRaw.set(a.modelId, (costRaw.get(a.modelId) ?? 0) + assetCost(a, modelsById.get(a.modelId)));
    }
    for (const b of bulk) {
      if (!b.modelId || b.isActive === false) continue;
      const qty = b.totalQuantity ?? 0;
      units.set(b.modelId, (units.get(b.modelId) ?? 0) + qty);
      const rate = positiveCost(modelsById.get(b.modelId)?.replacementCost) ?? 0;
      costRaw.set(b.modelId, (costRaw.get(b.modelId) ?? 0) + rate * qty);
    }

    return {
      rows: models
        .filter((m) => m.isActive !== false)
        .map((m) => {
          const unitsOwned = units.get(m.id) ?? 0;
          const raw = costRaw.get(m.id) ?? 0;
          return {
            modelId: m.id,
            modelName: m.name,
            manufacturer: m.manufacturer ?? null,
            categoryId: m.categoryId ?? null,
            fleetCost: unitsOwned > 0 && raw > 0 ? raw : null,
            unitsOwned,
          };
        }),
      truncated:
        models.length === MODEL_CAP ||
        assets.length === ASSET_CAP ||
        bulk.length === BULK_ASSET_CAP,
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  getModelRoi: { summary: "ROI (revenue vs fleet capital) for one model.", danger: "low", mcpTier: 2 },
  fleetRevenue: { summary: "Fleet revenue by model over a window.", danger: "low", mcpTier: 2 },
  zeroPricedGroups: { summary: "Project groups carrying gear with no flat price (data-quality signal).", danger: "low", mcpTier: 3 },
  fleetInventory: { summary: "Per-model unit counts and fleet capital cost.", danger: "low", mcpTier: 2 },
};
