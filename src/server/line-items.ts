"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
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
import { getSupplierById } from "@/lib/suppliers-read";
import { roundCurrency } from "@/lib/formatters";
import { calculateSuggestedPrice } from "./project-groups";
import { UserFacingError } from "@/lib/errors";
import { computeStockBreakdown } from "@/lib/availability";
import { isStaleRevision } from "@/lib/collaboration-conflict";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import { getModelById, getModelWithCategoryMap } from "@/lib/models-read";
import { getActiveAssetsByModel, getActiveBulkAssetsByModel, getAssetById, getBulkAssetById, getAssetByAssetTag, getAssetsByOrg, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getKitById, getKitSerializedItemsByOrg, getKitBulkItemsByOrg } from "@/lib/kits-read";
import { getSubHiresByProject } from "@/lib/sub-hire-read";
import { getProjectServicesByOrg } from "@/lib/project-services-read";
import { getLocationById } from "@/lib/locations-read";
import { getAssignmentsByProject } from "@/lib/crew-scheduling-read";

/**
 * Read back a created/updated line from Convex and attach the asset/bulkAsset
 * joins the old Prisma `include: { asset, bulkAsset }` returned, so callers that
 * read `result.asset` / `result.bulkAsset` keep working.
 */
async function readBackLine(id: string) {
  const convex = await getConvexClient();
  const line = await convex.query(api.projectLineItems.getById, { id });
  if (!line) return null;
  const [asset, bulkAsset] = await Promise.all([
    line.assetId ? getAssetById(line.assetId) : Promise.resolve(null),
    line.bulkAssetId ? getBulkAssetById(line.bulkAssetId) : Promise.resolve(null),
  ]);
  return { ...line, asset, bulkAsset };
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
        const conflictSet = new Set(conflictProjectIds);
        const convex = await getConvexClient();
        // Asset may be booked via a legacy line.assetId row OR via a unit — check
        // both in Convex (the flipped tables). Both reads are now scoped to THIS
        // asset (was: collect every unit in the org, then JS-filter to the asset,
        // then one getById per unit — a whole-table read + an N+1 that produced
        // hundreds of Convex calls per add).
        const [assetLines, assetUnits] = await Promise.all([
          convex.query(api.projectLineItems.listByAssetId, { assetId: parsed.assetId, orgId: organizationId }),
          convex.query(api.projectLineItemUnits.listByOrgAndAsset, { orgId: organizationId, assetId: parsed.assetId }),
        ]);
        const lineConflict = assetLines.find(
          (li) => li.status !== "CANCELLED" && conflictSet.has(li.projectId),
        );
        // Batch-fetch the line items for the asset's live units in one round-trip
        // (was one getById per unit).
        const unitLineIds = [
          ...new Set(assetUnits.filter((u) => u.status !== "RETURNED").map((u) => u.lineItemId)),
        ];
        const unitLines = unitLineIds.length
          ? await convex.query(api.projectLineItems.listByIds, { ids: unitLineIds, orgId: organizationId })
          : [];
        const unitConflictProjId = unitLines.find(
          (ul) => ul.status !== "CANCELLED" && conflictSet.has(ul.projectId),
        )?.projectId;
        const conflictProjId = lineConflict?.projectId ?? unitConflictProjId;
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
        // Scoped to THIS model (was: collect every line item in the org, then
        // JS-filter to the model).
        const modelLines = await (await getConvexClient()).query(api.projectLineItems.listByModelId, { modelId: parsed.modelId, orgId: organizationId });
        let overlapping;
        if (hasDates) {
          const projStartMs = convexProject.rentalStartDate as number;
          const projEndMs = convexProject.rentalEndDate as number;
          const modelAllProjects = await getProjectsByOrg(organizationId);
          const modelConflictProjectIds = new Set(
            modelAllProjects
              .filter(
                (p) =>
                  !p.isTemplate &&
                  !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
                  p.rentalStartDate != null &&
                  p.rentalEndDate != null &&
                  (p.rentalStartDate as number) <= projEndMs &&
                  (p.rentalEndDate as number) >= projStartMs,
              )
              .map((p) => p.id),
          );
          overlapping = modelLines.filter(
            (li) =>
              li.status !== "CANCELLED" &&
              li.subHireId == null &&
              modelConflictProjectIds.has(li.projectId),
          );
        } else {
          overlapping = modelLines.filter(
            (li) =>
              li.status !== "CANCELLED" &&
              li.subHireId == null &&
              li.projectId === projectId,
          );
        }

        const booked = overlapping.reduce((sum, li) => sum + (li.quantity ?? 0), 0);
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
    const convex = await getConvexClient();
    const projectLines = await convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId });
    const existing = projectLines.find(
      (li) =>
        li.modelId === parsed.modelId &&
        li.assetId == null &&
        (li.groupId ?? null) === (parsed.groupId ?? null) &&
        (li.categoryId ?? null) === (parsed.categoryId ?? null) &&
        !li.isKitChild &&
        // Merge only among non-sub-hire items. Sub-hire items always live in
        // their own SubHire-managed rows and shouldn't merge with manual adds.
        li.subHireId == null &&
        li.status !== "CANCELLED",
    );

    if (existing) {
      const oldQuantity = existing.quantity ?? 0;
      const newQuantity = (existing.quantity ?? 0) + parsed.quantity;
      const newLineTotal = calculateLineTotal(
        parsed.unitPrice ?? (existing.unitPrice != null ? Number(existing.unitPrice) : undefined),
        newQuantity,
        parsed.duration || existing.duration || 1,
        parsed.discount ?? (existing.discount != null ? Number(existing.discount) : undefined),
      );

      const mergedNotes = parsed.notes
        ? existing.notes
          ? `${existing.notes}; ${parsed.notes}`
          : parsed.notes
        : existing.notes;

      await convex.mutation(api.projectLineItems.patchLineItem, {
        id: existing.id,
        set: {
          quantity: newQuantity,
          unitPrice: parsed.unitPrice ?? existing.unitPrice ?? undefined,
          pricingType: parsed.pricingType || existing.pricingType,
          duration: parsed.duration || existing.duration || undefined,
          discount: parsed.discount ?? existing.discount ?? undefined,
          lineTotal: newLineTotal ?? undefined,
          groupName: parsed.groupName || existing.groupName || undefined,
          notes: mergedNotes || undefined,
          updatedAt: Date.now(),
        },
        clear: [],
      });

      const result = await readBackLine(existing.id);

      await recalculateProjectTotals(projectId);

      // Model lives in Convex — enrich after update.
      const mergedModel = result?.modelId ? await getModelById(result.modelId) : null;

      await logActivity({
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "lineItem",
        entityId: existing.id,
        entityName: result?.description || `Line item`,
        summary: `Merged line item into existing on project (qty ${oldQuantity} -> ${newQuantity})`,
        projectId,
      });

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

  void priceBreakdown;
  void priceOverridden;

  // Create the line in Convex. The mutation computes sortOrder in-mutation (no
  // TOCTOU) and expands permanent accessories as child lines atomically.
  const newLineId = createId();
  const convex = await getConvexClient();
  await convex.mutation(api.projectLineItems.createLineItem, {
    id: newLineId,
    organizationId,
    projectId,
    fields: {
      type: parsed.type,
      modelId: parsed.modelId || undefined,
      assetId: parsed.assetId || undefined,
      bulkAssetId: parsed.bulkAssetId || undefined,
      description: parsed.description || undefined,
      quantity: parsed.quantity,
      unitPrice: autoUnitPrice ?? undefined,
      pricingType: autoPricingType,
      duration: autoDuration ?? undefined,
      discount: parsed.discount ?? undefined,
      lineTotal: lineTotal ?? undefined,
      groupName: parsed.groupName || undefined,
      notes: parsed.notes || undefined,
      isOptional: parsed.isOptional,
      showSubhireOnDocs: parsed.showSubhireOnDocs,
      supplierId: parsed.supplierId || undefined,
      subhireOrderNumber: parsed.subhireOrderNumber || undefined,
      categoryId: parsed.categoryId || undefined,
      groupId: parsed.groupId || undefined,
    },
    includeAccessories,
    now: Date.now(),
  });

  const result = (await readBackLine(newLineId))!;

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

  const existingDoc = await (await getConvexClient()).query(api.projectLineItems.getById, { id });
  const existing =
    existingDoc && existingDoc.organizationId === organizationId
      ? {
          unitPrice: existingDoc.unitPrice ?? null,
          pricingType: existingDoc.pricingType,
          projectId: existingDoc.projectId,
          quantity: existingDoc.quantity ?? 0,
          modelId: existingDoc.modelId ?? null,
          subHireId: existingDoc.subHireId ?? null,
          updatedAt: existingDoc.updatedAt ?? null,
        }
      : null;

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
      // Scoped to THIS model (was: collect every line item in the org).
      const modelLines = await (await getConvexClient()).query(api.projectLineItems.listByModelId, { modelId: parsed.modelId, orgId: organizationId });
      let overlapping;
      if (hasDates) {
        const projStartMs = updateConvexProject!.rentalStartDate as number;
        const projEndMs = updateConvexProject!.rentalEndDate as number;
        const updateAllProjects = await getProjectsByOrg(organizationId);
        const updateConflictProjectIds = new Set(
          updateAllProjects
            .filter(
              (p) =>
                !p.isTemplate &&
                !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "") &&
                p.rentalStartDate != null &&
                p.rentalEndDate != null &&
                (p.rentalStartDate as number) <= projEndMs &&
                (p.rentalEndDate as number) >= projStartMs,
            )
            .map((p) => p.id),
        );
        overlapping = modelLines.filter(
          (li) =>
            li.status !== "CANCELLED" &&
            li.subHireId == null &&
            li.id !== id &&
            updateConflictProjectIds.has(li.projectId),
        );
      } else {
        overlapping = modelLines.filter(
          (li) =>
            li.status !== "CANCELLED" &&
            li.subHireId == null &&
            li.id !== id &&
            li.projectId === existing.projectId,
        );
      }

      const booked = overlapping.reduce((sum, li) => sum + (li.quantity ?? 0), 0);
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

  // Build the Convex patch. Scalar fields that the old code wrote `|| null` /
  // `?? null` are CLEARED to undefined when empty; association fields are only
  // touched when explicitly provided (undefined ⇒ keep existing), and clear when
  // provided-but-empty (matching the old `field || null`).
  const set: {
    type?: typeof parsed.type;
    quantity?: number;
    pricingType?: typeof parsed.pricingType;
    duration?: number;
    isOptional?: boolean;
    showSubhireOnDocs?: boolean;
    description?: string;
    unitPrice?: number;
    discount?: number;
    lineTotal?: number;
    groupName?: string;
    notes?: string;
    subhireOrderNumber?: string;
    modelId?: string;
    assetId?: string;
    bulkAssetId?: string;
    supplierId?: string;
    updatedAt?: number;
  } = {
    type: parsed.type,
    quantity: parsed.quantity,
    pricingType: parsed.pricingType,
    duration: parsed.duration,
    isOptional: parsed.isOptional,
    showSubhireOnDocs: parsed.showSubhireOnDocs,
    updatedAt: Date.now(),
  };
  const clear: string[] = [];

  const setStr = (key: "description" | "groupName" | "notes" | "subhireOrderNumber" | "modelId" | "assetId" | "bulkAssetId" | "supplierId", value: string | null | undefined) => {
    if (value === undefined || value === null || value === "") clear.push(key);
    else set[key] = value;
  };
  const setNum = (key: "unitPrice" | "discount" | "lineTotal", value: number | null | undefined) => {
    if (value === undefined || value === null) clear.push(key);
    else set[key] = value;
  };
  setStr("description", parsed.description);
  setNum("unitPrice", parsed.unitPrice ?? null);
  setNum("discount", parsed.discount ?? null);
  setNum("lineTotal", lineTotal);
  setStr("groupName", parsed.groupName);
  setStr("notes", parsed.notes);
  setStr("subhireOrderNumber", parsed.subhireOrderNumber);

  // Association fields: only when explicitly provided.
  if (parsed.modelId !== undefined) setStr("modelId", parsed.modelId);
  if (parsed.assetId !== undefined) setStr("assetId", parsed.assetId);
  if (parsed.bulkAssetId !== undefined) setStr("bulkAssetId", parsed.bulkAssetId);
  if (parsed.supplierId !== undefined) setStr("supplierId", parsed.supplierId);

  await (await getConvexClient()).mutation(api.projectLineItems.patchLineItem, {
    id,
    set,
    clear,
  });

  const result = (await readBackLine(id))!;

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
        lineTotal: result.lineTotal != null ? String(result.lineTotal) : null,
      },
    },
  );

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
  // Member counts (for the activity-feed summary) — read from Convex; the actual
  // child-line creation reads the same members in-mutation.
  const [allSerialized, allBulk] = await Promise.all([
    getKitSerializedItemsByOrg(organizationId),
    getKitBulkItemsByOrg(organizationId),
  ]);
  const serializedItems = allSerialized.filter((s) => s.kitId === kitId);
  const bulkItems = allBulk.filter((b) => b.kitId === kitId);
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
    const kitConflictSet = new Set(kitConflictProjectIds);
    const kitLines = await (await getConvexClient()).query(api.projectLineItems.listByKitId, { kitId, orgId: organizationId });
    const conflict = kitLines.find(
      (li) =>
        li.kitId === kitId &&
        !li.isKitChild &&
        li.status !== "CANCELLED" &&
        kitConflictSet.has(li.projectId),
    );
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

  // Create parent + children in one Convex mutation. The mutation reads the
  // kit's Convex members, computes sortOrder in-mutation, and applies ITEMIZED
  // child pricing from each member model's defaultRentalPrice.
  const parentId = createId();
  await (await getConvexClient()).mutation(api.projectLineItems.createKitLineItem, {
    id: parentId,
    organizationId,
    projectId,
    kitId,
    unitPrice: unitPrice ?? undefined,
    pricingMode,
    groupName: groupName || undefined,
    categoryId: categoryId || undefined,
    groupId: groupId || undefined,
    now: Date.now(),
  });

  const parentItem = (await readBackLine(parentId))!;

  await recalculateProjectTotals(projectId);

  if (emitActivity) {
    const memberCount = kit.serializedItems.length + kit.bulkItems.length;
    await writeCollabActivityEvent(
      { organizationId, userId, userName },
      {
        entityType: "project",
        entityId: projectId,
        action: "kit_added",
        summary: `added kit "${parentItem.description ?? kit.assetTag}" (${memberCount} item${memberCount === 1 ? "" : "s"})`,
        targetType: "lineItem",
        targetId: parentItem.id,
      },
    );
  }

  return serialize(parentItem);
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

  // Resolve groupName from groupId if provided (groups are Convex-only now)
  let groupName: string | undefined;
  if (parsed.groupId) {
    const group = await (await getConvexClient()).query(api.projectGroups.getById, { id: parsed.groupId });
    groupName =
      group && group.projectId === projectId && group.organizationId === organizationId
        ? group.title ?? undefined
        : undefined;
  }

  // Compute lineTotal — the mutation computes sortOrder in-mutation.
  const lineTotal = calculateLineTotal(parsed.unitPrice, parsed.quantity, parsed.duration, parsed.discount);

  const customId = createId();
  await (await getConvexClient()).mutation(api.projectLineItems.createCustomLineItem, {
    id: customId,
    organizationId,
    projectId,
    fields: {
      description: parsed.description,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? undefined,
      pricingType: parsed.pricingType,
      duration: parsed.duration,
      discount: parsed.discount ?? undefined,
      notes: parsed.notes ?? undefined,
      isOptional: parsed.isOptional,
      categoryId: parsed.categoryId ?? undefined,
      groupId: parsed.groupId ?? undefined,
      groupName: groupName ?? undefined,
      lineTotal: lineTotal ?? undefined,
    },
    now: Date.now(),
  });

  const result = (await readBackLine(customId))!;

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

  return serialize(result);
}

export async function removeLineItem(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const convex = await getConvexClient();
  const itemDoc = await convex.query(api.projectLineItems.getById, { id });
  const item = itemDoc && itemDoc.organizationId === organizationId ? itemDoc : null;
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
  // (+ their units) and the parent (+ its units) atomically in one Convex
  // mutation.
  await convex.mutation(api.projectLineItems.removeLineItemCascade, { id });
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
  await requirePermission("project", "manage_line_items");

  // Build the reorder payload: each id gets sortOrder = its index. groupUpdates
  // (id -> groupName) are merged in; ids that only appear in groupUpdates are
  // appended after the ordered ids (keeping their groupName change). The mutation
  // sets sortOrder + groupName atomically per row. `groupName: ""`/null clears.
  const groupNameById = new Map((groupUpdates ?? []).map((g) => [g.id, g.groupName]));
  const orderedSet = new Set(itemIds);
  const items: { id: string; sortOrder: number; groupName?: string }[] = itemIds.map((id, index) => ({
    id,
    sortOrder: index,
    ...(groupNameById.has(id) ? { groupName: groupNameById.get(id) || undefined } : {}),
  }));
  let extraSort = itemIds.length;
  for (const { id, groupName } of groupUpdates ?? []) {
    if (orderedSet.has(id)) continue;
    items.push({ id, sortOrder: extraSort++, groupName: groupName || undefined });
  }

  await (await getConvexClient()).mutation(api.projectLineItems.reorderLineItems, {
    items,
    now: Date.now(),
  });

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
  // Line items + projects both live in Convex — read both, filter/join in JS.
  const convex = await getConvexClient();
  // Line items scoped to THIS model (was: every line item in the org, then a
  // `li.modelId !== modelId` skip in the loop below).
  const [allOrgLines, allProjects] = await Promise.all([
    convex.query(api.projectLineItems.listByModelId, { modelId, orgId: organizationId }),
    getProjectsByOrg(organizationId),
  ]);
  const projectById = new Map(allProjects.map((p) => [p.id, p]));

  const overlappingLineItems: Array<{
    quantity: number;
    project: { id: string; name: string | null; projectNumber: string | null };
  }> = [];
  if (hasDates) {
    const endMs = endDate!.getTime();
    const startMs = startDate!.getTime();
    for (const li of allOrgLines) {
      if (li.modelId !== modelId) continue;
      if (li.status === "CANCELLED") continue;
      if (li.subHireId != null) continue;
      const p = projectById.get(li.projectId);
      if (!p) continue;
      if (p.isTemplate) continue;
      if (["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(p.status ?? "")) continue;
      if (p.rentalStartDate == null || p.rentalEndDate == null) continue;
      if ((p.rentalStartDate as number) > endMs || (p.rentalEndDate as number) < startMs) continue;
      overlappingLineItems.push({
        quantity: li.quantity ?? 0,
        project: { id: p.id, name: p.name ?? null, projectNumber: p.projectNumber ?? null },
      });
    }
  } else if (excludeProjectId) {
    for (const li of allOrgLines) {
      if (li.modelId !== modelId) continue;
      if (li.status === "CANCELLED") continue;
      if (li.subHireId != null) continue;
      if (li.projectId !== excludeProjectId) continue;
      const p = projectById.get(li.projectId);
      overlappingLineItems.push({
        quantity: li.quantity ?? 0,
        project: { id: li.projectId, name: p?.name ?? null, projectNumber: p?.projectNumber ?? null },
      });
    }
  }

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
    const lookupConflictSet = new Set(lookupConflictProjectIds);

    const assetLines = await (await getConvexClient()).query(api.projectLineItems.listByAssetId, { assetId: asset.id, orgId: organizationId });
    const overlapping = assetLines.find(
      (li) => li.status !== "CANCELLED" && lookupConflictSet.has(li.projectId),
    );

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
  const kitAvailConflictSet = new Set(kitAvailConflictProjectIds);

  const kitAvailOrgLines = await (await getConvexClient()).query(api.projectLineItems.listByKitId, { kitId, orgId: organizationId });
  const conflict = kitAvailOrgLines.find(
    (li) =>
      li.kitId === kitId &&
      !li.isKitChild &&
      li.status !== "CANCELLED" &&
      kitAvailConflictSet.has(li.projectId),
  );

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

  const convex = await getConvexClient();
  // Groups + line items both live in Convex — read both, compute revenue in JS.
  const [groups, projectLines] = await Promise.all([
    convex.query(api.projectGroups.listByProject, { projectId, orgId: project.organizationId }),
    convex.query(api.projectLineItems.listByProject, { projectId, orgId: project.organizationId }),
  ]);

  // 1. Equipment revenue from groups: bundle price × quantity, PLUS any
  // custom items placed inside the group. Custom items live outside the
  // model-rate optimizer, so their lineTotal doesn't roll into the bundle
  // price — they're "extras on top." Without this addition, a custom item
  // added to a group is invisible to the project total.
  const groupRevenue = groups.reduce((sum, g) => {
    const bundlePrice = g.price != null ? Number(g.price) : 0;
    const customExtras = projectLines
      .filter(
        (li) =>
          li.groupId === g.id &&
          li.isCustomItem === true &&
          !li.isOptional &&
          !li.isKitChild &&
          li.status !== "CANCELLED",
      )
      .reduce((s, li) => s + (li.lineTotal != null ? Number(li.lineTotal) : 0), 0);
    return sum + bundlePrice * (g.quantity ?? 0) + customExtras;
  }, 0);

  // 2. Equipment revenue from standalone (ungrouped) line items —
  // this naturally includes ungrouped custom items via their lineTotal.
  const standaloneRevenue = projectLines
    .filter(
      (li) =>
        li.groupId == null &&
        !li.isOptional &&
        !li.isKitChild &&
        li.status !== "CANCELLED",
    )
    .reduce((sum, li) => sum + (li.lineTotal != null ? Number(li.lineTotal) : 0), 0);

  const equipmentRevenue = roundCurrency(groupRevenue + standaloneRevenue);

  // 3. Service financials. project_service is Convex-only — read the org's
  // services and filter to this project's non-CANCELLED rows in JS (replaces the
  // Prisma findMany by projectId + status != CANCELLED).
  const services = (await getProjectServicesByOrg(project.organizationId)).filter(
    (s) => s.projectId === projectId && s.status !== "CANCELLED",
  );

  // costTotal = what it costs us (all services)
  const serviceCostTotal = roundCurrency(
    services.reduce((sum, s) => sum + (s.costTotal != null ? Number(s.costTotal) : 0), 0)
  );

  // serviceRevenue = what we charge the client (only billable services shown on documents)
  const serviceRevenue = roundCurrency(
    services
      .filter((s) => s.showOnDocuments === true)
      .reduce((sum, s) => sum + (s.lineTotal != null ? Number(s.lineTotal) : 0), 0)
  );

  // 4. Labour costs from crew assignments (read from Convex — dual-written)
  const assignments = await getAssignmentsByProject(projectId, project.organizationId);

  const labourCostTotal = roundCurrency(
    assignments.reduce((sum, a) => sum + (a.estimatedCost != null ? Number(a.estimatedCost) : 0), 0)
  );

  // 5. Sub-hire costs (what we pay suppliers) — sub-hires are dual-written; read
  // from Convex and filter out CANCELLED/DRAFT in JS.
  const subHires = (await getSubHiresByProject(projectId, project.organizationId)).filter(
    (sh) => sh.status !== "CANCELLED" && sh.status !== "DRAFT",
  );

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

  // project is Convex-only — patch the recomputed totals directly. (The prior
  // Prisma update + mirror left the Convex totals stale when the mirror was a
  // no-op; this is now the single source of truth.)
  await convex.mutation(api.projects.patchProject, {
    id: projectId,
    set: {
      equipmentRevenue,
      serviceCostTotal,
      labourCostTotal,
      subHireCostTotal,
      subtotal,
      discountAmount,
      taxAmount,
      total,
      margin,
      updatedAt: Date.now(),
    },
  });
}
