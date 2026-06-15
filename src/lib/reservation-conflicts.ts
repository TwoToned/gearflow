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
import { syncLineItemsToConvex } from "@/lib/line-item-mirror";
import { getModelMap } from "@/lib/models-read";

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

  const projectSelect = {
    id: true,
    projectNumber: true,
    name: true,
    status: true,
    rentalStartDate: true,
    rentalEndDate: true,
  } as const;

  // This project's asset assignments — from legacy line.assetId rows AND
  // from ProjectLineItemUnit rows (the fulfillment model). Deployed assets
  // now live on units, so both sources must be checked.
  const [assetLines, assetUnits, modelMap] = await Promise.all([
    prisma.projectLineItem.findMany({
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
        asset: { select: { assetTag: true } },
      },
    }),
    prisma.projectLineItemUnit.findMany({
      where: {
        organizationId,
        assetId: { not: null },
        status: { not: "RETURNED" },
        lineItem: { projectId, status: { not: "CANCELLED" } },
      },
      select: {
        lineItemId: true,
        assetId: true,
        asset: {
          select: {
            assetTag: true,
            modelId: true,
          },
        },
      },
    }),
    getModelMap(organizationId),
  ]);

  interface AssetRef {
    lineItemId: string;
    assetId: string;
    modelId: string | null;
    assetTag: string;
    modelName: string;
  }
  const here: AssetRef[] = [
    ...assetLines
      .filter((l) => l.assetId)
      .map((l) => ({
        lineItemId: l.id,
        assetId: l.assetId as string,
        modelId: l.modelId,
        assetTag: l.asset?.assetTag ?? "—",
        modelName: l.modelId ? (modelMap.get(l.modelId)?.name ?? "—") : "—",
      })),
    ...assetUnits
      .filter((u) => u.assetId)
      .map((u) => ({
        lineItemId: u.lineItemId,
        assetId: u.assetId as string,
        modelId: u.asset?.modelId ?? null,
        assetTag: u.asset?.assetTag ?? "—",
        modelName: u.asset?.modelId ? (modelMap.get(u.asset.modelId)?.name ?? "—") : "—",
      })),
  ];
  if (here.length === 0) return [];

  const assetIds = [...new Set(here.map((r) => r.assetId))];
  const projectWindow = {
    isTemplate: false,
    status: { notIn: [...DEAD_PROJECT_STATUSES] },
    rentalStartDate: { lte: project.rentalEndDate },
    rentalEndDate: { gte: project.rentalStartDate },
  };

  // Overlapping other-project bookings of those assets — both tables.
  const [overlapLines, overlapUnits] = await Promise.all([
    prisma.projectLineItem.findMany({
      where: {
        organizationId,
        assetId: { in: assetIds },
        status: { not: "CANCELLED" },
        projectId: { not: projectId },
        project: projectWindow,
      },
      select: { id: true, assetId: true, project: { select: projectSelect } },
    }),
    prisma.projectLineItemUnit.findMany({
      where: {
        organizationId,
        assetId: { in: assetIds },
        status: { not: "RETURNED" },
        lineItem: {
          projectId: { not: projectId },
          status: { not: "CANCELLED" },
          project: projectWindow,
        },
      },
      select: {
        lineItemId: true,
        assetId: true,
        lineItem: { select: { project: { select: projectSelect } } },
      },
    }),
  ]);

  const overlapByAsset = new Map<
    string,
    { id: string; project: (typeof overlapLines)[number]["project"] }
  >();
  for (const o of overlapLines) {
    if (o.assetId && !overlapByAsset.has(o.assetId)) {
      overlapByAsset.set(o.assetId, { id: o.id, project: o.project });
    }
  }
  for (const o of overlapUnits) {
    if (o.assetId && !overlapByAsset.has(o.assetId)) {
      overlapByAsset.set(o.assetId, {
        id: o.lineItemId,
        project: o.lineItem.project,
      });
    }
  }

  const conflicts: ReservationConflict[] = [];
  const seen = new Set<string>();
  for (const r of here) {
    const overlap = overlapByAsset.get(r.assetId);
    if (!overlap) continue;
    const key = `${r.lineItemId}:${r.assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({
      lineItemId: r.lineItemId,
      assetId: r.assetId,
      assetTag: r.assetTag,
      modelId: r.modelId ?? "",
      modelName: r.modelName,
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

  // Which of those are booked in an overlapping live project? Bookings
  // live on legacy line.assetId rows AND on ProjectLineItemUnit rows
  // (the fulfillment model) — both tables must be checked or a swap
  // candidate that's actually deployed via a unit looks free.
  const candidateAssetIds = assets.map((a) => a.id);
  const projectWindow = {
    isTemplate: false,
    status: { notIn: [...DEAD_PROJECT_STATUSES] },
    rentalStartDate: { lte: rentalEndDate },
    rentalEndDate: { gte: rentalStartDate },
  };
  const [bookedLines, bookedUnits] = await Promise.all([
    prisma.projectLineItem.findMany({
      where: {
        organizationId,
        assetId: { in: candidateAssetIds },
        status: { not: "CANCELLED" },
        id: { not: lineItemId },
        project: projectWindow,
      },
      select: { assetId: true },
    }),
    prisma.projectLineItemUnit.findMany({
      where: {
        organizationId,
        assetId: { in: candidateAssetIds },
        status: { not: "RETURNED" },
        lineItemId: { not: lineItemId },
        lineItem: {
          status: { not: "CANCELLED" },
          project: projectWindow,
        },
      },
      select: { assetId: true },
    }),
  ]);
  const bookedIds = new Set<string>();
  for (const b of bookedLines) if (b.assetId) bookedIds.add(b.assetId);
  for (const b of bookedUnits) if (b.assetId) bookedIds.add(b.assetId);

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

  // Re-verify free-in-window AND reassign inside one transaction. Without
  // the shared transaction the check + update is a TOCTOU window: two
  // operators swapping onto the same free asset both pass the check, both
  // write, and the asset ends up double-booked — re-introducing exactly
  // the conflict this feature exists to resolve.
  const { rentalStartDate, rentalEndDate } = lineItem.project;
  await prisma.$transaction(async (tx) => {
    if (rentalStartDate && rentalEndDate) {
      const projectWindow = {
        isTemplate: false,
        status: { notIn: [...DEAD_PROJECT_STATUSES] },
        rentalStartDate: { lte: rentalEndDate },
        rentalEndDate: { gte: rentalStartDate },
      };
      // Re-check both the legacy line.assetId rows AND the unit table —
      // a fresh deployment may have landed on a ProjectLineItemUnit.
      const [lineConflict, unitConflict] = await Promise.all([
        tx.projectLineItem.findFirst({
          where: {
            organizationId,
            assetId: newAssetId,
            status: { not: "CANCELLED" },
            id: { not: lineItemId },
            project: projectWindow,
          },
          select: { project: { select: { projectNumber: true } } },
        }),
        tx.projectLineItemUnit.findFirst({
          where: {
            organizationId,
            assetId: newAssetId,
            status: { not: "RETURNED" },
            lineItemId: { not: lineItemId },
            lineItem: { status: { not: "CANCELLED" }, project: projectWindow },
          },
          select: {
            lineItem: { select: { project: { select: { projectNumber: true } } } },
          },
        }),
      ]);
      const conflictProjectNumber =
        lineConflict?.project.projectNumber ??
        unitConflict?.lineItem.project.projectNumber;
      if (conflictProjectNumber) {
        throw new Error(
          `Asset ${newAsset.assetTag} was just booked on ${conflictProjectNumber}. Pick another.`,
        );
      }
    }

    await tx.projectLineItem.update({
      where: { id: lineItemId, organizationId },
      data: { assetId: newAssetId },
    });
  });
  await syncLineItemsToConvex([lineItemId]);

  return { lineItemId, assetId: newAssetId };
}

export { DEAD_PROJECT_STATUSES };
