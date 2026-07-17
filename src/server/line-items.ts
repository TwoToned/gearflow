"use server";

import { createId } from "@paralleldrive/cuid2";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { readOrgDefaultTaxRate } from "@/lib/org-settings-read";
import {
  lineItemSchema,
  customLineItemSchema,
  type LineItemFormValues,
  type CustomLineItemFormValues,
} from "@/lib/validations/line-item";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import type { ActorContext } from "@/lib/actor-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { mapNativeWriteError } from "@/lib/native-writes";
import { getSupplierById } from "@/lib/suppliers-read";
import { roundCurrency } from "@/lib/formatters";
import { UserFacingError } from "@/lib/errors";
import { computeStockBreakdown, resolveModelAssetType } from "@/lib/availability";
import { isStaleRevision } from "@/lib/collaboration-conflict";
import { getModelById, getModelWithCategoryMap } from "@/lib/models-read";
import { getActiveAssetsByModel, getActiveBulkAssetsByModel, getAssetById, getBulkAssetById, getAssetByAssetTag, getAssetsByOrg, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getKitById, getKitSerializedItemsByOrg, getKitBulkItemsByOrg } from "@/lib/kits-read";
import { getSubHiresByProject } from "@/lib/sub-hire-read";
import { getProjectServicesByOrg } from "@/lib/project-services-read";
import { getLocationById } from "@/lib/locations-read";
import { getAssignmentsByProject } from "@/lib/crew-scheduling-read";

/**
 * Org default tax rate from Postgres (the source of truth — the Convex `organizations`
 * mirror has no writer, so it can be stale). Passed into the native write mutations so
 * their in-transaction recalc uses the authoritative rate for the no-override fallback.
 */
async function orgDefaultTaxRateFor(orgId: string): Promise<number | null> {
  // Org default tax lives in the Convex org-settings row (Phase 1 inversion).
  return readOrgDefaultTaxRate(orgId);
}

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

export async function addLineItem(projectId: string, data: LineItemFormValues, allowOverbook = false, forceSeparate = false, includeAccessories = true, actor?: ActorContext) {
  // `actor` lets the API/MCP layer drive this exact guarded path on behalf of an
  // API key (actorType "apiKey") instead of a Better Auth session. When omitted,
  // the acting identity is the current session — unchanged web-UI behaviour.
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items", actor);
  const parsed = lineItemSchema.parse(data);

  // The FULL add orchestration — availability, merge-dedup, auto-pricing, insert,
  // accessory expansion, group-suggested-price, recalc, collab feed, and webhook —
  // runs atomically in one Convex mutation (addLineItemSmartNative). The server keeps
  // only the parse + actor resolution above and the supplier enrich below. lineTotal
  // is recomputed in-mutation; the client is never trusted.
  const convex = await getConvexClient();
  let res: { id: string; merged: boolean };
  try {
    res = await convex.mutation(api.lineItemWrites.addLineItemSmartNative, {
      id: createId(),
      organizationId,
      projectId,
      fields: {
        type: parsed.type,
        modelId: parsed.modelId || undefined,
        assetId: parsed.assetId || undefined,
        bulkAssetId: parsed.bulkAssetId || undefined,
        description: parsed.description || undefined,
        quantity: parsed.quantity,
        unitPrice: parsed.unitPrice ?? undefined,
        pricingType: parsed.pricingType,
        duration: parsed.duration ?? undefined,
        discount: parsed.discount ?? undefined,
        groupName: parsed.groupName || undefined,
        notes: parsed.notes || undefined,
        isOptional: parsed.isOptional,
        showSubhireOnDocs: parsed.showSubhireOnDocs,
        supplierId: parsed.supplierId || undefined,
        subhireOrderNumber: parsed.subhireOrderNumber || undefined,
        categoryId: parsed.categoryId || undefined,
        groupId: parsed.groupId || undefined,
      },
      allowOverbook,
      forceSeparate,
      includeAccessories,
      actor: { userId, userName },
      auditId: createId(),
      // This NEW app image conditionalizes its own collab/webhook tail off on the
      // native path (below), so the mutation must emit them. The pre-fold app never
      // passes this, so it doesn't double-emit during the deploy window. Expand-contract.
      emitSideEffects: true,
      now: Date.now(),
    });
  } catch (e) {
    throw mapNativeWriteError(e);
  }

  const result = (await readBackLine(res.id))!;

  // Non-money tail (supplier enrich only). The money orchestration + CREATE/UPDATE
  // audit + recalc + collab feed ("line_item_added") + webhook ("line_item.added")
  // now all commit atomically inside addLineItemSmartNative.
  const supplier = result.supplierId ? await getSupplierById(result.supplierId).catch(() => null) : null;

  if (res.merged) {
    return serialize({ ...result, supplier, _merged: true, _newQuantity: result.quantity });
  }
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

    // ONE parallel wave for all enforcement reads (was 3 sequential round-trips:
    // model/assets/bulks → modelLines → projects). projects only when dated.
    const convexEnf = await getConvexClient();
    const [model, activeAssets, activeBulkAssets, modelLines, updateAllProjects] = await Promise.all([
      getModelById(parsed.modelId),
      getActiveAssetsByModel(parsed.modelId, organizationId),
      getActiveBulkAssetsByModel(parsed.modelId, organizationId),
      convexEnf.query(api.projectLineItems.listByModelId, { modelId: parsed.modelId, orgId: organizationId }),
      hasDates ? getProjectsByOrg(organizationId) : Promise.resolve(null),
    ]);

    if (model) {
      const modelForBreakdown = {
        assetType: resolveModelAssetType(model.assetType, activeBulkAssets.length > 0),
        assets: activeAssets.map((a: ConvexAsset) => ({ status: a.status ?? "AVAILABLE" })),
        bulkAssets: activeBulkAssets.map((ba: ConvexBulkAsset) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
      };
      let overlapping;
      if (hasDates) {
        const projStartMs = updateConvexProject!.rentalStartDate as number;
        const projEndMs = updateConvexProject!.rentalEndDate as number;
        const updateConflictProjectIds = new Set(
          updateAllProjects!
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

  const patchConvex = await getConvexClient();
  // RBAC + patch/clear + UPDATE audit atomic. The availability re-check + stale guard
  // above stay server-side; recalc + collab feed fold into the mutation.
  try {
    await patchConvex.mutation(api.lineItemWrites.patchNative, {
      id,
      orgId: organizationId,
      set,
      clear,
      entityName: parsed.description || "Line item",
      allowOverbook,
      actor: { userId, userName },
      auditId: createId(),
      emitSideEffects: true,
      now: Date.now(),
    });
  } catch (e) {
    throw mapNativeWriteError(e);
  }

  const result = (await readBackLine(id))!;

  // Supplier enrich (recalc + audit + collab feed all fold into patchNative).
  const supplier = result.supplierId
    ? await getSupplierById(result.supplierId).catch(() => null)
    : null;
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
  const kitConvex = await getConvexClient();
  const kitLineArgs = {
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
  };
  // Parent + expanded member children (shared core) + CREATE audit atomic. The
  // server pre-check above already gated kit availability identically; the mutation
  // re-checks belt-and-braces, so map any ConvexError back to the rich toast. The
  // "kit_added" collab event (gated on emitActivity) folds into addKitNative too.
  try {
    await kitConvex.mutation(api.lineItemWrites.addKitNative, {
      ...kitLineArgs,
      kitLabel: `${kit.assetTag} - ${kit.name}`,
      emitActivity,
      actor: { userId, userName },
      auditId: createId(),
    });
  } catch (e) {
    throw mapNativeWriteError(e);
  }

  const parentItem = (await readBackLine(parentId))!;

  // Recalc + collab feed fold into addKitNative.
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
  const customFields = {
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
  };
  const customConvex = await getConvexClient();
  // Custom items consume no inventory → fully native (RBAC + insert + audit +
  // recalc + "custom_item_added" collab feed, all atomic in the mutation).
  await customConvex.mutation(api.lineItemWrites.addCustomNative, {
    id: customId,
    organizationId,
    projectId,
    fields: customFields,
    actor: { userId, userName },
    auditId: createId(),
    emitSideEffects: true,
    now: Date.now(),
  });

  const result = (await readBackLine(customId))!;

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

  // Native: the child-removal guard + cascade (children + units) + DELETE audit
  // + project-totals recalc + collab feed ("line_item_removed") all run atomically
  // in the mutation (one round-trip).
  try {
    await convex.mutation(api.lineItemWrites.removeNative, {
      id,
      orgId: organizationId,
      actor: { userId, userName },
      auditId: createId(),
      // This NEW app image conditionalizes its own collab tail off on the native
      // path (below), so the mutation must emit it. The pre-fold app never passes
      // this, so it doesn't double-emit during the deploy window. Expand-contract.
      emitSideEffects: true,
      now: Date.now(),
    });
  } catch (e) {
    throw mapNativeWriteError(e);
  }
  return serialize({ success: true });
}

/**
 * Bulk-remove line items in a single server round-trip.
 *
 * Collapses the old N-client-round-trips loop (one `removeLineItem` call per
 * selected row) into one action: loops the legacy cascade-delete Convex mutation
 * server-side, then recalcs each affected project ONCE and writes ONE bulk audit.
 * Child items (kit members, accessory children, sub-hire group children) are
 * skipped — they are removed via their parent, never individually (same guard as
 * `removeLineItem`) — and reported back in `skipped`.
 */
export async function removeLineItemsBatch(ids: string[]) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  if (ids.length === 0) return serialize({ removed: 0, skipped: 0 });

  const convex = await getConvexClient();
  // ONE backend-local pass: the org-scope + child-guard + cascade loop runs inside
  // a single Convex mutation, not one server→Convex round-trip per item.
  const { removed, skipped, projectIds } = await convex.mutation(
    api.projectLineItems.removeManyCascade,
    { ids, orgId: organizationId },
  );

  await Promise.all([
    ...projectIds.map((pid: string) => recalculateProjectTotals(pid)),
    removed > 0
      ? logActivity({
          organizationId,
          userId,
          userName,
          action: "DELETE",
          entityType: "lineItem",
          entityId: ids[0],
          entityName: `${removed} line item${removed === 1 ? "" : "s"}`,
          summary: `Removed ${removed} line item${removed === 1 ? "" : "s"} from project`,
          projectId: projectIds[0],
        })
      : Promise.resolve(),
  ]);

  return serialize({ removed, skipped });
}

/** A shared value to apply to every selected line item in a bulk edit. */
export interface BulkLineItemPatch {
  pricingType?: "PER_DAY" | "PER_WEEK" | "FLAT" | "PER_HOUR" | "OPTIMIZED";
  /** `null` or a non-positive value clears the discount. `%` is resolved per-item. */
  discount?: { mode: "$" | "%"; value: number } | null;
  /** `null`/empty clears the note. */
  notes?: string | null;
  isOptional?: boolean;
}

/**
 * Bulk-edit shared fields across selected line items in one server round-trip.
 *
 * Only the fields that legitimately apply to many rows are settable (pricing
 * type, discount, notes, optional flag) — quantity/unit-price/description are
 * per-item and stay out. A `%` discount is resolved against each item's own base
 * (unitPrice × quantity × duration). `lineTotal` is recomputed per item whenever
 * the discount changes. Child items are skipped. Recalc + audit run once at the end.
 */
export async function updateLineItemsBatch(ids: string[], patch: BulkLineItemPatch) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  if (ids.length === 0) return serialize({ updated: 0, skipped: 0 });

  const convex = await getConvexClient();
  // ONE read for all selected rows — the per-item discount/lineTotal maths needs
  // each row's own price/qty/duration, but that's a single round-trip, not N.
  const docs = await convex.query(api.projectLineItems.listByIdsForOrg, {
    ids,
    orgId: organizationId,
  });

  const now = Date.now();
  const items: { id: string; set: Record<string, unknown>; clear: string[] }[] = [];
  // Rows dropped by the org-scoped read (missing / wrong org) count as skipped.
  let skipped = ids.length - docs.length;

  for (const doc of docs) {
    if (doc.isKitChild) {
      skipped++;
      continue;
    }

    const set: Record<string, unknown> = { updatedAt: now };
    const clear: string[] = [];

    if (patch.pricingType !== undefined) set.pricingType = patch.pricingType;
    if (patch.isOptional !== undefined) set.isOptional = patch.isOptional;
    if (patch.notes !== undefined) {
      if (patch.notes == null || patch.notes === "") clear.push("notes");
      else set.notes = patch.notes;
    }

    if (patch.discount !== undefined) {
      let discountApplied: number | undefined;
      if (patch.discount == null || patch.discount.value <= 0) {
        clear.push("discount");
        discountApplied = undefined;
      } else if (patch.discount.mode === "%") {
        const base = (doc.unitPrice ?? 0) * (doc.quantity ?? 0) * (doc.duration ?? 1);
        discountApplied = roundCurrency((base * patch.discount.value) / 100);
        set.discount = discountApplied;
      } else {
        discountApplied = patch.discount.value;
        set.discount = discountApplied;
      }
      // Discount feeds the stored line total — recompute it from the item's own
      // price/quantity/duration (unchanged) and the new discount.
      const lineTotal = calculateLineTotal(
        doc.unitPrice ?? undefined,
        doc.quantity ?? 0,
        doc.duration ?? 1,
        discountApplied,
      );
      if (lineTotal == null) clear.push("lineTotal");
      else set.lineTotal = lineTotal;
    }

    items.push({ id: doc.id, set, clear });
  }

  if (items.length === 0) return serialize({ updated: 0, skipped });

  // ONE backend-local write pass for every row.
  const { updated, projectIds } = await convex.mutation(api.projectLineItems.patchMany, {
    orgId: organizationId,
    items,
  });

  await Promise.all([
    ...projectIds.map((pid: string) => recalculateProjectTotals(pid)),
    updated > 0
      ? logActivity({
          organizationId,
          userId,
          userName,
          action: "UPDATE",
          entityType: "lineItem",
          entityId: ids[0],
          entityName: `${updated} line item${updated === 1 ? "" : "s"}`,
          summary: `Bulk edited ${updated} line item${updated === 1 ? "" : "s"}`,
          projectId: projectIds[0],
        })
      : Promise.resolve(),
  ]);

  return serialize({ updated, skipped });
}

export async function reorderLineItems(
  projectId: string,
  itemIds: string[],
  groupUpdates?: { id: string; groupName: string | null }[],
) {
  const { organizationId: reorderOrgId } = await requirePermission("project", "manage_line_items");

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

  const reorderConvex = await getConvexClient();
  await reorderConvex.mutation(api.lineItemWrites.reorderNative, {
    orgId: reorderOrgId,
    items,
    now: Date.now(),
  });

  return serialize({ success: true });
}

export async function checkAvailability(
  modelId: string,
  rentalStartDate?: Date | string | null,
  rentalEndDate?: Date | string | null,
  excludeProjectId?: string,
  actor?: ActorContext
) {
  // `actor` (API/MCP path) supplies the org directly; membership + RBAC are
  // already validated upstream (authorizeApiOperation) before this read runs.
  // Without it, resolve the org from the current session, as before.
  const { organizationId } = actor
    ? { organizationId: actor.organizationId }
    : await getOrgContext();

  const hasDates = !!rentalStartDate && !!rentalEndDate;
  const startDate = hasDates ? new Date(rentalStartDate) : null;
  const endDate = hasDates ? new Date(rentalEndDate) : null;

  // ONE round-trip for everything this check needs (was ~6 queries in 3 sequential
  // waves: model+assets+bulks, then lines+projects, then a trailing accessories
  // read). Read backend-local inside a single Convex query; raw docs used below.
  const convex = await getConvexClient();
  const ab = await convex.query(api.availabilityCheck.checkBundle, { modelId, orgId: organizationId });
  const model = ab.model;
  const activeAssets = ab.activeAssets;
  const activeBulkAssets = ab.activeBulkAssets;

  if (!model) {
    return serialize({ totalStock: 0, effectiveStock: 0, booked: 0, available: 0, bookedOnThisProject: 0, unavailable: 0, inMaintenance: 0, lost: 0, conflicts: [] as string[], dateless: !hasDates, hasAccessories: false });
  }

  const modelForBreakdown = {
    assetType: resolveModelAssetType(model.assetType, activeBulkAssets.length > 0),
    assets: activeAssets.map((a: ConvexAsset) => ({ status: a.status ?? "AVAILABLE" })),
    bulkAssets: activeBulkAssets.map((ba: ConvexBulkAsset) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
  };

  // Find overlapping projects (where the project rental period overlaps with the given dates)
  // Include both regular items AND kit children — they all consume stock
  // Sub-hire items represent third-party stock and are excluded.
  // When no dates: only count bookings on the current project (stock-only check)
  // Line items (this model) + all org projects — both from the bundle above.
  const allOrgLines = ab.lines;
  const allProjects = ab.projects;
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

  const bulkAccessoryCount = ab.bulkAccessoryCount;

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

  const orgId = project.organizationId;
  const convex = await getConvexClient();

  // One backend-local recalc mutation (the 6–12s write tail collapsed to one
  // round-trip). orgDefaultTaxRate is resolved inside the mutation from orgSettings
  // (source of truth) — the client no longer supplies it (a spoofable, money-affecting
  // value). recalc.ts is parity-tested (convex/recalc.test.ts).
  await convex.mutation(api.lineItemWrites.recalcNative, {
    projectId,
    orgId,
    now: Date.now(),
  });
}

/**
 * Availability for MANY models in one call.
 *
 * `checkAvailability` answers for a single model, so an agent sizing up ten models
 * paid ten round trips. This runs the same per-model check server-side and returns
 * a keyed result, collapsing the agent's cost to one request. Each model's answer
 * is byte-identical to calling `checkAvailability` directly — this is a fan-out,
 * not a second implementation of the overbooking maths.
 *
 * Reads only; capped so a caller can't fan out unboundedly.
 */
export async function checkAvailabilityBatch(
  modelIds: string[],
  rentalStartDate?: Date | string | null,
  rentalEndDate?: Date | string | null,
  excludeProjectId?: string,
  actor?: ActorContext
) {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    throw new UserFacingError({
      code: "NO_MODELS",
      title: "No models given",
      message: "Provide at least one modelId.",
      field: "modelIds",
    });
  }

  const unique = [...new Set(modelIds)];
  const MAX = 100;
  if (unique.length > MAX) {
    throw new UserFacingError({
      code: "TOO_MANY_MODELS",
      title: "Too many models",
      message: `Received ${unique.length} models; the maximum per call is ${MAX}.`,
      hint: "Split the request into batches.",
      field: "modelIds",
    });
  }

  // Bounded concurrency: each check is its own Convex query, and firing 100 at
  // once would spike the deployment for no latency gain.
  const CONCURRENCY = 8;
  const results: Record<string, Awaited<ReturnType<typeof checkAvailability>>> = {};

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const chunk = unique.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      chunk.map((modelId) =>
        checkAvailability(modelId, rentalStartDate, rentalEndDate, excludeProjectId, actor)
      )
    );
    chunk.forEach((modelId, idx) => {
      results[modelId] = settled[idx];
    });
  }

  return serialize({ requested: unique.length, availability: results });
}
