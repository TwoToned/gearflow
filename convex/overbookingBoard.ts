import { v, ConvexError } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { getProjectWindow } from "./lib/projectWindow";
import type { Doc } from "./_generated/dataModel";
import {
  candidateBoardProjects,
  computeGearShortageBoard,
  computeSaleStockToProcure,
  computeServicesMissingCrew,
  computeUnconfirmedCrew,
  computeCrewDoubleBookings,
} from "./lib/overbookingBoard";
import { computeConfirmImpactModels, countUnconfirmedCrewForProject } from "./lib/overbookingConfirmImpact";

/** Mirrors convex/overbooking.ts's own MIN_TS — see that file's comment for why
 *  an unbounded-below range scan needs this floor (undefined sorts before all
 *  numbers in a Convex index). */
const MIN_TS = -8_640_000_000_000_000;

const MAX_RANGE_DAYS = 366;

/**
 * Candidate projects — TWO range-scans unioned, same shape as overbooking.ts's
 * `bundle` (WS2 #941): rental-index scan (unbounded below — also sweeps in
 * every projectStartDate-unset row, since undefined sorts first) UNION
 * projectStartDate-index scan (MIN_TS-bounded, backfilled rows only). Both
 * candidate sets are then refined by the PURE getProjectWindow overlap check
 * in `candidateBoardProjects`.
 */
async function fetchCandidateProjects(ctx: QueryCtx, orgId: string, rangeEnd: number) {
  const projectDocsById = new Map<string, Doc<"projects">>();
  for await (const p of ctx.db
    .query("projects")
    .withIndex("by_organizationId_rentalStartDate", (q) => q.eq("organizationId", orgId).lte("rentalStartDate", rangeEnd))) {
    projectDocsById.set(p.id, p);
  }
  for await (const p of ctx.db
    .query("projects")
    .withIndex("by_organizationId_projectStartDate", (q) => q.eq("organizationId", orgId).gt("projectStartDate", MIN_TS).lte("projectStartDate", rangeEnd))) {
    projectDocsById.set(p.id, p);
  }
  return projectDocsById;
}

/** Line items for candidate projects only (referenced-only) + the models/assets/
 *  bulkAssets those line items reference (also referenced-only). */
async function fetchGearData(ctx: QueryCtx, orgId: string, candidateProjectIds: string[]) {
  const lineItemGroups = await Promise.all(
    candidateProjectIds.map((pid) => ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", pid)).collect()),
  );
  const lineItems = lineItemGroups.flat().filter((li) => li.organizationId === orgId);

  const referencedModelIds = [...new Set(lineItems.map((li) => li.modelId).filter((id): id is string => !!id))];
  const [modelDocs, assetGroups, bulkGroups] = await Promise.all([
    Promise.all(referencedModelIds.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique())),
    Promise.all(referencedModelIds.map((mid) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
    Promise.all(referencedModelIds.map((mid) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
  ]);
  return {
    lineItems,
    referencedModelIds,
    models: modelDocs.filter((m): m is NonNullable<typeof m> => !!m && m.organizationId === orgId),
    assets: assetGroups.flat().filter((a) => a.organizationId === orgId),
    bulkAssetsForModels: bulkGroups.flat().filter((b) => b.organizationId === orgId),
  };
}

/**
 * WS11 (#950) — models with a negative `saleStockQuantity` (a single
 * per-model sale-stock pool, independent of rental assets/bulk) for the
 * "Sale stock to procure" section, plus the NEW_STOCK sale lines that drew
 * each one down. Supersedes the WS3 (#942) `bulkAssets.saleStockQuantity`
 * org-wide-scan stub — `models` already has an `by_organizationId` index, so
 * this is a normal indexed org-scan + client-side `saleStockQuantity < 0`
 * filter (Convex guidelines: an additional predicate a chosen index can't
 * express is an ordinary `.filter()`, not an R-8.3.3 exception), and the
 * follow-up sale-line reads are TARGETED per negative model (`by_modelId`),
 * not another org-wide scan. Also merges in `gearModels` (models already
 * fetched for the gear-shortage section) so a model with real demand AND a
 * negative sale pool isn't queried twice.
 */
async function fetchSaleStockData(ctx: QueryCtx, orgId: string, gearModels: Doc<"models">[], gearModelIds: string[]) {
  // saleStockQuantity has no index, so finding every negative-pool model needs
  // the org's whole catalog; models is catalog-scale (bounded by distinct
  // model count), same accepted shape as the assets.ts/projects.ts `list()` rows.
  // r9.8-ok: see docs/exceptions.md R-8.3.3 (overbookingBoard-sale-stock-models)
  const allOrgModels = await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
  const negativeModels = allOrgModels.filter((m) => (m.saleStockQuantity ?? 0) < 0);
  const negativeModelIds = negativeModels.filter((m) => !gearModelIds.includes(m.id)).map((m) => m.id);
  const gearModelsById = new Map(gearModels.map((m) => [m.id, m]));
  const models = [...gearModels, ...negativeModels.filter((m) => !gearModelsById.has(m.id) && negativeModelIds.includes(m.id))];

  // Targeted per-negative-model line-item reads (bounded to the small set of
  // over-drawn models, not an org-wide scan) — the "contributing sale lines".
  const allNegativeModelIds = negativeModels.map((m) => m.id);
  const saleLineGroups = await Promise.all(
    allNegativeModelIds.map((mid) => ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
  );
  const saleLines = saleLineGroups.flat().filter((li) => li.organizationId === orgId);

  return { models, saleLines };
}

/** Services in range (bounded both ends on by_organizationId_date, WS3 #942) +
 *  their crew assignments (referenced-only, by_serviceId). */
async function fetchServicesData(ctx: QueryCtx, orgId: string, rangeStart: number, rangeEnd: number) {
  const services = await ctx.db
    .query("projectServices")
    .withIndex("by_organizationId_date", (q) => q.eq("organizationId", orgId).gte("date", rangeStart).lte("date", rangeEnd))
    .collect();
  const assignmentGroups = await Promise.all(
    services.map((s) => ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", s.id)).collect()),
  );
  const assignmentsByServiceId = new Map<string, Doc<"crewAssignments">[]>(
    services.map((s, i) => [s.id, assignmentGroups[i].filter((a) => a.organizationId === orgId)]),
  );
  return { services, assignmentsByServiceId };
}

/** Crew assignments in range (bounded both ends on by_organizationId_startDate,
 *  WS3 #942) — feeds "unconfirmed crew" + "crew double-bookings" — plus the
 *  availability blocks for just the crew members those assignments reference. */
async function fetchCrewData(ctx: QueryCtx, orgId: string, rangeStart: number, rangeEnd: number) {
  const rangedAssignments = await ctx.db
    .query("crewAssignments")
    .withIndex("by_organizationId_startDate", (q) => q.eq("organizationId", orgId).gte("startDate", rangeStart).lte("startDate", rangeEnd))
    .collect();
  const referencedCrewMemberIds = [...new Set(rangedAssignments.map((a) => a.crewMemberId))];
  const availGroups = await Promise.all(
    referencedCrewMemberIds.map((id) => ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect()),
  );
  return { rangedAssignments, availabilityBlocks: availGroups.flat().filter((b) => b.organizationId === orgId) };
}

/** projectsById covering every project referenced anywhere above (candidates +
 *  services' + assignments' projects), referenced-only for anything missing. */
async function fetchExtraProjects(
  ctx: QueryCtx,
  orgId: string,
  projectDocsById: Map<string, Doc<"projects">>,
  extraIds: string[],
) {
  const missing = extraIds.filter((id) => !projectDocsById.has(id));
  const docs = await Promise.all(missing.map((pid) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique()));
  for (const p of docs) {
    if (p && p.organizationId === orgId) projectDocsById.set(p.id, p);
  }
  return projectDocsById;
}

function validateRange(rangeStart: number, rangeEnd: number): void {
  if (rangeEnd < rangeStart) {
    throw new ConvexError("overbookingBoard: rangeEnd must be >= rangeStart");
  }
  if (rangeEnd - rangeStart > MAX_RANGE_DAYS * 86_400_000) {
    throw new ConvexError(`overbookingBoard: range exceeds ${MAX_RANGE_DAYS} days`);
  }
}

/**
 * The shared read+aggregate core behind both `bundle` (the full board page)
 * and `counts` (the cheap dashboard-chip query) — same reads either way (the
 * DB work is identical), factored out so the two callers can't drift and so
 * `counts` can return just the small numbers a chip needs instead of every
 * row's full detail.
 */
async function computeBoardBundle(ctx: QueryCtx, orgId: string, rangeStart: number, rangeEnd: number) {
  const range = { start: rangeStart, end: rangeEnd };

  const projectDocsById = await fetchCandidateProjects(ctx, orgId, rangeEnd);
  const candidateProjects = candidateBoardProjects([...projectDocsById.values()], range);
  const candidateProjectIds = candidateProjects.map((p) => p.id);

  const { lineItems, referencedModelIds, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, orgId, candidateProjectIds);
  const { models: modelsForSaleStock, saleLines } = await fetchSaleStockData(ctx, orgId, models, referencedModelIds);
  const { services, assignmentsByServiceId } = await fetchServicesData(ctx, orgId, rangeStart, rangeEnd);
  const { rangedAssignments, availabilityBlocks } = await fetchCrewData(ctx, orgId, rangeStart, rangeEnd);

  await fetchExtraProjects(ctx, orgId, projectDocsById, [
    ...services.map((s) => s.projectId),
    ...rangedAssignments.map((a) => a.projectId),
    ...saleLines.map((li) => li.projectId),
  ]);
  const projectRefById = new Map(
    [...projectDocsById.values()].map((p) => [p.id, { id: p.id, name: p.name, projectNumber: p.projectNumber }]),
  );

  const gear = computeGearShortageBoard(range, candidateProjects, lineItems, models, assets, bulkAssetsForModels);
  const saleStockToProcure = computeSaleStockToProcure(modelsForSaleStock, saleLines, projectRefById);
  const servicesMissingCrew = computeServicesMissingCrew(range, services, assignmentsByServiceId, projectRefById);
  const unconfirmedCrew = computeUnconfirmedCrew(range, rangedAssignments, projectDocsById);
  const crewDoubleBookings = computeCrewDoubleBookings(range, rangedAssignments, availabilityBlocks, projectRefById);

  return { range, gear, saleStockToProcure, servicesMissingCrew, unconfirmedCrew, crewDoubleBookings };
}

/**
 * The Overbookings & Gaps board (WS3 #942) — one org-wide, date-ranged read
 * aggregating six sections: overbooked gear (hard), pencilled collisions, sale
 * stock to procure, services missing crew, unconfirmed crew, crew
 * double-bookings. `requireOrgPermission("project", "read")` — the same gate
 * `/projects` reads use; this is a projects-adjacent risk board, not a new
 * resource. All reads are either REFERENCED-ONLY (bounded to the org projects/
 * models/services/assignments actually relevant to the range) or an
 * organizationId-scoped index range-scan bounded on both ends by
 * [rangeStart, rangeEnd] — see docs/exceptions.md for the one exception
 * (bulkAssets org-wide scan for the sale-stock section, which has no indexed
 * field to range-scan on).
 */
export const bundle = query({
  args: { orgId: v.string(), rangeStart: v.number(), rangeEnd: v.number() },
  handler: async (ctx, { orgId, rangeStart, rangeEnd }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    validateRange(rangeStart, rangeEnd);
    const { range, gear, saleStockToProcure, servicesMissingCrew, unconfirmedCrew, crewDoubleBookings } = await computeBoardBundle(
      ctx,
      orgId,
      rangeStart,
      rangeEnd,
    );
    return {
      range,
      gearHard: gear.hard,
      gearPencilled: gear.pencilled,
      saleStockToProcure,
      servicesMissingCrew,
      unconfirmedCrew,
      crewDoubleBookings,
    };
  },
});

/**
 * Cheap dashboard-chip counts (spec decision, WS3 #942): "hard count / pencilled
 * count / sale-stock-to-procure count" for the `NeedsAttention` chips
 * (`dashboard/page.tsx`), backed by the SAME bounded reads `bundle` uses (not a
 * second, different query) but returning only small numbers — the dashboard
 * shouldn't subscribe to the full board's row-level payload just to show three
 * chip counts. Uses the board's default 30-day horizon; the dashboard doesn't
 * offer a range picker.
 */
export const counts = query({
  args: { orgId: v.string(), rangeStart: v.number(), rangeEnd: v.number() },
  handler: async (ctx, { orgId, rangeStart, rangeEnd }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    validateRange(rangeStart, rangeEnd);
    const { gear, saleStockToProcure } = await computeBoardBundle(ctx, orgId, rangeStart, rangeEnd);
    return {
      hardCount: gear.hard.length,
      pencilledCount: gear.pencilled.length,
      saleStockCount: saleStockToProcure.length,
    };
  },
});

/**
 * Confirm-time gate preview (spec decision, WS3 #942, non-blocking): "if I
 * confirm THIS project right now, how many models would go hard-overbooked,
 * and how much crew is still unconfirmed?" Called from the UI right before a
 * status change into CONFIRMED, to show a warn+confirm dialog — the caller
 * decides whether to proceed regardless of the answer; this query never
 * blocks the write itself (that stays `projectWrites.updateStatusNative`,
 * untouched). `requireOrgPermission("project", "read")` — same read gate as
 * `bundle` above.
 */
export const confirmImpact = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }

    const { start, end } = getProjectWindow(project);
    const emptyImpact = { hardOverbookingModelCount: 0, hardOverbookingQty: 0, unconfirmedCrewCount: 0 };
    if (start == null || end == null) {
      // Dateless project — no window to compare other bookings against, so
      // there's nothing for the gear side of the preview to say; crew can
      // still be checked below.
      const ownAssignments = (
        await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
      ).filter((a) => a.organizationId === orgId);
      return { ...emptyImpact, unconfirmedCrewCount: countUnconfirmedCrewForProject(ownAssignments) };
    }
    const range = { start, end };

    const projectDocsById = await fetchCandidateProjects(ctx, orgId, end);
    projectDocsById.set(project.id, project); // ensure present even if its own window predates any candidate scan bound
    const candidateProjects = candidateBoardProjects([...projectDocsById.values()], range).map((p) =>
      p.id === projectId ? { ...p, status: "CONFIRMED" } : p,
    );
    const candidateProjectIds = candidateProjects.map((p) => p.id);

    const { lineItems, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, orgId, candidateProjectIds);
    const { modelCount, qty } = computeConfirmImpactModels(projectId, range, candidateProjects, lineItems, models, assets, bulkAssetsForModels);

    const ownAssignments = (
      await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
    ).filter((a) => a.organizationId === orgId);

    return {
      hardOverbookingModelCount: modelCount,
      hardOverbookingQty: qty,
      unconfirmedCrewCount: countUnconfirmedCrewForProject(ownAssignments),
    };
  },
});
