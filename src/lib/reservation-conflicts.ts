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
import { getProjectById, getProjectsByOrg, type ConvexProject } from "@/lib/projects-read";
import { getAssetsByOrg } from "@/lib/assets-read";

/**
 * Map a Convex project doc to the conflict-report project shape. Convex stores
 * rental dates as epoch-ms numbers; the UI contract wants `Date | null`.
 */
function toConflictProject(p: ConvexProject): ReservationConflict["conflictingProject"] {
  return {
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    status: p.status ?? "",
    rentalStartDate: p.rentalStartDate != null ? new Date(p.rentalStartDate as number) : null,
    rentalEndDate: p.rentalEndDate != null ? new Date(p.rentalEndDate as number) : null,
  };
}

/**
 * Org projects that overlap `[startMs, endMs]` in a live (non-dead) status,
 * excluding templates and `excludeProjectId`. Replaces the cross-domain
 * `project: { isTemplate, status, rentalStartDate, rentalEndDate }` Prisma join
 * — collect the ids here, then filter the line/unit queries by
 * `projectId: { in: [...] }`.
 */
function overlappingProjectIds(
  projects: ConvexProject[],
  startMs: number,
  endMs: number,
  excludeProjectId: string,
): string[] {
  return projects
    .filter(
      (p) =>
        p.id !== excludeProjectId &&
        !p.isTemplate &&
        !(DEAD_PROJECT_STATUSES as readonly string[]).includes(p.status ?? "") &&
        p.rentalStartDate != null &&
        p.rentalEndDate != null &&
        (p.rentalStartDate as number) <= endMs &&
        (p.rentalEndDate as number) >= startMs,
    )
    .map((p) => p.id);
}

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
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) return [];
  if (!project?.rentalStartDate || !project.rentalEndDate) return [];

  // This project's asset assignments — from legacy line.assetId rows AND
  // from ProjectLineItemUnit rows (the fulfillment model). Deployed assets
  // now live on units, so both sources must be checked. asset (assetTag/modelId)
  // + the org's projects all live in Convex — attached/resolved in JS.
  const [assetLines, assetUnits, modelMap, allOrgAssets, allProjects] = await Promise.all([
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
      },
    }),
    getModelMap(organizationId),
    getAssetsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const assetMap = new Map(allOrgAssets.map((a) => [a.id, a]));
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

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
        assetTag: assetMap.get(l.assetId as string)?.assetTag ?? "—",
        modelName: l.modelId ? (modelMap.get(l.modelId)?.name ?? "—") : "—",
      })),
    ...assetUnits
      .filter((u) => u.assetId)
      .map((u) => {
        const unitAsset = assetMap.get(u.assetId as string);
        const unitModelId = unitAsset?.modelId ?? null;
        return {
          lineItemId: u.lineItemId,
          assetId: u.assetId as string,
          modelId: unitModelId,
          assetTag: unitAsset?.assetTag ?? "—",
          modelName: unitModelId ? (modelMap.get(unitModelId)?.name ?? "—") : "—",
        };
      }),
  ];
  if (here.length === 0) return [];

  const assetIds = [...new Set(here.map((r) => r.assetId))];
  // Other live projects overlapping this project's window — collect ids from
  // the Convex mirror, then filter the Prisma line/unit queries by projectId.
  const conflictProjectIds = overlappingProjectIds(
    allProjects,
    project.rentalStartDate as number,
    project.rentalEndDate as number,
    projectId,
  );
  if (conflictProjectIds.length === 0) return [];

  // Overlapping other-project bookings of those assets — both tables.
  const [overlapLines, overlapUnits] = await Promise.all([
    prisma.projectLineItem.findMany({
      where: {
        organizationId,
        assetId: { in: assetIds },
        status: { not: "CANCELLED" },
        projectId: { in: conflictProjectIds },
      },
      select: { id: true, assetId: true, projectId: true },
    }),
    prisma.projectLineItemUnit.findMany({
      where: {
        organizationId,
        assetId: { in: assetIds },
        status: { not: "RETURNED" },
        lineItem: {
          projectId: { in: conflictProjectIds },
          status: { not: "CANCELLED" },
        },
      },
      select: {
        lineItemId: true,
        assetId: true,
        lineItem: { select: { projectId: true } },
      },
    }),
  ]);

  const overlapByAsset = new Map<string, { id: string; projectId: string }>();
  for (const o of overlapLines) {
    if (o.assetId && !overlapByAsset.has(o.assetId)) {
      overlapByAsset.set(o.assetId, { id: o.id, projectId: o.projectId });
    }
  }
  for (const o of overlapUnits) {
    if (o.assetId && !overlapByAsset.has(o.assetId)) {
      overlapByAsset.set(o.assetId, {
        id: o.lineItemId,
        projectId: o.lineItem.projectId,
      });
    }
  }

  const conflicts: ReservationConflict[] = [];
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
      projectId: true,
    },
  });
  if (!lineItem?.modelId) return [];

  // Project header (rental window) lives in Convex.
  const lineItemProject = await getProjectById(lineItem.projectId);
  if (!lineItemProject?.rentalStartDate || !lineItemProject.rentalEndDate) {
    return [];
  }
  const startMs = lineItemProject.rentalStartDate as number;
  const endMs = lineItemProject.rentalEndDate as number;

  // All bookable assets of this model (Convex read, filter in JS).
  const allOrgAssets = await getAssetsByOrg(organizationId);
  const assets = allOrgAssets.filter(
    (a) =>
      a.modelId === lineItem.modelId &&
      a.isActive !== false &&
      !a.kitId &&
      a.status !== "RETIRED" &&
      a.status !== "LOST",
  );
  if (assets.length === 0) return [];

  // Which of those are booked in an overlapping live project? Bookings
  // live on legacy line.assetId rows AND on ProjectLineItemUnit rows
  // (the fulfillment model) — both tables must be checked or a swap
  // candidate that's actually deployed via a unit looks free.
  const candidateAssetIds = assets.map((a) => a.id);
  // Other live projects overlapping this project's window (Convex mirror →
  // projectId filter, replacing the cross-domain `project` join).
  const allProjects = await getProjectsByOrg(organizationId);
  const conflictProjectIds = overlappingProjectIds(allProjects, startMs, endMs, "");
  const [bookedLines, bookedUnits] = conflictProjectIds.length
    ? await Promise.all([
        prisma.projectLineItem.findMany({
          where: {
            organizationId,
            assetId: { in: candidateAssetIds },
            status: { not: "CANCELLED" },
            id: { not: lineItemId },
            projectId: { in: conflictProjectIds },
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
              projectId: { in: conflictProjectIds },
            },
          },
          select: { assetId: true },
        }),
      ])
    : [[], []];
  const bookedIds = new Set<string>();
  for (const b of bookedLines) if (b.assetId) bookedIds.add(b.assetId);
  for (const b of bookedUnits) if (b.assetId) bookedIds.add(b.assetId);

  return assets
    .filter((a) => a.id !== lineItem.assetId && !bookedIds.has(a.id))
    .map((a) => ({
      assetId: a.id,
      assetTag: a.assetTag,
      serialNumber: a.serialNumber ?? null,
      customName: a.customName ?? null,
      status: a.status ?? "",
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
      projectId: true,
    },
  });
  if (!lineItem) throw new Error("Line item not found");

  // Project header (rental window) lives in Convex.
  const lineItemProject = await getProjectById(lineItem.projectId);

  const allOrgAssetsForSwap = await getAssetsByOrg(organizationId);
  const newAsset = allOrgAssetsForSwap.find((a) => a.id === newAssetId) ?? null;
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
  const rentalStartDate = lineItemProject?.rentalStartDate ?? null;
  const rentalEndDate = lineItemProject?.rentalEndDate ?? null;
  // Other live projects overlapping the window — collect ids from Convex up
  // front (read outside the tx; the tx still re-reads the booking rows for the
  // TOCTOU guard). projectMap resolves the conflicting project number.
  const swapAllProjects = await getProjectsByOrg(organizationId);
  const swapProjectMap = new Map(swapAllProjects.map((p) => [p.id, p]));
  await prisma.$transaction(async (tx) => {
    if (rentalStartDate != null && rentalEndDate != null) {
      const swapConflictProjectIds = overlappingProjectIds(
        swapAllProjects,
        rentalStartDate as number,
        rentalEndDate as number,
        "",
      );
      // Re-check both the legacy line.assetId rows AND the unit table —
      // a fresh deployment may have landed on a ProjectLineItemUnit.
      const [lineConflict, unitConflict] = swapConflictProjectIds.length
        ? await Promise.all([
            tx.projectLineItem.findFirst({
              where: {
                organizationId,
                assetId: newAssetId,
                status: { not: "CANCELLED" },
                id: { not: lineItemId },
                projectId: { in: swapConflictProjectIds },
              },
              select: { projectId: true },
            }),
            tx.projectLineItemUnit.findFirst({
              where: {
                organizationId,
                assetId: newAssetId,
                status: { not: "RETURNED" },
                lineItemId: { not: lineItemId },
                lineItem: { status: { not: "CANCELLED" }, projectId: { in: swapConflictProjectIds } },
              },
              select: {
                lineItem: { select: { projectId: true } },
              },
            }),
          ])
        : [null, null];
      const conflictProjectId =
        lineConflict?.projectId ?? unitConflict?.lineItem.projectId;
      if (conflictProjectId) {
        const conflictProjectNumber = swapProjectMap.get(conflictProjectId)?.projectNumber ?? conflictProjectId;
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
