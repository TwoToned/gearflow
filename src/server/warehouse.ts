"use server";

import { prisma } from "@/lib/prisma";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientById } from "@/lib/clients-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getLocationMap } from "@/lib/locations-read";
import { serialize } from "@/lib/serialize";
import { computeOverbookedStatus } from "@/lib/availability";
import { logActivity, logActivityMany } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { assertNoBlockingComments } from "@/lib/blocking-comments-read";
import { getModelCheckItemCountMap } from "@/lib/line-item-tree-read";
import { buildWarehouseLineItems, buildPullSheetLineItems } from "@/lib/project-line-item-read";
import { getKitById, getKitByAssetTag } from "@/lib/kits-read";
import { getActiveAssetsByModel, getAssetById, getAssetByAssetTag, getAssetsByIds, getBulkAssetsByIds, getBulkAssetByAssetTag } from "@/lib/assets-read";
import { getProjectById, getProjectByIdMapped, getProjectsByOrg } from "@/lib/projects-read";

export async function getProjectForWarehouse(projectId: string) {
  const { organizationId } = await getOrgContext();

  // The whole EQUIPMENT line-item tree (lineItems → childLineItems → units, with
  // model/supplier/kit/asset/bulkAsset + check-item counts) is reconstructed from
  // the dual-written Convex tables in JS — see buildWarehouseLineItems (Phase A
  // keystone consumer 2/4). project is Convex-only too — read the scalars; even
  // location is attached from Convex below.
  const project = await getProjectByIdMapped(projectId, organizationId);

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.isTemplate) {
    throw new Error("Cannot perform warehouse operations on a template");
  }

  // ONE parallel wave (was 3 SEQUENTIAL round-trips: line-item tree → client →
  // location). All independent of each other — each needs only projectId/orgId or
  // the project scalars already read above.
  const [lineItems, client, locationMap] = await Promise.all([
    buildWarehouseLineItems(projectId, organizationId),
    project.clientId ? getClientById(project.clientId) : Promise.resolve(null),
    project.locationId ? getLocationMap(organizationId) : Promise.resolve(null),
  ]);
  const location = project.locationId && locationMap ? locationMap.get(project.locationId) ?? null : null;
  return serialize({ ...project, lineItems, client, location });
}

export async function lookupAssetForScan(
  projectId: string,
  assetTag: string,
  mode: "checkout" | "checkin" = "checkout"
) {
  const { organizationId } = await getOrgContext();

  // Look up the asset tag in all tables: serialized, bulk, kits. All three
  // domains live in Convex — read from the mirror helpers.
  const [rawAsset, rawBulkAsset, kit] = await Promise.all([
    getAssetByAssetTag(organizationId, assetTag),
    getBulkAssetByAssetTag(organizationId, assetTag),
    getKitByAssetTag(organizationId, assetTag),
  ]);
  const [assetModel, bulkAssetModel] = await Promise.all([
    rawAsset ? getModelById(rawAsset.modelId) : Promise.resolve(null),
    rawBulkAsset ? getModelById(rawBulkAsset.modelId) : Promise.resolve(null),
  ]);
  const asset = rawAsset ? { ...rawAsset, model: assetModel } : null;
  const bulkAsset = rawBulkAsset ? { ...rawBulkAsset, model: bulkAssetModel } : null;

  // The project's line-item tree lives in Convex — fetch once and resolve
  // every "which line does this scan apply to" question in JS below.
  const convexScan = await getConvexClient();
  const projectLines = (
    await convexScan.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId })
  ).filter((li) => li.status !== "CANCELLED");

  // If it's a Kit barcode
  if (kit) {
    const kitLineItem =
      projectLines.find((li) => li.kitId === kit.id && !li.isKitChild) ?? null;
    if (!kitLineItem) {
      return serialize({
        found: true as const, type: "kit" as const, lineItemId: null, assetId: null,
        assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: "not_on_project" as const,
      });
    }
    if (mode === "checkout" && kitLineItem.status === "CHECKED_OUT") {
      return serialize({ found: true as const, type: "kit" as const, lineItemId: null, assetId: null, assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: "already_checked_out" as const });
    }
    if (mode === "checkin" && kitLineItem.status !== "CHECKED_OUT") {
      return serialize({ found: true as const, type: "kit" as const, lineItemId: null, assetId: null, assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: "not_checked_out" as const });
    }
    return serialize({ found: true as const, type: "kit" as const, lineItemId: kitLineItem.id, assetId: null, assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: null });
  }

  // If this serialized asset is inside a Kit, prompt to scan the Kit instead
  if (asset && asset.kitId) {
    const parentKit = await getKitById(asset.kitId);
    return serialize({
      found: true as const, type: "kit_member" as const, lineItemId: null, assetId: asset.id,
      assetName: asset.model?.name ?? "", kitId: parentKit?.id || null, kitAssetTag: parentKit?.assetTag || null, reason: "asset_in_kit" as const,
    });
  }

  // If this serialized asset is a permanent accessory of another asset, prompt
  // to scan the parent instead — accessories move with their parent.
  if (asset && asset.parentAssetId) {
    const parent = await getAssetById(asset.parentAssetId);
    const parentInOrg = parent?.organizationId === organizationId ? parent : null;
    return serialize({
      found: true as const, type: "asset_child" as const, lineItemId: null, assetId: asset.id,
      assetName: asset.model?.name ?? "", parentAssetId: parentInOrg?.id || null, parentAssetTag: parentInOrg?.assetTag || null, reason: "asset_is_accessory" as const,
    });
  }

  const found = asset || bulkAsset;
  if (!found) {
    return serialize({ found: false as const, type: null, lineItemId: null, assetId: null, assetName: null, reason: null });
  }

  const modelId = found.modelId;
  const assetName = asset
    ? [asset.model?.name, asset.customName ? `(${asset.customName})` : null].filter(Boolean).join(" ")
    : bulkAsset!.model?.name ?? "";

  // Block checkout of retired/in-maintenance/lost assets
  if (mode === "checkout" && asset && (asset.status === "RETIRED" || asset.status === "IN_MAINTENANCE" || asset.status === "LOST")) {
    return serialize({
      found: true as const, type: null, lineItemId: null, assetId: asset.id,
      assetName, reason: "asset_unavailable" as const,
      assetStatus: asset.status,
    });
  }

  // Block checkout of T&T FAILED/OVERDUE assets (AS/NZS 3760:2022 compliance)
  if (mode === "checkout") {
    const convexForTT = await getConvexClient();
    const blockedRows = await convexForTT.query(api.testTagAssets.listBlockedForCheckout, {
      orgId: organizationId,
      assetIds: asset ? [asset.id] : [],
      bulkAssetIds: bulkAsset ? [bulkAsset.id] : [],
    });
    const blockingTt = blockedRows[0] ?? null;
    if (blockingTt) {
      return serialize({
        found: true as const,
        type: null,
        lineItemId: null,
        assetId: asset?.id ?? null,
        assetName,
        reason: "tt_blocked" as const,
        ttStatus: blockingTt.status,
        ttNextDueDate: blockingTt.nextDueDate != null ? new Date(blockingTt.nextDueDate) : null,
        ttLastTestDate: blockingTt.lastTestDate != null ? new Date(blockingTt.lastTestDate) : null,
        ttTestTagId: blockingTt.testTagId,
      });
    }
  }

  // ── Resolve which order line this scan applies to ─────────────────────
  // A deployed/assigned serialised asset is pinned to a line by a
  // ProjectLineItemUnit, not by ProjectLineItem.assetId. Units live in Convex —
  // pull the org's units once and resolve in JS (line-item → project mapping is
  // local since the unit carries only lineItemId).
  let lineItem: (typeof projectLines)[number] | null = null;
  const projectLineIds = new Set(projectLines.map((li) => li.id));
  // Map of every line item in the org keyed by id → {projectId, status}, so a
  // unit's line can be located on any project (for the "out elsewhere" check).
  const orgUnits = asset
    ? ((await convexScan.query(api.projectLineItemUnits.list, { orgId: organizationId })) as Array<{
        assetId?: string | null;
        lineItemId: string;
        status: string;
      }>).filter((u) => u.assetId === asset.id)
    : [];

  if (asset) {
    // Unit pinned to a line on THIS project (its line must not be CANCELLED).
    const unit = orgUnits.find((u) => projectLineIds.has(u.lineItemId)) ?? null;

    if (mode === "checkin") {
      // Check-in must target a unit that is still out.
      if (!unit || unit.status !== "CHECKED_OUT") {
        return serialize({
          found: true as const, type: "serialized" as const,
          lineItemId: null, assetId: asset.id, assetName,
          reason: "not_checked_out" as const,
        });
      }
      return serialize({
        found: true as const, type: "serialized" as const,
        lineItemId: unit.lineItemId, assetId: asset.id, assetName, reason: null,
      });
    }

    // checkout
    if (unit) {
      if (unit.status === "CHECKED_OUT") {
        return serialize({
          found: true as const, type: "serialized" as const,
          lineItemId: null, assetId: null, assetName,
          reason: "already_checked_out" as const,
        });
      }
      // Already assigned (prepped) to a line — deploy onto that line.
      return serialize({
        found: true as const, type: "serialized" as const,
        lineItemId: unit.lineItemId, assetId: asset.id, assetName, reason: null,
      });
    }

    // Not on this project yet — block if it is out on another job.
    if (asset.status === "CHECKED_OUT") {
      // A CHECKED_OUT unit for this asset whose line lives on another project.
      const otherUnit = orgUnits.find(
        (u) => u.status === "CHECKED_OUT" && !projectLineIds.has(u.lineItemId),
      );
      let detail = "";
      if (otherUnit) {
        const otherLine = await convexScan.query(api.projectLineItems.getById, {
          id: otherUnit.lineItemId,
        });
        const otherProject = otherLine?.projectId
          ? await getProjectById(otherLine.projectId)
          : null;
        detail = otherProject
          ? ` on ${otherProject.name}${otherProject.projectNumber ? ` (${otherProject.projectNumber})` : ""}`
          : "";
      }
      return serialize({
        found: true as const, type: "serialized" as const,
        lineItemId: null, assetId: null, assetName,
        reason: "asset_checked_out_elsewhere" as const, detail,
      });
    }

    // Find an order line of this model with spare capacity.
    const candidates = projectLines
      .filter((li) => li.modelId === modelId && !li.isKitChild)
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));
    lineItem =
      candidates.find((li) => (li.assignedQuantity ?? 0) < (li.quantity ?? 0)) ?? null;
  } else {
    // Bulk asset — find its order line on the project.
    lineItem =
      projectLines
        .filter((li) => li.modelId === modelId && !li.isKitChild)
        .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))[0] ?? null;
  }

  if (!lineItem) {
    const reason =
      mode === "checkin" && asset
        ? ("not_checked_out" as const)
        : ("not_on_project" as const);
    return serialize({
      found: true as const,
      type: null,
      lineItemId: null,
      assetId: asset?.id || null,
      assetName,
      reason,
      // Extra info for "not_on_project" — allows client to prompt adding asset
      modelId: modelId,
      bulkAssetId: bulkAsset?.id || null,
      isBulk: !!bulkAsset,
    });
  }

  // Bulk scan
  if (!asset) {
    if (mode === "checkin") {
      const lineUnits = await convexScan.query(api.projectLineItemUnits.listByLineItem, {
        lineItemId: lineItem.id,
      });
      const outUnit = lineUnits.find((u) => u.status === "CHECKED_OUT") ?? null;
      if (!outUnit) {
        return serialize({
          found: true as const, type: "bulk" as const, lineItemId: null,
          assetId: null, assetName, reason: "already_returned" as const,
        });
      }
    }
    return serialize({
      found: true as const, type: "bulk" as const, lineItemId: lineItem.id,
      assetId: null, assetName, reason: null,
    });
  }

  // Serialised checkout onto a line with capacity.
  return serialize({
    found: true as const, type: "serialized" as const,
    lineItemId: lineItem.id, assetId: asset.id, assetName, reason: null,
  });
}

/**
 * Graft the Convex `model` doc onto post-transaction line-item result rows.
 * The check-out/check-in tx includes dropped `model: true` (model lives in
 * Convex now); this re-attaches it from the org model map. Shape-identical to
 * the old flat `model: true` Prisma join, and null-safe over the `unknown[]`
 * results array (each entry is a line-item row carrying `modelId`).
 */
async function attachModelToResults(
  organizationId: string,
  results: unknown[],
): Promise<unknown[]> {
  const modelMap = await getModelMap(organizationId);
  return results.map((r) => {
    if (!r || typeof r !== "object") return r;
    const row = r as { modelId?: string | null };
    return { ...row, model: row.modelId ? modelMap.get(row.modelId) ?? null : null };
  });
}

// ── checkOutItems (refactored) ──────────────────────────────────────────

export async function checkOutItems(
  projectId: string,
  items: Array<{
    lineItemId: string;
    assetId?: string;
    quantity?: number;
    notes?: string;
  }>,
  includeAccessories = true,
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  // Block send-out while any blocking comment on the project is unresolved.
  await assertNoBlockingComments(organizationId, projectId, {
    actionLabel: "check out items",
  });

  // The whole atomic checkout (T&T preflight, prep-unit expansion, status flips,
  // unit/asset/bulk mutations, accessory cascade, scan logs) runs inside one
  // Convex mutation. We re-read the affected lines for the return payload.
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.checkoutItems, {
    organizationId,
    projectId,
    userId,
    items: items.map((i) => ({
      lineItemId: i.lineItemId,
      assetId: i.assetId,
      quantity: i.quantity,
      notes: i.notes,
    })),
    includeAccessories,
    now: Date.now(),
  });

  await logActivityMany(
    items.map((item) => ({
      organizationId,
      userId,
      userName,
      action: "CHECK_OUT",
      entityType: "asset",
      entityId: item.assetId || item.lineItemId,
      entityName: `Line item ${item.lineItemId}`,
      summary: `Checked out item on project`,
      projectId,
      assetId: item.assetId,
    })),
  );

  // Re-read the updated lines and graft the Convex model doc for the return.
  const rows = await Promise.all(
    res.updatedLineIds.map((id: string) => convex.query(api.projectLineItems.getById, { id })),
  );

  // Fired only after the gear physically moved. Best-effort: never blocks the write.
  void emitWebhookEvent(organizationId, "warehouse.checked_out", {
    projectId,
    lineItemIds: res.updatedLineIds,
    assetIds: items.map((i) => i.assetId).filter((a): a is string => Boolean(a)),
    count: res.updatedLineIds.length,
  });

  return serialize(await attachModelToResults(organizationId, rows));
}

// reassignLineItemUnit / reassignKitMemberSerial moved browser-direct (PR-B) — see
// convex/warehouseWrites.ts + src/hooks/use-warehouse-writes.ts.

export async function checkInItems(
  projectId: string,
  items: Array<{
    lineItemId: string;
    /** The scanned serialised asset being returned. Omit for bulk returns. */
    assetId?: string;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string;
  }>
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  // The whole atomic check-in (unit returns, asset/bulk restores, scan logs,
  // accessory cascade, line rollups) runs inside one Convex mutation.
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.checkinItems, {
    organizationId,
    projectId,
    userId,
    items,
    now: Date.now(),
  });

  await logActivityMany(
    items.map((item) => ({
      organizationId,
      userId,
      userName,
      action: "CHECK_IN",
      entityType: "asset",
      entityId: item.lineItemId,
      entityName: `Line item ${item.lineItemId}`,
      summary: `Checked in item on project (condition: ${item.returnCondition})`,
      projectId,
    })),
  );

  // Re-read the updated lines and graft the Convex model doc for the return.
  const rows = await Promise.all(
    res.updatedLineIds.map((id: string) => convex.query(api.projectLineItems.getById, { id })),
  );
  return serialize(await attachModelToResults(organizationId, rows));
}

// ── Move-back (reverse a stage) ──────────────────────────────────────────────

/** Deployed → Prepped. Reverse of checkOutItems for the selected units. */
export async function undeployItems(
  projectId: string,
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>,
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.undeployItems, {
    organizationId,
    projectId,
    userId,
    items: items.map((i) => ({ lineItemId: i.lineItemId, assetId: i.assetId, quantity: i.quantity })),
    now: Date.now(),
  });
  await logActivityMany(
    items.map((item) => ({
      organizationId, userId, userName, action: "UPDATE", entityType: "asset",
      entityId: item.assetId || item.lineItemId, entityName: `Line item ${item.lineItemId}`,
      summary: "Moved item back to Prepped (un-deploy)", projectId, assetId: item.assetId,
    })),
  );
  const rows = await Promise.all(
    res.updatedLineIds.map((id: string) => convex.query(api.projectLineItems.getById, { id })),
  );
  return serialize(await attachModelToResults(organizationId, rows));
}

/** Returned → Deployed. Reverse of checkInItems for the selected units. */
export async function unreturnItems(
  projectId: string,
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>,
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.unreturnItems, {
    organizationId,
    projectId,
    userId,
    items: items.map((i) => ({ lineItemId: i.lineItemId, assetId: i.assetId, quantity: i.quantity })),
    now: Date.now(),
  });
  await logActivityMany(
    items.map((item) => ({
      organizationId, userId, userName, action: "UPDATE", entityType: "asset",
      entityId: item.assetId || item.lineItemId, entityName: `Line item ${item.lineItemId}`,
      summary: "Moved item back to Deployed (un-return)", projectId, assetId: item.assetId,
    })),
  );
  const rows = await Promise.all(
    res.updatedLineIds.map((id: string) => convex.query(api.projectLineItems.getById, { id })),
  );
  return serialize(await attachModelToResults(organizationId, rows));
}

// undeprepLine / undeployKit / unreturnKit / undeployKitsBatch / unreturnKitsBatch
// moved browser-direct (PR-A) — see convex/warehouseWrites.ts + src/hooks/use-warehouse-writes.ts.

export async function checkOutKit(projectId: string, kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  // Block send-out while any blocking comment on the project is unresolved.
  await assertNoBlockingComments(organizationId, projectId, {
    actionLabel: "check out this kit",
  });

  // The whole atomic kit checkout (T&T preflight over this kit + nested kits,
  // line/asset/kit status flips, bulk decrements, scan log) runs in one Convex
  // mutation.
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.checkoutKit, {
    organizationId,
    projectId,
    userId,
    kitId,
    now: Date.now(),
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_OUT",
    entityType: "kit",
    entityId: kitId,
    entityName: `Kit ${kitId}`,
    summary: `Checked out kit with all contents`,
    projectId,
    kitId,
  });

  return serialize({ success: true, ...res });
}

export async function checkInKit(
  projectId: string,
  kitId: string,
  returnCondition: "GOOD" | "DAMAGED" | "MISSING" = "GOOD"
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  // The whole atomic kit check-in (line/asset/kit status resets, bulk restores,
  // scan log) runs in one Convex mutation.
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.checkinKit, {
    organizationId,
    projectId,
    userId,
    kitId,
    returnCondition,
    now: Date.now(),
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_IN",
    entityType: "kit",
    entityId: kitId,
    entityName: `Kit ${kitId}`,
    summary: `Checked in kit (condition: ${returnCondition})`,
    projectId,
    kitId,
  });

  return serialize({ success: true, ...res });
}

/**
 * Bulk-deploy many kits in ONE server round-trip AND ONE Convex mutation
 * (`checkoutKitsBatch`). Replaces the warehouse "Deploy Selected" loop that fired
 * one checkOutKit round-trip per kit. The project-wide blocking-comment gate is
 * checked once. The batch mutation reports each kit's pre-write validation failure
 * (kit-not-on-project, composition drift, T&T preflight) as a per-kit error so one
 * ineligible kit doesn't sink the rest — matching the old independent per-kit
 * mutations. A mid-write condition (short bulk) is atomic across the batch. Returns
 * succeeded kit ids + per-kit errors.
 */
export async function checkOutKitsBatch(projectId: string, kitIds: string[]) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");
  const unique = [...new Set(kitIds)];
  if (unique.length === 0) return serialize({ succeeded: [] as string[], errors: [] as { kitId: string; message: string }[] });

  // Project-wide blocker gate (kit checkout has no line scope) — check once.
  await assertNoBlockingComments(organizationId, projectId, { actionLabel: "check out this kit" });

  const convex = await getConvexClient();
  const now = Date.now();
  // ONE array mutation deploys every kit (was one round-trip per kit). Per-kit
  // pre-write validation (kit-not-on-project, composition drift, T&T preflight) is
  // reported as a per-kit error so one ineligible kit doesn't sink the rest —
  // matching the old independent per-kit mutations. A mid-write failure (short bulk)
  // is atomic across the batch (the mutation rejects and the operator retries).
  const { succeeded, errors } = await convex.mutation(api.warehouseOps.checkoutKitsBatch, {
    organizationId, projectId, userId, kitIds: unique, now,
  });
  await logActivityMany(
    succeeded.map((kitId) => ({
      organizationId, userId, userName, action: "CHECK_OUT", entityType: "kit",
      entityId: kitId, entityName: `Kit ${kitId}`, summary: "Checked out kit with all contents", projectId, kitId,
    })),
  );
  return serialize({ succeeded, errors });
}

/**
 * Bulk-return many kits in ONE server round-trip AND ONE Convex mutation
 * (`checkinKitsBatch`). Replaces the warehouse "Return Selected" loop that fired
 * one checkInKit round-trip per kit (for the kits that pass the interactive
 * verification/check-flow gates). A kit not on the project is reported as a per-kit
 * error; the rest still return.
 */
export async function checkInKitsBatch(
  projectId: string,
  kits: Array<{ kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }>,
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");
  // Dedupe by kitId (keep the first occurrence) — checkinKit restores the kit's
  // bulk contents each call, so returning the same kit twice would overstate
  // availability + double-log. (checkOutKitsBatch dedupes with `new Set`.)
  const seen = new Set<string>();
  const uniqueKits = kits.filter((k) => (seen.has(k.kitId) ? false : (seen.add(k.kitId), true)));
  if (uniqueKits.length === 0) return serialize({ succeeded: [] as string[], errors: [] as { kitId: string; message: string }[] });

  const convex = await getConvexClient();
  const now = Date.now();
  // ONE array mutation returns every kit (was one round-trip per kit). A kit not on
  // the project is reported as a per-kit error; the rest still return.
  const { succeeded, errors } = await convex.mutation(api.warehouseOps.checkinKitsBatch, {
    organizationId, projectId, userId,
    items: uniqueKits.map((k) => ({ kitId: k.kitId, returnCondition: k.returnCondition })),
    now,
  });
  await logActivityMany(
    uniqueKits
      .filter((k) => succeeded.includes(k.kitId))
      .map((k) => ({
        organizationId, userId, userName, action: "CHECK_IN", entityType: "kit",
        entityId: k.kitId, entityName: `Kit ${k.kitId}`, summary: `Checked in kit (condition: ${k.returnCondition})`, projectId, kitId: k.kitId,
      })),
  );
  return serialize({ succeeded, errors });
}

export async function getScanLog(params?: {
  projectId?: string;
  assetId?: string;
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { projectId, assetId, page = 1, pageSize = 25 } = params || {};

  // Fetch from Convex using the most selective index available.
  const convexForScanLog = await getConvexClient();
  let rawLogs;
  if (assetId) {
    rawLogs = await convexForScanLog.query(api.assetScanLogs.listByOrgAndAsset, { orgId: organizationId, assetId });
  } else if (projectId) {
    rawLogs = await convexForScanLog.query(api.assetScanLogs.listByProject, { orgId: organizationId, projectId });
  } else {
    rawLogs = await convexForScanLog.query(api.assetScanLogs.list, { orgId: organizationId });
  }

  rawLogs.sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0));
  const total = rawLogs.length;
  const pageLogs = rawLogs.slice((page - 1) * pageSize, page * pageSize);

  // Attach scannedBy + asset/bulk/project, all scoped to THIS PAGE's logs (≤pageSize)
  // — was getAssetsByOrg/getBulkAssetsByOrg/getProjectsByOrg (the whole org) to fill
  // maps used only for the page's rows.
  const scannedByIds = [...new Set(pageLogs.map((l) => l.scannedById))];
  const pageAssetIds = [...new Set(pageLogs.map((l) => l.assetId).filter((x): x is string => !!x))];
  const pageBulkIds = [...new Set(pageLogs.map((l) => l.bulkAssetId).filter((x): x is string => !!x))];
  const pageProjectIds = [...new Set(pageLogs.map((l) => l.projectId).filter((x): x is string => !!x))];
  const convexScanUsers = await getConvexClient();
  const [scanUsers, modelMap, allAssets, allBulkAssets, allProjects] = await Promise.all([
    scannedByIds.length > 0 ? convexScanUsers.query(api.users.listByIds, { ids: scannedByIds }) : Promise.resolve([]),
    getModelMap(organizationId),
    getAssetsByIds(organizationId, pageAssetIds),
    getBulkAssetsByIds(organizationId, pageBulkIds),
    pageProjectIds.length
      ? convexForScanLog.query(api.projects.listByIds, { orgId: organizationId, ids: pageProjectIds })
      : Promise.resolve([]),
  ]);
  // scannedBy now resolves from the Convex `users` mirror (was a prisma.user join).
  const scanUserMap = new Map(
    scanUsers.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, image: u.image ?? null }]),
  );
  const scanAssetMap = new Map(allAssets.map((a) => [a.id, a]));
  const scanBulkAssetMap = new Map(allBulkAssets.map((b) => [b.id, b]));
  const scanProjectMap = new Map(allProjects.map((p) => [p.id, p]));

  const logsWithModel = pageLogs.map((log) => {
    const convexAsset = log.assetId ? scanAssetMap.get(log.assetId) ?? null : null;
    return {
      ...log,
      asset: convexAsset
        ? { ...convexAsset, model: convexAsset.modelId ? modelMap.get(convexAsset.modelId) ?? null : null }
        : null,
      bulkAsset: log.bulkAssetId ? scanBulkAssetMap.get(log.bulkAssetId) ?? null : null,
      project: log.projectId ? scanProjectMap.get(log.projectId) ?? null : null,
      scannedBy: scanUserMap.get(log.scannedById) ?? null,
    };
  });

  return serialize({
    logs: logsWithModel,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function quickAddAndCheckOut(
  projectId: string,
  data: {
    modelId: string;
    assetId?: string;
    bulkAssetId?: string;
    quantity?: number;
    prepContainer?: string | null;
  }
) {
  const { organizationId, userId } = await requirePermission("warehouse", "check_out");

  // Block send-out while any blocking comment on the project is unresolved.
  await assertNoBlockingComments(organizationId, projectId, {
    actionLabel: "check out items",
  });

  // The atomic add (T&T preflight, line-item create, scan log) runs in one
  // Convex mutation; it returns the new line id which we re-read for the return.
  const convex = await getConvexClient();
  const res = await convex.mutation(api.warehouseOps.quickAdd, {
    organizationId,
    projectId,
    modelId: data.modelId,
    assetId: data.assetId ?? undefined,
    bulkAssetId: data.bulkAssetId ?? undefined,
    quantity: data.quantity ?? undefined,
    prepContainer: data.prepContainer ?? undefined,
    userId,
    now: Date.now(),
  });

  const lineItem = await convex.query(api.projectLineItems.getById, { id: res.id });

  // Attach `model` + `_count.modelCheckItems` from the Convex mirror, matching
  // the old `model: { include: { _count: { modelCheckItems } } }` include shape
  // (model scalars + the check-item count — no category/supplier). The client
  // routes the line through the check queue when the count is non-zero.
  const [model, modelCheckCounts] = await Promise.all([
    lineItem?.modelId ? getModelById(lineItem.modelId) : Promise.resolve(null),
    getModelCheckItemCountMap(organizationId),
  ]);
  const modelWithCount = model
    ? { ...model, _count: { modelCheckItems: modelCheckCounts.get(model.id) ?? 0 } }
    : null;

  return serialize({ ...lineItem, model: modelWithCount });
}

// clearPrepContainer / ensureContainerOnProject / syncContainersBatch moved
// browser-direct (PR-A) — see convex/warehouseWrites.ts + src/hooks/use-warehouse-writes.ts.
// The dead singular syncContainerStatus was dropped (no live caller).

type AvailableAssetRow = {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  customName: string | null;
};

/**
 * Available serialised assets for ONE model — shared engine for the single and
 * batched actions. Was a per-ASSET query loop (`listByAssetId` once per asset —
 * a 50-asset model = 50 sequential Convex reads); now ONE `listByModelId` query
 * returns every line item for the model, from which the in-use asset set is
 * derived. Identical result, O(1) queries per model instead of O(assets).
 */
async function availableAssetsForModel(
  modelId: string,
  organizationId: string,
  activeProjectIds: Set<string>,
): Promise<AvailableAssetRow[]> {
  const convex = await getConvexClient();
  const [modelAssets, lines] = await Promise.all([
    getActiveAssetsByModel(modelId, organizationId),
    convex.query(api.projectLineItems.listByModelId, { modelId, orgId: organizationId }),
  ]);
  // An asset is in use if ANY of its line items is on an active project AND
  // (status not RETURNED/CANCELLED OR prepStatus PACKED) — same predicate as the
  // old per-asset check, now evaluated once over the model's line items.
  const inUseAssetIds = new Set(
    lines
      .filter(
        (li) =>
          li.assetId != null &&
          li.projectId != null &&
          activeProjectIds.has(li.projectId) &&
          ((li.status !== "RETURNED" && li.status !== "CANCELLED") || li.prepStatus === "PACKED"),
      )
      .map((li) => li.assetId as string),
  );
  return modelAssets
    .filter((a) => a.status === "AVAILABLE" && !inUseAssetIds.has(a.id))
    .map((a) => ({
      id: a.id,
      assetTag: a.assetTag,
      serialNumber: a.serialNumber ?? null,
      customName: a.customName ?? null,
    }))
    .sort((x, y) => x.assetTag.localeCompare(y.assetTag));
}

/** Active (non-template, non-terminal) project ids — the availability scope. */
async function activeProjectIdSet(organizationId: string): Promise<Set<string>> {
  const allProjects = await getProjectsByOrg(organizationId);
  return new Set(
    allProjects
      .filter(
        (p) =>
          !p.isTemplate &&
          !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? ""),
      )
      .map((p) => p.id),
  );
}

export async function getAvailableAssetsForModel(modelId: string) {
  const { organizationId } = await getOrgContext();
  const activeProjectIds = await activeProjectIdSet(organizationId);
  return serialize(await availableAssetsForModel(modelId, organizationId, activeProjectIds));
}

/**
 * Available serialised assets for MANY models in ONE server round-trip — replaces
 * the warehouse asset-picker's `for (item of needsAssetPicker) await
 * getAvailableAssetsForModel(li.modelId)` loop (one round-trip per item, each of
 * which was itself a per-asset query loop). Returns a `{ [modelId]: rows }` map.
 * The active-project scope is read once; each model's availability is computed
 * concurrently.
 */
export async function getAvailableAssetsForModels(modelIds: string[]) {
  const { organizationId } = await getOrgContext();
  const unique = [...new Set(modelIds)];
  if (unique.length === 0) return serialize({} as Record<string, AvailableAssetRow[]>);

  const activeProjectIds = await activeProjectIdSet(organizationId);
  const entries = await Promise.all(
    unique.map(async (modelId) => [modelId, await availableAssetsForModel(modelId, organizationId, activeProjectIds)] as const),
  );
  return serialize(Object.fromEntries(entries) as Record<string, AvailableAssetRow[]>);
}

export async function getProjectPullSheet(projectId: string) {
  const { organizationId } = await getOrgContext();

  // The EQUIPMENT line-item tree (lineItems → childLineItems, model/supplier/kit/
  // asset/bulkAsset + per-asset location graft, CANCELLED dropped, no units) is
  // reconstructed from the dual-written Convex tables — see buildPullSheetLineItems
  // (Phase A keystone consumer 3/4). project is Convex-only — read the scalars.
  const project = await getProjectByIdMapped(projectId, organizationId);

  if (!project) {
    throw new Error("Project not found");
  }

  const { lineItems: attachedLineItems, locationMap } = await buildPullSheetLineItems(
    projectId,
    organizationId,
  );

  // Compute overbooked status
  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    attachedLineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  const enrichedLineItems = attachedLineItems
    .filter((li) => {
      const isSubhireItem = li.subHireId != null;
      // Kit children render under their parent
      if (li.isKitChild && !isSubhireItem) return false;
      // Sub-hire group parents are wrappers — their children show individually
      if (isSubhireItem && !li.isKitChild && !li.kitId && (li.childLineItems?.length ?? 0) > 0) return false;
      return true;
    })
    .map((li) => {
      const info = overbookedMap.get(li.id);
      return {
        ...li,
        isOverbooked: !!info,
        overbookedInfo: info ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        childLineItems: li.childLineItems?.map((child: any) => {
          const childInfo = overbookedMap.get(child.id);
          return { ...child, isOverbooked: !!childInfo, overbookedInfo: childInfo ?? null };
        }),
      };
    });

  // Group line items by groupName
  const groups: Record<string, typeof enrichedLineItems> = {};
  for (const item of enrichedLineItems) {
    const key = item.groupName || "Ungrouped";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  }

  // Clients live in Convex — attach instead of a Prisma join. Return the
  // Convex-attached tree as `project.lineItems` too (not the model/supplier-less
  // raw Prisma rows) so the payload stays byte-identical to the old include even
  // though current consumers read `groups`, not `project.lineItems`.
  const client = project.clientId ? await getClientById(project.clientId) : null;
  const location = project.locationId ? locationMap.get(project.locationId) ?? null : null;
  return serialize({
    project: { ...project, lineItems: attachedLineItems, client, location },
    groups,
  });
}

// forceReturnAsset / forceReturnKit / forceReturnKits / bulkForceReturnAssets moved
// browser-direct (PR-B) — see convex/warehouseWrites.ts + src/hooks/use-warehouse-writes.ts.
