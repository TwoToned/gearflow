import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadDoc } from "./lib/auth";
import {
  overlappingProjectIds,
  collectHereAssetRefs,
  buildOverlapByAsset,
  toConflictProject,
  filterSwapCandidateAssets,
  collectBookedAssetIds,
  type CLine,
  type CUnit,
  type CProject,
  type CAsset,
} from "./lib/reservationConflicts";

/**
 * Reservation-conflict DETECTION reads (Phase 3 browser-direct — replaces the
 * getProjectConflicts/getSwapCandidates server actions in
 * src/server/reservation-conflicts.ts). Both derive + authorize the org from the fetched
 * anchor row (project / line item) via `requireOrgReadDoc` — so the browser passes only
 * the entity id, never a client-supplied orgId. These are ONE-SHOT reads (the conflicts
 * banner has no liveness need — Appendix B), never a reactive subscription.
 *
 * R-8.3.3/R-9.8: this used to `.collect()` the ENTIRE org's projectLineItems / units /
 * assets / projects / models on every conflict check — unbounded and growing with the
 * org's history, not just its live bookings. Every read below is now scoped by an
 * indexed key instead of `by_organizationId`:
 *   - "here" (what the anchor project/line already holds) is read via `by_projectId` /
 *     `by_lineItemId` — bounded to that ONE project's own rows, not the org's.
 *   - overlap candidates are range-scanned via `by_organizationId_rentalStartDate`
 *     (rentalStartDate <= endMs is necessary for overlap) — the same bounded pattern
 *     `projectLineItems.swapLineItemAsset`'s atomic re-check already uses — instead of
 *     every project the org has ever run.
 *   - booking history for a conflict check is read via `by_assetId` for the SPECIFIC
 *     assets involved (a handful) — not the org's whole line-item/unit tables.
 * The pure conflict-math helpers (overlappingProjectIds, buildOverlapByAsset, etc.) are
 * unchanged — only what gets fetched into them is now bounded.
 */

/** A project's own line items + their units — bounded to that project, not the org. */
async function loadProjectLines(ctx: QueryCtx, projectId: string) {
  const lineItems = (await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect()) as CLine[];
  const units = (
    await Promise.all(
      lineItems.map((l) =>
        ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", l.id)).collect(),
      ),
    )
  ).flat() as CUnit[];
  return { lineItems, units };
}

/** Asset + model docs for a specific id set, keyed for O(1) lookup — bounded to those ids. */
async function loadAssetsAndModels(ctx: QueryCtx, assetIds: Iterable<string>, extraModelIds: Iterable<string>) {
  const assets = (
    await Promise.all(
      [...new Set(assetIds)].map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    )
  ).filter((a): a is NonNullable<typeof a> => a != null) as CAsset[];
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  const modelIds = new Set(extraModelIds);
  for (const a of assets) if (a.modelId) modelIds.add(a.modelId);
  const models = await Promise.all(
    [...modelIds].map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );
  const modelMap = new Map(
    models.filter((m): m is NonNullable<typeof m> => m != null).map((m) => [m.id, { name: m.name }]),
  );
  return { assetMap, modelMap };
}

/**
 * Org projects whose window COULD overlap `[?, endMs]` — range-scanned by
 * rentalStartDate (an overlap requires rentalStartDate <= endMs) instead of collecting
 * the whole org's projects table. Dateless/future-only projects are filtered out (or
 * kept, harmlessly) by `overlappingProjectIds`'s own null/window check below.
 */
async function loadOverlapCandidateProjects(ctx: QueryCtx, orgId: string, endMs: number) {
  const projects: CProject[] = [];
  for await (const p of ctx.db
    .query("projects")
    .withIndex("by_organizationId_rentalStartDate", (q) => q.eq("organizationId", orgId).lte("rentalStartDate", endMs))) {
    projects.push(p as CProject);
  }
  return projects;
}

/**
 * Booking history for a SPECIFIC set of asset ids: every line item that directly books
 * one of them (`by_assetId`), every unit that books one of them (`by_assetId`), plus the
 * parent line item of each such unit (needed for the unit's status/projectId) — bounded
 * to those assets' own booking history, not an org-wide collect.
 */
async function loadAssetBookings(ctx: QueryCtx, assetIds: Iterable<string>) {
  const ids = [...new Set(assetIds)];
  const [lineHits, unitHits] = await Promise.all([
    Promise.all(
      ids.map((id) => ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", id)).collect()),
    ),
    Promise.all(
      ids.map((id) =>
        ctx.db.query("projectLineItemUnits").withIndex("by_assetId", (q) => q.eq("assetId", id)).collect(),
      ),
    ),
  ]);
  const lineItems = lineHits.flat() as CLine[];
  const units = unitHits.flat() as CUnit[];

  const knownLineIds = new Set(lineItems.map((l) => l.id));
  const missingParentIds = [...new Set(units.map((u) => u.lineItemId).filter((id) => !knownLineIds.has(id)))];
  const parents = await Promise.all(
    missingParentIds.map((id) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );
  for (const p of parents) if (p) lineItems.push(p as CLine);

  return { lineItems, units };
}

/** Every double-booked asset on the project. Empty when it has no window or no conflicts. */
export const projectConflicts = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    await requireOrgReadDoc(ctx, project); // authorizes + confirms the project is in the caller's org
    if (!project) return [];
    const startMs = project.rentalStartDate ?? null;
    const endMs = project.rentalEndDate ?? null;
    if (startMs == null || endMs == null) return [];

    const orgId = project.organizationId;

    const { lineItems: hereLines, units: hereUnits } = await loadProjectLines(ctx, projectId);
    const hereAssetIds = new Set<string>();
    for (const l of hereLines) if (l.assetId) hereAssetIds.add(l.assetId);
    for (const u of hereUnits) if (u.assetId) hereAssetIds.add(u.assetId);
    if (hereAssetIds.size === 0) return [];

    const hereModelIds = new Set<string>();
    for (const l of hereLines) if (l.modelId) hereModelIds.add(l.modelId);
    const { assetMap, modelMap } = await loadAssetsAndModels(ctx, hereAssetIds, hereModelIds);

    const here = collectHereAssetRefs(projectId, hereLines, hereUnits, assetMap, modelMap);
    if (here.length === 0) return [];

    const assetIds = new Set(here.map((r) => r.assetId));
    const candidateProjects = await loadOverlapCandidateProjects(ctx, orgId, endMs);
    const conflictProjectIds = overlappingProjectIds(candidateProjects, startMs, endMs, projectId);
    if (conflictProjectIds.size === 0) return [];

    const { lineItems: bookingLines, units: bookingUnits } = await loadAssetBookings(ctx, assetIds);
    const overlapByAsset = buildOverlapByAsset(assetIds, conflictProjectIds, bookingLines, bookingUnits);
    if (overlapByAsset.size === 0) return [];

    const projectMap = new Map(candidateProjects.map((p) => [p.id, p]));

    const conflicts = [];
    const seen = new Set<string>();
    for (const r of here) {
      const overlap = overlapByAsset.get(r.assetId);
      if (!overlap) continue;
      const conflictProject = projectMap.get(overlap.projectId);
      if (!conflictProject) continue;
      const key = `${r.lineItemId}:${r.assetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        lineItemId: r.lineItemId,
        assetId: r.assetId,
        assetTag: r.assetTag,
        modelId: r.modelId ?? "",
        modelName: r.modelName,
        conflictingProject: toConflictProject(conflictProject),
        conflictingLineItemId: overlap.id,
      });
    }
    return conflicts;
  },
});

/** Free same-model assets the conflicting line item could swap to. */
export const swapCandidates = query({
  args: { lineItemId: v.string() },
  handler: async (ctx, { lineItemId }) => {
    const lineItem = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
    await requireOrgReadDoc(ctx, lineItem); // authorizes + confirms the line item is in the caller's org
    if (!lineItem || !lineItem.modelId) return [];

    const orgId = lineItem.organizationId;
    const lineItemProject = await ctx.db
      .query("projects")
      .withIndex("by_cuid", (q) => q.eq("id", lineItem.projectId))
      .first();
    if (!lineItemProject?.rentalStartDate || !lineItemProject.rentalEndDate) return [];
    const startMs = lineItemProject.rentalStartDate;
    const endMs = lineItemProject.rentalEndDate;

    // Same-model assets only, via by_modelId — bounded to that model's fleet, not the
    // org's whole assets table. modelId is a global cuid (not org-scoped by the index),
    // so cross-tenant-check every hit against the caller's org (CLAUDE.md by_cuid/
    // by_modelId note).
    const modelAssets = await ctx.db
      .query("assets")
      .withIndex("by_modelId", (q) => q.eq("modelId", lineItem.modelId!))
      .collect();
    const orgModelAssets = modelAssets.filter((a) => a.organizationId === orgId) as CAsset[];
    const assets = filterSwapCandidateAssets(orgModelAssets, lineItem.modelId);
    if (assets.length === 0) return [];

    const candidateAssetIds = new Set(assets.map((a) => a.id));
    const candidateProjects = await loadOverlapCandidateProjects(ctx, orgId, endMs);
    const conflictProjectIds = overlappingProjectIds(candidateProjects, startMs, endMs, "");

    let bookedIds = new Set<string>();
    if (conflictProjectIds.size > 0) {
      const { lineItems, units } = await loadAssetBookings(ctx, candidateAssetIds);
      bookedIds = collectBookedAssetIds(candidateAssetIds, conflictProjectIds, lineItemId, lineItems, units);
    }

    return assets
      .filter((a) => a.id !== lineItem.assetId && !bookedIds.has(a.id))
      .map((a) => ({
        assetId: a.id,
        assetTag: a.assetTag,
        serialNumber: a.serialNumber ?? null,
        customName: a.customName ?? null,
        status: a.status ?? "",
      }));
  },
});
