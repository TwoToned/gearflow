"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import type { ActorContext } from "@/lib/actor-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { UserFacingError } from "@/lib/errors";
import { computeStockBreakdown, resolveModelAssetType } from "@/lib/availability";
import { getProjectWindow } from "@/lib/project-window";
import { getModelWithCategoryMap } from "@/lib/model-category-join";
import { getAssetByAssetTag, getAssetsByOrg, getBulkAssetsByIds, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getKitById } from "@/lib/kits-read";
import { getLocationById } from "@/lib/locations-read";

/** Model-accessory detail for the add-form picker (issue #794) — resolved bulk-asset
 *  tag + model name, not just the bare bulkAssetId. */
type ModelAccessoryDetail = {
  id: string;
  bulkAssetId: string;
  quantity: number;
  inclusion: "DEFAULT" | "OPTIONAL";
  assetTag: string;
  modelName: string | null;
};

export async function checkAvailability(
  modelId: string,
  rentalStartDate?: Date | string | null,
  rentalEndDate?: Date | string | null,
  excludeProjectId?: string,
  actor?: ActorContext
) {
  // `actor` (API/MCP path) supplies the org directly; membership + RBAC are
  // already validated upstream (authorizeApiOperation) before this read runs.
  // Without it, resolve the org from the current session, as before.
  const { organizationId } = actor
    ? { organizationId: actor.organizationId }
    : await getOrgContext();

  const hasDates = !!rentalStartDate && !!rentalEndDate;
  const startDate = hasDates ? new Date(rentalStartDate) : null;
  const endDate = hasDates ? new Date(rentalEndDate) : null;

  // ONE round-trip for everything this check needs (was ~6 queries in 3 sequential
  // waves: model+assets+bulks, then lines+projects, then a trailing accessories
  // read). Read backend-local inside a single Convex query; raw docs used below.
  const convex = await getConvexClient();
  const ab = await convex.query(api.availabilityCheck.checkBundle, { modelId, orgId: organizationId });
  const model = ab.model;
  const activeAssets = ab.activeAssets;
  const activeBulkAssets = ab.activeBulkAssets;

  if (!model) {
    return serialize({ totalStock: 0, effectiveStock: 0, booked: 0, available: 0, bookedOnThisProject: 0, unavailable: 0, inMaintenance: 0, lost: 0, conflicts: [] as string[], dateless: !hasDates, hasAccessories: false, accessories: [] as typeof ab.accessories });
  }

  const modelForBreakdown = {
    assetType: resolveModelAssetType(model.assetType, activeBulkAssets.length > 0, activeAssets.length > 0),
    assets: activeAssets.map((a: ConvexAsset) => ({ status: a.status ?? "AVAILABLE" })),
    bulkAssets: activeBulkAssets.map((ba: ConvexBulkAsset) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
  };

  // Find overlapping projects (where the project rental period overlaps with the given dates)
  // Include both regular items AND kit children — they all consume stock
  // Sub-hire items represent third-party stock and are excluded.
  // When no dates: only count bookings on the current project (stock-only check)
  // Line items (this model) + all org projects — both from the bundle above.
  const allOrgLines = ab.lines;
  const allProjects = ab.projects;
  const projectById = new Map(allProjects.map((p) => [p.id, p]));

  const overlappingLineItems: Array<{
    quantity: number;
    project: { id: string; name: string | null; projectNumber: string | null };
  }> = [];
  if (hasDates) {
    const endMs = endDate!.getTime();
    const startMs = startDate!.getTime();
    for (const li of allOrgLines) {
      if (li.modelId !== modelId) continue;
      if (li.status === "CANCELLED") continue;
      if (li.subHireId != null) continue;
      const p = projectById.get(li.projectId);
      if (!p) continue;
      if (p.isTemplate) continue;
      if (["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "")) continue;
      // WS2 (#941) — availability reads the PROJECT window (falls back to rental
      // when unset), not the rental window directly.
      const { start: pStart, end: pEnd } = getProjectWindow(p);
      if (pStart == null || pEnd == null) continue;
      if (pStart > endMs || pEnd < startMs) continue;
      overlappingLineItems.push({
        quantity: li.quantity ?? 0,
        project: { id: p.id, name: p.name ?? null, projectNumber: p.projectNumber ?? null },
      });
    }
  } else if (excludeProjectId) {
    for (const li of allOrgLines) {
      if (li.modelId !== modelId) continue;
      if (li.status === "CANCELLED") continue;
      if (li.subHireId != null) continue;
      if (li.projectId !== excludeProjectId) continue;
      const p = projectById.get(li.projectId);
      overlappingLineItems.push({
        quantity: li.quantity ?? 0,
        project: { id: li.projectId, name: p?.name ?? null, projectNumber: p?.projectNumber ?? null },
      });
    }
  }

  const bookedOnThisProject = excludeProjectId
    ? overlappingLineItems
        .filter((li) => li.project.id === excludeProjectId)
        .reduce((sum, li) => sum + li.quantity, 0)
    : 0;

  const conflicts = hasDates
    ? [
        ...new Map(
          overlappingLineItems
            .filter((li) => !excludeProjectId || li.project.id !== excludeProjectId)
            .map((li) => [
              li.project.id,
              `${li.project.projectNumber} - ${li.project.name}`,
            ])
        ).values(),
      ]
    : [];

  const booked = overlappingLineItems.reduce(
    (sum, li) => sum + li.quantity,
    0
  );

  const bulkAccessoryCount = ab.bulkAccessoryCount;

  if (modelForBreakdown.assetType === "SERIALIZED") {
    const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(modelForBreakdown);
    const inMaintenance = modelForBreakdown.assets.filter((a: { status: string }) => a.status === "IN_MAINTENANCE").length;
    const lost = modelForBreakdown.assets.filter((a: { status: string }) => a.status === "LOST").length;
    const available = Math.max(0, effectiveStock - booked);

    return serialize({
      totalStock, effectiveStock, booked, available, bookedOnThisProject,
      unavailable, inMaintenance, lost, conflicts, dateless: !hasDates, hasAccessories: bulkAccessoryCount > 0,
      accessories: ab.accessories,
    });
  } else {
    // BULK: sum up total quantity across all bulk assets
    const totalStock = modelForBreakdown.bulkAssets.reduce(
      (sum: number, ba: { totalQuantity: number }) => sum + ba.totalQuantity,
      0
    );
    const available = Math.max(0, totalStock - booked);

    return serialize({
      totalStock, effectiveStock: totalStock, booked, available, bookedOnThisProject,
      unavailable: 0, inMaintenance: 0, lost: 0, conflicts, dateless: !hasDates, hasAccessories: bulkAccessoryCount > 0,
      accessories: ab.accessories,
    });
  }
}

export async function lookupAssetByTag(
  assetTag: string,
  rentalStartDate?: Date | string,
  rentalEndDate?: Date | string,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  const convexTagAsset = await getAssetByAssetTag(organizationId, assetTag);

  if (!convexTagAsset) {
    return serialize({ found: false as const, asset: null, available: false, conflictsWith: null, hasAccessories: false, accessories: [] as ModelAccessoryDetail[] });
  }

  const convexTagLocation = convexTagAsset.locationId ? await getLocationById(convexTagAsset.locationId) : null;
  const asset = { ...convexTagAsset, location: convexTagLocation ?? null };

  // Model lives in Convex — fetch with category for the caller.
  const modelWithCategoryMap = await getModelWithCategoryMap(organizationId);
  const model = asset.modelId ? (modelWithCategoryMap.get(asset.modelId) ?? null) : null;

  // Check if this specific asset is booked in any overlapping project
  let available = true;
  let conflictsWith: string | null = null;

  if (rentalStartDate && rentalEndDate) {
    const startDate = new Date(rentalStartDate);
    const endDate = new Date(rentalEndDate);

    const lookupAllProjects = await getProjectsByOrg(organizationId);
    const lookupConflictProjectIds = lookupAllProjects
      .filter(
        (p) =>
          !p.isTemplate &&
          !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
          p.rentalStartDate != null &&
          p.rentalEndDate != null &&
          (p.rentalStartDate as number) <= endDate.getTime() &&
          (p.rentalEndDate as number) >= startDate.getTime() &&
          (excludeProjectId ? p.id !== excludeProjectId : true),
      )
      .map((p) => p.id);
    const lookupProjectMap = new Map(lookupAllProjects.map((p) => [p.id, p]));
    const lookupConflictSet = new Set(lookupConflictProjectIds);

    const assetLines = await (await getConvexClient()).query(api.projectLineItems.listByAssetId, { assetId: asset.id, orgId: organizationId });
    const overlapping = assetLines.find(
      (li) => li.status !== "CANCELLED" && lookupConflictSet.has(li.projectId),
    );

    if (overlapping) {
      available = false;
      const overlapProject = lookupProjectMap.get(overlapping.projectId);
      conflictsWith = overlapProject
        ? `${overlapProject.projectNumber} - ${overlapProject.name}`
        : overlapping.projectId;
    }
  }

  // Only block truly unavailable assets — checked out/reserved assets can be added to future projects
  if (asset.status === "RETIRED" || asset.status === "LOST") {
    available = false;
    if (!conflictsWith) {
      conflictsWith = `Asset status: ${asset.status.replace("_", " ")}`;
    }
  }

  // Serialized children + assetBulkChild + modelBulkAccessory all live in Convex
  // now (Phase B). (The old prisma.assetBulkChild.count read a frozen table —
  // DEDICATED bulk accessories added after cutover were invisible to the
  // hasAccessories flag.) assetBulkChildren/modelBulkAccessories are scoped via
  // their by_parentAssetId/by_modelId indexes; the serialized-children check still
  // goes through getAssetsByOrg (org-wide) — assets.ts has no by_parentAssetId
  // caller-facing query yet, tracked separately (R-9.8, #901).
  const [orgAssetsForChildren, parentBulkChildren, modelBulksForCount] = await Promise.all([
    getAssetsByOrg(organizationId),
    (await getConvexClient()).query(api.assetBulkChildren.listByParentAssetId, { parentAssetId: asset.id, orgId: organizationId }),
    asset.modelId
      ? (await getConvexClient()).query(api.modelBulkAccessories.listByModelId, { modelId: asset.modelId, organizationId })
      : Promise.resolve([]),
  ]);
  const modelBulksCount = modelBulksForCount.length;
  const childAssetCount = orgAssetsForChildren.filter((a) => a.parentAssetId === asset.id).length;
  const childBulkCount = parentBulkChildren.length;
  const hasAccessories = childAssetCount > 0 || childBulkCount > 0 || modelBulksCount > 0;

  // Resolved model-accessory detail for the add-form picker (issue #794) — same
  // tag/model-name shape checkAvailability's `accessories` returns, so a by-asset-tag
  // add gets the same picker as a by-model add (design decision #1).
  const accessoryBulkAssets = await getBulkAssetsByIds(organizationId, modelBulksForCount.map((a) => a.bulkAssetId));
  const bulkAssetById = new Map(accessoryBulkAssets.map((ba) => [ba.id, ba]));
  const accessories: ModelAccessoryDetail[] = modelBulksForCount.map((a) => {
    const ba = bulkAssetById.get(a.bulkAssetId);
    const baModel = ba?.modelId ? (modelWithCategoryMap.get(ba.modelId) ?? null) : null;
    return {
      id: a.id,
      bulkAssetId: a.bulkAssetId,
      quantity: a.quantity,
      inclusion: (a.inclusion ?? "DEFAULT") as "DEFAULT" | "OPTIONAL",
      assetTag: ba?.assetTag ?? a.bulkAssetId,
      modelName: baModel?.name ?? null,
    };
  });

  return serialize({ found: true as const, asset: { ...asset, model }, available, conflictsWith, hasAccessories, accessories });
}

export async function checkKitAvailability(
  kitId: string,
  rentalStartDate: Date | string,
  rentalEndDate: Date | string,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  const startDate = new Date(rentalStartDate);
  const endDate = new Date(rentalEndDate);

  const kitAvailConvexKit = await getKitById(kitId);

  if (!kitAvailConvexKit || kitAvailConvexKit.organizationId !== organizationId) {
    return serialize({ available: false, conflictsWith: "Kit not found" });
  }

  // Only block truly unavailable kits — checked out kits can still be added to future projects
  if (kitAvailConvexKit.status === "IN_MAINTENANCE" || kitAvailConvexKit.status === "INCOMPLETE") {
    return serialize({ available: false, conflictsWith: `Kit status: ${(kitAvailConvexKit.status as string).replace("_", " ")}` });
  }

  const kitAvailAllProjects = await getProjectsByOrg(organizationId);
  const kitAvailConflictProjectIds = kitAvailAllProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
        p.rentalStartDate != null &&
        p.rentalEndDate != null &&
        (p.rentalStartDate as number) <= endDate.getTime() &&
        (p.rentalEndDate as number) >= startDate.getTime() &&
        (excludeProjectId ? p.id !== excludeProjectId : true),
    )
    .map((p) => p.id);
  const kitAvailProjectMap = new Map(kitAvailAllProjects.map((p) => [p.id, p]));
  const kitAvailConflictSet = new Set(kitAvailConflictProjectIds);

  const kitAvailOrgLines = await (await getConvexClient()).query(api.projectLineItems.listByKitId, { kitId, orgId: organizationId });
  const conflict = kitAvailOrgLines.find(
    (li) =>
      li.kitId === kitId &&
      !li.isKitChild &&
      li.status !== "CANCELLED" &&
      kitAvailConflictSet.has(li.projectId),
  );

  if (conflict) {
    const conflictKitAvailProject = kitAvailProjectMap.get(conflict.projectId);
    return serialize({
      available: false,
      conflictsWith: conflictKitAvailProject
        ? `${conflictKitAvailProject.projectNumber} - ${conflictKitAvailProject.name}`
        : conflict.projectId,
    });
  }

  return serialize({ available: true, conflictsWith: null });
}

// --- Internal helpers ---

/**
 * Recalculate all project financial totals from source data.
 *
 *   equipmentRevenue = SUM(group.price × group.quantity)  [groups]
 *                    + SUM(standalone.lineTotal)           [ungrouped items]
 *   serviceCostTotal = SUM(service.costTotal) WHERE status != CANCELLED
 *                      (a service's costTotal is itself auto-rolled up from its own
 *                      crewAssignments' estimatedCost once it has crew — see
 *                      convex/lib/serviceCost.ts recalcServiceCostFromCrew)
 *   labourCostTotal  = SUM(assignment.estimatedCost) WHERE assignment.serviceId IS NULL
 *                      (service-linked assignments are already counted via
 *                      serviceCostTotal above — see convex/lib/recalc.ts)
 *   subtotal         = equipmentRevenue
 *   discountAmount   = subtotal × discountPercent / 100
 *   taxableAmount    = subtotal - discountAmount
 *   taxRate          = project.taxRate ?? org.defaultTaxRate ?? 10
 *   taxAmount        = taxableAmount × taxRate / 100
 *   total            = taxableAmount + taxAmount
 *   subHireCostTotal = SUM(subHire.totalCost) WHERE status NOT IN (CANCELLED, DRAFT)
 *   margin           = total - (serviceCostTotal + labourCostTotal + subHireCostTotal)
 */
export async function recalculateProjectTotals(projectId: string) {
  // Project header lives in Convex — read discountPercent/taxRate/organizationId
  // off the mirror (both money fields are wrapped in Number() below, so the
  // Convex-number vs Prisma-Decimal shape difference is a no-op).
  const project = await getProjectById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const orgId = project.organizationId;
  const convex = await getConvexClient();

  // One backend-local recalc mutation (the 6–12s write tail collapsed to one
  // round-trip). orgDefaultTaxRate is resolved inside the mutation from orgSettings
  // (source of truth) — the client no longer supplies it (a spoofable, money-affecting
  // value). recalc.ts is parity-tested (convex/recalc.test.ts).
  await convex.mutation(api.lineItemWrites.recalcNative, {
    projectId,
    orgId,
    now: Date.now(),
  });
}

/**
 * Availability for MANY models in one call.
 *
 * `checkAvailability` answers for a single model, so an agent sizing up ten models
 * paid ten round trips. This runs the same per-model check server-side and returns
 * a keyed result, collapsing the agent's cost to one request. Each model's answer
 * is byte-identical to calling `checkAvailability` directly — this is a fan-out,
 * not a second implementation of the overbooking maths.
 *
 * Reads only; capped so a caller can't fan out unboundedly.
 */
export async function checkAvailabilityBatch(
  modelIds: string[],
  rentalStartDate?: Date | string | null,
  rentalEndDate?: Date | string | null,
  excludeProjectId?: string,
  actor?: ActorContext
) {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    throw new UserFacingError({
      code: "NO_MODELS",
      title: "No models given",
      message: "Provide at least one modelId.",
      field: "modelIds",
    });
  }

  const unique = [...new Set(modelIds)];
  const MAX = 100;
  if (unique.length > MAX) {
    throw new UserFacingError({
      code: "TOO_MANY_MODELS",
      title: "Too many models",
      message: `Received ${unique.length} models; the maximum per call is ${MAX}.`,
      hint: "Split the request into batches.",
      field: "modelIds",
    });
  }

  // Bounded concurrency: each check is its own Convex query, and firing 100 at
  // once would spike the deployment for no latency gain.
  const CONCURRENCY = 8;
  const results: Record<string, Awaited<ReturnType<typeof checkAvailability>>> = {};

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const chunk = unique.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      chunk.map((modelId) =>
        checkAvailability(modelId, rentalStartDate, rentalEndDate, excludeProjectId, actor)
      )
    );
    chunk.forEach((modelId, idx) => {
      results[modelId] = settled[idx];
    });
  }

  return serialize({ requested: unique.length, availability: results });
}
