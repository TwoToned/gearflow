"use server";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  lineItemSchema,
  customLineItemSchema,
  type LineItemFormValues,
  type CustomLineItemFormValues,
} from "@/lib/validations/line-item";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { upsertProjectLineItemsToConvex, removeLineItemFromConvex } from "@/lib/line-item-mirror";
import { patchProjectInConvex } from "@/lib/project-mirror";
import { getSupplierById } from "@/lib/suppliers-read";
import { roundCurrency } from "@/lib/formatters";
import { calculateSuggestedPrice } from "./project-groups";
import { UserFacingError } from "@/lib/errors";
import { computeStockBreakdown } from "@/lib/availability";
import { isStaleRevision } from "@/lib/collaboration-conflict";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import { getModelById, getModelMap, getModelWithCategoryMap } from "@/lib/models-read";
import { getActiveAssetsByModel, getActiveBulkAssetsByModel, getAssetById, getAssetByAssetTag, getAssetsByOrg, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getKitById } from "@/lib/kits-read";
import { getLocationById } from "@/lib/locations-read";

/**
 * Expand a serialised asset's permanent accessories into child line items.
 *
 * Called inside the same transaction that creates the parent line. Each
 * accessory becomes a child ProjectLineItem with `isKitChild: true` (the
 * structural "is a child" flag that the ~40 totals/count filters key off) and
 * `childKind: ACCESSORY` (the behaviour discriminator). No units are created
 * here — like every other line, units materialise lazily at prep. SHIPS_WITH
 * bulk demand is counted live by availability; DEDICATED was already reserved
 * against the pool when the accessory was attached to the asset.
 */
async function expandAccessoryChildren(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string,
  parentLine: {
    id: string;
    assetId: string | null;
    modelId: string | null;
    quantity: number;
    categoryId: string | null;
    groupId: string | null;
    duration: number;
    pricingType: import("@/generated/prisma/client").PricingType;
  },
  modelMap: Map<string, { name: string }>,
) {
  const base = {
    organizationId,
    projectId,
    type: "EQUIPMENT" as const,
    isKitChild: true,
    childKind: "ACCESSORY" as const,
    parentLineItemId: parentLine.id,
    categoryId: parentLine.categoryId,
    groupId: parentLine.groupId,
    unitPrice: null,
    pricingType: parentLine.pricingType,
    duration: parentLine.duration,
  };

  if (parentLine.assetId) {
    // A specific serialised asset was added: expand its own serialised + bulk
    // accessories, unioned with its model's defaults (asset wins by bulkAssetId).
    const asset = await tx.asset.findUnique({
      where: { id: parentLine.assetId },
      select: {
        modelId: true,
        childAssets: {
          select: { id: true, modelId: true },
          orderBy: { assetTag: "asc" },
        },
        childBulkItems: {
          select: {
            bulkAssetId: true,
            quantity: true,
            bulkAsset: { select: { modelId: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!asset) return;

    const assetBulkIds = new Set(asset.childBulkItems.map((b) => b.bulkAssetId));
    const modelBulksRaw = asset.modelId
      ? await (await getConvexClient()).query(api.modelBulkAccessories.listByModelId, {
          modelId: asset.modelId,
          organizationId,
        })
      : [];
    const inheritedBulks = modelBulksRaw.filter((m) => !assetBulkIds.has(m.bulkAssetId));

    if (asset.childAssets.length === 0 && asset.childBulkItems.length === 0 && inheritedBulks.length === 0) {
      return;
    }

    // Normalise both sources to a common shape for the createLoop below.
    type BulkItem = { bulkAssetId: string; quantity: number; modelId: string | null };
    const allBulks: BulkItem[] = [
      ...asset.childBulkItems.map((b) => ({ bulkAssetId: b.bulkAssetId, quantity: b.quantity, modelId: b.bulkAsset.modelId })),
      ...inheritedBulks.map((m) => ({ bulkAssetId: m.bulkAssetId, quantity: m.quantity, modelId: m.bulkAssetModelId })),
    ];

    let sort = 0;
    for (const child of asset.childAssets) {
      await tx.projectLineItem.create({
        data: { ...base, modelId: child.modelId, assetId: child.id, quantity: 1, description: modelMap.get(child.modelId)?.name ?? null, sortOrder: sort++ },
      });
    }
    for (const bi of allBulks) {
      const modelName = modelMap.get(bi.modelId ?? "")?.name ?? null;
      await tx.projectLineItem.create({
        data: {
          ...base,
          modelId: bi.modelId,
          bulkAssetId: bi.bulkAssetId,
          quantity: bi.quantity,
          description: modelName ? `${bi.quantity}x ${modelName}` : null,
          sortOrder: sort++,
        },
      });
    }
    return;
  }

  // Model-level line (no specific asset chosen — the common quoting flow). Expand
  // the MODEL's default bulk accessories now, scaled by the line quantity, so the
  // accessory shows on the project + documents immediately. Serialised asset-level
  // accessories can't expand here (no specific asset picked); they materialise at
  // warehouse prep when a unit is assigned (expandAccessoriesForAsset, which
  // reconciles this row's quantity to the units actually assigned).
  if (parentLine.modelId) {
    const modelBulks = await (await getConvexClient()).query(api.modelBulkAccessories.listByModelId, {
      modelId: parentLine.modelId,
      organizationId,
    });
    if (modelBulks.length === 0) return;

    let sort = 0;
    for (const bi of modelBulks) {
      const qty = bi.quantity * Math.max(parentLine.quantity, 1);
      const modelName = modelMap.get(bi.bulkAssetModelId ?? "")?.name ?? null;
      await tx.projectLineItem.create({
        data: {
          ...base,
          modelId: bi.bulkAssetModelId ?? null,
          bulkAssetId: bi.bulkAssetId,
          quantity: qty,
          description: modelName ? `${qty}x ${modelName}` : null,
          sortOrder: sort++,
        },
      });
    }
  }
}

export async function addLineItem(projectId: string, data: LineItemFormValues, allowOverbook = false, forceSeparate = false, includeAccessories = true) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = lineItemSchema.parse(data);

  // Server-side availability enforcement for equipment.
  // Sub-hire items represent third-party stock and never consume our inventory.
  // Detection moved from `isSubhire` boolean to `subHireId != null` (Wave 2).
  // WHY: Prevent double-booking of owned equipment. Sub-hire items are third-party
  // stock (rented in to cover gaps) and don't consume our warehouse inventory.
  if (parsed.type === "EQUIPMENT" && parsed.modelId && !allowOverbook) {
    const convexProject = await getProjectById(projectId);
    if (!convexProject || convexProject.organizationId !== organizationId) {
      return serialize({ success: false });
    }

    const hasDates = convexProject.rentalStartDate != null && convexProject.rentalEndDate != null;

    // Two-mode availability check: without dates (project still being quoted),
    // we only check conflicts within this project (the user is iterating on
    // their quote). With dates, we check across all overlapping projects to
    // prevent genuine double-booking across the calendar.
    // WHY: Kit assets must be booked through the kit workflow to keep the kit
    // complete. Booking a kit asset directly would leave the kit missing a piece.
    if (parsed.assetId) {
      // Check if asset is in a kit
      const assetCheck = await getAssetById(parsed.assetId);
      if (assetCheck?.kitId) {
        const assetKit = await getKitById(assetCheck.kitId);
        throw new UserFacingError({
          code: "ASSET_IN_KIT",
          title: "Asset is in a kit",
          message: `This asset belongs to Kit ${assetKit?.assetTag ?? assetCheck.kitId}.`,
          hint: "Add the Kit to the project instead, or remove the asset from the Kit first.",
        });
      }

      // Specific asset — check if it's booked in an overlapping project
      // (only when dates exist). The asset may be assigned via a legacy
      // line.assetId row OR via a ProjectLineItemUnit (the fulfillment
      // model) — both tables must be checked.
      // WHY: When rental dates are confirmed, the asset must be free across all
      // overlapping projects. Without dates (quoting phase), only check within
      // this project since the user is iterating on a draft quote.
      if (hasDates) {
        const projStartMs = convexProject.rentalStartDate as number;
        const projEndMs = convexProject.rentalEndDate as number;
        const allProjects = await getProjectsByOrg(organizationId);
        const conflictProjectIds = allProjects
          .filter(
            (p) =>
              !p.isTemplate &&
              !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
              p.rentalStartDate != null &&
              p.rentalEndDate != null &&
              (p.rentalStartDate as number) <= projEndMs &&
              (p.rentalEndDate as number) >= projStartMs &&
              p.id !== projectId,
          )
          .map((p) => p.id);
        const projectMap = new Map(allProjects.map((p) => [p.id, p]));
        const [lineConflict, unitConflict] = await Promise.all([
          prisma.projectLineItem.findFirst({
            where: {
              organizationId,
              assetId: parsed.assetId,
              status: { not: "CANCELLED" },
              projectId: { in: conflictProjectIds },
            },
            select: { projectId: true },
          }),
          prisma.projectLineItemUnit.findFirst({
            where: {
              organizationId,
              assetId: parsed.assetId,
              status: { not: "RETURNED" },
              lineItem: {
                status: { not: "CANCELLED" },
                projectId: { in: conflictProjectIds },
              },
            },
            select: {
              lineItem: {
                select: { projectId: true },
              },
            },
          }),
        ]);
        const conflictProjId = lineConflict?.projectId ?? unitConflict?.lineItem.projectId;
        const conflictProject = conflictProjId ? projectMap.get(conflictProjId) : null;
        if (conflictProject) {
          throw new UserFacingError({
            code: "ASSET_DOUBLE_BOOKED",
            title: "Asset already booked",
            message: `This asset is booked on ${conflictProject.projectNumber} — ${conflictProject.name} during those dates.`,
            hint: "Pick a different asset, adjust the rental dates, or remove it from the other project.",
          });
        }
      }

      // Block truly unavailable assets (retired, lost) but allow checked-out ones
      // WHY: Retired and lost assets are permanently unavailable — booking them
      // would create unfulfillable commitments. Checked-out assets return before
      // the project starts, so they're still bookable.
      const asset = await getAssetById(parsed.assetId);
      if (asset && (asset.status === "RETIRED" || asset.status === "LOST")) {
        throw new UserFacingError({
          code: "ASSET_UNAVAILABLE",
          title: "Asset cannot be added",
          message: `This asset is marked ${asset.status.replace("_", " ").toLowerCase()}.`,
          hint: asset.status === "LOST"
            ? "Find the asset and mark it Available, or pick a different one."
            : "Retired assets cannot be booked. Pick a different asset.",
        });
      }
    } else {
      // Model-level — check quantity against available stock
      // Model + active assets live in Convex — fetch in parallel.
      const [model, activeAssets, activeBulkAssets] = await Promise.all([
        getModelById(parsed.modelId),
        getActiveAssetsByModel(parsed.modelId, organizationId),
        getActiveBulkAssetsByModel(parsed.modelId, organizationId),
      ]);

      // WHY: For model-level (non-specific) adds, enforce against effective
      // stock. With dates, check across all overlapping projects; without dates,
      // only check this project's existing bookings since other quotes are drafts.
      if (model) {
        const modelForBreakdown = {
          assetType: (model.assetType ?? "SERIALIZED") as "SERIALIZED" | "BULK",
          assets: activeAssets.map((a: ConvexAsset) => ({ status: a.status ?? "AVAILABLE" })),
          bulkAssets: activeBulkAssets.map((ba: ConvexBulkAsset) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
        };
        // When dates exist, check overlapping bookings across projects
        // When no dates, check only this project's existing bookings against stock
        // Sub-hire items don't consume our stock so they're excluded from the count.
        let overlapping;
        if (hasDates) {
          const projStartMs = convexProject.rentalStartDate as number;
          const projEndMs = convexProject.rentalEndDate as number;
          const modelAllProjects = await getProjectsByOrg(organizationId);
          const modelConflictProjectIds = modelAllProjects
            .filter(
              (p) =>
                !p.isTemplate &&
                !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
                p.rentalStartDate != null &&
                p.rentalEndDate != null &&
                (p.rentalStartDate as number) <= projEndMs &&
                (p.rentalEndDate as number) >= projStartMs,
            )
            .map((p) => p.id);
          overlapping = await prisma.projectLineItem.findMany({
            where: {
              organizationId,
              modelId: parsed.modelId,
              status: { not: "CANCELLED" },
              subHireId: null,
              projectId: { in: modelConflictProjectIds },
            },
          });
        } else {
          overlapping = await prisma.projectLineItem.findMany({
            where: {
              organizationId,
              modelId: parsed.modelId,
              status: { not: "CANCELLED" },
              subHireId: null,
              projectId,
            },
          });
        }

        const booked = overlapping.reduce((sum, li) => sum + li.quantity, 0);
        // Enforce against effectiveStock — in-maintenance/lost/retired assets
        // cannot be booked even though they still exist in the model.
        const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(modelForBreakdown);
        const available = Math.max(0, effectiveStock - booked);

        // WHY: Compare against effective stock (total minus unavailable), not
        // raw count. Assets in maintenance or retired still exist on paper but
        // can't be booked — using total stock would overstate availability.
        if (parsed.quantity > available) {
          const detail = unavailable > 0
            ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
            : `${booked} already booked out of ${totalStock} total`;
          throw new UserFacingError({
            code: "INSUFFICIENT_STOCK",
            title: "Not enough available",
            message: `Only ${available} of ${parsed.quantity} requested are free during those dates.`,
            hint: `Stock: ${detail}. Reduce the quantity, change the dates, or add a sub-hire to cover the gap.`,
          });
        }
      }
    }
  }

  // If adding by model (no specific asset), merge into existing line item
  // within the same group/category to keep the quote clean. Merging prevents
  // duplicate rows when a user adds the same model twice (e.g. "2x lights"
  // then "3x lights"), rolling them into one consolidated line.
  // Never merge across sub-hire boundaries (own stock vs third-party stock).
  // When forceSeparate is true, always create a new line item.
  // WHY: Consolidating same-model adds prevents duplicate rows that would confuse
  // the customer and complicate warehouse picking. Sub-hire items must never merge
  // with owned stock because they have different costs and availability rules.
  if (parsed.type === "EQUIPMENT" && parsed.modelId && !parsed.assetId && !forceSeparate) {
    const existing = await prisma.projectLineItem.findFirst({
      where: {
        projectId,
        organizationId,
        modelId: parsed.modelId,
        assetId: null,
        groupId: parsed.groupId ?? null,
        categoryId: parsed.categoryId ?? null,
        isKitChild: false,
        // Merge only among non-sub-hire items. Sub-hire items always live in
        // their own SubHire-managed rows and shouldn't merge with manual adds.
        subHireId: null,
        status: { not: "CANCELLED" },
      },
    });

    if (existing) {
      const oldQuantity = existing.quantity;
      const newQuantity = existing.quantity + parsed.quantity;
      const newLineTotal = calculateLineTotal(
        parsed.unitPrice ?? (existing.unitPrice ? Number(existing.unitPrice) : undefined),
        newQuantity,
        parsed.duration || existing.duration,
        parsed.discount ?? (existing.discount ? Number(existing.discount) : undefined),
      );

      const result = await prisma.projectLineItem.update({
        where: { id: existing.id },
        data: {
          quantity: newQuantity,
          unitPrice: parsed.unitPrice ?? existing.unitPrice,
          pricingType: parsed.pricingType || existing.pricingType,
          duration: parsed.duration || existing.duration,
          discount: parsed.discount ?? existing.discount,
          lineTotal: newLineTotal,
          groupName: parsed.groupName || existing.groupName,
          notes: parsed.notes
            ? existing.notes
              ? `${existing.notes}; ${parsed.notes}`
              : parsed.notes
            : existing.notes,
        },
        include: { asset: true, bulkAsset: true },
      });

      await recalculateProjectTotals(projectId);

      // Model lives in Convex — enrich after update.
      const mergedModel = result.modelId ? await getModelById(result.modelId) : null;

      await logActivity({
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "lineItem",
        entityId: result.id,
        entityName: result.description || `Line item`,
        summary: `Merged line item into existing on project (qty ${oldQuantity} -> ${newQuantity})`,
        projectId,
      });

      await upsertProjectLineItemsToConvex(projectId);
      return serialize({ ...result, model: mergedModel, _merged: true, _newQuantity: newQuantity });
    }
  }

  // Simple auto-pricing: when adding a model-backed line with no manual price,
  // auto-fill the unit price from the model's rate using the project's default
  // rental period/quantity (the legacy `rate × period × qty` model). The unit
  // price is the per-period rate; `duration` carries the rental quantity so the
  // line total is `rate × quantity × rentalQuantity`. Mirrors the legacy branch
  // in calculateSuggestedPrice. Manual prices (parsed.unitPrice set) are kept.
  let autoUnitPrice = parsed.unitPrice;
  let autoDuration = parsed.duration;
  const autoPricingType = parsed.pricingType;
  const priceBreakdown: string | null = null;
  const priceOverridden = false;

  if (parsed.modelId && parsed.pricingType === "PER_DAY" && !parsed.unitPrice) {
    // WHY: Adding a line should fill a sensible price from the model's rate so
    // the quote isn't blank. Falls through to no price if rates are missing.
    const [model, proj] = await Promise.all([
      getModelById(parsed.modelId),
      getProjectById(projectId),
    ]);

    if (model) {
      const rentalPeriod = proj?.defaultRentalPeriod ?? "DAILY";
      const rentalQuantity = proj?.defaultRentalQuantity ?? 1;
      const rate =
        rentalPeriod === "WEEKLY"
          ? (model.weeklyRate ?? model.dailyRate ?? null)
          : (model.dailyRate ?? null);

      if (rate != null) {
        autoUnitPrice = Number(rate);
        autoDuration = rentalQuantity;
      }
    }
  }

  const lineTotal = calculateLineTotal(
    autoUnitPrice,
    parsed.quantity,
    autoDuration,
    parsed.discount
  );

  const [maxSortAgg, accessoryModelMap] = await Promise.all([
    prisma.projectLineItem.aggregate({
      where: { projectId, organizationId },
      _max: { sortOrder: true },
    }),
    // Model names for accessory description text — fetched before the transaction
    // so we avoid a cross-domain Prisma join inside expandAccessoryChildren.
    getModelMap(organizationId),
  ]);
  const nextSort = (maxSortAgg._max.sortOrder ?? -1) + 1;

  const result = await prisma.$transaction(async (tx) => {
    const line = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId,
        categoryId: parsed.categoryId || null,
        groupId: parsed.groupId || null,
        type: parsed.type,
        modelId: parsed.modelId || null,
        assetId: parsed.assetId || null,
        bulkAssetId: parsed.bulkAssetId || null,
        description: parsed.description || null,
        quantity: parsed.quantity,
        unitPrice: autoUnitPrice ?? null,
        pricingType: autoPricingType,
        duration: autoDuration,
        discount: parsed.discount ?? null,
        lineTotal,
        priceBreakdown,
        priceOverridden,
        sortOrder: nextSort,
        groupName: parsed.groupName || null,
        notes: parsed.notes || null,
        isOptional: parsed.isOptional,
        showSubhireOnDocs: parsed.showSubhireOnDocs,
        supplierId: parsed.supplierId || null,
        subhireOrderNumber: parsed.subhireOrderNumber || null,
      },
      include: {
        asset: true,
        bulkAsset: true,
      },
    });

    // Auto-expand permanent accessories as child lines (atomic with the parent):
    // a specific serialised asset expands its own + its model's; a model-level
    // line expands the model's default accessories so they appear on the quote.
    // Sub-hire lines are third-party stock — never expand.
    // WHY: Permanent accessories (cases, cables, mounts) must travel with the
    // parent on every booking. Expanding them as child lines ensures the
    // warehouse includes them during prep and the quote shows what's included.
    // includeAccessories=false lets callers suppress this (e.g. return-only flow).
    if (includeAccessories && !line.subHireId && line.type === "EQUIPMENT" && (line.assetId || line.modelId)) {
      await expandAccessoryChildren(tx, organizationId, projectId, line, accessoryModelMap);
    }

    return line;
  });

  // Recalculate group suggested price if item was added to a group
  if (result.groupId) {
    const suggested = await calculateSuggestedPrice(result.groupId);
    const convex = await getConvexClient();
    await convex.mutation(api.projectGroups.update, {
      id: result.groupId,
      patch: { suggestedPrice: suggested, updatedAt: Date.now() },
    });
  }

  await recalculateProjectTotals(projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "lineItem",
    entityId: result.id,
    entityName: result.description || `Line item`,
    summary: `Added line item to project`,
    projectId,
  });

  await writeCollabActivityEvent(
    { organizationId, userId, userName },
    {
      entityType: "project",
      entityId: projectId,
      action: "line_item_added",
      summary: `added ${result.description || "a line item"}`,
      targetType: "lineItem",
      targetId: result.id,
    },
  );

  await upsertProjectLineItemsToConvex(projectId);

  // Supplier lives in Convex — attach instead of a Prisma join.
  const supplier = result.supplierId ? await getSupplierById(result.supplierId) : null;
  return serialize({ ...result, supplier });
}

export async function updateLineItem(
  id: string,
  data: LineItemFormValues,
  allowOverbook = false,
  /**
   * Optional optimistic-concurrency baseline: the `updatedAt` the editor opened
   * with. If the row has changed since (someone else saved while this editor was
   * open, e.g. after a lock expired), the save is rejected with a conflict. When
   * omitted the check is skipped — edit locks remain the first line of defence.
   */
  baseUpdatedAt?: string | number | null,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = lineItemSchema.parse(data);

  const existing = await prisma.projectLineItem.findUnique({
    where: { id, organizationId },
    select: {
      unitPrice: true,
      pricingType: true,
      projectId: true,
      quantity: true,
      modelId: true,
      subHireId: true,
      updatedAt: true,
    },
  });

  // Optimistic-concurrency guard: reject stale saves even when the edit lock
  // has lapsed. The editor sends the `updatedAt` it opened with; if the row is
  // now newer, someone else saved in the meantime.
  if (existing && isStaleRevision(existing.updatedAt, baseUpdatedAt)) {
    throw new UserFacingError({
      code: "STALE_LINE_ITEM",
      title: "Item changed",
      message:
        "This line item was updated by someone else while you had it open.",
      hint: "Close and reopen the item to see the latest values, then re-apply your change.",
    });
  }

  // Server-side availability enforcement for equipment (mirrors addLineItem).
  // Only re-validate on quantity increase. Editing other fields on an
  // already-overbooked item does not re-block — the badge surfaces the
  // existing overbook and the client-side check prevents new increases.
  if (
    existing &&
    parsed.type === "EQUIPMENT" &&
    parsed.modelId &&
    // Sub-hire items are identified by `existing.subHireId != null` now
    // (Wave 2 — no more isSubhire flag on the form schema).
    existing.subHireId == null &&
    !allowOverbook &&
    parsed.quantity > existing.quantity
  ) {
    const updateConvexProject = await getProjectById(existing.projectId);
    const hasDates = updateConvexProject?.rentalStartDate != null && updateConvexProject?.rentalEndDate != null;

    // Model + active assets live in Convex — fetch in parallel.
    const [model, activeAssets, activeBulkAssets] = await Promise.all([
      getModelById(parsed.modelId),
      getActiveAssetsByModel(parsed.modelId, organizationId),
      getActiveBulkAssetsByModel(parsed.modelId, organizationId),
    ]);

    if (model) {
      const modelForBreakdown = {
        assetType: (model.assetType ?? "SERIALIZED") as "SERIALIZED" | "BULK",
        assets: activeAssets.map((a: ConvexAsset) => ({ status: a.status ?? "AVAILABLE" })),
        bulkAssets: activeBulkAssets.map((ba: ConvexBulkAsset) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
      };
      let overlapping;
      if (hasDates) {
        const projStartMs = updateConvexProject!.rentalStartDate as number;
        const projEndMs = updateConvexProject!.rentalEndDate as number;
        const updateAllProjects = await getProjectsByOrg(organizationId);
        const updateConflictProjectIds = updateAllProjects
          .filter(
            (p) =>
              !p.isTemplate &&
              !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
              p.rentalStartDate != null &&
              p.rentalEndDate != null &&
              (p.rentalStartDate as number) <= projEndMs &&
              (p.rentalEndDate as number) >= projStartMs,
          )
          .map((p) => p.id);
        overlapping = await prisma.projectLineItem.findMany({
          where: {
            organizationId,
            modelId: parsed.modelId,
            status: { not: "CANCELLED" },
            subHireId: null,
            id: { not: id },
            projectId: { in: updateConflictProjectIds },
          },
        });
      } else {
        overlapping = await prisma.projectLineItem.findMany({
          where: {
            organizationId,
            modelId: parsed.modelId,
            status: { not: "CANCELLED" },
            subHireId: null,
            id: { not: id },
            projectId: existing.projectId,
          },
        });
      }

      const booked = overlapping.reduce((sum, li) => sum + li.quantity, 0);
      // Enforce against effectiveStock — matches checkAvailability and the badge.
      const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(modelForBreakdown);
      const available = Math.max(0, effectiveStock - booked);

      if (parsed.quantity > available) {
        const detail = unavailable > 0
          ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
          : `${booked} already booked out of ${totalStock} total`;
        throw new UserFacingError({
          code: "INSUFFICIENT_STOCK",
          title: "Not enough available",
          message: `Only ${available} of ${parsed.quantity} requested are free during those dates.`,
          hint: `Stock: ${detail}. Reduce the quantity, change the dates, or add a sub-hire to cover the gap.`,
        });
      }
    }
  }

  const lineTotal = calculateLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount
  );

  const result = await prisma.projectLineItem.update({
    where: { id, organizationId },
    data: {
      type: parsed.type,
      // Only update association fields when explicitly provided — the edit
      // dialog doesn't send modelId/assetId/bulkAssetId, so undefined here
      // means "keep the existing value", not "clear it".
      ...(parsed.modelId !== undefined && { modelId: parsed.modelId || null }),
      ...(parsed.assetId !== undefined && { assetId: parsed.assetId || null }),
      ...(parsed.bulkAssetId !== undefined && { bulkAssetId: parsed.bulkAssetId || null }),
      description: parsed.description || null,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? null,
      pricingType: parsed.pricingType,
      duration: parsed.duration,
      discount: parsed.discount ?? null,
      lineTotal,
      groupName: parsed.groupName || null,
      notes: parsed.notes || null,
      isOptional: parsed.isOptional,
      showSubhireOnDocs: parsed.showSubhireOnDocs,
      ...(parsed.supplierId !== undefined && { supplierId: parsed.supplierId || null }),
      subhireOrderNumber: parsed.subhireOrderNumber || null,
    },
    include: {
      asset: true,
      bulkAsset: true,
    },
  });

  await recalculateProjectTotals(result.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "lineItem",
    entityId: result.id,
    entityName: result.description || `Line item`,
    summary: `Updated line item on project`,
    projectId: result.projectId,
  });

  await writeCollabActivityEvent(
    { organizationId, userId, userName },
    {
      entityType: "project",
      entityId: result.projectId,
      action: "line_item_updated",
      summary: `updated ${result.description || "a line item"}`,
      targetType: "lineItem",
      targetId: result.id,
      metadata: {
        quantity: result.quantity,
        lineTotal: result.lineTotal?.toString?.() ?? null,
      },
    },
  );

  await upsertProjectLineItemsToConvex(result.projectId);
  // Supplier lives in Convex — attach instead of a Prisma join.
  const supplier = result.supplierId ? await getSupplierById(result.supplierId) : null;
  return serialize({ ...result, supplier });
}

export async function addKitLineItem(
  projectId: string,
  kitId: string,
  pricingMode: "KIT_PRICE" | "ITEMIZED" = "KIT_PRICE",
  unitPrice?: number,
  groupName?: string,
  categoryId?: string,
  groupId?: string,
  /** Emit a collaboration activity-feed event for this kit add. Bulk callers
   *  (e.g. applyGroupTemplate) pass false and log one grouped event instead. */
  emitActivity = true,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const convexKit = await getKitById(kitId);
  if (!convexKit || convexKit.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Kit not found",
      message: "This kit was deleted or moved. Refresh and try again.",
    });
  }
  const [serializedItems, bulkItems] = await Promise.all([
    prisma.kitSerializedItem.findMany({
      where: { kitId },
      include: { asset: { select: { modelId: true } } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.kitBulkItem.findMany({
      where: { kitId },
      include: { bulkAsset: { select: { modelId: true } } },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  const kit = { ...convexKit, serializedItems, bulkItems };
  // Block truly unavailable kits but allow checked-out ones — date overlap check below handles real conflicts
  if (kit.status === "IN_MAINTENANCE" || kit.status === "INCOMPLETE") {
    throw new UserFacingError({
      code: "KIT_UNAVAILABLE",
      title: "Kit cannot be added",
      message: `Kit ${kit.assetTag} is ${(kit.status as string).replace("_", " ").toLowerCase()}.`,
      hint: kit.status === "IN_MAINTENANCE"
        ? "Wait for maintenance to finish, or pick a different kit."
        : "Complete the kit's missing items before booking it.",
    });
  }

  // Check not already on an overlapping project
  const kitAddProject = await getProjectById(projectId);
  if (kitAddProject?.rentalStartDate != null && kitAddProject?.rentalEndDate != null) {
    const kitProjStartMs = kitAddProject.rentalStartDate as number;
    const kitProjEndMs = kitAddProject.rentalEndDate as number;
    const kitAddAllProjects = await getProjectsByOrg(organizationId);
    const kitConflictProjectIds = kitAddAllProjects
      .filter(
        (p) =>
          !p.isTemplate &&
          !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
          p.rentalStartDate != null &&
          p.rentalEndDate != null &&
          (p.rentalStartDate as number) <= kitProjEndMs &&
          (p.rentalEndDate as number) >= kitProjStartMs &&
          p.id !== projectId,
      )
      .map((p) => p.id);
    const kitProjectMap = new Map(kitAddAllProjects.map((p) => [p.id, p]));
    const conflict = await prisma.projectLineItem.findFirst({
      where: {
        organizationId, kitId, isKitChild: false, status: { not: "CANCELLED" },
        projectId: { in: kitConflictProjectIds },
      },
      select: { projectId: true },
    });
    if (conflict) {
      const conflictKitProject = kitProjectMap.get(conflict.projectId);
      throw new UserFacingError({
        code: "KIT_DOUBLE_BOOKED",
        title: "Kit already booked",
        message: `Kit ${kit.assetTag} is on ${conflictKitProject?.projectNumber ?? conflict.projectId} — ${conflictKitProject?.name ?? ""} during those dates.`,
        hint: "Pick a different kit, adjust the rental dates, or remove it from the other project.",
      });
    }
  }

  const maxSort = await prisma.projectLineItem.aggregate({ where: { projectId, organizationId }, _max: { sortOrder: true } });
  let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  // Model lives in Convex — load map before the transaction.
  const modelMap = await getModelMap(organizationId);

  const result = await prisma.$transaction(async (tx) => {
    // Create parent kit line item — holds the kit-level pricing and serves
    // as the anchor for all child items. Each serialized and bulk item from
    // the kit becomes a child ProjectLineItem so the warehouse can track and
    // deploy each piece individually while the parent maintains the kit-level
    // unit price for quoting.
    const parentItem = await tx.projectLineItem.create({
      data: {
        organizationId, projectId, type: "EQUIPMENT", kitId,
        description: `${kit.assetTag} - ${kit.name}`,
        quantity: 1, unitPrice: unitPrice ?? null, pricingType: "PER_DAY", duration: 1,
        lineTotal: unitPrice ?? null, sortOrder: nextSort++, pricingMode,
        groupName: groupName || null,
        categoryId: categoryId || null,
        groupId: groupId || null,
      },
    });

    // Create child line items for serialized items
    for (const si of kit.serializedItems) {
      const siModel = si.asset.modelId ? modelMap.get(si.asset.modelId) ?? null : null;
      const childPrice = pricingMode === "ITEMIZED" ? (siModel?.defaultRentalPrice ? Number(siModel.defaultRentalPrice) : null) : null;
      await tx.projectLineItem.create({
        data: {
          organizationId, projectId, type: "EQUIPMENT",
          modelId: si.asset.modelId, assetId: si.assetId,
          description: siModel?.name ?? si.asset.modelId ?? "",
          quantity: 1, unitPrice: childPrice, pricingType: "PER_DAY", duration: 1,
          lineTotal: childPrice, sortOrder: nextSort++,
          isKitChild: true, parentLineItemId: parentItem.id,
        },
      });
    }

    // Create child line items for bulk items
    for (const bi of kit.bulkItems) {
      const biModel = bi.bulkAsset.modelId ? modelMap.get(bi.bulkAsset.modelId) ?? null : null;
      const childPrice = pricingMode === "ITEMIZED" ? (biModel?.defaultRentalPrice ? Number(biModel.defaultRentalPrice) * bi.quantity : null) : null;
      await tx.projectLineItem.create({
        data: {
          organizationId, projectId, type: "EQUIPMENT",
          modelId: bi.bulkAsset.modelId, bulkAssetId: bi.bulkAssetId,
          description: `${bi.quantity}x ${biModel?.name ?? bi.bulkAsset.modelId ?? ""}`,
          quantity: bi.quantity, unitPrice: childPrice ? childPrice / bi.quantity : null,
          pricingType: "PER_DAY", duration: 1, lineTotal: childPrice, sortOrder: nextSort++,
          isKitChild: true, parentLineItemId: parentItem.id,
        },
      });
    }

    return { parentItem, nextSort };
  });

  await recalculateProjectTotals(projectId);
  await upsertProjectLineItemsToConvex(projectId);

  if (emitActivity) {
    const memberCount = kit.serializedItems.length + kit.bulkItems.length;
    await writeCollabActivityEvent(
      { organizationId, userId, userName },
      {
        entityType: "project",
        entityId: projectId,
        action: "kit_added",
        summary: `added kit "${result.parentItem.description ?? kit.assetTag}" (${memberCount} item${memberCount === 1 ? "" : "s"})`,
        targetType: "lineItem",
        targetId: result.parentItem.id,
      },
    );
  }

  return serialize(result.parentItem);
}

export async function addCustomLineItem(projectId: string, data: CustomLineItemFormValues) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = customLineItemSchema.parse(data);

  // Validate project belongs to this org before writing
  const customLineItemProject = await getProjectById(projectId);
  if (!customLineItemProject || customLineItemProject.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page and try again.",
    });
  }

  // Resolve groupName from groupId if provided
  let groupName: string | undefined;
  if (parsed.groupId) {
    const group = await prisma.projectGroup.findFirst({
      where: { id: parsed.groupId, projectId, organizationId },
      select: { title: true },
    });
    groupName = group?.title ?? undefined;
  }

  // Compute lineTotal and sortOrder so revenue and ordering are correct
  const lineTotal = calculateLineTotal(parsed.unitPrice, parsed.quantity, parsed.duration, parsed.discount);
  const maxSort = await prisma.projectLineItem.aggregate({ where: { projectId, organizationId }, _max: { sortOrder: true } });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const result = await prisma.projectLineItem.create({
    data: {
      organizationId,
      projectId,
      type: "EQUIPMENT",
      isCustomItem: true,
      description: parsed.description,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? null,
      pricingType: parsed.pricingType,
      duration: parsed.duration,
      discount: parsed.discount ?? null,
      notes: parsed.notes ?? null,
      isOptional: parsed.isOptional,
      categoryId: parsed.categoryId ?? null,
      groupId: parsed.groupId ?? null,
      groupName: groupName ?? null,
      lineTotal,
      sortOrder,
    },
  });

  await recalculateProjectTotals(projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "lineItem",
    entityId: result.id,
    entityName: parsed.description,
    summary: `Added custom item "${parsed.description}" to project`,
    projectId,
  });

  await writeCollabActivityEvent(
    { organizationId, userId, userName },
    {
      entityType: "project",
      entityId: projectId,
      action: "custom_item_added",
      summary: `added custom item "${parsed.description}"`,
      targetType: "lineItem",
      targetId: result.id,
    },
  );

  await upsertProjectLineItemsToConvex(projectId);
  return serialize(result);
}

export async function removeLineItem(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const item = await prisma.projectLineItem.findFirst({
    where: { id, organizationId },
  });
  if (!item) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Line item not found",
      message: "This item was deleted by someone else. Refresh the page.",
    });
  }

  // Block direct removal of child items (kit members, sub-hire group children,
  // and accessory children). `childKind` distinguishes the message; all are
  // removed via their parent, never individually.
  if (item.isKitChild) {
    const isAccessory = item.childKind === "ACCESSORY";
    throw new UserFacingError({
      code: isAccessory ? "ACCESSORY_CHILD" : "KIT_CHILD",
      title: "Cannot remove this item",
      message: isAccessory
        ? "This item is an accessory of another asset."
        : "This item is part of a Kit.",
      hint: isAccessory
        ? "Remove the parent asset's line to remove it, or detach the accessory from the asset in the catalog."
        : "Remove the Kit from the project instead — that will remove all its members at once.",
    });
  }

  // Parent line (kit parent OR accessory parent): cascade-delete its children
  // atomically with the parent.
  const children = await prisma.projectLineItem.findMany({
    where: { parentLineItemId: item.id, organizationId },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.projectLineItem.deleteMany({
      where: { parentLineItemId: item.id, organizationId },
    });
    await tx.projectLineItem.delete({ where: { id } });
  });
  // Mirror the cascade delete to Convex (children first, then the parent).
  for (const c of children) await removeLineItemFromConvex(c.id);
  await removeLineItemFromConvex(id);
  await recalculateProjectTotals(item.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "lineItem",
    entityId: id,
    entityName: item.description || `Line item`,
    summary: `Removed line item from project`,
    projectId: item.projectId,
  });

  await writeCollabActivityEvent(
    { organizationId, userId, userName },
    {
      entityType: "project",
      entityId: item.projectId,
      action: "line_item_removed",
      summary: `removed ${item.description || "a line item"}`,
      targetType: "lineItem",
      targetId: id,
    },
  );

  return serialize({ success: true });
}

export async function reorderLineItems(
  projectId: string,
  itemIds: string[],
  groupUpdates?: { id: string; groupName: string | null }[],
) {
  const { organizationId } = await requirePermission("project", "manage_line_items");

  const updates = itemIds.map((id, index) =>
    prisma.projectLineItem.update({
      where: { id, organizationId },
      data: { sortOrder: index },
    })
  );

  if (groupUpdates?.length) {
    for (const { id, groupName } of groupUpdates) {
      updates.push(
        prisma.projectLineItem.update({
          where: { id, organizationId },
          data: { groupName: groupName || null },
        })
      );
    }
  }

  await prisma.$transaction(updates);
  await upsertProjectLineItemsToConvex(projectId);

  return serialize({ success: true });
}

export async function checkAvailability(
  modelId: string,
  rentalStartDate?: Date | string | null,
  rentalEndDate?: Date | string | null,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  const hasDates = !!rentalStartDate && !!rentalEndDate;
  const startDate = hasDates ? new Date(rentalStartDate) : null;
  const endDate = hasDates ? new Date(rentalEndDate) : null;

  // Model + active assets live in Convex — fetch in parallel.
  const [model, activeAssets, activeBulkAssets] = await Promise.all([
    getModelById(modelId),
    getActiveAssetsByModel(modelId, organizationId),
    getActiveBulkAssetsByModel(modelId, organizationId),
  ]);

  if (!model) {
    return serialize({ totalStock: 0, effectiveStock: 0, booked: 0, available: 0, bookedOnThisProject: 0, unavailable: 0, inMaintenance: 0, lost: 0, conflicts: [] as string[], dateless: !hasDates, hasAccessories: false });
  }

  const modelForBreakdown = {
    assetType: (model.assetType ?? "SERIALIZED") as "SERIALIZED" | "BULK",
    assets: activeAssets.map((a: ConvexAsset) => ({ status: a.status ?? "AVAILABLE" })),
    bulkAssets: activeBulkAssets.map((ba: ConvexBulkAsset) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
  };

  // Find overlapping projects (where the project rental period overlaps with the given dates)
  // Include both regular items AND kit children — they all consume stock
  // Sub-hire items represent third-party stock and are excluded.
  // When no dates: only count bookings on the current project (stock-only check)
  const overlappingLineItems = hasDates
    ? await prisma.projectLineItem.findMany({
        where: {
          organizationId,
          modelId,
          status: { not: "CANCELLED" },
          subHireId: null,
          project: {
            isTemplate: false,
            status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
            rentalStartDate: { lte: endDate! },
            rentalEndDate: { gte: startDate! },
          },
        },
        include: {
          project: { select: { id: true, name: true, projectNumber: true } },
        },
      })
    : excludeProjectId
      ? await prisma.projectLineItem.findMany({
          where: {
            organizationId,
            modelId,
            status: { not: "CANCELLED" },
            subHireId: null,
            projectId: excludeProjectId,
          },
          include: {
            project: { select: { id: true, name: true, projectNumber: true } },
          },
        })
      : [];

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

  const bulkAccessoryCount = (
    await (await getConvexClient()).query(api.modelBulkAccessories.listByModelId, { modelId, organizationId })
  ).length;

  if (modelForBreakdown.assetType === "SERIALIZED") {
    const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(modelForBreakdown);
    const inMaintenance = modelForBreakdown.assets.filter((a: { status: string }) => a.status === "IN_MAINTENANCE").length;
    const lost = modelForBreakdown.assets.filter((a: { status: string }) => a.status === "LOST").length;
    const available = Math.max(0, effectiveStock - booked);

    return serialize({
      totalStock, effectiveStock, booked, available, bookedOnThisProject,
      unavailable, inMaintenance, lost, conflicts, dateless: !hasDates, hasAccessories: bulkAccessoryCount > 0,
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
    return serialize({ found: false as const, asset: null, available: false, conflictsWith: null, hasAccessories: false });
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

    const overlapping = await prisma.projectLineItem.findFirst({
      where: {
        organizationId,
        assetId: asset.id,
        status: { not: "CANCELLED" },
        projectId: { in: lookupConflictProjectIds },
      },
      select: { projectId: true },
    });

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
  // now (Phase B). None has a by-parent index, so filter the org list. (The old
  // prisma.assetBulkChild.count read a frozen table — DEDICATED bulk accessories
  // added after cutover were invisible to the hasAccessories flag.)
  const [orgAssetsForChildren, allBulkChildren, modelBulksForCount] = await Promise.all([
    getAssetsByOrg(organizationId),
    (await getConvexClient()).query(api.assetBulkChildren.list, { orgId: organizationId }),
    asset.modelId
      ? (await getConvexClient()).query(api.modelBulkAccessories.listByModelId, { modelId: asset.modelId, organizationId })
      : Promise.resolve([]),
  ]);
  const modelBulksCount = modelBulksForCount.length;
  const childAssetCount = orgAssetsForChildren.filter((a) => a.parentAssetId === asset.id).length;
  const childBulkCount = allBulkChildren.filter((c) => c.parentAssetId === asset.id).length;
  const hasAccessories = childAssetCount > 0 || childBulkCount > 0 || modelBulksCount > 0;

  return serialize({ found: true as const, asset: { ...asset, model }, available, conflictsWith, hasAccessories });
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

  const conflict = await prisma.projectLineItem.findFirst({
    where: {
      organizationId,
      kitId,
      isKitChild: false,
      status: { not: "CANCELLED" },
      projectId: { in: kitAvailConflictProjectIds },
    },
    select: { projectId: true },
  });

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

function calculateLineTotal(
  unitPrice: number | undefined,
  quantity: number,
  duration: number,
  discount: number | undefined
): number | null {
  if (unitPrice == null) return null;
  const gross = roundCurrency(unitPrice * quantity * duration);
  const disc = discount ?? 0;
  return Math.max(0, roundCurrency(gross - disc));
}

/**
 * Recalculate all project financial totals from source data.
 *
 *   equipmentRevenue = SUM(group.price × group.quantity)  [groups]
 *                    + SUM(standalone.lineTotal)           [ungrouped items]
 *   serviceCostTotal = SUM(service.costTotal) WHERE status != CANCELLED
 *   labourCostTotal  = SUM(assignment.estimatedCost)
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

  // 1. Equipment revenue from groups: bundle price × quantity, PLUS any
  // custom items placed inside the group. Custom items live outside the
  // model-rate optimizer, so their lineTotal doesn't roll into the bundle
  // price — they're "extras on top." Without this addition, a custom item
  // added to a group is invisible to the project total.
  const groups = await prisma.projectGroup.findMany({
    where: { projectId },
    select: {
      price: true,
      quantity: true,
      lineItems: {
        where: {
          isCustomItem: true,
          isOptional: false,
          isKitChild: false,
          status: { not: "CANCELLED" },
        },
        select: { lineTotal: true },
      },
    },
  });

  const groupRevenue = groups.reduce((sum, g) => {
    const bundlePrice = g.price != null ? Number(g.price) : 0;
    const customExtras = g.lineItems.reduce(
      (s, li) => s + (li.lineTotal != null ? Number(li.lineTotal) : 0),
      0,
    );
    return sum + bundlePrice * g.quantity + customExtras;
  }, 0);

  // 2. Equipment revenue from standalone (ungrouped) line items —
  // this naturally includes ungrouped custom items via their lineTotal.
  const standaloneItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      groupId: null,
      isOptional: false,
      isKitChild: false,
      status: { not: "CANCELLED" },
    },
    select: { lineTotal: true },
  });

  const standaloneRevenue = standaloneItems.reduce((sum, li) => {
    const lt = li.lineTotal != null ? Number(li.lineTotal) : 0;
    return sum + lt;
  }, 0);

  const equipmentRevenue = roundCurrency(groupRevenue + standaloneRevenue);

  // 3. Service financials
  const services = await prisma.projectService.findMany({
    where: { projectId, status: { not: "CANCELLED" } },
    select: { costTotal: true, lineTotal: true, showOnDocuments: true },
  });

  // costTotal = what it costs us (all services)
  const serviceCostTotal = roundCurrency(
    services.reduce((sum, s) => sum + (s.costTotal != null ? Number(s.costTotal) : 0), 0)
  );

  // serviceRevenue = what we charge the client (only billable services shown on documents)
  const serviceRevenue = roundCurrency(
    services
      .filter((s) => s.showOnDocuments)
      .reduce((sum, s) => sum + (s.lineTotal != null ? Number(s.lineTotal) : 0), 0)
  );

  // 4. Labour costs from crew assignments
  const assignments = await prisma.crewAssignment.findMany({
    where: { projectId },
    select: { estimatedCost: true },
  });

  const labourCostTotal = roundCurrency(
    assignments.reduce((sum, a) => sum + (a.estimatedCost != null ? Number(a.estimatedCost) : 0), 0)
  );

  // 5. Sub-hire costs (what we pay suppliers)
  const subHires = await prisma.subHire.findMany({
    where: {
      projectId,
      status: { notIn: ["CANCELLED", "DRAFT"] },
    },
    select: { totalCost: true },
  });

  const subHireCostTotal = roundCurrency(
    subHires.reduce((sum, sh) => sum + (sh.totalCost != null ? Number(sh.totalCost) : 0), 0)
  );

  // 6. Calculate totals (equipment + billable services)
  const subtotal = roundCurrency(equipmentRevenue + serviceRevenue);
  const discountPercent = project.discountPercent != null ? Number(project.discountPercent) : 0;
  const discountAmount = roundCurrency(subtotal * (discountPercent / 100));
  const taxableAmount = roundCurrency(subtotal - discountAmount);

  // Tax rate: project override → org default → 10%
  let taxRate = 10;
  if (project.taxRate != null) {
    taxRate = Number(project.taxRate);
  } else {
    const org = await prisma.organization.findUnique({
      where: { id: project.organizationId },
      select: { defaultTaxRate: true },
    });
    if (org?.defaultTaxRate != null) {
      taxRate = Number(org.defaultTaxRate);
    }
  }

  const taxAmount = roundCurrency(taxableAmount * (taxRate / 100));
  const total = roundCurrency(taxableAmount + taxAmount);
  const margin = roundCurrency(total - (serviceCostTotal + labourCostTotal + subHireCostTotal));

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      equipmentRevenue,
      serviceCostTotal,
      labourCostTotal,
      subHireCostTotal,
      subtotal,
      discountAmount,
      taxAmount,
      total,
      margin,
    },
  });
  // Mirror the recomputed project totals to Convex (project is dual-written).
  await patchProjectInConvex(updated.id, updated);
}
