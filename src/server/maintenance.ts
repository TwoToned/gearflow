"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  maintenanceSchema,
  type MaintenanceFormValues,
} from "@/lib/validations/maintenance";
import type { Prisma, MaintenanceStatus } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { syncAssetsToConvex } from "@/lib/asset-mirror";
import {
  mirrorMaintenanceCreate,
  patchMaintenanceInConvex,
  removeMaintenanceFromConvex,
} from "@/lib/maintenance-mirror";
import { getModelMap } from "@/lib/models-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import {
  getMaintenanceRecordsByOrg,
  getMaintenanceRecordById,
  filterMaintenanceRecords,
  sortMaintenanceRecords,
  type MaintenanceRecordRow,
  type MaintenanceJoinData,
} from "@/lib/maintenance-read";
import {
  getMaintenanceAssetLinksByRecordIds,
  getMaintenanceAssetLinksByAssetIds,
  createMaintenanceAssetLinks,
  removeMaintenanceAssetLinks,
  removeAllMaintenanceAssetLinks,
} from "@/lib/maintenance-record-asset-read";

/**
 * Attach the cross-domain joins the maintenance reads need onto Convex-sourced
 * record rows:
 *
 *   - `assets[]` — the `maintenanceRecordAssets` join table (the intentional
 *     Prisma terminus — NOT mirrored to Convex), each carrying its `asset`
 *     scalars + the Convex `model` doc grafted on, ordered by asset tag asc
 *     (matches the old `orderBy: { asset: { assetTag: "asc" } }`).
 *   - `reportedBy` / `assignedTo` — Auth `User` rows (stay Prisma forever),
 *     batched in one findMany.
 *
 * Returns the records enriched in the same nested shape the old Prisma
 * `include` produced, plus a per-record `MaintenanceJoinData` map the
 * filter/sort predicates use (assetIds / tags / model names for the search).
 */
async function attachJoins(
  organizationId: string,
  records: MaintenanceRecordRow[],
): Promise<{
  enriched: Record<string, unknown>[];
  joinByRecordId: Map<string, MaintenanceJoinData>;
}> {
  const recordIds = records.map((r) => r.id);

  // Convex-only join table (Phase B): flat { maintenanceRecordId, assetId } links.
  // The asset scalars + model are sourced from Convex (assets are dual-written),
  // replacing the old Prisma `include: { asset: true }`.
  const links = await getMaintenanceAssetLinksByRecordIds(recordIds);

  const modelMap = await getModelMap(organizationId);

  // Asset scalars from Convex, keyed by id (the join carries only assetId now).
  const orgAssets = await getAssetsByOrg(organizationId);
  const assetMap = new Map(orgAssets.map((a) => [a.id, a]));

  // Auth Users for reportedBy / assignedTo (Prisma terminus).
  const userIds = Array.from(
    new Set(
      records
        .flatMap((r) => [r.reportedById, r.assignedToId])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Group links by record, graft the Convex model onto each asset, and sort by
  // asset tag asc to mirror the old include orderBy.
  const linksByRecord = new Map<string, Record<string, unknown>[]>();
  const joinByRecordId = new Map<string, MaintenanceJoinData>();
  for (const id of recordIds) {
    linksByRecord.set(id, []);
    joinByRecordId.set(id, { assetIds: [], assetTags: [], modelNames: [] });
  }
  for (const link of links) {
    const asset = assetMap.get(link.assetId) ?? null;
    const model = asset?.modelId ? modelMap.get(asset.modelId) ?? null : null;
    const graftedAsset = asset ? { ...asset, model } : null;
    linksByRecord.get(link.maintenanceRecordId)?.push({ ...link, asset: graftedAsset });
    const join = joinByRecordId.get(link.maintenanceRecordId);
    if (join) {
      join.assetIds.push(link.assetId);
      if (asset?.assetTag) join.assetTags.push(asset.assetTag);
      if (model?.name) join.modelNames.push(model.name);
    }
  }

  const enriched = records.map((r) => {
    const recordLinks = (linksByRecord.get(r.id) ?? []).sort((a, b) => {
      const ta = (a.asset as { assetTag?: string } | null)?.assetTag ?? "";
      const tb = (b.asset as { assetTag?: string } | null)?.assetTag ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    return {
      ...r,
      assets: recordLinks,
      reportedBy: r.reportedById ? userMap.get(r.reportedById) ?? null : null,
      assignedTo: r.assignedToId ? userMap.get(r.assignedToId) ?? null : null,
    };
  });

  return { enriched, joinByRecordId };
}

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

  // Record rows from Convex (org-scoped); the assets/model + User joins stay
  // Prisma. The search OR matches asset tags + model names, so the join data is
  // needed to filter — attach for the whole org, then filter/sort/paginate in
  // JS (mirrors the old Prisma where/orderBy/skip/take). No Prisma fallback.
  const allRecords = await getMaintenanceRecordsByOrg(organizationId);
  const { joinByRecordId } = await attachJoins(organizationId, allRecords);

  const filtered = filterMaintenanceRecords(allRecords, joinByRecordId, {
    search,
    status,
    type,
    assetId,
  });
  const sorted = sortMaintenanceRecords(filtered, sortBy, sortOrder || "asc");
  const total = sorted.length;
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  // Re-attach joins for just the page slice (cheap; avoids serialising the
  // whole org's asset/user graph when only a page is rendered).
  const { enriched } = await attachJoins(organizationId, pageRows);

  return serialize({
    records: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getMaintenanceRecord(id: string) {
  const { organizationId } = await getOrgContext();

  const record = await getMaintenanceRecordById(id);
  // getById isn't org-scoped at the index level (lookup is by cuid), so enforce
  // the org boundary here exactly as the old `where: { id, organizationId }` did.
  if (!record || record.organizationId !== organizationId) return serialize(null);

  const { enriched } = await attachJoins(organizationId, [record]);
  return serialize(enriched[0]);
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
 * Compute which of `assetIds` are still held by ANOTHER active holding record —
 * the cross-check the old `releaseAssets` ran as a relational Prisma query
 * (`maintenanceRecordAsset` joined to `maintenanceRecord.status IN HOLDING`,
 * excluding the current record). The join is Convex-only now (Phase B): read the
 * asset-side links from Convex, then re-apply the record-status filter in JS
 * against the org's Convex maintenance records. Runs OUTSIDE the Prisma tx (Convex
 * calls cannot run inside a Prisma transaction).
 */
async function computeStillHeldIds(
  organizationId: string,
  assetIds: string[],
  currentRecordId: string,
): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const [links, records] = await Promise.all([
    getMaintenanceAssetLinksByAssetIds(assetIds),
    getMaintenanceRecordsByOrg(organizationId),
  ]);
  const holdingRecordIds = new Set(
    records.filter((r) => isHoldingStatus(r.status)).map((r) => r.id),
  );
  const stillHeld = new Set<string>();
  for (const l of links) {
    if (l.maintenanceRecordId === currentRecordId) continue;
    if (holdingRecordIds.has(l.maintenanceRecordId)) stillHeld.add(l.assetId);
  }
  return stillHeld;
}

/**
 * Release assets back to AVAILABLE — but only if currently IN_MAINTENANCE AND not
 * still held by another active holding record. The "still held" set is computed
 * from Convex by the caller (the join is Convex-only) and passed in; this only
 * runs the Prisma `asset.updateMany` inside the tx.
 */
async function releaseAssets(
  tx: TxClient,
  assetIds: string[],
  stillHeldIds: Set<string>,
) {
  if (assetIds.length === 0) return;
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

  // The asset-release cross-check reads the Convex join — compute the "still held
  // by another holding record" set BEFORE the Prisma tx (Convex can't run inside
  // it). On create the new record has no links yet, so this only reflects OTHER
  // records (currentRecordId is a fresh cuid, never matched).
  const newRecordId = createId();
  const stillHeld =
    parsed.status === "COMPLETED" && parsed.result !== "FAIL"
      ? await computeStillHeldIds(organizationId, assetIds, newRecordId)
      : new Set<string>();

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceRecord.create({
      data: {
        id: newRecordId,
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
      },
    });

    // Apply state-machine transitions atomically with record creation
    if (isHoldingStatus(parsed.status)) {
      await holdAssets(tx, assetIds);
    } else if (parsed.status === "COMPLETED" && parsed.result !== "FAIL") {
      // PASS releases; FAIL keeps held (no change)
      await releaseAssets(tx, assetIds, stillHeld);
    }
    // CANCELLED on create is a no-op (nothing to release; never held)

    return created;
  });
  // Convex-only join write (Phase B): link the assets to the new record.
  await createMaintenanceAssetLinks(record.id, assetIds);
  // Mirror any asset status flips (hold/release) to Convex.
  await syncAssetsToConvex(assetIds);
  await mirrorMaintenanceCreate(record as unknown as Record<string, unknown>);

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

  // Org-guard + status via the Convex record (record is dual-written); existing
  // asset links come from the Convex join (Phase B).
  const existing = await getMaintenanceRecordById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Maintenance record not found");
  }
  const existingLinks = await getMaintenanceAssetLinksByRecordIds([id]);
  const existingAssetIds = existingLinks.map((l) => l.assetId);

  // Determine new asset list (edit mode may update assets)
  const newAssetIds = parsed.assetIds?.length
    ? parsed.assetIds
    : parsed.assetId
      ? [parsed.assetId]
      : existingAssetIds;

  const toRemove = existingAssetIds.filter((id) => !newAssetIds.includes(id));

  const wasHolding = isHoldingStatus(existing.status);
  const isHolding = isHoldingStatus(parsed.status);
  const willReleaseRemaining =
    newAssetIds.length > 0 &&
    wasHolding &&
    ((parsed.status === "COMPLETED" && parsed.result !== "FAIL") ||
      parsed.status === "CANCELLED");

  // Convex-join cross-checks for the two possible releases (computed BEFORE the
  // Prisma tx; exclude THIS record so its own links never self-hold).
  const [removeStillHeld, remainingStillHeld] = await Promise.all([
    toRemove.length > 0
      ? computeStillHeldIds(organizationId, toRemove, id)
      : Promise.resolve(new Set<string>()),
    willReleaseRemaining
      ? computeStillHeldIds(organizationId, newAssetIds, id)
      : Promise.resolve(new Set<string>()),
  ]);

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
      },
    });

    // Asset-removal release: removed assets must not stay IN_MAINTENANCE forever.
    // Release them with the same guards as any other release (only if no other
    // active record still holds them and only if currently IN_MAINTENANCE).
    if (toRemove.length > 0) {
      await releaseAssets(tx, toRemove, removeStillHeld);
    }

    // State-machine transitions for remaining assets:
    if (newAssetIds.length > 0) {
      // Just entered a holding status (e.g. SCHEDULED → IN_PROGRESS,
      // SCHEDULED → AWAITING_PARTS): hold remaining assets.
      if (isHolding && !wasHolding) {
        await holdAssets(tx, newAssetIds);
      }

      // Transitions BETWEEN holding statuses (e.g. AWAITING_PARTS →
      // IN_PROGRESS, IN_PROGRESS → QA): no asset-status change.

      // Exited holding to a release-status (and was holding): release.
      if (willReleaseRemaining) {
        await releaseAssets(tx, newAssetIds, remainingStillHeld);
      }

      // Completed FAIL: stay IN_MAINTENANCE (no change).
    }

    return updated;
  });
  // Convex-only join write (Phase B): apply the link diff.
  await removeMaintenanceAssetLinks(id, toRemove);
  await createMaintenanceAssetLinks(
    id,
    newAssetIds.filter((aId) => !existingAssetIds.includes(aId)),
  );
  // Mirror any asset status flips (removed-asset release + remaining hold/release).
  await syncAssetsToConvex([...toRemove, ...newAssetIds]);
  await patchMaintenanceInConvex(record.id, record as unknown as Record<string, unknown>);

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

export async function deleteMaintenanceRecord(id: string) {
  const { organizationId, userId, userName } = await requirePermission("maintenance", "delete");

  // Org-guard + status via the Convex record; asset links via the Convex join.
  const record = await getMaintenanceRecordById(id);
  if (!record || record.organizationId !== organizationId) {
    throw new Error("Record not found");
  }
  const links = await getMaintenanceAssetLinksByRecordIds([id]);
  const linkedAssetIds = links.map((l) => l.assetId);

  // Compute the release cross-check from Convex BEFORE the tx (exclude this record).
  const stillHeld =
    isHoldingStatus(record.status) && linkedAssetIds.length > 0
      ? await computeStillHeldIds(organizationId, linkedAssetIds, record.id)
      : new Set<string>();

  // Release held assets AND delete the record in one transaction. Split across
  // two, there's a window where the asset is AVAILABLE but the record still
  // exists — a concurrent hold could re-grab it.
  await prisma.$transaction(async (tx) => {
    if (isHoldingStatus(record.status) && linkedAssetIds.length > 0) {
      await releaseAssets(tx, linkedAssetIds, stillHeld);
    }
    await tx.maintenanceRecord.delete({
      where: { id, organizationId },
    });
  });
  // Re-implement the maintenanceRecord → maintenanceRecordAsset Cascade
  // (Convex-only join, Phase B): delete this record's links.
  await removeAllMaintenanceAssetLinks(id);
  // Mirror any released asset status flips to Convex.
  await syncAssetsToConvex(linkedAssetIds);
  await removeMaintenanceFromConvex(id);

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

  const allAssets = await getAssetsByOrg(organizationId);
  const assets = allAssets.filter((a) => a.isActive !== false).sort((a, b) => a.assetTag.localeCompare(b.assetTag));

  const modelMap = await getModelMap(organizationId);
  return serialize(
    assets.map((a) => ({
      id: a.id,
      label: `${a.assetTag} — ${a.modelId ? modelMap.get(a.modelId)?.name ?? "" : ""}${a.customName ? ` (${a.customName})` : ""}`,
    }))
  );
}
