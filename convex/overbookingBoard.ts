import { v, ConvexError } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";
import {
  candidateBoardProjects,
  computeGearShortageBoard,
  computeSaleStockToProcure,
  computeServicesMissingCrew,
  computeUnconfirmedCrew,
  computeCrewDoubleBookings,
} from "./lib/overbookingBoard";

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
 * ALL org bulk assets for the sale-stock section — saleStockQuantity has no
 * index (it's a minimal pre-WS11 stub, WS3 #942), so this can't be a targeted
 * range-scan. Org-scoped (not global), same shape as several other "small,
 * org-bounded roster" reads in this codebase (e.g. crewAvailability.ts's
 * plannerData). See docs/exceptions.md R-8.3.3. Also resolves the models any
 * negative-saleStock rows point at that have NO project demand (so `gearModels`
 * — derived from line items — would otherwise miss them).
 */
async function fetchSaleStockData(ctx: QueryCtx, orgId: string, gearModels: Doc<"models">[], gearModelIds: string[]) {
  const allOrgBulkAssets = await ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: org-scoped, saleStockQuantity is unindexed — see docs/exceptions.md R-8.3.3
  const saleStockModelIds = [...new Set(allOrgBulkAssets.filter((b) => (b.saleStockQuantity ?? 0) < 0).map((b) => b.modelId))].filter(
    (mid) => !gearModelIds.includes(mid),
  );
  const saleStockModelDocs = await Promise.all(
    saleStockModelIds.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique()),
  );
  const models = [...gearModels, ...saleStockModelDocs.filter((m): m is NonNullable<typeof m> => !!m && m.organizationId === orgId)];
  return { allOrgBulkAssets, models };
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
    if (rangeEnd < rangeStart) {
      throw new ConvexError("overbookingBoard.bundle: rangeEnd must be >= rangeStart");
    }
    if (rangeEnd - rangeStart > MAX_RANGE_DAYS * 86_400_000) {
      throw new ConvexError(`overbookingBoard.bundle: range exceeds ${MAX_RANGE_DAYS} days`);
    }
    const range = { start: rangeStart, end: rangeEnd };

    const projectDocsById = await fetchCandidateProjects(ctx, orgId, rangeEnd);
    const candidateProjects = candidateBoardProjects([...projectDocsById.values()], range);
    const candidateProjectIds = candidateProjects.map((p) => p.id);

    const { lineItems, referencedModelIds, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, orgId, candidateProjectIds);
    const { allOrgBulkAssets, models: modelsForSaleStock } = await fetchSaleStockData(ctx, orgId, models, referencedModelIds);
    const { services, assignmentsByServiceId } = await fetchServicesData(ctx, orgId, rangeStart, rangeEnd);
    const { rangedAssignments, availabilityBlocks } = await fetchCrewData(ctx, orgId, rangeStart, rangeEnd);

    await fetchExtraProjects(ctx, orgId, projectDocsById, [
      ...services.map((s) => s.projectId),
      ...rangedAssignments.map((a) => a.projectId),
    ]);
    const projectRefById = new Map(
      [...projectDocsById.values()].map((p) => [p.id, { id: p.id, name: p.name, projectNumber: p.projectNumber }]),
    );

    // ─── Aggregate every section via the pure lib functions ───────────────────
    const gear = computeGearShortageBoard(range, candidateProjects, lineItems, models, assets, bulkAssetsForModels);
    const saleStockToProcure = computeSaleStockToProcure(allOrgBulkAssets, modelsForSaleStock);
    const servicesMissingCrew = computeServicesMissingCrew(range, services, assignmentsByServiceId, projectRefById);
    const unconfirmedCrew = computeUnconfirmedCrew(range, rangedAssignments, projectDocsById);
    const crewDoubleBookings = computeCrewDoubleBookings(range, rangedAssignments, availabilityBlocks, projectRefById);

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
