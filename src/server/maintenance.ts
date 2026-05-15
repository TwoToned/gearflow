"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  maintenanceSchema,
  type MaintenanceFormValues,
} from "@/lib/validations/maintenance";
import type { Prisma, MaintenanceStatus } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { UserFacingError } from "@/lib/errors";

const assetInclude = {
  assets: {
    include: { asset: { include: { model: true } } },
    orderBy: { asset: { assetTag: "asc" as const } },
  },
};

export async function getMaintenanceRecords(params?: {
  search?: string;
  status?: string;
  type?: string;
  assetId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const { search, status, type, assetId, page = 1, pageSize = 25, sortBy, sortOrder } = params || {};

  const where: Prisma.MaintenanceRecordWhereInput = {
    organizationId,
    ...(status && { status: status as Prisma.EnumMaintenanceStatusFilter }),
    ...(type && { type: type as Prisma.EnumMaintenanceTypeFilter }),
    ...(assetId && { assets: { some: { assetId } } }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { assets: { some: { asset: { assetTag: { contains: search, mode: "insensitive" } } } } },
        { assets: { some: { asset: { model: { name: { contains: search, mode: "insensitive" } } } } } },
      ],
    }),
  };

  const [records, total] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where,
      include: {
        ...assetInclude,
        assignedTo: true,
        reportedBy: true,
      },
      orderBy: sortBy
        ? { [sortBy]: sortOrder || "asc" }
        : [{ status: "asc" }, { scheduledDate: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.maintenanceRecord.count({ where }),
  ]);

  return serialize({
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * Returns every non-terminal maintenance record grouped by status — the
 * source for the workshop kanban. Terminal statuses (COMPLETED, CANCELLED)
 * are excluded; if you want to see history, use the existing
 * /maintenance list with a status filter.
 */
export async function getWorkshopQueue(params?: {
  search?: string;
  assignedToId?: string;
  projectId?: string;
}) {
  const { organizationId } = await getOrgContext();
  const { search, assignedToId, projectId } = params || {};

  const where: Prisma.MaintenanceRecordWhereInput = {
    organizationId,
    status: { notIn: ["COMPLETED", "CANCELLED"] },
    ...(assignedToId && { assignedToId }),
    ...(projectId && { projectId }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { assets: { some: { asset: { assetTag: { contains: search, mode: "insensitive" } } } } },
      ],
    }),
  };

  const records = await prisma.maintenanceRecord.findMany({
    where,
    include: {
      assets: { include: { asset: { select: { id: true, assetTag: true, model: { select: { name: true } } } } } },
      assignedTo: { select: { id: true, name: true, image: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
  });

  return serialize(records);
}

export async function getMaintenanceRecord(id: string) {
  const { organizationId } = await getOrgContext();

  return serialize(
    await prisma.maintenanceRecord.findUnique({
      where: { id, organizationId },
      include: {
        ...assetInclude,
        assignedTo: true,
        reportedBy: true,
      },
    })
  );
}

/**
 * State-machine invariants for MaintenanceRecord → Asset.status:
 *
 *   SCHEDULED        does NOT hold the assets (no status change yet)
 *   AWAITING_PARTS   holds (asset is in the workshop awaiting parts order)
 *   IN_PROGRESS      holds (asset is actively being repaired)
 *   QA               holds (asset is being verified before release)
 *   COMPLETED PASS   releases: IN_MAINTENANCE → AVAILABLE (guarded — only
 *                    if no other active holding record still holds this
 *                    asset, and only if currently IN_MAINTENANCE)
 *   COMPLETED FAIL   holds: leaves IN_MAINTENANCE in place
 *   CANCELLED        releases (same guards as COMPLETED PASS)
 *
 * The "guarded" pattern matters because Asset.status is a single mutable
 * enum touched by maintenance, warehouse checkout, T&T, and lost/retired
 * lifecycles. We never overwrite a status set by a different lifecycle.
 *
 * Wave 3 adds AWAITING_PARTS + QA as additional "holding" statuses so the
 * workshop kanban can move cards through proper stages without
 * accidentally returning an asset to AVAILABLE mid-repair.
 */

type TxClient = Prisma.TransactionClient;

/** Statuses where the asset is physically in the workshop's hands. */
const HOLDING_STATUSES: MaintenanceStatus[] = [
  "AWAITING_PARTS",
  "IN_PROGRESS",
  "QA",
];

/** Predicate the rest of the file uses to decide "do we hold this asset?". */
function isHoldingStatus(status: MaintenanceStatus): boolean {
  return HOLDING_STATUSES.includes(status);
}

/** Mark assets as IN_MAINTENANCE only if currently AVAILABLE. */
async function holdAssets(tx: TxClient, assetIds: string[]) {
  if (assetIds.length === 0) return;
  await tx.asset.updateMany({
    where: { id: { in: assetIds }, status: "AVAILABLE" },
    data: { status: "IN_MAINTENANCE" },
  });
}

/**
 * Release assets back to AVAILABLE — but only if currently IN_MAINTENANCE
 * AND no other active holding record still holds them. Pass the record id
 * being completed/cancelled so we exclude it from the "other holds" check.
 */
async function releaseAssets(
  tx: TxClient,
  assetIds: string[],
  currentRecordId: string,
) {
  if (assetIds.length === 0) return;
  const stillHeld = await tx.maintenanceRecordAsset.findMany({
    where: {
      assetId: { in: assetIds },
      maintenanceRecordId: { not: currentRecordId },
      maintenanceRecord: { status: { in: HOLDING_STATUSES } },
    },
    select: { assetId: true },
  });
  const stillHeldIds = new Set(stillHeld.map((r) => r.assetId));
  const toRelease = assetIds.filter((id) => !stillHeldIds.has(id));
  if (toRelease.length === 0) return;
  await tx.asset.updateMany({
    where: { id: { in: toRelease }, status: "IN_MAINTENANCE" },
    data: { status: "AVAILABLE" },
  });
}

export async function createMaintenanceRecord(data: MaintenanceFormValues) {
  const { organizationId, userId, userName } = await requirePermission("maintenance", "create");
  const parsed = maintenanceSchema.parse(data);

  const assetIds = parsed.assetIds?.length
    ? parsed.assetIds
    : parsed.assetId
      ? [parsed.assetId]
      : [];

  if (assetIds.length === 0) throw new Error("At least one asset is required");

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceRecord.create({
      data: {
        organizationId,
        type: parsed.type,
        status: parsed.status,
        title: parsed.title,
        description: parsed.description || null,
        reportedById: parsed.reportedById || userId,
        assignedToId: parsed.assignedToId || null,
        scheduledDate: parsed.scheduledDate ?? null,
        completedDate: parsed.completedDate ?? null,
        cost: parsed.cost ?? null,
        partsUsed: parsed.partsUsed || null,
        photos: parsed.photos ?? [],
        result: parsed.result ?? null,
        nextDueDate: parsed.nextDueDate ?? null,
        tags: parsed.tags,
        assets: {
          create: assetIds.map((assetId) => ({ assetId })),
        },
      },
      include: {
        ...assetInclude,
      },
    });

    // Apply state-machine transitions atomically with record creation
    if (isHoldingStatus(parsed.status)) {
      await holdAssets(tx, assetIds);
    } else if (parsed.status === "COMPLETED" && parsed.result !== "FAIL") {
      // PASS releases; FAIL keeps held (no change)
      await releaseAssets(tx, assetIds, created.id);
    }
    // CANCELLED on create is a no-op (nothing to release; never held)

    return created;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "maintenance",
    entityId: record.id,
    entityName: record.title,
    summary: `Created maintenance record: ${record.title}`,
    details: { assetCount: assetIds.length },
  });

  return serialize(record);
}

export async function updateMaintenanceRecord(
  id: string,
  data: MaintenanceFormValues
) {
  const { organizationId, userId, userName } = await requirePermission("maintenance", "update");
  const parsed = maintenanceSchema.parse(data);

  const existing = await prisma.maintenanceRecord.findUnique({
    where: { id, organizationId },
    include: { assets: true },
  });

  if (!existing) throw new Error("Maintenance record not found");

  const existingAssetIds = existing.assets.map((a) => a.assetId);

  // Determine new asset list (edit mode may update assets)
  const newAssetIds = parsed.assetIds?.length
    ? parsed.assetIds
    : parsed.assetId
      ? [parsed.assetId]
      : existingAssetIds;

  const toRemove = existingAssetIds.filter((id) => !newAssetIds.includes(id));

  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.maintenanceRecord.update({
      where: { id, organizationId },
      data: {
        type: parsed.type,
        status: parsed.status,
        title: parsed.title,
        description: parsed.description || null,
        reportedById: parsed.reportedById || undefined,
        assignedToId: parsed.assignedToId || null,
        scheduledDate: parsed.scheduledDate ?? null,
        completedDate: parsed.completedDate ?? null,
        cost: parsed.cost ?? null,
        partsUsed: parsed.partsUsed || null,
        photos: parsed.photos ?? [],
        result: parsed.result ?? null,
        nextDueDate: parsed.nextDueDate ?? null,
        tags: parsed.tags,
        assets: {
          deleteMany: toRemove.length > 0 ? { assetId: { in: toRemove } } : undefined,
          create: newAssetIds
            .filter((id) => !existingAssetIds.includes(id))
            .map((assetId) => ({ assetId })),
        },
      },
      include: {
        ...assetInclude,
      },
    });

    // Asset-removal release: previously a bug — removed assets stayed
    // IN_MAINTENANCE forever. Release them now, with the same guards as
    // any other release (only if no other active record still holds them
    // and only if currently IN_MAINTENANCE).
    //
    // Apply this regardless of the new record status, because the asset
    // is no longer associated with THIS record after the update above.
    if (toRemove.length > 0) {
      await releaseAssets(tx, toRemove, id);
    }

    // State-machine transitions for remaining assets:
    if (newAssetIds.length > 0) {
      const wasHolding = isHoldingStatus(existing.status);
      const isHolding = isHoldingStatus(parsed.status);

      // Just entered a holding status (e.g. SCHEDULED → IN_PROGRESS,
      // SCHEDULED → AWAITING_PARTS): hold remaining assets.
      if (isHolding && !wasHolding) {
        await holdAssets(tx, newAssetIds);
      }

      // Transitions BETWEEN holding statuses (e.g. AWAITING_PARTS →
      // IN_PROGRESS, IN_PROGRESS → QA): no asset-status change. The
      // asset is still IN_MAINTENANCE, just in a different workshop
      // stage. holdAssets is idempotent on already-held items so even
      // if we called it, it'd be a no-op — keeping the guard cleanly
      // expresses intent.

      // Exited holding to a release-status (and was holding): release.
      if (
        wasHolding &&
        ((parsed.status === "COMPLETED" && parsed.result !== "FAIL") ||
          parsed.status === "CANCELLED")
      ) {
        await releaseAssets(tx, newAssetIds, id);
      }

      // Completed FAIL: stay IN_MAINTENANCE (no change — guarded hold
      // remains in place; nothing to do here).
    }

    return updated;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "maintenance",
    entityId: record.id,
    entityName: record.title,
    summary: `Updated maintenance record: ${record.title}`,
  });

  return serialize(record);
}

/**
 * Lightweight status-only update used by the workshop kanban — moving
 * a card between columns is a high-frequency interaction that shouldn't
 * pay the cost of re-validating + re-writing every field on the record.
 *
 * Applies the same state-machine guards as updateMaintenanceRecord.
 * `result` is required when transitioning to COMPLETED (PASS or FAIL
 * decides whether the asset releases). Defaults to PASS when omitted.
 */
export async function setMaintenanceStatus(
  id: string,
  nextStatus: MaintenanceStatus,
  result?: "PASS" | "FAIL",
) {
  const { organizationId, userId, userName } = await requirePermission(
    "maintenance",
    "update",
  );

  const existing = await prisma.maintenanceRecord.findUnique({
    where: { id, organizationId },
    include: { assets: { select: { assetId: true } } },
  });
  if (!existing) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Maintenance record not found",
      message: "This record was deleted or moved. Refresh the page.",
    });
  }

  const assetIds = existing.assets.map((a) => a.assetId);
  const wasHolding = isHoldingStatus(existing.status);
  const isHolding = isHoldingStatus(nextStatus);
  const completedResult = nextStatus === "COMPLETED" ? result ?? "PASS" : existing.result;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.maintenanceRecord.update({
      where: { id, organizationId },
      data: {
        status: nextStatus,
        result: completedResult,
        completedDate: nextStatus === "COMPLETED" ? new Date() : existing.completedDate,
      },
    });

    if (assetIds.length > 0) {
      if (isHolding && !wasHolding) {
        await holdAssets(tx, assetIds);
      } else if (
        wasHolding &&
        ((nextStatus === "COMPLETED" && completedResult !== "FAIL") ||
          nextStatus === "CANCELLED")
      ) {
        await releaseAssets(tx, assetIds, id);
      }
    }
    return u;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "maintenance",
    entityId: id,
    entityName: existing.title,
    summary: `Status ${existing.status} → ${nextStatus}${
      completedResult && nextStatus === "COMPLETED" ? ` (${completedResult})` : ""
    }`,
  });

  return serialize(updated);
}

export async function deleteMaintenanceRecord(id: string) {
  const { organizationId, userId, userName } = await requirePermission("maintenance", "delete");

  const record = await prisma.maintenanceRecord.findUnique({
    where: { id, organizationId },
    include: { assets: true },
  });

  if (!record) throw new Error("Record not found");

  // If the record was keeping assets in maintenance (any holding status),
  // release them via the same guarded helper so we don't free an asset
  // another active record still owns.
  if (isHoldingStatus(record.status) && record.assets.length > 0) {
    await prisma.$transaction(async (tx) => {
      await releaseAssets(
        tx,
        record.assets.map((a) => a.assetId),
        record.id,
      );
    });
  }

  await prisma.maintenanceRecord.delete({
    where: { id, organizationId },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "maintenance",
    entityId: id,
    entityName: record.title,
    summary: `Deleted maintenance record: ${record.title}`,
    details: { deleted: { title: record.title } },
  });
}

export async function getAssetsForMaintenanceSelect() {
  const { organizationId } = await getOrgContext();

  const assets = await prisma.asset.findMany({
    where: { organizationId, isActive: true },
    include: { model: true },
    orderBy: { assetTag: "asc" },
  });

  return serialize(
    assets.map((a) => ({
      id: a.id,
      label: `${a.assetTag} — ${a.model.name}${a.customName ? ` (${a.customName})` : ""}`,
    }))
  );
}
