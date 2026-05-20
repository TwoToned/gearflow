/**
 * Reservation conflict detection + swap resolution (Wave 3).
 *
 * The "asset already booked" error on addLineItem is a hard stop. This
 * module turns it into something solvable: surface every double-booked
 * asset on a project, and let the operator swap a conflicting line item
 * onto a different free asset of the same model.
 *
 * A conflict, precisely:
 *   - line item LI on project P has assetId set
 *   - the same asset appears on a line item LI2 on a *different* project P2
 *   - P2 is in a live status (not CANCELLED / RETURNED / COMPLETED / INVOICED)
 *   - P and P2 rental windows overlap
 *   - both line items are non-CANCELLED
 *
 * Dateless projects can't conflict (no window to overlap) — skipped.
 *
 * Lives outside `"use server"` so integration tests drive it directly.
 */

import { prisma } from "@/lib/prisma";

/**
 * Project statuses where the booking is released — excluded from conflict
 * checks. Everything else (ENQUIRY → ON_SITE) still holds the asset.
 * Mirrors the exclusion list in addLineItem's conflict guard.
 */
const DEAD_PROJECT_STATUSES = ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] as const;

export interface ReservationConflict {
  lineItemId: string;
  assetId: string;
  assetTag: string;
  modelId: string;
  modelName: string;
  /** The other project this asset is also booked on. */
  conflictingProject: {
    id: string;
    projectNumber: string;
    name: string;
    status: string;
    rentalStartDate: Date | null;
    rentalEndDate: Date | null;
  };
  conflictingLineItemId: string;
}

/**
 * Every double-booked asset on the given project. Empty array when the
 * project has no rental window or no conflicts.
 */
export async function findProjectConflictsCore(
  projectId: string,
  organizationId: string,
): Promise<ReservationConflict[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    select: { rentalStartDate: true, rentalEndDate: true },
  });
  if (!project?.rentalStartDate || !project.rentalEndDate) return [];

  // Asset-bearing line items on this project.
  const lineItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      assetId: { not: null },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      assetId: true,
      modelId: true,
      asset: { select: { assetTag: true, model: { select: { name: true } } } },
    },
  });
  if (lineItems.length === 0) return [];

  const assetIds = lineItems
    .map((li) => li.assetId)
    .filter((id): id is string => id != null);

  // Other-project line items that book any of these assets in an
  // overlapping window.
  const overlaps = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      assetId: { in: assetIds },
      status: { not: "CANCELLED" },
      projectId: { not: projectId },
      project: {
        isTemplate: false,
        status: { notIn: [...DEAD_PROJECT_STATUSES] },
        rentalStartDate: { lte: project.rentalEndDate },
        rentalEndDate: { gte: project.rentalStartDate },
      },
    },
    select: {
      id: true,
      assetId: true,
      project: {
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
          rentalStartDate: true,
          rentalEndDate: true,
        },
      },
    },
  });

  // Index overlaps by assetId for the join.
  const overlapByAsset = new Map<string, (typeof overlaps)[number]>();
  for (const o of overlaps) {
    if (o.assetId && !overlapByAsset.has(o.assetId)) {
      overlapByAsset.set(o.assetId, o);
    }
  }

  const conflicts: ReservationConflict[] = [];
  for (const li of lineItems) {
    if (!li.assetId) continue;
    const overlap = overlapByAsset.get(li.assetId);
    if (!overlap) continue;
    conflicts.push({
      lineItemId: li.id,
      assetId: li.assetId,
      assetTag: li.asset?.assetTag ?? "—",
      modelId: li.modelId ?? "",
      modelName: li.asset?.model?.name ?? "—",
      conflictingProject: overlap.project,
      conflictingLineItemId: overlap.id,
    });
  }
  return conflicts;
}

export interface SwapCandidate {
  assetId: string;
  assetTag: string;
  serialNumber: string | null;
  customName: string | null;
  status: string;
}

/**
 * Free same-model assets that the conflicting line item could swap to.
 * "Free" = not booked on any live overlapping project in this project's
 * rental window, not in a kit, not RETIRED / LOST.
 */
export async function findSwapCandidatesCore(
  lineItemId: string,
  organizationId: string,
): Promise<SwapCandidate[]> {
  const lineItem = await prisma.projectLineItem.findUnique({
    where: { id: lineItemId, organizationId },
    select: {
      id: true,
      modelId: true,
      assetId: true,
      project: {
        select: { id: true, rentalStartDate: true, rentalEndDate: true },
      },
    },
  });
  if (!lineItem?.modelId) return [];
  if (!lineItem.project.rentalStartDate || !lineItem.project.rentalEndDate) {
    return [];
  }

  const { rentalStartDate, rentalEndDate } = lineItem.project;

  // All bookable assets of this model.
  const assets = await prisma.asset.findMany({
    where: {
      organizationId,
      modelId: lineItem.modelId,
      isActive: true,
      kitId: null,
      status: { notIn: ["RETIRED", "LOST"] },
    },
    select: {
      id: true,
      assetTag: true,
      serialNumber: true,
      customName: true,
      status: true,
    },
  });
  if (assets.length === 0) return [];

  // Which of those are booked in an overlapping live project?
  const booked = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      assetId: { in: assets.map((a) => a.id) },
      status: { not: "CANCELLED" },
      id: { not: lineItemId },
      project: {
        isTemplate: false,
        status: { notIn: [...DEAD_PROJECT_STATUSES] },
        rentalStartDate: { lte: rentalEndDate },
        rentalEndDate: { gte: rentalStartDate },
      },
    },
    select: { assetId: true },
  });
  const bookedIds = new Set(booked.map((b) => b.assetId));

  return assets
    .filter((a) => a.id !== lineItem.assetId && !bookedIds.has(a.id))
    .map((a) => ({
      assetId: a.id,
      assetTag: a.assetTag,
      serialNumber: a.serialNumber,
      customName: a.customName,
      status: a.status,
    }));
}

/**
 * Reassign a line item to a different asset. Re-checks that the target
 * asset is the same model and is genuinely free in the project window —
 * the candidate list could be stale by the time the operator clicks.
 *
 * Returns the updated line item id. Throws a plain Error on validation
 * failure; the server-action wrapper translates to UserFacingError.
 */
export async function swapLineItemAssetCore(
  lineItemId: string,
  newAssetId: string,
  organizationId: string,
): Promise<{ lineItemId: string; assetId: string }> {
  const lineItem = await prisma.projectLineItem.findUnique({
    where: { id: lineItemId, organizationId },
    select: {
      id: true,
      modelId: true,
      project: {
        select: { id: true, rentalStartDate: true, rentalEndDate: true },
      },
    },
  });
  if (!lineItem) throw new Error("Line item not found");

  const newAsset = await prisma.asset.findUnique({
    where: { id: newAssetId, organizationId },
    select: { id: true, modelId: true, status: true, kitId: true, assetTag: true },
  });
  if (!newAsset) throw new Error("Target asset not found");

  if (lineItem.modelId && newAsset.modelId !== lineItem.modelId) {
    throw new Error("Target asset is a different model");
  }
  if (newAsset.kitId) {
    throw new Error(`Asset ${newAsset.assetTag} is part of a kit and can't be assigned directly`);
  }
  if (newAsset.status === "RETIRED" || newAsset.status === "LOST") {
    throw new Error(`Asset ${newAsset.assetTag} is ${newAsset.status.toLowerCase()}`);
  }

  // Re-verify the target asset is free in the window.
  if (lineItem.project.rentalStartDate && lineItem.project.rentalEndDate) {
    const conflict = await prisma.projectLineItem.findFirst({
      where: {
        organizationId,
        assetId: newAssetId,
        status: { not: "CANCELLED" },
        id: { not: lineItemId },
        project: {
          isTemplate: false,
          status: { notIn: [...DEAD_PROJECT_STATUSES] },
          rentalStartDate: { lte: lineItem.project.rentalEndDate },
          rentalEndDate: { gte: lineItem.project.rentalStartDate },
        },
      },
      select: { project: { select: { projectNumber: true } } },
    });
    if (conflict) {
      throw new Error(
        `Asset ${newAsset.assetTag} was just booked on ${conflict.project.projectNumber}. Pick another.`,
      );
    }
  }

  await prisma.projectLineItem.update({
    where: { id: lineItemId, organizationId },
    data: { assetId: newAssetId },
  });

  return { lineItemId, assetId: newAssetId };
}

export { DEAD_PROJECT_STATUSES };
