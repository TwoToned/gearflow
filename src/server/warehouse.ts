"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientById } from "@/lib/clients-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getLocationMap } from "@/lib/locations-read";
import { serialize } from "@/lib/serialize";
import { computeOverbookedStatus } from "@/lib/availability";
import type { Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity-log";
import {
  syncLineItemRollup,
  ensureSerialisedUnit,
  expandAccessoriesForAsset,
  ensureBulkUnit,
  returnLineUnits,
  checkinAccessoryChildren,
} from "@/lib/line-item-fulfillment";
import {
  adjustBulkAvailability,
  coalesceAdjustments,
  type BulkAdjustment,
  type TxClient,
} from "@/lib/inventory-mutations";
import { TestTagBlockError } from "@/lib/errors/test-tag-block-error";
import { syncKitsToConvex } from "@/lib/kit-mirror";
import { syncAssetsToConvex, syncBulkAssetsToConvex } from "@/lib/asset-mirror";
import { upsertProjectLineItemsToConvex, syncLineItemsToConvex } from "@/lib/line-item-mirror";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  attachModelCheckItemCounts,
  attachKitTree,
  getModelCheckItemCountMap,
  getKitCheckItemCountMap,
} from "@/lib/line-item-tree-read";
import { getKitMap } from "@/lib/kits-read";

// ---------------------------------------------------------------------------
// Kit bulk-content traversal
// ---------------------------------------------------------------------------

/**
 * Returns bulk-quantity adjustments for one kit's permanent composition
 * (KitBulkItem rows). Nested kits are NOT recursed here — the caller is
 * already iterating the project line-item tree and calls this once per
 * kit id encountered.
 *
 * @param sign -1 to consume (kit checkout), +1 to release (kit check-in)
 */
async function collectKitBulkAdjustments(
  tx: TxClient,
  kitId: string,
  organizationId: string,
  sign: -1 | 1,
): Promise<BulkAdjustment[]> {
  const bulks = await tx.kitBulkItem.findMany({
    where: { kitId, organizationId },
    select: { bulkAssetId: true, quantity: true },
  });
  return bulks.map((b) => ({
    bulkAssetId: b.bulkAssetId,
    delta: sign * b.quantity,
  }));
}

// ---------------------------------------------------------------------------
// Test & Tag (AS/NZS 3760:2022) compliance gate
// ---------------------------------------------------------------------------

// TestTagBlockError lives in src/lib/errors/test-tag-block-error.ts because
// "use server" files can only export async functions.

/**
 * Asserts that none of the given assets are blocked by failed/overdue
 * Test & Tag status. Throws TestTagBlockError on block. Logs a SCAN_VERIFY
 * row for each blocked asset so the denied scan is auditable.
 *
 * Pass at least one of assetIds or bulkAssetIds. Empty input is a no-op.
 */
async function assertTestTagAllowsCheckout(
  tx: TxClient,
  organizationId: string,
  options: {
    assetIds?: string[];
    bulkAssetIds?: string[];
    projectId?: string | null;
    scannedById: string;
    kitId?: string | null;
  },
): Promise<void> {
  const assetIds = options.assetIds?.filter(Boolean) ?? [];
  const bulkAssetIds = options.bulkAssetIds?.filter(Boolean) ?? [];
  if (assetIds.length === 0 && bulkAssetIds.length === 0) return;

  const blocked = await tx.testTagAsset.findMany({
    where: {
      organizationId,
      isActive: true,
      status: { in: ["FAILED", "OVERDUE"] },
      OR: [
        ...(assetIds.length > 0 ? [{ assetId: { in: assetIds } }] : []),
        ...(bulkAssetIds.length > 0 ? [{ bulkAssetId: { in: bulkAssetIds } }] : []),
      ],
    },
    select: {
      testTagId: true,
      status: true,
      nextDueDate: true,
      assetId: true,
      bulkAssetId: true,
      asset: { select: { assetTag: true } },
      bulkAsset: { select: { assetTag: true } },
    },
  });

  if (blocked.length === 0) return;

  // Log every blocked scan so the audit trail is complete
  for (const b of blocked) {
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: b.assetId,
        bulkAssetId: b.bulkAssetId,
        kitId: options.kitId ?? null,
        projectId: options.projectId ?? null,
        action: "SCAN_VERIFY",
        scannedById: options.scannedById,
        notes: `Checkout blocked: T&T ${b.status} for ${b.asset?.assetTag ?? b.bulkAsset?.assetTag ?? b.testTagId}`,
      },
    });
  }

  throw new TestTagBlockError(
    blocked.map((b) => ({
      assetTag: b.asset?.assetTag ?? b.bulkAsset?.assetTag ?? b.testTagId,
      status: b.status as "FAILED" | "OVERDUE",
      nextDueDate: b.nextDueDate,
    })),
  );
}

export async function getProjectForWarehouse(projectId: string) {
  const { organizationId } = await getOrgContext();

  // model + supplier + kit are all dual-written to Convex and attached in JS
  // below (Phase 6 decommission) — not joined here. Their check-item counts
  // (`model._count.modelCheckItems` / `kit._count.kitCheckItems`) also come off
  // the Convex mirror now that both junction tables are dual-written.
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      location: true,
      lineItems: {
        where: { type: "EQUIPMENT" },
        orderBy: { sortOrder: "asc" },
        include: {
          asset: true,
          bulkAsset: true,
          // Per-unit assignments (post-cutover, the source of truth for
          // which physical assets the warehouse is preparing / deploying
          // / returning on this line).
          units: {
            orderBy: { ordinal: "asc" },
            where: { status: { not: "CANCELLED" } },
            include: {
              asset: { select: { id: true, assetTag: true } },
              bulkAsset: { select: { id: true, assetTag: true } },
            },
          },
          childLineItems: {
            orderBy: { sortOrder: "asc" },
            include: {
              asset: true, bulkAsset: true,
              units: {
                orderBy: { ordinal: "asc" },
                where: { status: { not: "CANCELLED" } },
                include: {
                  asset: { select: { id: true, assetTag: true } },
                  bulkAsset: { select: { id: true, assetTag: true } },
                },
              },
              childLineItems: {
                orderBy: { sortOrder: "asc" },
                include: {
                  asset: true, bulkAsset: true,
                  units: {
                    orderBy: { ordinal: "asc" },
                    where: { status: { not: "CANCELLED" } },
                    include: {
                      asset: { select: { id: true, assetTag: true } },
                      bulkAsset: { select: { id: true, assetTag: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.isTemplate) {
    throw new Error("Cannot perform warehouse operations on a template");
  }

  // Attach model (+ equipment category) + supplier + kit from the Convex mirror,
  // grafting model._count.modelCheckItems + kit._count.kitCheckItems from the
  // mirror too, so the warehouse payload keeps its exact shape.
  const [attachMaps, kitMap, modelCheckCounts, kitCheckCounts] = await Promise.all([
    buildLineItemAttachMaps(organizationId),
    getKitMap(organizationId),
    getModelCheckItemCountMap(organizationId),
    getKitCheckItemCountMap(organizationId),
  ]);
  const withModelSupplier = attachLineItemTree(project.lineItems, attachMaps);
  const withModelCount = attachModelCheckItemCounts(withModelSupplier, modelCheckCounts);
  const lineItems = attachKitTree(withModelCount, kitMap, kitCheckCounts);

  // Clients live in Convex — attach instead of a Prisma join.
  const client = project.clientId ? await getClientById(project.clientId) : null;
  return serialize({ ...project, lineItems, client });
}

export async function lookupAssetForScan(
  projectId: string,
  assetTag: string,
  mode: "checkout" | "checkin" = "checkout"
) {
  const { organizationId } = await getOrgContext();

  // Look up the asset tag in all tables: serialized, bulk, kits. The `model`
  // join is attached from the Convex mirror below (model is dual-written) — the
  // scan path only reads `model.name`; the old `category` + `_count` includes
  // here were vestigial (never consumed). No Prisma fallback on a mirror miss.
  const [rawAsset, rawBulkAsset, kit] = await Promise.all([
    prisma.asset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    }),
    prisma.bulkAsset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    }),
    prisma.kit.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    }),
  ]);
  const [assetModel, bulkAssetModel] = await Promise.all([
    rawAsset ? getModelById(rawAsset.modelId) : Promise.resolve(null),
    rawBulkAsset ? getModelById(rawBulkAsset.modelId) : Promise.resolve(null),
  ]);
  const asset = rawAsset ? { ...rawAsset, model: assetModel } : null;
  const bulkAsset = rawBulkAsset ? { ...rawBulkAsset, model: bulkAssetModel } : null;

  // If it's a Kit barcode
  if (kit) {
    const kitLineItem = await prisma.projectLineItem.findFirst({
      where: { projectId, organizationId, kitId: kit.id, isKitChild: false, status: { notIn: ["CANCELLED"] } },
    });
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
    const parentKit = await prisma.kit.findUnique({ where: { id: asset.kitId }, select: { id: true, assetTag: true, name: true } });
    return serialize({
      found: true as const, type: "kit_member" as const, lineItemId: null, assetId: asset.id,
      assetName: asset.model?.name ?? "", kitId: parentKit?.id || null, kitAssetTag: parentKit?.assetTag || null, reason: "asset_in_kit" as const,
    });
  }

  // If this serialized asset is a permanent accessory of another asset, prompt
  // to scan the parent instead — accessories move with their parent.
  if (asset && asset.parentAssetId) {
    const parent = await prisma.asset.findFirst({ where: { id: asset.parentAssetId, organizationId }, select: { id: true, assetTag: true } });
    return serialize({
      found: true as const, type: "asset_child" as const, lineItemId: null, assetId: asset.id,
      assetName: asset.model?.name ?? "", parentAssetId: parent?.id || null, parentAssetTag: parent?.assetTag || null, reason: "asset_is_accessory" as const,
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
    const blockingTt = await prisma.testTagAsset.findFirst({
      where: {
        organizationId,
        isActive: true,
        status: { in: ["FAILED", "OVERDUE"] },
        OR: [
          ...(asset ? [{ assetId: asset.id }] : []),
          ...(bulkAsset ? [{ bulkAssetId: bulkAsset.id }] : []),
        ],
      },
      select: { status: true, nextDueDate: true, lastTestDate: true, testTagId: true },
    });
    if (blockingTt) {
      return serialize({
        found: true as const,
        type: null,
        lineItemId: null,
        assetId: asset?.id ?? null,
        assetName,
        reason: "tt_blocked" as const,
        ttStatus: blockingTt.status,
        ttNextDueDate: blockingTt.nextDueDate,
        ttLastTestDate: blockingTt.lastTestDate,
        ttTestTagId: blockingTt.testTagId,
      });
    }
  }

  // ── Resolve which order line this scan applies to ─────────────────────
  // A deployed/assigned serialised asset is pinned to a line by a
  // ProjectLineItemUnit, not by ProjectLineItem.assetId.
  let lineItem = null;

  if (asset) {
    const unit = await prisma.projectLineItemUnit.findFirst({
      where: {
        assetId: asset.id,
        lineItem: {
          projectId,
          organizationId,
          status: { notIn: ["CANCELLED"] },
        },
      },
      select: { lineItemId: true, status: true },
    });

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
      const otherUnit = await prisma.projectLineItemUnit.findFirst({
        where: {
          assetId: asset.id,
          status: "CHECKED_OUT",
          lineItem: { projectId: { not: projectId }, organizationId },
        },
        select: {
          lineItem: {
            select: { project: { select: { name: true, projectNumber: true } } },
          },
        },
      });
      const otherProject = otherUnit?.lineItem.project;
      const detail = otherProject
        ? ` on ${otherProject.name}${otherProject.projectNumber ? ` (${otherProject.projectNumber})` : ""}`
        : "";
      return serialize({
        found: true as const, type: "serialized" as const,
        lineItemId: null, assetId: null, assetName,
        reason: "asset_checked_out_elsewhere" as const, detail,
      });
    }

    // Find an order line of this model with spare capacity.
    const candidates = await prisma.projectLineItem.findMany({
      where: {
        projectId,
        organizationId,
        modelId,
        isKitChild: false,
        status: { notIn: ["CANCELLED"] },
      },
      orderBy: { sortOrder: "asc" },
    });
    lineItem =
      candidates.find((li) => li.assignedQuantity < li.quantity) ?? null;
  } else {
    // Bulk asset — find its order line on the project.
    lineItem = await prisma.projectLineItem.findFirst({
      where: {
        projectId,
        organizationId,
        modelId,
        isKitChild: false,
        status: { notIn: ["CANCELLED"] },
      },
      orderBy: { sortOrder: "asc" },
    });
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
      const outUnit = await prisma.projectLineItemUnit.findFirst({
        where: { lineItemId: lineItem.id, status: "CHECKED_OUT" },
        select: { id: true },
      });
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

// ---------------------------------------------------------------------------
// Accessory cascade — permanent accessories (child assets) move with their
// parent through the warehouse. They are separate child line items
// (childKind: ACCESSORY, parentLineItemId set), so the parent's checkout /
// checkin must flip the children through the SAME unit path as any other line
// (ensureSerialisedUnit / ensureBulkUnit / returnLineUnits) — never a parallel
// cascade. No-op when the parent has no accessories.
// ---------------------------------------------------------------------------

async function checkoutAccessoryChildren(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    projectId: string;
    parentLineItemId: string;
    userId: string;
    projectLocationId: string | null;
  },
) {
  const { organizationId, projectId, parentLineItemId, userId, projectLocationId } = args;
  const children = await tx.projectLineItem.findMany({
    where: { parentLineItemId, organizationId, childKind: "ACCESSORY" },
  });

  // SECURITY/COMPLIANCE: accessory children are SEPARATE line items with their
  // own ids and units. The top-level checkout preflight only gathers ids from
  // the scanned parent lines + their units, so accessory children never reach
  // it — whether they were materialised at prep time (own line ids the
  // preflight can't see) or at scan time (expanded AFTER the preflight ran).
  // Without this gate a failed/overdue accessory ships ungated. Assert here;
  // a block throws TestTagBlockError and rolls back the whole checkout batch,
  // matching the top-level preflight's all-or-nothing semantics.
  //
  // Scope the gate to children that will ACTUALLY be flipped now — i.e. not
  // already CHECKED_OUT. The cascade below skips already-out units (guarded
  // updates), so gating an already-deployed sibling accessory would wrongly
  // block a later partial deploy of the same multi-quantity parent line if
  // that sibling's T&T lapsed after it shipped. (Note: a not-yet-deployed
  // sibling accessory IS still gated, because the line-scoped cascade would
  // flip it; tightening that to true per-unit scope is the deferred "snapshot
  // per-unit accessory contributions" follow-up — see FEATUREDOCS/48.)
  const gateChildren = children.filter((c) => c.status !== "CHECKED_OUT");
  await assertTestTagAllowsCheckout(tx, organizationId, {
    assetIds: gateChildren.map((c) => c.assetId).filter((x): x is string => !!x),
    bulkAssetIds: gateChildren.map((c) => c.bulkAssetId).filter((x): x is string => !!x),
    projectId,
    scannedById: userId,
  });

  // Collect every serialised accessory asset whose status flips, for the Convex
  // mirror (asset is dual-written). Returned to the caller to sync post-commit.
  const assetsTouched: string[] = [];
  for (const child of children) {
    if (child.assetId) {
      const asset = await tx.asset.findUnique({ where: { id: child.assetId }, select: { status: true } });
      // Skip if already deployed (idempotent on repeated parent scans).
      const { id: unitId } = await ensureSerialisedUnit(tx, { organizationId, lineItemId: child.id, assetId: child.assetId });
      await tx.projectLineItemUnit.updateMany({
        where: { id: unitId, status: { not: "CHECKED_OUT" } },
        data: { status: "CHECKED_OUT", checkedOutAt: new Date(), checkedOutById: userId },
      });
      if (asset?.status !== "CHECKED_OUT") {
        await tx.asset.updateMany({
          where: { id: child.assetId, organizationId },
          data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
        });
        assetsTouched.push(child.assetId);
      }
      await tx.assetScanLog.create({
        data: { organizationId, assetId: child.assetId, projectId, action: "CHECK_OUT", scannedById: userId, notes: "Accessory — moved with parent" },
      });
    } else if (child.bulkAssetId) {
      const { id: unitId } = await ensureBulkUnit(tx, { organizationId, lineItemId: child.id, bulkAssetId: child.bulkAssetId, quantity: child.quantity });
      await tx.projectLineItemUnit.update({
        where: { id: unitId },
        data: { status: "CHECKED_OUT", quantity: child.quantity, checkedOutAt: new Date(), checkedOutById: userId },
      });
      await tx.assetScanLog.create({
        data: { organizationId, bulkAssetId: child.bulkAssetId, projectId, action: "CHECK_OUT", scannedById: userId, notes: "Accessory — moved with parent" },
      });
    }
    await syncLineItemRollup(tx, child.id);
  }
  return { assetsTouched };
}


// ── checkOutItems helpers ─────────────────────────────────────────────────

/** Return value from checkOutSerializedItem: signals whether the caller should
 *  `continue` (skip post-checkout finalization for this item). */
type CheckoutItemResult = { kind: "continue" } | { kind: "done" };

/**
 * Gather every serialized and bulk asset id that will be affected by the
 * checkout batch and assert none have a failed/overdue Test & Tag record.
 * Returns the preflight line items (needed by the prep-unit expansion step).
 */
async function gatherTestTagAssetsAndAssert(
  tx: TxClient,
  organizationId: string,
  userId: string,
  projectId: string,
  items: Array<{ lineItemId: string; assetId?: string }>,
): Promise<Array<{ id: string; assetId: string | null; bulkAssetId: string | null }>> {
  const lineItemIds = items.map((i) => i.lineItemId);
  const [preflightLineItems, preflightUnits] = await Promise.all([
    tx.projectLineItem.findMany({
      where: { id: { in: lineItemIds }, organizationId, projectId },
      select: { id: true, assetId: true, bulkAssetId: true },
    }),
    tx.projectLineItemUnit.findMany({
      where: { lineItemId: { in: lineItemIds }, organizationId },
      select: { assetId: true, bulkAssetId: true },
    }),
  ]);
  const preflightAssetIds = [
    ...(preflightLineItems.map((li) => li.assetId).filter(Boolean) as string[]),
    ...(preflightUnits.map((u) => u.assetId).filter(Boolean) as string[]),
    ...(items.map((i) => i.assetId).filter(Boolean) as string[]),
  ];
  const preflightBulkIds = [
    ...(preflightLineItems.map((li) => li.bulkAssetId).filter(Boolean) as string[]),
    ...(preflightUnits.map((u) => u.bulkAssetId).filter(Boolean) as string[]),
  ];
  await assertTestTagAllowsCheckout(tx, organizationId, {
    assetIds: preflightAssetIds,
    bulkAssetIds: preflightBulkIds,
    projectId,
    scannedById: userId,
  });
  return preflightLineItems;
}

/**
 * Expand "deploy the whole prepped line" items into one item per prepped
 * unit so that each prep assignment materializes as a real checkout.
 */
async function expandPrepUnitAssignments(
  tx: TxClient,
  organizationId: string,
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }>,
  preflightLineItems: Array<{ id: string; assetId: string | null; bulkAssetId: string | null }>,
): Promise<typeof items> {
  const expandedItems: typeof items = [];
  for (const item of items) {
    if (item.assetId) {
      expandedItems.push(item);
      continue;
    }
    const lineItemRow = preflightLineItems.find((l) => l.id === item.lineItemId);
    if (lineItemRow?.assetId || lineItemRow?.bulkAssetId) {
      expandedItems.push(item);
      continue;
    }
    const lineUnits = await tx.projectLineItemUnit.findMany({
      where: {
        lineItemId: item.lineItemId,
        organizationId,
        status: { not: "CHECKED_OUT" },
        OR: [
          { assetId: { not: null } },
          { bulkAssetId: { not: null } },
        ],
      },
      select: { assetId: true, bulkAssetId: true, quantity: true },
      orderBy: { ordinal: "asc" },
    });
    if (lineUnits.length === 0) {
      expandedItems.push(item);
      continue;
    }
    const want = item.quantity ?? lineUnits.length;
    const toDeploy = lineUnits.slice(0, Math.max(1, Math.min(want, lineUnits.length)));
    for (const u of toDeploy) {
      expandedItems.push({
        lineItemId: item.lineItemId,
        ...(u.assetId
          ? { assetId: u.assetId }
          : { quantity: u.quantity }),
        notes: item.notes,
      });
    }
  }
  return expandedItems;
}

/**
 * Validate and execute a serialised-asset checkout: scope the asset to the
 * caller's org, guard against double-deploy / unavailable statuses, create or
 * update the unit row, flip asset status, and write a scan log.
 *
 * @returns `{ kind: "continue" }` when the asset is already deployed on its
 *          own unit (caller should skip post-checkout finalization).
 *          `{ kind: "done" }` on a successful fresh checkout.
 */
async function checkOutSerializedItem(
  tx: TxClient,
  params: {
    organizationId: string;
    lineItemId: string;
    targetAssetId: string;
    userId: string;
    projectLocationId: string | null;
    projectId: string;
    notes?: string;
  },
): Promise<CheckoutItemResult> {
  const { organizationId, lineItemId, targetAssetId, userId, projectLocationId, projectId, notes } = params;

  const assetRecord = await tx.asset.findFirst({
    where: { id: targetAssetId, organizationId },
    select: { status: true, assetTag: true },
  });
  if (!assetRecord) {
    throw new Error(`Asset not found in this organization`);
  }
  if (assetRecord.status === "CHECKED_OUT") {
    const ownUnit = await tx.projectLineItemUnit.findUnique({
      where: {
        lineItemId_assetId: {
          lineItemId,
          assetId: targetAssetId,
        },
      },
      select: { status: true },
    });
    if (ownUnit && ownUnit.status === "CHECKED_OUT") return { kind: "continue" };
    throw new Error(`Asset ${assetRecord.assetTag} is already deployed`);
  }
  if (
    assetRecord.status === "RETIRED" ||
    assetRecord.status === "IN_MAINTENANCE" ||
    assetRecord.status === "LOST"
  ) {
    throw new Error(
      `Asset ${assetRecord.assetTag} is ${assetRecord.status
        .replace("_", " ")
        .toLowerCase()} and cannot be deployed`,
    );
  }

  const { id: unitId } = await ensureSerialisedUnit(tx, {
    organizationId,
    lineItemId,
    assetId: targetAssetId,
  });
  await tx.projectLineItemUnit.updateMany({
    where: { id: unitId, status: { not: "CHECKED_OUT" } },
    data: {
      status: "CHECKED_OUT",
      checkedOutAt: new Date(),
      checkedOutById: userId,
    },
  });

  await tx.asset.updateMany({
    where: { id: targetAssetId, organizationId },
    data: {
      status: "CHECKED_OUT",
      ...(projectLocationId && { locationId: projectLocationId }),
    },
  });
  await tx.assetScanLog.create({
    data: {
      organizationId,
      assetId: targetAssetId,
      projectId,
      action: "CHECK_OUT",
      scannedById: userId,
      notes: notes || null,
    },
  });
  return { kind: "done" };
}

/**
 * Execute a bulk-asset checkout: create or update a unit row carrying the
 * checkout quantity and write a scan log.
 */
async function checkOutBulkItem(
  tx: TxClient,
  params: {
    organizationId: string;
    lineItemId: string;
    lineItemQuantity: number;
    bulkAssetId: string;
    checkoutQty: number;
    userId: string;
    projectId: string;
    notes?: string;
  },
): Promise<void> {
  const { organizationId, lineItemId, lineItemQuantity, bulkAssetId, checkoutQty, userId, projectId, notes } = params;

  const { id: unitId } = await ensureBulkUnit(tx, {
    organizationId,
    lineItemId,
    bulkAssetId,
    quantity: checkoutQty,
  });
  await tx.projectLineItemUnit.update({
    where: { id: unitId },
    data: {
      status: "CHECKED_OUT",
      quantity: checkoutQty,
      checkedOutAt: new Date(),
      checkedOutById: userId,
    },
  });
  await tx.assetScanLog.create({
    data: {
      organizationId,
      bulkAssetId,
      projectId,
      action: "CHECK_OUT",
      scannedById: userId,
      notes:
        notes ||
        `Checked out ${checkoutQty} of ${lineItemQuantity}`,
    },
  });
}

/**
 * Deploy-whole-line edge: flip the line directly (no physical unit to track).
 * Pushes the updated line into the results array and signals the caller to
 * `continue` (skip post-checkout finalization).
 */
async function checkOutDeployWholeLine(
  tx: TxClient,
  params: {
    lineItemId: string;
    lineItemQuantity: number;
    userId: string;
  },
  updated: unknown[],
): Promise<void> {
  const { lineItemId, lineItemQuantity, userId } = params;
  await tx.projectLineItem.update({
    where: { id: lineItemId },
    data: {
      status: "CHECKED_OUT",
      checkedOutQuantity: lineItemQuantity,
      checkedOutAt: new Date(),
      checkedOutBy: { connect: { id: userId } },
    },
  });
  updated.push(
    await tx.projectLineItem.findUnique({
      where: { id: lineItemId },
      // model lives in Convex — attached after the tx (see attachModelToResults).
      include: { asset: true, bulkAsset: true },
    }),
  );
}

/**
 * Post-checkout finalization: expand accessories, roll up the unit onto the
 * order line, cascade checkout to accessory children, and push the updated
 * line into the results array.
 */
async function finalizeCheckoutItem(
  tx: TxClient,
  params: {
    organizationId: string;
    lineItemId: string;
    targetAssetId: string | null;
    projectId: string;
    userId: string;
    projectLocationId: string | null;
    includeAccessories?: boolean;
  },
  updated: unknown[],
): Promise<{ assetsTouched: string[] }> {
  const { organizationId, lineItemId, targetAssetId, projectId, userId, projectLocationId, includeAccessories } = params;

  let assetsTouched: string[] = [];
  if (includeAccessories !== false) {
    if (targetAssetId) {
      await expandAccessoriesForAsset(tx, { organizationId, lineItemId, assetId: targetAssetId });
    }

    const r = await checkoutAccessoryChildren(tx, {
      organizationId,
      projectId,
      parentLineItemId: lineItemId,
      userId,
      projectLocationId,
    });
    assetsTouched = r.assetsTouched;
  }

  await syncLineItemRollup(tx, lineItemId);

  updated.push(
    await tx.projectLineItem.findUnique({
      where: { id: lineItemId },
      // model lives in Convex — attached after the tx (see attachModelToResults).
      include: { asset: true, bulkAsset: true },
    }),
  );
  return { assetsTouched };
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

  const touchedAssetIds = new Set<string>();
  const results = await prisma.$transaction(async (tx) => {
    const updated: unknown[] = [];

    // Fetch the project's location to update asset locations on checkout
    const project = await tx.project.findUnique({
      where: { id: projectId, organizationId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    // Pre-flight T&T compliance block
    const preflightLineItems = await gatherTestTagAssetsAndAssert(
      tx, organizationId, userId, projectId, items,
    );

    // Expand deploy-whole-prep items into one item per prepped unit
    const expandedItems = await expandPrepUnitAssignments(
      tx, organizationId, items, preflightLineItems,
    );

    for (const item of expandedItems) {
      // Verify line item belongs to this project and org
      const lineItem = await tx.projectLineItem.findFirst({
        where: {
          id: item.lineItemId,
          projectId,
          organizationId,
        },
      });

      if (!lineItem) {
        throw new Error(`Line item ${item.lineItemId} not found in project`);
      }

      const targetAssetId = item.assetId || lineItem.assetId || null;

      if (targetAssetId) {
        const result = await checkOutSerializedItem(tx, {
          organizationId,
          lineItemId: lineItem.id,
          targetAssetId,
          userId,
          projectLocationId,
          projectId,
          notes: item.notes,
        });
        if (result.kind === "continue") continue;
        touchedAssetIds.add(targetAssetId);
      } else if (lineItem.bulkAssetId) {
        const checkoutQty = item.quantity || lineItem.quantity;
        await checkOutBulkItem(tx, {
          organizationId,
          lineItemId: lineItem.id,
          lineItemQuantity: lineItem.quantity,
          bulkAssetId: lineItem.bulkAssetId,
          checkoutQty,
          userId,
          projectId,
          notes: item.notes,
        });
      } else {
        await checkOutDeployWholeLine(tx, {
          lineItemId: lineItem.id,
          lineItemQuantity: lineItem.quantity,
          userId,
        }, updated);
        continue;
      }

      const fin = await finalizeCheckoutItem(tx, {
        organizationId,
        lineItemId: lineItem.id,
        targetAssetId,
        projectId,
        userId,
        projectLocationId,
        includeAccessories,
      }, updated);
      for (const id of fin.assetsTouched) touchedAssetIds.add(id);
    }

    return updated;
  });

  // Mirror the checked-out asset status/location changes (scanned assets +
  // cascaded accessories) + the project's line-item status flips / scan-time
  // accessory expansions to Convex.
  await syncAssetsToConvex([...touchedAssetIds]);
  await upsertProjectLineItemsToConvex(projectId);

  for (const item of items) {
    await logActivity({
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
    });
  }

  // model lives in Convex — graft it onto the result rows (the tx dropped the join).
  return serialize(await attachModelToResults(organizationId, results));
}

// ── checkInItems helper ─────────────────────────────────────────────────

/**
 * Process a single check-in item: call returnLineUnits, write scan log,
 * sync the line rollup, cascade to accessory children, and push the
 * updated line item into the results array.
 */
async function processItemCheckIn(
  tx: TxClient,
  params: {
    organizationId: string;
    projectId: string;
    userId: string;
    defaultLocationId: string | null;
  },
  item: {
    lineItemId: string;
    assetId?: string;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string;
  },
  updated: unknown[],
): Promise<{ assetsTouched: string[] }> {
  const { organizationId, projectId, userId, defaultLocationId } = params;

  const { unitsFlipped, assetsTouched } = await returnLineUnits(tx, {
    organizationId,
    projectId,
    lineItemId: item.lineItemId,
    assetId: item.assetId,
    returnCondition: item.returnCondition,
    quantity: item.quantity,
    notes: item.notes,
    userId,
    defaultLocationId,
  });

  if (assetsTouched.length === 1) {
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: assetsTouched[0],
        projectId,
        action: "CHECK_IN",
        scannedById: userId,
        notes: item.notes || null,
      },
    });
  } else if (unitsFlipped > 0 || assetsTouched.length > 0) {
    await tx.assetScanLog.create({
      data: {
        organizationId,
        projectId,
        action: "CHECK_IN",
        scannedById: userId,
        notes: item.notes || `Returned ${unitsFlipped} unit(s)`,
      },
    });
  }

  await syncLineItemRollup(tx, item.lineItemId);

  const touched = [...assetsTouched];
  if (unitsFlipped > 0) {
    const acc = await checkinAccessoryChildren(tx, {
      organizationId,
      projectId,
      parentLineItemId: item.lineItemId,
      returnCondition: item.returnCondition ?? "GOOD",
      userId,
      defaultLocationId,
      returnedAssetId: item.assetId ?? null,
    });
    touched.push(...acc.assetsTouched);
  }

  updated.push(
    await tx.projectLineItem.findUnique({
      where: { id: item.lineItemId },
      // model lives in Convex — attached after the tx (see attachModelToResults).
      include: { asset: true, bulkAsset: true },
    }),
  );
  return { assetsTouched: touched };
}

// ── checkInItems (refactored) ───────────────────────────────────────────

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

  const touchedAssetIds = new Set<string>();
  const results = await prisma.$transaction(async (tx) => {
    const updated: unknown[] = [];

    // Find the org's default location to restore assets to on return
    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id || null;

    for (const item of items) {
      const r = await processItemCheckIn(tx, {
        organizationId,
        projectId,
        userId,
        defaultLocationId,
      }, item, updated);
      for (const id of r.assetsTouched) touchedAssetIds.add(id);
    }

    return updated;
  });

  // Mirror the returned asset status/location changes + the project's line-item
  // status flips to Convex.
  await syncAssetsToConvex([...touchedAssetIds]);
  await upsertProjectLineItemsToConvex(projectId);

  for (const item of items) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CHECK_IN",
      entityType: "asset",
      entityId: item.lineItemId,
      entityName: `Line item ${item.lineItemId}`,
      summary: `Checked in item on project (condition: ${item.returnCondition})`,
      projectId,
    });
  }

  // model lives in Convex — graft it onto the result rows (the tx dropped the join).
  return serialize(await attachModelToResults(organizationId, results));
}

export async function checkOutKit(projectId: string, kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const result = await prisma.$transaction(async (tx) => {
    // Find the kit parent line item on this project
    const kitLineItem = await tx.projectLineItem.findFirst({
      where: { projectId, organizationId, kitId, isKitChild: false },
    });
    if (!kitLineItem) throw new Error("Kit not found on this project");

    // Fetch the project's location to update kit/asset locations
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    // Pre-flight T&T compliance block — gather every asset id reachable
    // through the kit's permanent composition (KitSerializedItem and
    // KitBulkItem) plus any nested kit's composition. If any asset has
    // FAILED/OVERDUE T&T status, throw and roll back. Mirror of the
    // bulk-availability gathering pattern from Wave 1.5.
    const kitSerializedItems = await tx.kitSerializedItem.findMany({
      where: { kitId },
      select: { assetId: true },
    });
    const kitBulkItems = await tx.kitBulkItem.findMany({
      where: { kitId, organizationId },
      select: { bulkAssetId: true },
    });
    // Find nested kits via child line items so we can include their composition
    const kitChildren = await tx.projectLineItem.findMany({
      where: { parentLineItemId: kitLineItem.id, organizationId },
      select: { kitId: true },
    });
    const nestedKitIds = kitChildren
      .map((c) => c.kitId)
      .filter(Boolean) as string[];
    const nestedSerializedItems = nestedKitIds.length
      ? await tx.kitSerializedItem.findMany({
          where: { kitId: { in: nestedKitIds } },
          select: { assetId: true },
        })
      : [];
    const nestedBulkItems = nestedKitIds.length
      ? await tx.kitBulkItem.findMany({
          where: { kitId: { in: nestedKitIds }, organizationId },
          select: { bulkAssetId: true },
        })
      : [];
    await assertTestTagAllowsCheckout(tx, organizationId, {
      assetIds: [
        ...kitSerializedItems.map((k) => k.assetId),
        ...nestedSerializedItems.map((k) => k.assetId),
      ],
      bulkAssetIds: [
        ...kitBulkItems.map((k) => k.bulkAssetId),
        ...nestedBulkItems.map((k) => k.bulkAssetId),
      ],
      projectId,
      scannedById: userId,
      kitId,
    });

    // Accumulate every asset/bulk id whose row this checkout mutates, for the
    // Convex mirror (both dual-written) after the transaction commits.
    const txTouchedAssets = new Set<string>();
    const txTouchedBulk = new Set<string>();

    // Update kit parent line item
    await tx.projectLineItem.update({
      where: { id: kitLineItem.id },
      data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
    });

    // Update all child line items (direct children)
    const children = await tx.projectLineItem.findMany({
      where: { parentLineItemId: kitLineItem.id, organizationId },
      select: { id: true, assetId: true, kitId: true },
    });
    if (children.length > 0) {
      await tx.projectLineItem.updateMany({
        where: { id: { in: children.map((c) => c.id) } },
        data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
      });
    }

    // Handle grandchildren: children of nested kits inside this kit
    const nestedKitChildren = children.filter((c) => c.kitId);
    for (const nestedChild of nestedKitChildren) {
      // Update grandchild line items
      await tx.projectLineItem.updateMany({
        where: { parentLineItemId: nestedChild.id, organizationId },
        data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
      });
      // Update the nested kit entity status
      await tx.kit.update({
        where: { id: nestedChild.kitId! },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
      // Update serialized assets inside the nested kit
      const nestedKitItems = await tx.kitSerializedItem.findMany({ where: { kitId: nestedChild.kitId! } });
      if (nestedKitItems.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: nestedKitItems.map((ki) => ki.assetId) } },
          data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
        });
        for (const ki of nestedKitItems) txTouchedAssets.add(ki.assetId);
      }
    }

    // Update child assets referenced by line items (for prep-kits whose contents are line item references, not KitSerializedItem)
    const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
    if (childAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: childAssetIds } },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
      for (const id of childAssetIds) txTouchedAssets.add(id);
    }
    // Also update grandchild assets
    if (nestedKitChildren.length > 0) {
      const grandchildren = await tx.projectLineItem.findMany({
        where: { parentLineItemId: { in: nestedKitChildren.map((c) => c.id) }, organizationId },
        select: { assetId: true },
      });
      const grandchildAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
      if (grandchildAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: grandchildAssetIds } },
          data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
        });
        for (const id of grandchildAssetIds) txTouchedAssets.add(id);
      }
    }

    // Update Kit status and location
    await tx.kit.update({
      where: { id: kitId },
      data: {
        status: "CHECKED_OUT",
        ...(projectLocationId && { locationId: projectLocationId }),
      },
    });

    // Update all serialized assets inside the kit (KitSerializedItem records — for regular kits)
    const kitItems = await tx.kitSerializedItem.findMany({ where: { kitId } });
    if (kitItems.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: kitItems.map((ki) => ki.assetId) } },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
      for (const ki of kitItems) txTouchedAssets.add(ki.assetId);
    }

    // Decrement BulkAsset.availableQuantity for every KitBulkItem in this kit
    // AND every nested kit. Concurrency-safe via the shared helper: if any
    // bulk has insufficient stock under concurrent writes, throws and rolls
    // back the entire transaction (no partial checkout).
    const bulkAdjustments: BulkAdjustment[] = [
      ...(await collectKitBulkAdjustments(tx, kitId, organizationId, -1)),
    ];
    for (const nestedChild of nestedKitChildren) {
      bulkAdjustments.push(
        ...(await collectKitBulkAdjustments(tx, nestedChild.kitId!, organizationId, -1)),
      );
    }
    if (bulkAdjustments.length > 0) {
      await adjustBulkAvailability(tx, organizationId, coalesceAdjustments(bulkAdjustments));
      for (const a of bulkAdjustments) txTouchedBulk.add(a.bulkAssetId);
    }

    // Create scan log for the kit
    await tx.assetScanLog.create({
      data: { organizationId, kitId, projectId, action: "CHECK_OUT", scannedById: userId, notes: "Kit deployed with all contents" },
    });

    return {
      success: true,
      kitId,
      affectedKitIds: [kitId, ...nestedKitChildren.map((c) => c.kitId!)],
      touchedAssets: [...txTouchedAssets],
      touchedBulk: [...txTouchedBulk],
    };
  });

  // Mirror the kit status/location changes (this kit + any nested kits) + the
  // affected serialized assets + bulk quantity changes to Convex.
  await syncKitsToConvex(result.affectedKitIds);
  await syncAssetsToConvex(result.touchedAssets);
  await syncBulkAssetsToConvex(result.touchedBulk);
  await upsertProjectLineItemsToConvex(projectId);

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

  return serialize(result);
}

export async function checkInKit(
  projectId: string,
  kitId: string,
  returnCondition: "GOOD" | "DAMAGED" | "MISSING" = "GOOD"
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const result = await prisma.$transaction(async (tx) => {
    const kitLineItem = await tx.projectLineItem.findFirst({
      where: { projectId, organizationId, kitId, isKitChild: false },
    });
    if (!kitLineItem) throw new Error("Kit not found on this project");

    // Find the org's default location to restore kit/assets to
    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id || null;

    // Accumulate every asset/bulk id whose row this check-in mutates, for the
    // Convex mirror (both dual-written) after the transaction commits.
    const txTouchedAssets = new Set<string>();
    const txTouchedBulk = new Set<string>();

    // Update kit parent line item
    await tx.projectLineItem.update({
      where: { id: kitLineItem.id },
      data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition },
    });

    const newKitStatus = returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : returnCondition === "MISSING" ? "INCOMPLETE" : "AVAILABLE";
    const assetStatus = returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : returnCondition === "MISSING" ? "LOST" : "AVAILABLE";

    // Update all child line items (direct children)
    const children = await tx.projectLineItem.findMany({
      where: { parentLineItemId: kitLineItem.id, organizationId, status: "CHECKED_OUT" },
      select: { id: true, assetId: true, kitId: true },
    });
    if (children.length > 0) {
      await tx.projectLineItem.updateMany({
        where: { id: { in: children.map((c) => c.id) } },
        data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition },
      });
    }

    // Handle grandchildren: children of nested kits inside this kit
    const nestedKitChildren = children.filter((c) => c.kitId);
    for (const nestedChild of nestedKitChildren) {
      // Return grandchild line items
      await tx.projectLineItem.updateMany({
        where: { parentLineItemId: nestedChild.id, organizationId, status: "CHECKED_OUT" },
        data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition },
      });
      // Reset the nested kit entity
      await tx.kit.update({
        where: { id: nestedChild.kitId! },
        data: { status: newKitStatus, locationId: defaultLocationId },
      });
      // Reset serialized assets inside the nested kit
      const nestedKitItems = await tx.kitSerializedItem.findMany({ where: { kitId: nestedChild.kitId! } });
      if (nestedKitItems.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: nestedKitItems.map((ki) => ki.assetId) } },
          data: { status: assetStatus, locationId: defaultLocationId },
        });
        for (const ki of nestedKitItems) txTouchedAssets.add(ki.assetId);
      }
    }

    // Reset child assets referenced by line items (for prep-kits)
    const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
    if (childAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: childAssetIds } },
        data: { status: assetStatus, locationId: defaultLocationId },
      });
      for (const id of childAssetIds) txTouchedAssets.add(id);
    }
    // Also reset grandchild assets
    if (nestedKitChildren.length > 0) {
      const grandchildren = await tx.projectLineItem.findMany({
        where: { parentLineItemId: { in: nestedKitChildren.map((c) => c.id) }, organizationId },
        select: { assetId: true },
      });
      const grandchildAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
      if (grandchildAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: grandchildAssetIds } },
          data: { status: assetStatus, locationId: defaultLocationId },
        });
        for (const id of grandchildAssetIds) txTouchedAssets.add(id);
      }
    }

    // Update Kit status and restore location
    await tx.kit.update({
      where: { id: kitId },
      data: { status: newKitStatus, locationId: defaultLocationId },
    });

    // Update all serialized assets inside the kit (KitSerializedItem — for regular kits)
    const kitItems = await tx.kitSerializedItem.findMany({ where: { kitId } });
    if (kitItems.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: kitItems.map((ki) => ki.assetId) } },
        data: { status: assetStatus, locationId: defaultLocationId },
      });
      for (const ki of kitItems) txTouchedAssets.add(ki.assetId);
    }

    // Restore BulkAsset.availableQuantity for every KitBulkItem in this kit
    // AND every nested kit. Returns always release stock back to available
    // regardless of condition — bulk damage/loss tracking is a Wave 3 concern
    // (DamageEvent model). For now: stock returns, period.
    const bulkAdjustments: BulkAdjustment[] = [
      ...(await collectKitBulkAdjustments(tx, kitId, organizationId, +1)),
    ];
    for (const nestedChild of nestedKitChildren) {
      bulkAdjustments.push(
        ...(await collectKitBulkAdjustments(tx, nestedChild.kitId!, organizationId, +1)),
      );
    }
    if (bulkAdjustments.length > 0) {
      await adjustBulkAvailability(tx, organizationId, coalesceAdjustments(bulkAdjustments));
      for (const a of bulkAdjustments) txTouchedBulk.add(a.bulkAssetId);
    }

    // Create scan log
    await tx.assetScanLog.create({
      data: { organizationId, kitId, projectId, action: "CHECK_IN", scannedById: userId, notes: `Kit returned — condition: ${returnCondition}` },
    });

    return {
      success: true,
      kitId,
      affectedKitIds: [kitId, ...nestedKitChildren.map((c) => c.kitId!)],
      touchedAssets: [...txTouchedAssets],
      touchedBulk: [...txTouchedBulk],
    };
  });

  // Mirror the kit status/location changes (this kit + any nested kits) + the
  // affected serialized assets + bulk quantity changes to Convex.
  await syncKitsToConvex(result.affectedKitIds);
  await syncAssetsToConvex(result.touchedAssets);
  await syncBulkAssetsToConvex(result.touchedBulk);
  await upsertProjectLineItemsToConvex(projectId);

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

  return serialize(result);
}

export async function getScanLog(params?: {
  projectId?: string;
  assetId?: string;
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { projectId, assetId, page = 1, pageSize = 25 } = params || {};

  const where: Prisma.AssetScanLogWhereInput = {
    organizationId,
    ...(projectId && { projectId }),
    ...(assetId && { assetId }),
  };

  const [logs, total] = await Promise.all([
    prisma.assetScanLog.findMany({
      where,
      include: {
        // asset.model lives in Convex — attached after the query, not joined.
        asset: true,
        bulkAsset: true,
        project: true,
        scannedBy: true,
      },
      orderBy: { scannedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.assetScanLog.count({ where }),
  ]);

  // Graft the Convex model doc onto each log's asset (replaces asset.model join).
  const modelMap = await getModelMap(organizationId);
  const logsWithModel = logs.map((log) =>
    log.asset
      ? { ...log, asset: { ...log.asset, model: log.asset.modelId ? modelMap.get(log.asset.modelId) ?? null : null } }
      : log,
  );

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

  const result = await prisma.$transaction(async (tx) => {
    // T&T compliance block — refuse to add an asset to a project if its
    // electrical-safety test is failed or overdue.
    await assertTestTagAllowsCheckout(tx, organizationId, {
      assetIds: data.assetId ? [data.assetId] : [],
      bulkAssetIds: data.bulkAssetId ? [data.bulkAssetId] : [],
      projectId,
      scannedById: userId,
    });

    // Get next sort order
    const maxSort = await tx.projectLineItem.aggregate({
      where: { projectId, organizationId },
      _max: { sortOrder: true },
    });
    const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

    const qty = data.quantity || 1;

    // Create the line item — starts as PENDING so the client can route through
    // the check queue if the model has check items assigned
    const lineItem = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId,
        type: "EQUIPMENT",
        modelId: data.modelId,
        assetId: data.assetId || null,
        bulkAssetId: data.bulkAssetId || null,
        quantity: qty,
        sortOrder: nextSort,
        status: "CONFIRMED",
        checkedOutQuantity: 0,
        prepStatus: "PENDING",
        prepContainer: data.prepContainer || null,
      },
      // `model` is attached from the Convex mirror after the tx (dual-written);
      // its `_count.modelCheckItems` is grafted from the dual-written
      // model_check_item mirror. asset/bulkAsset stay Prisma joins.
      include: {
        asset: true,
        bulkAsset: true,
      },
    });

    // Create scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: data.assetId || null,
        bulkAssetId: data.bulkAssetId || null,
        projectId,
        action: "CHECK_OUT",
        scannedById: userId,
        notes: "Added to project and prepped via warehouse scan",
      },
    });

    return lineItem;
  });

  // Mirror the newly-created line item to Convex (dual-write — this scan-add path
  // previously missed it, leaving the Convex projectLineItems mirror short a row
  // until a resync).
  await upsertProjectLineItemsToConvex(projectId);

  // Attach `model` + `_count.modelCheckItems` from the Convex mirror, matching
  // the old `model: { include: { _count: { modelCheckItems } } }` include shape
  // (model scalars + the check-item count — no category/supplier). The client
  // routes the line through the check queue when the count is non-zero. No Prisma
  // fallback on a mirror miss.
  const [model, modelCheckCounts] = await Promise.all([
    result.modelId ? getModelById(result.modelId) : Promise.resolve(null),
    getModelCheckItemCountMap(organizationId),
  ]);
  const modelWithCount = model
    ? { ...model, _count: { modelCheckItems: modelCheckCounts.get(model.id) ?? 0 } }
    : null;

  return serialize({ ...result, model: modelWithCount });
}

export async function clearPrepContainer(projectId: string, containerName: string) {
  const { organizationId } = await requirePermission("warehouse", "check_out");

  await prisma.projectLineItem.updateMany({
    where: { projectId, organizationId, prepContainer: containerName },
    data: { prepContainer: null },
  });

  return serialize({ success: true });
}

export async function ensureContainerOnProject(
  projectId: string,
  assetId: string,
  modelId: string,
  containerName: string
) {
  const { organizationId, userId } = await requirePermission("warehouse", "check_out");

  // Atomic check-then-create inside a transaction to prevent duplicates
  const lineItem = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectLineItem.findFirst({
      where: { projectId, organizationId, assetId, isContainerLineItem: true },
      // model lives in Convex — attached after the tx, not joined.
      include: { asset: true },
    });
    if (existing) return existing;

    // Get next sort order
    const maxSort = await tx.projectLineItem.aggregate({
      where: { projectId, organizationId },
      _max: { sortOrder: true },
    });
    const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

    return tx.projectLineItem.create({
      data: {
        organizationId,
        projectId,
        type: "EQUIPMENT",
        modelId,
        assetId,
        quantity: 1,
        sortOrder: nextSort,
        status: "CONFIRMED",
        checkedOutQuantity: 0,
        prepStatus: "PACKED",
        prepContainer: containerName,
        isContainerLineItem: true,
      },
      // model lives in Convex — attached after the tx, not joined.
      include: { asset: true },
    });
  });

  // Graft the Convex model doc onto the line item (replaces the `model: true` join).
  const modelMap = await getModelMap(organizationId);
  const model = lineItem.modelId ? modelMap.get(lineItem.modelId) ?? null : null;
  return serialize({ ...lineItem, model });
}

export async function syncContainerStatus(projectId: string, containerName: string) {
  const { organizationId, userId } = await requirePermission("warehouse", "check_out");

  // Find the container line item
  const containerLI = await prisma.projectLineItem.findFirst({
    where: { projectId, organizationId, isContainerLineItem: true, prepContainer: containerName },
  });
  if (!containerLI) return serialize({ updated: false });

  // Get all non-container items in this container
  const contentItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      prepContainer: containerName,
      isContainerLineItem: false,
    },
    select: { status: true },
  });

  if (contentItems.length === 0) return serialize({ updated: false });

  const allDeployed = contentItems.every((i) => i.status === "CHECKED_OUT");
  const allReturned = contentItems.every((i) => i.status === "RETURNED");

  const allDeployedFlag = allDeployed && containerLI.status !== "CHECKED_OUT";
  const allReturnedFlag = allReturned && containerLI.status !== "RETURNED";

  if (!allDeployedFlag && !allReturnedFlag) return serialize({ updated: false });

  if (allDeployedFlag) {
    await prisma.projectLineItem.update({
      where: { id: containerLI.id },
      data: {
        status: "CHECKED_OUT",
        checkedOutQuantity: 1,
        checkedOutAt: new Date(),
        checkedOutBy: { connect: { id: userId } },
      },
    });
  } else {
    await prisma.projectLineItem.update({
      where: { id: containerLI.id },
      data: {
        status: "RETURNED",
        returnedQuantity: 1,
        returnedAt: new Date(),
        returnedBy: { connect: { id: userId } },
        returnCondition: "GOOD",
      },
    });
  }

  // Update the container asset status too
  if (containerLI.assetId) {
    const updatedAsset = await prisma.asset.update({
      where: { id: containerLI.assetId },
      data: {
        status: allDeployedFlag ? "CHECKED_OUT" : "AVAILABLE",
      },
    });
    await syncAssetsToConvex([updatedAsset.id]);
  }
  // Mirror the container line item's status flip to Convex.
  await upsertProjectLineItemsToConvex(projectId);

  return serialize({ updated: true, status: allDeployedFlag ? "CHECKED_OUT" : "RETURNED" });
}

export async function getAvailableAssetsForModel(modelId: string) {
  const { organizationId } = await getOrgContext();

  // Single query: get assets that have NO active line item referencing them.
  // Uses Prisma's `none` relation filter — equivalent to SQL NOT EXISTS.
  // An asset is "in use" if ANY line item on an active project:
  //   a) has a non-terminal status (not RETURNED/CANCELLED), OR
  //   b) has prepStatus = PACKED (belt-and-suspenders for re-prep edge cases)
  const available = await prisma.asset.findMany({
    where: {
      organizationId,
      modelId,
      status: "AVAILABLE",
      isActive: true,
      lineItems: {
        none: {
          OR: [
            { status: { notIn: ["RETURNED", "CANCELLED"] } },
            { prepStatus: "PACKED" },
          ],
          project: {
            isTemplate: false,
            status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
          },
        },
      },
    },
    select: { id: true, assetTag: true, serialNumber: true, customName: true },
    orderBy: { assetTag: "asc" },
  });

  return serialize(available);
}

export async function getProjectPullSheet(projectId: string) {
  const { organizationId } = await getOrgContext();

  // model (+ equipment category) + supplier + kit are all dual-written to Convex
  // and attached in JS below (Phase 6 decommission) — not joined here.
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      location: true,
      lineItems: {
        where: {
          type: "EQUIPMENT",
          status: { not: "CANCELLED" },
        },
        orderBy: { sortOrder: "asc" },
        include: {
          asset: { include: { location: true } },
          bulkAsset: true,
          childLineItems: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { sortOrder: "asc" },
            include: {
              asset: { include: { location: true } },
              bulkAsset: true,
              childLineItems: {
                where: { status: { not: "CANCELLED" } },
                orderBy: { sortOrder: "asc" },
                include: {
                  asset: { include: { location: true } },
                  bulkAsset: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  // Attach model (+ equipment category) + supplier + kit from the Convex mirror,
  // grafting model._count.modelCheckItems + kit._count.kitCheckItems off the
  // mirror too. Done before overbooked/enrichment so downstream sees the same
  // shape the old Prisma include produced.
  const [attachMaps, kitMap, modelCheckCounts, kitCheckCounts] = await Promise.all([
    buildLineItemAttachMaps(organizationId),
    getKitMap(organizationId),
    getModelCheckItemCountMap(organizationId),
    getKitCheckItemCountMap(organizationId),
  ]);
  const attachedTree = attachLineItemTree(project.lineItems, attachMaps);
  const withModelCount = attachModelCheckItemCounts(attachedTree, modelCheckCounts);
  const attachedLineItems = attachKitTree(withModelCount, kitMap, kitCheckCounts);

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
        childLineItems: li.childLineItems?.map((child) => {
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
  return serialize({
    project: { ...project, lineItems: attachedLineItems, client },
    groups,
  });
}

export async function forceReturnAsset(assetId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { id: true, assetTag: true, status: true },
  });

  if (!asset) throw new Error("Asset not found");
  if (asset.status === "AVAILABLE") throw new Error("Asset is already available");

  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Return all checked-out line items for this asset across all projects
    await tx.projectLineItem.updateMany({
      where: { assetId, organizationId, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedQuantity: 1,
        returnedAt: new Date(),
        returnCondition: "GOOD",
      },
    });

    // Reset asset status and location
    await tx.asset.update({
      where: { id: assetId },
      data: {
        status: "AVAILABLE",
        locationId: defaultLocation?.id ?? null,
      },
    });
  });
  await syncAssetsToConvex([assetId]);
  // Mirror the returned line items across every affected project.
  const farProjects = await prisma.projectLineItem.findMany({
    where: { assetId, organizationId }, select: { projectId: true }, distinct: ["projectId"],
  });
  for (const p of farProjects) await upsertProjectLineItemsToConvex(p.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "FORCE_RETURN",
    entityType: "asset",
    entityId: assetId,
    entityName: asset.assetTag,
    summary: `Force returned asset ${asset.assetTag} to available`,
  });

  return serialize({ success: true });
}

// ── forceReturnKit helper ───────────────────────────────────────────────

/**
 * Restore a single kit parent line item: return all children/grandchildren,
 * reset nested kits and their assets, reset child assets, and return the
 * parent. Collects nested kit ids into `kitsToRestore` for later bulk
 * restoration.
 */
async function restoreKitParentLineItem(
  tx: TxClient,
  parent: { id: string; status: string },
  params: {
    organizationId: string;
    returnData: { status: "RETURNED"; returnedQuantity: number; returnedAt: Date; returnCondition: "GOOD" };
    resetData: { status: "AVAILABLE"; locationId: string | null };
  },
  kitsToRestore: Set<string>,
  assetsTouched: Set<string>,
): Promise<void> {
  const { organizationId, returnData, resetData } = params;

  const children = await tx.projectLineItem.findMany({
    where: { parentLineItemId: parent.id, organizationId },
    select: { id: true, assetId: true, kitId: true, status: true },
  });

  // Handle grandchildren first (children of nested kits)
  const nestedKitChildren = children.filter((c) => c.kitId);
  for (const child of nestedKitChildren) {
    const grandchildren = await tx.projectLineItem.findMany({
      where: { parentLineItemId: child.id, organizationId },
      select: { id: true, assetId: true },
    });
    if (grandchildren.length > 0) {
      await tx.projectLineItem.updateMany({
        where: { id: { in: grandchildren.map((gc) => gc.id) }, status: "CHECKED_OUT" },
        data: returnData,
      });
      const gcAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
      if (gcAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: gcAssetIds } },
          data: resetData,
        });
        for (const id of gcAssetIds) assetsTouched.add(id);
      }
    }
  }

  // Reset nested child kits to AVAILABLE + their serialized assets
  const childKitIds = nestedKitChildren.map((c) => c.kitId!);
  for (const nestedKitId of childKitIds) kitsToRestore.add(nestedKitId);
  if (childKitIds.length > 0) {
    await tx.kit.updateMany({
      where: { id: { in: childKitIds }, organizationId },
      data: resetData,
    });
    const nestedKitAssets = await tx.kitSerializedItem.findMany({
      where: { kitId: { in: childKitIds } },
      select: { assetId: true },
    });
    if (nestedKitAssets.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: nestedKitAssets.map((a) => a.assetId) } },
        data: resetData,
      });
      for (const a of nestedKitAssets) assetsTouched.add(a.assetId);
    }
  }

  // Return all children
  const checkedOutChildren = children.filter((c) => c.status === "CHECKED_OUT");
  if (checkedOutChildren.length > 0) {
    await tx.projectLineItem.updateMany({
      where: { id: { in: checkedOutChildren.map((c) => c.id) } },
      data: returnData,
    });
  }

  // Reset child assets to AVAILABLE
  const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
  if (childAssetIds.length > 0) {
    await tx.asset.updateMany({
      where: { id: { in: childAssetIds } },
      data: resetData,
    });
    for (const id of childAssetIds) assetsTouched.add(id);
  }

  // Return parent line item
  if (parent.status === "CHECKED_OUT") {
    await tx.projectLineItem.update({
      where: { id: parent.id },
      data: returnData,
    });
  }
}

// ── forceReturnKit (refactored) ─────────────────────────────────────────

export async function forceReturnKit(kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const kit = await prisma.kit.findFirst({
    where: { id: kitId, organizationId },
    select: { id: true, assetTag: true, name: true, status: true },
  });

  if (!kit) throw new Error("Kit not found");
  if (kit.status === "AVAILABLE") throw new Error("Kit is already available");

  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  const affectedKitIds = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const returnData = { status: "RETURNED" as const, returnedQuantity: 1, returnedAt: now, returnCondition: "GOOD" as const };
    const resetData = { status: "AVAILABLE" as const, locationId: defaultLocation?.id ?? null };

    // Track every kit id that needs bulk restoration (this kit + every unique
    // nested kit encountered across all parent line items), plus every asset/
    // bulk row whose status/quantity this force-return mutates (Convex mirror).
    const kitsToRestore = new Set<string>([kitId]);
    const assetsTouched = new Set<string>();
    const bulkTouched = new Set<string>();

    // Find all parent line items for this kit across all projects
    const kitParentItems = await tx.projectLineItem.findMany({
      where: { kitId, organizationId, isKitChild: false },
      select: { id: true, status: true },
    });

    for (const parent of kitParentItems) {
      await restoreKitParentLineItem(tx, parent, { organizationId, returnData, resetData }, kitsToRestore, assetsTouched);
    }

    // Reset kit status
    await tx.kit.update({
      where: { id: kitId },
      data: resetData,
    });

    // Reset all serialized assets inside this kit (KitSerializedItem records)
    const kitItems = await tx.kitSerializedItem.findMany({
      where: { kitId },
      select: { assetId: true },
    });
    if (kitItems.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: kitItems.map((ki) => ki.assetId) } },
        data: resetData,
      });
      for (const ki of kitItems) assetsTouched.add(ki.assetId);
    }

    // Restore BulkAsset.availableQuantity for the root kit and every unique
    // nested kit that was encountered.
    const bulkAdjustments: BulkAdjustment[] = [];
    for (const kid of kitsToRestore) {
      bulkAdjustments.push(
        ...(await collectKitBulkAdjustments(tx, kid, organizationId, +1)),
      );
    }
    if (bulkAdjustments.length > 0) {
      await adjustBulkAvailability(tx, organizationId, coalesceAdjustments(bulkAdjustments));
      for (const a of bulkAdjustments) bulkTouched.add(a.bulkAssetId);
    }

    return { kitIds: [...kitsToRestore], assets: [...assetsTouched], bulk: [...bulkTouched] };
  });

  // Mirror the kit status/location resets (root kit + every nested kit) + the
  // affected assets + bulk quantity restores to Convex.
  await syncKitsToConvex(affectedKitIds.kitIds);
  await syncAssetsToConvex(affectedKitIds.assets);
  await syncBulkAssetsToConvex(affectedKitIds.bulk);
  // Mirror the returned line items across every project this kit appears on.
  const frkProjects = await prisma.projectLineItem.findMany({
    where: { kitId, organizationId }, select: { projectId: true }, distinct: ["projectId"],
  });
  for (const p of frkProjects) await upsertProjectLineItemsToConvex(p.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "FORCE_RETURN",
    entityType: "kit",
    entityId: kitId,
    entityName: `${kit.assetTag} - ${kit.name}`,
    summary: `Force returned kit ${kit.assetTag} and all contents to available`,
  });

  return serialize({ success: true });
}

export async function bulkForceReturnAssets(assetIds: string[]) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  if (assetIds.length === 0) throw new Error("No assets selected");

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, organizationId, status: "CHECKED_OUT" },
    select: { id: true, assetTag: true },
  });

  if (assets.length === 0) throw new Error("No checked-out assets found in selection");

  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  const ids = assets.map((a) => a.id);

  await prisma.$transaction(async (tx) => {
    // Return all checked-out line items for these assets
    await tx.projectLineItem.updateMany({
      where: { assetId: { in: ids }, organizationId, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedQuantity: 1,
        returnedAt: new Date(),
        returnCondition: "GOOD",
      },
    });

    // Reset all assets
    await tx.asset.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "AVAILABLE",
        locationId: defaultLocation?.id ?? null,
      },
    });
  });
  await syncAssetsToConvex(ids);
  // Mirror the returned line items across every affected project.
  const bfrProjects = await prisma.projectLineItem.findMany({
    where: { assetId: { in: ids }, organizationId }, select: { projectId: true }, distinct: ["projectId"],
  });
  for (const p of bfrProjects) await upsertProjectLineItemsToConvex(p.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "FORCE_RETURN",
    entityType: "asset",
    entityId: ids[0],
    entityName: assets.map((a) => a.assetTag).join(", "),
    summary: `Bulk force returned ${assets.length} assets to available`,
  });

  return serialize({ count: assets.length });
}
