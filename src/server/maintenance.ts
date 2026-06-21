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
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
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

  // Asset state-machine transitions in a Prisma tx (asset.status still Prisma).
  await prisma.$transaction(async (tx) => {
    if (isHoldingStatus(parsed.status)) {
      await holdAssets(tx, assetIds);
    } else if (parsed.status === "COMPLETED" && parsed.result !== "FAIL") {
      await releaseAssets(tx, assetIds, stillHeld);
    }
  });

  const now = Date.now();
  const convex = await getConvexClient();
  await convex.mutation(api.maintenanceRecords.createIfMissing, {
    id: newRecordId,
    organizationId,
    type: parsed.type,
    status: parsed.status ?? undefined,
    title: parsed.title,
    description: parsed.description || undefined,
    reportedById: parsed.reportedById || userId,
    assignedToId: parsed.assignedToId || undefined,
    scheduledDate: parsed.scheduledDate ? new Date(parsed.scheduledDate as unknown as string).getTime() : undefined,
    completedDate: parsed.completedDate ? new Date(parsed.completedDate as unknown as string).getTime() : undefined,
    cost: parsed.cost ? Number(parsed.cost) : undefined,
    partsUsed: parsed.partsUsed || undefined,
    photos: parsed.photos ?? [],
    result: parsed.result ?? undefined,
    nextDueDate: parsed.nextDueDate ? new Date(parsed.nextDueDate as unknown as string).getTime() : undefined,
    tags: parsed.tags,
    createdAt: now,
    updatedAt: now,
  });

  // Convex-only join write (Phase B): link the assets to the new record.
  await createMaintenanceAssetLinks(newRecordId, assetIds);
  // Mirror any asset status flips (hold/release) to Convex.
  await syncAssetsToConvex(assetIds);

  const record = await getMaintenanceRecordById(newRecordId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "maintenance",
    entityId: newRecordId,
    entityName: parsed.title,
    summary: `Created maintenance record: ${parsed.title}`,
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

  // Asset state-machine transitions in a Prisma tx (asset.status still Prisma).
  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await releaseAssets(tx, toRemove, removeStillHeld);
    }
    if (newAssetIds.length > 0) {
      if (isHolding && !wasHolding) {
        await holdAssets(tx, newAssetIds);
      }
      if (willReleaseRemaining) {
        await releaseAssets(tx, newAssetIds, remainingStillHeld);
      }
    }
  });

  const convex = await getConvexClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await convex.mutation(api.maintenanceRecords.update, { id, patch: {
    type: parsed.type,
    status: parsed.status ?? undefined,
    title: parsed.title,
    description: parsed.description || null,
    reportedById: parsed.reportedById || undefined,
    assignedToId: parsed.assignedToId || null,
    scheduledDate: parsed.scheduledDate ? new Date(parsed.scheduledDate as unknown as string).getTime() : null,
    completedDate: parsed.completedDate ? new Date(parsed.completedDate as unknown as string).getTime() : null,
    cost: parsed.cost ? Number(parsed.cost) : null,
    partsUsed: parsed.partsUsed || null,
    photos: parsed.photos ?? [],
    result: parsed.result ?? null,
    nextDueDate: parsed.nextDueDate ? new Date(parsed.nextDueDate as unknown as string).getTime() : null,
    tags: parsed.tags,
    updatedAt: Date.now(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any });

  // Convex-only join write (Phase B): apply the link diff.
  await removeMaintenanceAssetLinks(id, toRemove);
  await createMaintenanceAssetLinks(
    id,
    newAssetIds.filter((aId) => !existingAssetIds.includes(aId)),
  );
  // Mirror any asset status flips (removed-asset release + remaining hold/release).
  await syncAssetsToConvex([...toRemove, ...newAssetIds]);

  const record = await getMaintenanceRecordById(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "maintenance",
    entityId: id,
    entityName: existing.title,
    summary: `Updated maintenance record: ${existing.title}`,
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

  // Release held assets in a Prisma tx (asset.status still Prisma).
  if (isHoldingStatus(record.status) && linkedAssetIds.length > 0) {
    await prisma.$transaction(async (tx) => {
      await releaseAssets(tx, linkedAssetIds, stillHeld);
    });
  }
  const convex = await getConvexClient();
  await convex.mutation(api.maintenanceRecords.remove, { id });
  // Re-implement the maintenanceRecord → maintenanceRecordAsset Cascade
  // (Convex-only join, Phase B): delete this record's links.
  await removeAllMaintenanceAssetLinks(id);
  // Mirror any released asset status flips to Convex.
  await syncAssetsToConvex(linkedAssetIds);

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
