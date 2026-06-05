"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
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
} from "@/server/line-item-fulfillment";
import {
  adjustBulkAvailability,
  coalesceAdjustments,
  type BulkAdjustment,
  type TxClient,
} from "@/lib/inventory-mutations";
import { TestTagBlockError } from "@/lib/errors/test-tag-block-error";

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

// ---------------------------------------------------------------------------
// 1. getProjectForWarehouse
// ---------------------------------------------------------------------------

export async function getProjectForWarehouse(projectId: string) {
  const { organizationId } = await getOrgContext();

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      client: true,
      location: true,
      lineItems: {
        where: { type: "EQUIPMENT" },
        orderBy: { sortOrder: "asc" },
        include: {
          model: { include: { _count: { select: { modelCheckItems: true } } } },
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
          kit: { include: { _count: { select: { kitCheckItems: true } } } },
          supplier: { select: { name: true } },
          childLineItems: {
            orderBy: { sortOrder: "asc" },
            include: {
              model: { include: { _count: { select: { modelCheckItems: true } } } },
              asset: true, bulkAsset: true,
              units: {
                orderBy: { ordinal: "asc" },
                where: { status: { not: "CANCELLED" } },
                include: {
                  asset: { select: { id: true, assetTag: true } },
                  bulkAsset: { select: { id: true, assetTag: true } },
                },
              },
              kit: { include: { _count: { select: { kitCheckItems: true } } } },
              supplier: { select: { name: true } },
              childLineItems: {
                orderBy: { sortOrder: "asc" },
                include: {
                  model: { include: { _count: { select: { modelCheckItems: true } } } },
                  asset: true, bulkAsset: true,
                  units: {
                    orderBy: { ordinal: "asc" },
                    where: { status: { not: "CANCELLED" } },
                    include: {
                      asset: { select: { id: true, assetTag: true } },
                      bulkAsset: { select: { id: true, assetTag: true } },
                    },
                  },
                  kit: { include: { _count: { select: { kitCheckItems: true } } } },
                  supplier: { select: { name: true } },
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

  return serialize(project);
}

// ---------------------------------------------------------------------------
// 2. lookupAssetForScan
// ---------------------------------------------------------------------------

export async function lookupAssetForScan(
  projectId: string,
  assetTag: string,
  mode: "checkout" | "checkin" = "checkout"
) {
  const { organizationId } = await getOrgContext();

  // Look up the asset tag in all tables: serialized, bulk, kits
  const [asset, bulkAsset, kit] = await Promise.all([
    prisma.asset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: { include: { category: true, _count: { select: { modelCheckItems: true } } } } },
    }),
    prisma.bulkAsset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: { include: { category: true, _count: { select: { modelCheckItems: true } } } } },
    }),
    prisma.kit.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    }),
  ]);

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
      assetName: asset.model.name, kitId: parentKit?.id || null, kitAssetTag: parentKit?.assetTag || null, reason: "asset_in_kit" as const,
    });
  }

  // If this serialized asset is a permanent accessory of another asset, prompt
  // to scan the parent instead — accessories move with their parent.
  if (asset && asset.parentAssetId) {
    const parent = await prisma.asset.findFirst({ where: { id: asset.parentAssetId, organizationId }, select: { id: true, assetTag: true } });
    return serialize({
      found: true as const, type: "asset_child" as const, lineItemId: null, assetId: asset.id,
      assetName: asset.model.name, parentAssetId: parent?.id || null, parentAssetTag: parent?.assetTag || null, reason: "asset_is_accessory" as const,
    });
  }

  const found = asset || bulkAsset;
  if (!found) {
    return serialize({ found: false as const, type: null, lineItemId: null, assetId: null, assetName: null, reason: null });
  }

  const modelId = found.modelId;
  const assetName = asset
    ? [asset.model.name, asset.customName ? `(${asset.customName})` : null].filter(Boolean).join(" ")
    : bulkAsset!.model.name;

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
        await tx.asset.update({
          where: { id: child.assetId },
          data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
        });
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
}


// ---------------------------------------------------------------------------
// 3. checkOutItems
// ---------------------------------------------------------------------------

export async function checkOutItems(
  projectId: string,
  items: Array<{
    lineItemId: string;
    assetId?: string;
    quantity?: number;
    notes?: string;
  }>
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const results = await prisma.$transaction(async (tx) => {
    const updated: unknown[] = [];

    // Fetch the project's location to update asset locations on checkout
    const project = await tx.project.findUnique({
      where: { id: projectId, organizationId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    // Pre-flight T&T compliance block — fetch all line items first, gather
    // every serialized and bulk asset id involved, and assert none have a
    // failed/overdue Test & Tag record. Throws TestTagBlockError on block,
    // rolling back the whole batch (no partial check-out across the items).
    //
    // Three sources contribute to the asset set:
    //   1) legacy `line.assetId` / `line.bulkAssetId` (kit children + bulk
    //      lines + un-migrated splits)
    //   2) ProjectLineItemUnit rows already on the line (prep created
    //      them; checkout would mark CHECKED_OUT)
    //   3) `item.assetId` from the incoming scans (post-cutover scans
    //      land here before the unit is written)
    // Without (2) a prepped asset on a fresh order line could slip past
    // the T&T check, since (1) is null on post-cutover lines.
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

    // Expand any "deploy the whole prepped line" item into one item per
    // prepped unit. Symptom this fixes: operator preps a 10x line — 10
    // units exist with assetIds. Operator clicks Deploy, the UI sends
    // `{ lineItemId, quantity: 10 }` (it has no UI-level identity per
    // unit — just synthetic "Unit N" rows). Without expansion, the
    // inner loop fell into the "deploy whole line" branch that flipped
    // line.status without touching any unit or marking any asset
    // CHECKED_OUT. The prep work was captured on units; the deploy
    // ignored them. Now we consult units before the loop and turn each
    // assigned unit into a typed serialised/bulk item. The decision to
    // expand is based on the LINE's shape (no line-level asset), NOT
    // on what the caller put in `item` — because the deploy tab
    // legitimately sends `quantity: N` for a multi-quantity serialised
    // line, and that must still expand to N unit deploys.
    const expandedItems: typeof items = [];
    for (const item of items) {
      if (item.assetId) {
        // Explicit single-asset deploy (scan flow) — pass through.
        expandedItems.push(item);
        continue;
      }
      const lineItemRow = preflightLineItems.find((l) => l.id === item.lineItemId);
      if (lineItemRow?.assetId || lineItemRow?.bulkAssetId) {
        // Legacy line carries its own asset/bulk — existing branches
        // handle it correctly. (Kit children, classic bulk lines.)
        expandedItems.push(item);
        continue;
      }
      // No item.assetId and no line-level asset/bulk — this is the
      // post-cutover multi-quantity serialised case. Consult units.
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
        // No prepped units to deploy — fall through; the existing
        // "deploy whole line" edge below flips status (legitimate for
        // a generic line that's just being marked deployed).
        expandedItems.push(item);
        continue;
      }
      // If caller asked for fewer than the prepped count (partial
      // deploy), clamp to that count — preserves the user intent that
      // `quantity: 3` of 10 prepped should only deploy 3. With no
      // per-unit selection in the UI today this just deploys the
      // earliest ordinals; a future UI refactor can pass unit ids.
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

      // Fulfillment model: scanning an asset onto a line creates a
      // ProjectLineItemUnit, never a split line item. The order line keeps
      // its quantity; syncLineItemRollup rolls the units back up onto it.
      const targetAssetId = item.assetId || lineItem.assetId || null;

      if (targetAssetId) {
        // ── Serialised checkout — one unit per physical asset ────────────
        const assetRecord = await tx.asset.findUnique({
          where: { id: targetAssetId },
          select: { status: true, assetTag: true },
        });
        if (assetRecord && assetRecord.status === "CHECKED_OUT") {
          // Already deployed. Idempotent if it is this line's own unit;
          // otherwise the asset is genuinely double-booked.
          const ownUnit = await tx.projectLineItemUnit.findUnique({
            where: {
              lineItemId_assetId: {
                lineItemId: lineItem.id,
                assetId: targetAssetId,
              },
            },
            select: { status: true },
          });
          if (ownUnit && ownUnit.status === "CHECKED_OUT") continue;
          throw new Error(`Asset ${assetRecord.assetTag} is already deployed`);
        }
        if (
          assetRecord &&
          (assetRecord.status === "RETIRED" ||
            assetRecord.status === "IN_MAINTENANCE" ||
            assetRecord.status === "LOST")
        ) {
          throw new Error(
            `Asset ${assetRecord.assetTag} is ${assetRecord.status
              .replace("_", " ")
              .toLowerCase()} and cannot be deployed`,
          );
        }

        const { id: unitId } = await ensureSerialisedUnit(tx, {
          organizationId,
          lineItemId: lineItem.id,
          assetId: targetAssetId,
        });
        // Guarded transition — only flip a unit that is not already out.
        await tx.projectLineItemUnit.updateMany({
          where: { id: unitId, status: { not: "CHECKED_OUT" } },
          data: {
            status: "CHECKED_OUT",
            checkedOutAt: new Date(),
            checkedOutById: userId,
          },
        });

        await tx.asset.update({
          where: { id: targetAssetId },
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
            notes: item.notes || null,
          },
        });
      } else if (lineItem.bulkAssetId) {
        // ── Bulk checkout — one unit row carrying the quantity ───────────
        const checkoutQty = item.quantity || lineItem.quantity;
        const { id: unitId } = await ensureBulkUnit(tx, {
          organizationId,
          lineItemId: lineItem.id,
          bulkAssetId: lineItem.bulkAssetId,
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
            bulkAssetId: lineItem.bulkAssetId,
            projectId,
            action: "CHECK_OUT",
            scannedById: userId,
            notes:
              item.notes ||
              `Checked out ${checkoutQty} of ${lineItem.quantity}`,
          },
        });
      } else {
        // No serialised asset and no bulk asset assigned — nothing to make a
        // unit from. Flip the order line directly (deploy-whole-line edge).
        await tx.projectLineItem.update({
          where: { id: lineItem.id },
          data: {
            status: "CHECKED_OUT",
            checkedOutQuantity: lineItem.quantity,
            checkedOutAt: new Date(),
            checkedOutBy: { connect: { id: userId } },
          },
        });
        updated.push(
          await tx.projectLineItem.findUnique({
            where: { id: lineItem.id },
            include: { model: true, asset: true, bulkAsset: true },
          }),
        );
        continue;
      }

      // If a specific asset with accessories was assigned to a model-level
      // line at scan time (no prep), materialise its accessory child lines now
      // so the cascade below deploys them. Idempotent — a no-op if prep already
      // expanded them.
      if (targetAssetId) {
        await expandAccessoriesForAsset(tx, { organizationId, lineItemId: lineItem.id, assetId: targetAssetId });
      }

      // Roll the unit change up onto the order line.
      await syncLineItemRollup(tx, lineItem.id);

      // Permanent accessories travel with the parent — check them out too.
      await checkoutAccessoryChildren(tx, {
        organizationId,
        projectId,
        parentLineItemId: lineItem.id,
        userId,
        projectLocationId,
      });

      updated.push(
        await tx.projectLineItem.findUnique({
          where: { id: lineItem.id },
          include: { model: true, asset: true, bulkAsset: true },
        }),
      );
    }

    return updated;
  });

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

  return serialize(results);
}

// ---------------------------------------------------------------------------
// 4. checkInItems
// ---------------------------------------------------------------------------

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

  const results = await prisma.$transaction(async (tx) => {
    const updated: unknown[] = [];

    // Find the org's default location to restore assets to on return
    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id || null;

    for (const item of items) {
      // Delegate the unit / asset surgery to the canonical helper —
      // also used by completeCheckAndStore so the two paths can't drift.
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

      // Scan log: one entry per checkin call, with a useful note for
      // bulk / line-level returns.
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

      // Permanent accessories return with their parent.
      await checkinAccessoryChildren(tx, {
        organizationId,
        projectId,
        parentLineItemId: item.lineItemId,
        returnCondition: item.returnCondition ?? "GOOD",
        userId,
        defaultLocationId,
      });

      updated.push(
        await tx.projectLineItem.findUnique({
          where: { id: item.lineItemId },
          include: { model: true, asset: true, bulkAsset: true },
        }),
      );
    }

    return updated;
  });

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

  return serialize(results);
}

// ---------------------------------------------------------------------------
// 4b. checkOutKit — check out an entire kit and all its contents
// ---------------------------------------------------------------------------

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
      }
    }

    // Update child assets referenced by line items (for prep-kits whose contents are line item references, not KitSerializedItem)
    const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
    if (childAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: childAssetIds } },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
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
    }

    // Create scan log for the kit
    await tx.assetScanLog.create({
      data: { organizationId, kitId, projectId, action: "CHECK_OUT", scannedById: userId, notes: "Kit deployed with all contents" },
    });

    return { success: true, kitId };
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

  return serialize(result);
}

// ---------------------------------------------------------------------------
// 4c. checkInKit — check in an entire kit and all its contents
// ---------------------------------------------------------------------------

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
      }
    }

    // Reset child assets referenced by line items (for prep-kits)
    const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
    if (childAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: childAssetIds } },
        data: { status: assetStatus, locationId: defaultLocationId },
      });
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
    }

    // Create scan log
    await tx.assetScanLog.create({
      data: { organizationId, kitId, projectId, action: "CHECK_IN", scannedById: userId, notes: `Kit returned — condition: ${returnCondition}` },
    });

    return { success: true, kitId };
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

  return serialize(result);
}

// ---------------------------------------------------------------------------
// 5. getScanLog
// ---------------------------------------------------------------------------

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
        asset: { include: { model: true } },
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

  return serialize({
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ---------------------------------------------------------------------------
// 6. quickAddAndCheckOut — add an asset to a project and check it out in one go
// ---------------------------------------------------------------------------

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
      include: {
        model: { include: { _count: { select: { modelCheckItems: true } } } },
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

  return serialize(result);
}

// ---------------------------------------------------------------------------
// 6b. clearPrepContainer — remove container assignment from line items
// ---------------------------------------------------------------------------

export async function clearPrepContainer(projectId: string, containerName: string) {
  const { organizationId } = await requirePermission("warehouse", "check_out");

  await prisma.projectLineItem.updateMany({
    where: { projectId, organizationId, prepContainer: containerName },
    data: { prepContainer: null },
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// 6c. ensureContainerOnProject — add container asset as a line item if needed
// ---------------------------------------------------------------------------

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
      include: { model: true, asset: true },
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
      include: { model: true, asset: true },
    });
  });

  return serialize(lineItem);
}

// ---------------------------------------------------------------------------
// 6d. syncContainerStatus — auto deploy/return container when contents change
// ---------------------------------------------------------------------------

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
    await prisma.asset.update({
      where: { id: containerLI.assetId },
      data: {
        status: allDeployedFlag ? "CHECKED_OUT" : "AVAILABLE",
      },
    });
  }

  return serialize({ updated: true, status: allDeployedFlag ? "CHECKED_OUT" : "RETURNED" });
}

// ---------------------------------------------------------------------------
// 7. getAvailableAssetsForModel
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 7. getProjectPullSheet
// ---------------------------------------------------------------------------

export async function getProjectPullSheet(projectId: string) {
  const { organizationId } = await getOrgContext();

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      location: true,
      client: true,
      lineItems: {
        where: {
          type: "EQUIPMENT",
          status: { not: "CANCELLED" },
        },
        orderBy: { sortOrder: "asc" },
        include: {
          model: { include: { category: true, _count: { select: { modelCheckItems: true } } } },
          asset: { include: { location: true } },
          bulkAsset: true,
          kit: true,
          supplier: { select: { name: true } },
          childLineItems: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { sortOrder: "asc" },
            include: {
              model: { include: { category: true, _count: { select: { modelCheckItems: true } } } },
              asset: { include: { location: true } },
              bulkAsset: true,
              kit: true,
              supplier: { select: { name: true } },
              childLineItems: {
                where: { status: { not: "CANCELLED" } },
                orderBy: { sortOrder: "asc" },
                include: {
                  model: { include: { category: true, _count: { select: { modelCheckItems: true } } } },
                  asset: { include: { location: true } },
                  bulkAsset: true,
                  supplier: { select: { name: true } },
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

  // Compute overbooked status
  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  const enrichedLineItems = project.lineItems
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

  return serialize({
    project,
    groups,
  });
}

// ---------------------------------------------------------------------------
// 8. forceReturnAsset — reset a stuck asset to AVAILABLE
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 9. forceReturnKit — reset a stuck kit + contents to AVAILABLE
// ---------------------------------------------------------------------------

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

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const returnData = { status: "RETURNED" as const, returnedQuantity: 1, returnedAt: now, returnCondition: "GOOD" as const };
    const resetData = { status: "AVAILABLE" as const, locationId: defaultLocation?.id ?? null };

    // Track every kit id that needs bulk restoration (this kit + every unique
    // nested kit encountered across all parent line items).
    const kitsToRestore = new Set<string>([kitId]);

    // Find all parent line items for this kit across all projects
    const kitParentItems = await tx.projectLineItem.findMany({
      where: { kitId, organizationId, isKitChild: false },
      select: { id: true, status: true },
    });

    for (const parent of kitParentItems) {
      // Get all children (may include nested kits with their own kitId)
      const children = await tx.projectLineItem.findMany({
        where: { parentLineItemId: parent.id, organizationId },
        select: { id: true, assetId: true, kitId: true, status: true },
      });

      // Handle grandchildren first (children of nested kits)
      const nestedKitChildren = children.filter((c) => c.kitId);
      for (const child of nestedKitChildren) {
        // Return grandchildren line items
        const grandchildren = await tx.projectLineItem.findMany({
          where: { parentLineItemId: child.id, organizationId },
          select: { id: true, assetId: true },
        });
        if (grandchildren.length > 0) {
          await tx.projectLineItem.updateMany({
            where: { id: { in: grandchildren.map((gc) => gc.id) }, status: "CHECKED_OUT" },
            data: returnData,
          });
          // Reset grandchild assets
          const gcAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
          if (gcAssetIds.length > 0) {
            await tx.asset.updateMany({
              where: { id: { in: gcAssetIds } },
              data: resetData,
            });
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
      }

      // Return parent line item
      if (parent.status === "CHECKED_OUT") {
        await tx.projectLineItem.update({
          where: { id: parent.id },
          data: returnData,
        });
      }

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
    }

    // Restore BulkAsset.availableQuantity for the root kit and every unique
    // nested kit that was encountered. Force-return assumes the kit was in
    // a CHECKED_OUT-like state with bulk consumption, and that the right
    // outcome is to release it all.
    const bulkAdjustments: BulkAdjustment[] = [];
    for (const kid of kitsToRestore) {
      bulkAdjustments.push(
        ...(await collectKitBulkAdjustments(tx, kid, organizationId, +1)),
      );
    }
    if (bulkAdjustments.length > 0) {
      await adjustBulkAvailability(tx, organizationId, coalesceAdjustments(bulkAdjustments));
    }
  });

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

// ---------------------------------------------------------------------------
// 10. bulkForceReturnAssets — force return multiple assets at once
// ---------------------------------------------------------------------------

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
