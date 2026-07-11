"use server";

import { prisma } from "@/lib/prisma";
import { addMediaConvex, removeMediaConvex } from "@/lib/media-write";
import { getConvexClient } from "@/lib/convex-client";
import { getSubHireMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import {
  getSubHiresByOrg,
  getSubHireById,
  getSubHireItems,
  getSubHireGroups,
  getSubHireItemCounts,
  mapSubHireItem,
  mapSubHireGroup,
  type SubHireRow,
  type SubHireItemRow,
  type SubHireGroupRow,
} from "@/lib/sub-hire-read";
import { api } from "../../convex/_generated/api";
import { createId } from "@paralleldrive/cuid2";
import {
  attachSupplier,
  getMatchingSupplierIds,
  getSupplierById,
} from "@/lib/suppliers-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { roundCurrency } from "@/lib/formatters";
import { subHireSchema, subHireItemSchema, subHireGroupSchema, subHireOrderPricingSchema, subHirePlacementSchema } from "@/lib/validations/sub-hire";
import type { SubHireStatus, SubHirePricingMode, SubHirePaymentStatus, PricingType, Prisma, MediaType } from "@/generated/prisma/client";

// ─── Convex single-row read helpers (write-path lookups) ─────────────────────

/** Fetch a single sub-hire item by id from Convex, Prisma-row-shaped, or null. */
async function findSubHireItemById(itemId: string): Promise<SubHireItemRow | null> {
  const row = await (await getConvexClient()).query(api.subHireItems.getById, { id: itemId });
  return row ? mapSubHireItem(row) : null;
}

/** Fetch a single sub-hire group by id from Convex, Prisma-row-shaped, or null. */
async function findSubHireGroupById(groupId: string): Promise<SubHireGroupRow | null> {
  const row = await (await getConvexClient()).query(api.subHireGroups.getById, { id: groupId });
  return row ? mapSubHireGroup(row) : null;
}

// ─── Status Machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<SubHireStatus, SubHireStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ON_HIRE", "RETURNED", "CANCELLED"],
  ON_HIRE: ["RETURNED", "CANCELLED"],
  RETURNED: [],
  CANCELLED: [],
};

// ─── Order Number ────────────────────────────────────────────────────────────

interface OrgSettings {
  [key: string]: unknown;
  subHireOrderCounter?: number;
}

async function reserveSubHireOrderNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  let settings: OrgSettings = {};
  if (org.metadata) {
    try {
      settings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  const currentCounter = settings.subHireOrderCounter || 0;
  const orderNumber = `SH-${String(currentCounter + 1).padStart(4, "0")}`;
  settings.subHireOrderCounter = currentCounter + 1;

  await tx.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  return orderNumber;
}

// ─── Core CRUD ───────────────────────────────────────────────────────────────

export async function getSubHires(filters?: {
  status?: SubHireStatus[];
  supplierId?: string;
  projectId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { organizationId } = await requirePermission("subHire", "read");

  // subHire + items + groups live in Convex — read heads then filter in JS.
  let heads = await getSubHiresByOrg(organizationId);

  if (filters?.status?.length) {
    const set = new Set(filters.status);
    heads = heads.filter((sh) => set.has(sh.status));
  }
  if (filters?.supplierId) {
    heads = heads.filter((sh) => sh.supplierId === filters.supplierId);
  }
  if (filters?.projectId) {
    heads = heads.filter((sh) => sh.projectId === filters.projectId);
  }
  if (filters?.dateFrom || filters?.dateTo) {
    const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    heads = heads.filter((sh) => {
      if (sh.hireStart === null) return false;
      if (from && sh.hireStart < from) return false;
      if (to && sh.hireStart > to) return false;
      return true;
    });
  }
  if (filters?.search) {
    const term = filters.search.toLowerCase();
    // Supplier lives in Convex — resolve matching supplier ids, then match
    // orderNumber / supplier / any item description (items also from Convex).
    const matchingSupplierIds = new Set(await getMatchingSupplierIds(organizationId, filters.search));
    const itemDescMatch = new Map<string, boolean>();
    await Promise.all(
      heads.map(async (sh) => {
        const items = await getSubHireItems(sh.id);
        itemDescMatch.set(sh.id, items.some((it) => it.description.toLowerCase().includes(term)));
      }),
    );
    heads = heads.filter(
      (sh) =>
        sh.orderNumber.toLowerCase().includes(term) ||
        matchingSupplierIds.has(sh.supplierId) ||
        itemDescMatch.get(sh.id) === true,
    );
  }

  // Sort by createdAt desc (nulls last), matching the Prisma order.
  heads.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  // _count.items for every head (one round trip per head).
  const itemCounts = await getSubHireItemCounts(heads.map((sh) => sh.id));

  // When fetching for a specific project, attach items + groups (with target
  // category/group labels + model) for the equipment-tab preview.
  let withItems: Array<SubHireRow & {
    _count: { items: number };
    items?: unknown[];
    groups?: unknown[];
  }>;
  if (filters?.projectId) {
    const [modelMap, projectCategories, projectGroups] = await Promise.all([
      getModelMap(organizationId),
      (await getConvexClient()).query(api.projectCategories.list, { orgId: organizationId }),
      (await getConvexClient()).query(api.projectGroups.list, { orgId: organizationId }),
    ]);
    const catLabel = new Map(projectCategories.map((c) => [c.id, { id: c.id, name: c.name }]));
    const grpLabel = new Map(projectGroups.map((g) => [g.id, { id: g.id, title: g.title, categoryId: g.categoryId ?? null }]));
    const enrichItem = <T extends { modelId: string | null; targetCategoryId: string | null; targetGroupId: string | null }>(item: T) => ({
      ...item,
      model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
      targetCategory: item.targetCategoryId ? (catLabel.get(item.targetCategoryId) ?? null) : null,
      targetGroup: item.targetGroupId ? (grpLabel.get(item.targetGroupId) ?? null) : null,
    });

    withItems = await Promise.all(
      heads.map(async (sh) => {
        const [items, groups] = await Promise.all([
          getSubHireItems(sh.id),
          getSubHireGroups(sh.id),
        ]);
        const groupItems = new Map<string, ReturnType<typeof enrichItem>[]>();
        for (const it of items) {
          if (!it.groupId) continue;
          const arr = groupItems.get(it.groupId) ?? [];
          arr.push(enrichItem(it));
          groupItems.set(it.groupId, arr);
        }
        return {
          ...sh,
          _count: { items: itemCounts.get(sh.id) ?? 0 },
          items: items.map(enrichItem),
          groups: groups.map((g) => ({
            ...g,
            targetCategory: g.targetCategoryId ? (catLabel.get(g.targetCategoryId) ?? null) : null,
            targetGroup: g.targetGroupId ? (grpLabel.get(g.targetGroupId) ?? null) : null,
            items: groupItems.get(g.id) ?? [],
          })),
        };
      }),
    );
  } else {
    withItems = heads.map((sh) => ({ ...sh, _count: { items: itemCounts.get(sh.id) ?? 0 } }));
  }

  // Supplier lives in Convex — attach instead of a Prisma join.
  const subHiresWithSupplier = await attachSupplier(organizationId, withItems);

  // Project lives in Convex — attach instead of a Prisma join.
  const uniqueProjectIds = [
    ...new Set(heads.map((s) => s.projectId).filter((id): id is string => id !== null)),
  ];
  const projectMap = new Map<string, { id: string; name: string; projectNumber: string }>();
  if (uniqueProjectIds.length > 0) {
    const allProjects = await getProjectsByOrg(organizationId);
    for (const p of allProjects) {
      projectMap.set(p.id, { id: p.id, name: p.name, projectNumber: p.projectNumber });
    }
  }
  const result = subHiresWithSupplier.map((sh) => ({
    ...sh,
    project: sh.projectId ? (projectMap.get(sh.projectId) ?? null) : null,
  }));

  return serialize(result);
}

export async function getSubHire(id: string) {
  const { organizationId } = await requirePermission("subHire", "read");

  // subHire + items + groups live in Convex; createdBy (auth) stays Prisma.
  const subHire = await getSubHireById(id);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");

  const client = await getConvexClient();
  const [items, groups, createdBy, modelMap, supplier, convexProject, media, projectCategories, projectGroups] =
    await Promise.all([
      getSubHireItems(id),
      getSubHireGroups(id),
      prisma.user.findUnique({ where: { id: subHire.createdById }, select: { id: true, name: true } }),
      getModelMap(organizationId),
      getSupplierById(subHire.supplierId),
      subHire.projectId ? getProjectById(subHire.projectId) : Promise.resolve(null),
      getSubHireMediaFromConvex(subHire.id),
      // Placement labels only ever reference THIS project's categories/groups, so
      // scope the fetch to the project instead of pulling every category/group in
      // the org (a large payload for orgs with many projects). A project-less
      // sub-hire has no placements, so an empty list is correct.
      subHire.projectId
        ? client.query(api.projectCategories.listByProject, { projectId: subHire.projectId, orgId: organizationId })
        : Promise.resolve([]),
      subHire.projectId
        ? client.query(api.projectGroups.listByProject, { projectId: subHire.projectId, orgId: organizationId })
        : Promise.resolve([]),
    ]);

  const catLabel = new Map(projectCategories.map((c) => [c.id, { id: c.id, name: c.name }]));
  const grpLabel = new Map(projectGroups.map((g) => [g.id, { id: g.id, title: g.title, categoryId: g.categoryId ?? null }]));
  const targetCategory = (cid: string | null) => (cid ? (catLabel.get(cid) ?? null) : null);
  const targetGroup = (gid: string | null) => (gid ? (grpLabel.get(gid) ?? null) : null);

  const project = convexProject
    ? { id: convexProject.id, name: convexProject.name, projectNumber: convexProject.projectNumber }
    : null;
  const enrichedGroups = groups.map((g) => ({
    ...g,
    targetCategory: targetCategory(g.targetCategoryId),
    targetGroup: targetGroup(g.targetGroupId),
    items: items
      .filter((item) => item.groupId === g.id)
      .map((item) => ({
        ...item,
        model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
      })),
  }));
  const enrichedItems = items.map((item) => ({
    ...item,
    model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
    targetCategory: targetCategory(item.targetCategoryId),
    targetGroup: targetGroup(item.targetGroupId),
  }));
  return serialize({
    ...subHire,
    createdBy,
    defaultTargetCategory: targetCategory(subHire.defaultTargetCategoryId),
    defaultTargetGroup: targetGroup(subHire.defaultTargetGroupId),
    media: withResolvedFile(media),
    groups: enrichedGroups,
    items: enrichedItems,
    supplier,
    project,
  });
}

export async function createSubHire(input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "create");
  const data = subHireSchema.parse(input);

  const id = createId();
  const now = Date.now();
  const convex = await getConvexClient();

  // Order-number reservation stays Prisma — it read-modify-writes the org metadata
  // JSON counter, and `organization` stays Prisma forever. The supplier fetch is
  // independent of it (and of the create), so run both concurrently instead of
  // three serial Convex/Postgres round-trips on the create path.
  const [orderNumber, supplier] = await Promise.all([
    prisma.$transaction((tx) => reserveSubHireOrderNumber(tx, organizationId)),
    getSupplierById(data.supplierId),
  ]);

  await convex.mutation(api.subHires.create, {
    id,
    organizationId,
    supplierId: data.supplierId,
    projectId: data.projectId || undefined,
    createdById: userId,
    orderNumber,
    supplierReference: data.supplierReference || undefined,
    status: "DRAFT",
    hireStart: data.hireStart ? data.hireStart.getTime() : undefined,
    hireEnd: data.hireEnd ? data.hireEnd.getTime() : undefined,
    showOnDocs: data.showOnDocs,
    notes: data.notes || undefined,
    defaultTargetCategoryId: data.defaultTargetCategoryId || undefined,
    defaultTargetGroupId: data.defaultTargetGroupId || undefined,
    createdAt: now,
    updatedAt: now,
  });

  // Read back the written head (Prisma-row-shaped) for the return value.
  const result = await getSubHireById(id);
  if (!result) throw new Error("Sub-hire not found after create");

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: result.id,
    entityName: `${result.orderNumber} (${supplier?.name ?? ""})`,
    summary: `Created sub-hire ${result.orderNumber}`,
  });

  return serialize({ ...result, supplier });
}

export async function updateSubHire(id: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireSchema.parse(input);

  const existing = await getSubHireById(id);
  if (!existing || existing.organizationId !== organizationId) throw new Error("Sub-hire not found");

  // Build the Convex patch. projectId/hireStart/hireEnd/notes mirror the prior
  // Prisma "value or null" behaviour → set when present, clear when empty.
  // supplierReference/defaultTarget* respect undefined ("don't touch").
  const set: Record<string, unknown> = {
    supplierId: data.supplierId,
    showOnDocs: data.showOnDocs,
    updatedAt: Date.now(),
  };
  const clear: string[] = [];

  if (data.projectId) set.projectId = data.projectId;
  else clear.push("projectId");

  if (data.hireStart) set.hireStart = data.hireStart.getTime();
  else clear.push("hireStart");

  if (data.hireEnd) set.hireEnd = data.hireEnd.getTime();
  else clear.push("hireEnd");

  if (data.notes) set.notes = data.notes;
  else clear.push("notes");

  if (data.supplierReference !== undefined) {
    if (data.supplierReference) set.supplierReference = data.supplierReference;
    else clear.push("supplierReference");
  }
  if (data.defaultTargetCategoryId !== undefined) {
    if (data.defaultTargetCategoryId) set.defaultTargetCategoryId = data.defaultTargetCategoryId;
    else clear.push("defaultTargetCategoryId");
  }
  if (data.defaultTargetGroupId !== undefined) {
    if (data.defaultTargetGroupId) set.defaultTargetGroupId = data.defaultTargetGroupId;
    else clear.push("defaultTargetGroupId");
  }

  const convex = await getConvexClient();
  await convex.mutation(api.subHires.patchSubHire, { id, set, clear });

  const subHire = await getSubHireById(id);
  if (!subHire) throw new Error("Sub-hire not found after update");

  // Supplier lives in Convex — fetch for the log label / return shape.
  const supplier = await getSupplierById(subHire.supplierId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplier?.name ?? ""})`,
    summary: `Updated sub-hire ${subHire.orderNumber}`,
  });

  return serialize({ ...subHire, supplier });
}

export async function deleteSubHire(id: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "delete");

  // subHire + items + groups + the linked line items all live in Convex now.
  const subHire = await getSubHireById(id);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");
  const projectId = subHire.projectId;

  const convex = await getConvexClient();
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  // Linked project line items live in Convex — filter the project's lines by this
  // sub-hire id (top-level + children resolved by the cascade mutation).
  const linkedLines = projectId
    ? (await convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId })).filter(
        (li) => li.subHireId === id,
      )
    : [];

  // Reject if any linked line items are checked out
  if (linkedLines.some((li) => li.status === "CHECKED_OUT")) {
    throw new Error("Cannot delete sub-hire with checked-out items");
  }

  // projectLineItem lives in Convex — delete the linked lines there (cascade
  // handles any children) before tearing down the Prisma-side sub-hire.
  // Sequential on purpose: linkedLines can contain a parent AND its child, and
  // removeLineItemCascade deletes the parent's direct children — firing these in
  // parallel would let a child's cascade run after its parent already deleted it
  // and throw "not found". (Keep as a loop; the win here is elsewhere.)
  for (const li of linkedLines) {
    await convex.mutation(api.projectLineItems.removeLineItemCascade, { id: li.id });
  }

  // Delete sub-hire head + all items + groups in one atomic Convex mutation.
  await convex.mutation(api.subHires.deleteCascade, { id });

  // Recalculate project totals if linked to a project
  if (projectId) {
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(projectId);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Deleted sub-hire ${subHire.orderNumber}`,
  });
}

export async function updateSubHireStatus(id: string, newStatus: SubHireStatus) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await getSubHireById(id);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  // Validate transition
  const validTargets = VALID_TRANSITIONS[subHire.status];
  if (!validTargets.includes(newStatus)) {
    throw new Error(`Cannot transition from ${subHire.status} to ${newStatus}`);
  }

  // Server-side validation: must have project to confirm
  if (newStatus === "CONFIRMED" && !subHire.projectId) {
    throw new Error("Assign a project before confirming");
  }

  const convex = await getConvexClient();

  if (newStatus === "CONFIRMED") {
    // Status change + line item generation. (Convex mutations are per-call atomic;
    // the old Prisma $transaction wrapper no longer applies.)
    await convex.mutation(api.subHires.patchSubHire, {
      id,
      set: { status: "CONFIRMED", updatedAt: Date.now() },
    });
    await generateSubHireLineItems(subHire.id, organizationId);

    // Recalculate project totals after generation
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(subHire.projectId!);
  } else {
    await convex.mutation(api.subHires.patchSubHire, {
      id,
      set: { status: newStatus, updatedAt: Date.now() },
    });

    // Recalculate project totals — status changes affect which sub-hires count as costs
    if (subHire.projectId) {
      const { recalculateProjectTotals } = await import("@/server/line-items");
      await recalculateProjectTotals(subHire.projectId);
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Changed sub-hire ${subHire.orderNumber} status to ${newStatus}`,
    details: { previousStatus: subHire.status, newStatus },
  });

  const updatedSubHire = await getSubHireById(id);
  if (!updatedSubHire) return serialize(null);
  const updatedItems = await getSubHireItems(id);
  // Model + supplier + project live in Convex — enrich after query.
  const [modelMap, supplier, convexProject] = await Promise.all([
    getModelMap(organizationId),
    getSupplierById(updatedSubHire.supplierId),
    updatedSubHire.projectId ? getProjectById(updatedSubHire.projectId) : Promise.resolve(null),
  ]);
  const project = convexProject
    ? { id: convexProject.id, name: convexProject.name, projectNumber: convexProject.projectNumber }
    : null;
  const enrichedItems = updatedItems.map((item) => ({
    ...item,
    model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
  }));
  return serialize({ ...updatedSubHire, items: enrichedItems, supplier, project });
}

// ─── Item CRUD ───────────────────────────────────────────────────────────────

export async function addSubHireItem(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireItemSchema.parse(input);

  const subHire = await getSubHireById(subHireId);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");

  // Get next sort order from the existing Convex items.
  const existingItems = await getSubHireItems(subHireId);
  const nextSort = Math.max(-1, ...existingItems.map((r) => r.sortOrder)) + 1;

  const id = createId();
  const convex = await getConvexClient();
  await convex.mutation(api.subHireItems.create, {
    id,
    subHireId,
    groupId: data.groupId || undefined,
    modelId: data.modelId || undefined,
    description: data.description,
    quantity: data.quantity,
    unitCost: data.unitCost,
    unitCharge: data.unitCharge,
    pricingType: data.pricingType as PricingType,
    duration: data.duration,
    discount: data.discount,
    showOnQuote: data.showOnQuote ?? true,
    showOnDocs: data.showOnDocs ?? subHire.showOnDocs ?? false,
    targetCategoryId: data.targetCategoryId || undefined,
    targetGroupId: data.targetGroupId || undefined,
    sortOrder: nextSort,
  });
  const item = (await getSubHireItems(subHireId)).find((it) => it.id === id)!;
  // Model lives in Convex — attach after create.
  const model = item.modelId ? await getModelById(item.modelId) : null;

  await recalculateSubHireTotals(subHireId);

  // Upsert supplier rate if item has a model
  if (data.modelId) {
    await upsertSupplierModelRate(organizationId, subHire.supplierId, data.modelId, data.unitCost, data.pricingType as PricingType);
  }

  // Sync line items to project (works for any status including DRAFT)
  await syncSubHireToProject(subHireId, organizationId, subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: subHire.orderNumber,
    summary: `Added item "${data.description}" to ${subHire.orderNumber}`,
  });

  return serialize({ ...item, model });
}

export async function updateSubHireItem(itemId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireItemSchema.parse(input);

  // Find the item + its sub-hire (org-scope via the head) — all in Convex.
  const existingItem = await findSubHireItemById(itemId);
  if (!existingItem) throw new Error("Sub-hire item not found");
  const parentSubHire = await getSubHireById(existingItem.subHireId);
  if (!parentSubHire || parentSubHire.organizationId !== organizationId) {
    throw new Error("Sub-hire item not found");
  }
  const existing = { subHire: parentSubHire };

  const set: Record<string, unknown> = {
    description: data.description,
    quantity: data.quantity,
    unitCost: data.unitCost,
    unitCharge: data.unitCharge,
    pricingType: data.pricingType as PricingType,
    duration: data.duration,
    discount: data.discount,
    showOnQuote: data.showOnQuote,
    showOnDocs: data.showOnDocs,
  };
  const clear: string[] = [];
  // modelId mirrors the prior `data.modelId || null` — set or clear unconditionally.
  if (data.modelId) set.modelId = data.modelId;
  else clear.push("modelId");
  if (data.groupId !== undefined) {
    if (data.groupId) set.groupId = data.groupId;
    else clear.push("groupId");
  }
  if (data.targetCategoryId !== undefined) {
    if (data.targetCategoryId) set.targetCategoryId = data.targetCategoryId;
    else clear.push("targetCategoryId");
  }
  if (data.targetGroupId !== undefined) {
    if (data.targetGroupId) set.targetGroupId = data.targetGroupId;
    else clear.push("targetGroupId");
  }

  const convex = await getConvexClient();
  await convex.mutation(api.subHireItems.patchItem, { id: itemId, set, clear });
  const item = (await getSubHireItems(existing.subHire.id)).find((it) => it.id === itemId)!;
  // Model lives in Convex — attach after update.
  const model = item.modelId ? await getModelById(item.modelId) : null;

  await recalculateSubHireTotals(existing.subHire.id);

  // Upsert supplier rate if item has a model
  if (data.modelId) {
    await upsertSupplierModelRate(organizationId, existing.subHire.supplierId, data.modelId, data.unitCost, data.pricingType as PricingType);
  }

  // Sync line items to project
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Updated item "${data.description}" on ${existing.subHire.orderNumber}`,
  });

  return serialize({ ...item, model });
}

export async function removeSubHireItem(itemId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const existingItem = await findSubHireItemById(itemId);
  if (!existingItem) throw new Error("Sub-hire item not found");
  const parentSubHire = await getSubHireById(existingItem.subHireId);
  if (!parentSubHire || parentSubHire.organizationId !== organizationId) {
    throw new Error("Sub-hire item not found");
  }
  const existing = { subHire: parentSubHire };

  // Reject if linked line items are checked out. projectLineItem lives in Convex —
  // filter the project's lines by this sub-hire item id.
  const convex = await getConvexClient();
  if (existing.subHire.projectId) {
    const lines = await convex.query(api.projectLineItems.listByProject, {
      projectId: existing.subHire.projectId,
      orgId: organizationId,
    });
    if (lines.some((li) => li.subHireItemId === itemId && li.status === "CHECKED_OUT")) {
      throw new Error("Cannot remove item with checked-out line items");
    }
  }

  // Delete the item from Convex first (so the regenerate below reads it as gone),
  // then recalc + regenerate the project line items.
  await convex.mutation(api.subHireItems.remove, { id: itemId });

  await recalculateSubHireTotals(existing.subHire.id);

  // Regenerate project line items (removes orphaned items, recalculates totals)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Removed item from ${existing.subHire.orderNumber}`,
  });
}

export async function reorderSubHireItems(subHireId: string, itemIds: string[]) {
  const { organizationId } = await requirePermission("subHire", "update");

  const subHire = await getSubHireById(subHireId);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");

  const convex = await getConvexClient();
  await Promise.all(
    itemIds.map((id, index) =>
      convex.mutation(api.subHireItems.patchItem, {
        id,
        set: { sortOrder: index },
      }),
    ),
  );
}

// ─── Totals ──────────────────────────────────────────────────────────────────

async function recalculateSubHireTotals(subHireId: string) {
  const subHire = await getSubHireById(subHireId);
  if (!subHire) return;

  // Fetch groups + items (with pricing overrides) from Convex.
  const groups = await getSubHireGroups(subHireId);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const items = await getSubHireItems(subHireId);

  let totalCost = 0;
  let totalCharge = 0;

  if (subHire.pricingMode === "ORDER_TOTAL") {
    // In ORDER_TOTAL mode, cost comes from the flat order amount
    totalCost = Number(subHire.orderTotalCost ?? 0);
    // Charge: use group charges where set, then item charges for the rest
    if (subHire.orderTotalCharge != null) {
      totalCharge = Number(subHire.orderTotalCharge);
    } else {
      const groupChargeHandled = new Set<string>();
      for (const group of groups) {
        if (group.charge != null) {
          totalCharge += Number(group.charge) * group.quantity * (1 - Number(group.discount ?? 0) / 100);
          groupChargeHandled.add(group.id);
        }
      }
      for (const item of items) {
        if (item.groupId && groupChargeHandled.has(item.groupId)) continue;
        const charge = Number(item.unitCharge);
        const disc = Number(item.discount);
        totalCharge += charge * item.quantity * item.duration * (1 - disc / 100);
      }
    }
  } else {
    // ITEMIZED mode — respect group-level cost/charge overrides
    const groupCostHandled = new Set<string>();
    const groupChargeHandled = new Set<string>();

    for (const group of groups) {
      if (group.cost != null) {
        totalCost += Number(group.cost) * group.quantity;
        groupCostHandled.add(group.id);
      }
      if (group.charge != null) {
        totalCharge += Number(group.charge) * group.quantity * (1 - Number(group.discount ?? 0) / 100);
        groupChargeHandled.add(group.id);
      }
    }

    for (const item of items) {
      const qty = item.quantity;
      const dur = item.duration;

      // Cost: skip items in groups with flat cost
      if (!(item.groupId && groupCostHandled.has(item.groupId))) {
        totalCost += Number(item.unitCost) * qty * dur;
      }

      // Charge: skip items in groups with flat charge
      if (!(item.groupId && groupChargeHandled.has(item.groupId))) {
        const disc = Number(item.discount);
        totalCharge += Number(item.unitCharge) * qty * dur * (1 - disc / 100);
      }
    }
  }

  await (await getConvexClient()).mutation(api.subHires.patchSubHire, {
    id: subHireId,
    set: {
      totalCost: roundCurrency(totalCost),
      totalCharge: roundCurrency(totalCharge),
      updatedAt: Date.now(),
    },
  });
}

// ─── Line Item Generation + Sync ─────────────────────────────────────────────

// Resolve where a line item should be placed on the project.
// Priority: entity-level target > order-level default > uncategorized.
// When targetGroupId is set, categoryId is resolved from the group.
function resolvePlacement(
  entity: { targetGroupId?: string | null; targetCategoryId?: string | null },
  orderDefaults: { defaultTargetGroupId?: string | null; defaultTargetCategoryId?: string | null },
  groupCategoryMap: Map<string, string | null>, // projectGroupId → categoryId (null for uncategorised groups)
): { groupId: string | null; categoryId: string | null } {
  const gId = entity.targetGroupId ?? orderDefaults.defaultTargetGroupId ?? null;
  if (gId) {
    return { groupId: gId, categoryId: groupCategoryMap.get(gId) ?? null };
  }
  const cId = entity.targetCategoryId ?? orderDefaults.defaultTargetCategoryId ?? null;
  return { groupId: null, categoryId: cId };
}

async function generateSubHireLineItems(
  subHireId: string,
  organizationId: string,
) {
  // subHire + groups + items live in Convex — read each, then reconstruct the
  // `groups[].items` nesting the body below expects (filter items on groupId).
  const head = await getSubHireById(subHireId);
  if (!head) throw new Error("Sub-hire not found");
  const [allGroups, allItems] = await Promise.all([
    getSubHireGroups(subHireId),
    getSubHireItems(subHireId),
  ]);
  const subHire = {
    ...head,
    groups: allGroups.map((g) => ({
      ...g,
      items: allItems.filter((it) => it.groupId === g.id),
    })),
    items: allItems,
  };

  if (!subHire.projectId) {
    throw new Error("Cannot generate line items without a project");
  }

  // projectLineItem lives in Convex — line-item reads/writes route there.
  const convex = await getConvexClient();
  const projectId = subHire.projectId;

  // Always clean up existing line items first to prevent duplicates. Read the
  // project's lines from Convex, keep this sub-hire's, and cascade-delete each.
  const existingLines = await convex.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  // Sequential (parent/child cascade race — see the delete path above).
  for (const line of existingLines) {
    if (line.subHireId === subHireId) {
      await convex.mutation(api.projectLineItems.removeLineItemCascade, { id: line.id });
    }
  }

  // Build a map of projectGroupId → categoryId for placement resolution
  const targetGroupIds = new Set<string>();
  if (subHire.defaultTargetGroupId) targetGroupIds.add(subHire.defaultTargetGroupId);
  for (const g of subHire.groups) {
    if (g.targetGroupId) targetGroupIds.add(g.targetGroupId);
  }
  for (const i of subHire.items) {
    if (i.targetGroupId) targetGroupIds.add(i.targetGroupId);
  }
  // projectGroup lives in Convex — resolve group→category there.
  const groupCategoryMap = new Map<string, string | null>();
  const targetGroups = await Promise.all(
    [...targetGroupIds].map((gId) => convex.query(api.projectGroups.getById, { id: gId })),
  );
  for (const pg of targetGroups) {
    if (pg) groupCategoryMap.set(pg.id, pg.categoryId ?? null);
  }

  const orderDefaults = {
    defaultTargetGroupId: subHire.defaultTargetGroupId,
    defaultTargetCategoryId: subHire.defaultTargetCategoryId,
  };

  // Get next sort order on the project. Derive from the lines we already read
  // (excluding this sub-hire's, which were just deleted) — no extra round trip.
  let nextSort =
    existingLines
      .filter((l) => l.organizationId === organizationId && l.subHireId !== subHireId)
      .reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;

  // Track project groups that received items (for suggestedPrice recalc)
  const affectedProjectGroupIds = new Set<string>();

  const groupedItemIds = new Set<string>();

  // 1. Generate grouped items — each sub-hire group becomes a parent with children
  for (const group of subHire.groups) {
    if (group.items.length === 0) continue;
    // Skip groups that shouldn't appear on quotes
    if (!group.showOnQuote) {
      for (const item of group.items) groupedItemIds.add(item.id);
      continue;
    }

    const placement = resolvePlacement(group, orderDefaults, groupCategoryMap);
    if (placement.groupId) affectedProjectGroupIds.add(placement.groupId);

    // showSubhireOnDocs: use group-level toggle, falling back to any item's showOnDocs
    const showAsSubhired = group.showOnDocs || group.items.some((i) => i.showOnDocs);

    // Group pricing: if charge is set, parent uses KIT_PRICE mode (like project groups).
    // A group-level discount (%) reduces the client charge (parity with recalculateSubHireTotals).
    const hasGroupCharge = group.charge != null;
    const groupCharge = hasGroupCharge ? Number(group.charge) : 0;
    const groupDiscount = Number(group.discount ?? 0);
    const groupLineTotal = hasGroupCharge
      ? roundCurrency(groupCharge * group.quantity * (1 - groupDiscount / 100))
      : 0;

    // Create parent line item for the group (Convex; isKitChild/parentLineItemId/
    // subHire* require the full-field generated create).
    const parentId = createId();
    const now = Date.now();
    await convex.mutation(api.projectLineItems.create, {
      id: parentId,
      organizationId,
      projectId,
      type: "EQUIPMENT",
      description: group.title,
      quantity: group.quantity,
      unitPrice: hasGroupCharge ? groupCharge : 0,
      discount: groupDiscount,
      lineTotal: groupLineTotal,
      pricingMode: hasGroupCharge ? "KIT_PRICE" : "ITEMIZED",
      subHireId: subHire.id,
      subHireGroupId: group.id,
      supplierId: subHire.supplierId,
      showSubhireOnDocs: showAsSubhired,
      subhireOrderNumber: subHire.orderNumber,
      categoryId: placement.categoryId ?? undefined,
      groupId: placement.groupId ?? undefined,
      status: "QUOTED",
      sortOrder: nextSort++,
      createdAt: now,
      updatedAt: now,
    });

    // Create child line items for each item in the group
    // Children inherit the same categoryId/groupId as the parent so they appear
    // in the correct project group on the equipment tab.
    for (const item of group.items) {
      groupedItemIds.add(item.id);
      const chargeAfterDiscount =
        Number(item.unitCharge) * (1 - Number(item.discount) / 100);
      const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

      const childNow = Date.now();
      await convex.mutation(api.projectLineItems.create, {
        id: createId(),
        organizationId,
        projectId,
        type: "EQUIPMENT",
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitCharge),
        pricingType: item.pricingType,
        duration: item.duration,
        discount: Number(item.discount),
        lineTotal,
        isKitChild: true,
        parentLineItemId: parentId,
        subHireId: subHire.id,
        subHireItemId: item.id,
        supplierId: subHire.supplierId,
        showSubhireOnDocs: item.showOnDocs,
        subhireOrderNumber: subHire.orderNumber,
        modelId: item.modelId ?? undefined,
        categoryId: placement.categoryId ?? undefined,
        groupId: placement.groupId ?? undefined,
        status: "QUOTED",
        sortOrder: nextSort++,
        createdAt: childNow,
        updatedAt: childNow,
      });
    }
  }

  // 2. Generate ungrouped items as standalone line items
  for (const item of subHire.items) {
    if (groupedItemIds.has(item.id)) continue;
    if (item.groupId) continue; // double-check: skip items with groupId
    if (!item.showOnQuote) continue; // Skip items that shouldn't appear on quotes

    const placement = resolvePlacement(item, orderDefaults, groupCategoryMap);
    if (placement.groupId) affectedProjectGroupIds.add(placement.groupId);

    const chargeAfterDiscount =
      Number(item.unitCharge) * (1 - Number(item.discount) / 100);
    const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

    const now = Date.now();
    await convex.mutation(api.projectLineItems.create, {
      id: createId(),
      organizationId,
      projectId,
      type: "EQUIPMENT",
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitCharge),
      pricingType: item.pricingType,
      duration: item.duration,
      discount: Number(item.discount),
      lineTotal,
      subHireId: subHire.id,
      subHireItemId: item.id,
      supplierId: subHire.supplierId,
      showSubhireOnDocs: item.showOnDocs,
      subhireOrderNumber: subHire.orderNumber,
      modelId: item.modelId ?? undefined,
      categoryId: placement.categoryId ?? undefined,
      groupId: placement.groupId ?? undefined,
      status: "QUOTED",
      sortOrder: nextSort++,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Recalculate suggestedPrice on any project groups that received items
  if (affectedProjectGroupIds.size > 0) {
    const { calculateSuggestedPrice } = await import("@/server/project-groups");
    // NOTE: calculateSuggestedPrice is pure (computes + returns, no persist), so
    // this loop's result was already discarded — kept as-is behaviourally, just
    // run the (independent) recalcs concurrently instead of sequentially.
    await Promise.all([...affectedProjectGroupIds].map((pgId) => calculateSuggestedPrice(pgId)));
  }
}

async function syncNewSubHireLineItem(
  subHire: { id: string; projectId: string | null; supplierId: string; orderNumber: string; status: string; defaultTargetGroupId?: string | null; defaultTargetCategoryId?: string | null },
  item: { id: string; groupId: string | null; description: string; quantity: number; unitCharge: Prisma.Decimal; pricingType: PricingType; duration: number; discount: Prisma.Decimal; modelId: string | null; showOnDocs: boolean; targetGroupId?: string | null; targetCategoryId?: string | null },
) {
  if (!subHire.projectId) return;

  const { organizationId } = await getOrgContext();
  const projectId = subHire.projectId;
  const convex = await getConvexClient();

  const chargeAfterDiscount =
    Number(item.unitCharge) * (1 - Number(item.discount) / 100);
  const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

  // projectLineItem lives in Convex — read the project's lines once (parent
  // lookup + sortOrder both derive from them).
  const projectLines = await convex.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });

  // If item belongs to a sub-hire group, find the parent line item and create as child
  let parentLineItemId: string | null = null;
  let isKitChild = false;
  let placementGroupId: string | null = null;
  let placementCategoryId: string | null = null;

  if (item.groupId) {
    const parentLineItem = projectLines.find((l) => l.subHireGroupId === item.groupId);
    if (parentLineItem) {
      parentLineItemId = parentLineItem.id;
      isKitChild = true;
      // Children inherit placement from parent (no independent placement)
    }
  } else {
    // Ungrouped item — resolve placement
    const orderDefaults = {
      defaultTargetGroupId: subHire.defaultTargetGroupId ?? null,
      defaultTargetCategoryId: subHire.defaultTargetCategoryId ?? null,
    };

    // Build group→category map for any referenced project groups (Convex)
    const groupCategoryMap = new Map<string, string | null>();
    const gId = item.targetGroupId ?? orderDefaults.defaultTargetGroupId;
    if (gId) {
      // Project groups are Convex-only now.
      const pg = await convex.query(api.projectGroups.getById, { id: gId });
      if (pg) groupCategoryMap.set(gId, pg.categoryId ?? null);
    }

    const placement = resolvePlacement(
      { targetGroupId: item.targetGroupId, targetCategoryId: item.targetCategoryId },
      orderDefaults,
      groupCategoryMap,
    );
    placementGroupId = placement.groupId;
    placementCategoryId = placement.categoryId;
  }

  const nextSort =
    projectLines
      .filter((l) => l.organizationId === organizationId)
      .reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;

  const now = Date.now();
  await convex.mutation(api.projectLineItems.create, {
    id: createId(),
    organizationId,
    projectId,
    type: "EQUIPMENT",
    description: item.description,
    quantity: item.quantity,
    unitPrice: Number(item.unitCharge),
    pricingType: item.pricingType,
    duration: item.duration,
    discount: Number(item.discount),
    lineTotal,
    isKitChild,
    parentLineItemId: parentLineItemId ?? undefined,
    subHireId: subHire.id,
    subHireItemId: item.id,
    supplierId: subHire.supplierId,
    showSubhireOnDocs: item.showOnDocs,
    subhireOrderNumber: subHire.orderNumber,
    modelId: item.modelId ?? undefined,
    categoryId: placementCategoryId ?? undefined,
    groupId: placementGroupId ?? undefined,
    status: "QUOTED",
    sortOrder: nextSort,
    createdAt: now,
    updatedAt: now,
  });

  // Recalculate affected project group's suggestedPrice
  if (placementGroupId) {
    const { calculateSuggestedPrice } = await import("@/server/project-groups");
    await calculateSuggestedPrice(placementGroupId);
  }

  const { recalculateProjectTotals } = await import("@/server/line-items");
  await recalculateProjectTotals(subHire.projectId);
}

async function syncSubHireLineItem(subHireItemId: string, projectId: string | null) {
  if (!projectId) return;

  const item = await findSubHireItemById(subHireItemId);
  if (!item) return;

  // projectLineItem lives in Convex — find the linked line + patch it there.
  const { organizationId } = await getOrgContext();
  const convex = await getConvexClient();
  const projectLines = await convex.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const linkedLineItem = projectLines.find((l) => l.subHireItemId === subHireItemId);
  if (!linkedLineItem) return;

  const chargeAfterDiscount =
    Number(item.unitCharge) * (1 - Number(item.discount) / 100);
  const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

  await convex.mutation(api.projectLineItems.patchLineItem, {
    id: linkedLineItem.id,
    set: {
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitCharge),
      pricingType: item.pricingType,
      duration: item.duration,
      discount: Number(item.discount),
      lineTotal,
      modelId: item.modelId ?? undefined,
      showSubhireOnDocs: item.showOnDocs,
      updatedAt: Date.now(),
    },
    clear: [],
  });

  const { recalculateProjectTotals } = await import("@/server/line-items");
  await recalculateProjectTotals(projectId);
}

export async function changeSubHireProject(subHireId: string, newProjectId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await getSubHireById(subHireId);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  const oldProjectId = subHire.projectId;

  // Verify new project exists in same org
  const newProject = await getProjectById(newProjectId);
  if (!newProject || newProject.organizationId !== organizationId) throw new Error("Project not found");

  // projectLineItem lives in Convex — delete the old project's lines for this
  // sub-hire there (cascade handles children) before moving the FK.
  if (oldProjectId) {
    const convex = await getConvexClient();
    const oldLines = await convex.query(api.projectLineItems.listByProject, {
      projectId: oldProjectId,
      orgId: organizationId,
    });
    // Sequential (parent/child cascade race — see the delete path above).
    for (const line of oldLines) {
      if (line.subHireId === subHireId) {
        await convex.mutation(api.projectLineItems.removeLineItemCascade, { id: line.id });
      }
    }
  }

  // Update project FK in Convex.
  const convex = await getConvexClient();
  await convex.mutation(api.subHires.patchSubHire, {
    id: subHireId,
    set: { projectId: newProjectId, updatedAt: Date.now() },
  });

  // Generate new line items if confirmed or on-hire (reads the new projectId from
  // the just-updated sub-hire row).
  if (subHire.status === "CONFIRMED" || subHire.status === "ON_HIRE") {
    await generateSubHireLineItems(subHireId, organizationId);
  }

  // Recalculate totals on both projects
  const { recalculateProjectTotals } = await import("@/server/line-items");
  if (oldProjectId) {
    await recalculateProjectTotals(oldProjectId);
  }
  await recalculateProjectTotals(newProjectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Moved sub-hire ${subHire.orderNumber} to project ${newProject.projectNumber}`,
  });

  const movedSubHire = await getSubHireById(subHireId);
  // Supplier + project live in Convex — attach instead of Prisma joins.
  const [supplier, convexProject] = movedSubHire
    ? await Promise.all([
        getSupplierById(movedSubHire.supplierId),
        movedSubHire.projectId ? getProjectById(movedSubHire.projectId) : Promise.resolve(null),
      ])
    : [null, null];
  const project = convexProject
    ? { id: convexProject.id, name: convexProject.name, projectNumber: convexProject.projectNumber }
    : null;
  return serialize(movedSubHire ? { ...movedSubHire, supplier, project } : movedSubHire);
}

// ─── Group CRUD ─────────────────────────────────────────────────────────────

export async function createSubHireGroup(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireGroupSchema.parse(input);

  const subHire = await getSubHireById(subHireId);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");

  // Next sort order from existing Convex groups.
  const existingGroups = await getSubHireGroups(subHireId);
  const nextSort = data.sortOrder ?? (Math.max(-1, ...existingGroups.map((g) => g.sortOrder)) + 1);

  const id = createId();
  const convex = await getConvexClient();
  await convex.mutation(api.subHireGroups.create, {
    id,
    subHireId,
    title: data.title,
    quantity: data.quantity ?? 1,
    cost: data.cost != null ? data.cost : undefined,
    charge: data.charge != null ? data.charge : undefined,
    discount: data.discount ?? 0,
    showOnQuote: data.showOnQuote ?? true,
    showOnDocs: data.showOnDocs ?? false,
    sortOrder: nextSort,
    targetCategoryId: data.targetCategoryId || undefined,
    targetGroupId: data.targetGroupId || undefined,
  });
  const group = (await getSubHireGroups(subHireId)).find((g) => g.id === id)!;

  // Sync line items to project (group structure may have changed)
  await syncSubHireToProject(subHireId, organizationId, subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: subHire.orderNumber,
    summary: `Created group "${data.title}" on ${subHire.orderNumber}`,
  });

  // A freshly-created group has no items yet.
  const enrichedGroup = { ...group, items: [] as unknown[] };
  return serialize(enrichedGroup);
}

export async function updateSubHireGroup(groupId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireGroupSchema.parse(input);

  const existingGroup = await findSubHireGroupById(groupId);
  if (!existingGroup) throw new Error("Sub-hire group not found");
  const parentSubHire = await getSubHireById(existingGroup.subHireId);
  if (!parentSubHire || parentSubHire.organizationId !== organizationId) {
    throw new Error("Sub-hire group not found");
  }
  const existing = { subHire: parentSubHire };

  const set: Record<string, unknown> = {
    title: data.title,
    discount: data.discount ?? 0,
    showOnQuote: data.showOnQuote,
    showOnDocs: data.showOnDocs,
  };
  const clear: string[] = [];
  if (data.quantity != null) set.quantity = data.quantity;
  if (data.sortOrder !== undefined) set.sortOrder = data.sortOrder;
  if (data.cost !== undefined) {
    if (data.cost != null) set.cost = data.cost;
    else clear.push("cost");
  }
  if (data.charge !== undefined) {
    if (data.charge != null) set.charge = data.charge;
    else clear.push("charge");
  }
  if (data.targetCategoryId !== undefined) {
    if (data.targetCategoryId) set.targetCategoryId = data.targetCategoryId;
    else clear.push("targetCategoryId");
  }
  if (data.targetGroupId !== undefined) {
    if (data.targetGroupId) set.targetGroupId = data.targetGroupId;
    else clear.push("targetGroupId");
  }

  const convex = await getConvexClient();
  await convex.mutation(api.subHireGroups.patchGroup, { id: groupId, set, clear });
  const group = (await getSubHireGroups(existing.subHire.id)).find((g) => g.id === groupId)!;

  // Recalculate sub-hire totals (group cost/charge may have changed)
  await recalculateSubHireTotals(existing.subHire.id);

  // Sync line items to project (title, placement, pricing may have changed)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Updated group "${data.title}" on ${existing.subHire.orderNumber}`,
  });

  // Model lives in Convex — enrich the group's items after update.
  const [groupItems, modelMap] = await Promise.all([
    getSubHireItems(existing.subHire.id),
    getModelMap(organizationId),
  ]);
  const enrichedGroup = {
    ...group,
    items: groupItems
      .filter((item) => item.groupId === groupId)
      .map((item) => ({
        ...item,
        model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
      })),
  };
  return serialize(enrichedGroup);
}

export async function deleteSubHireGroup(groupId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const existingGroup = await findSubHireGroupById(groupId);
  if (!existingGroup) throw new Error("Sub-hire group not found");
  const parentSubHire = await getSubHireById(existingGroup.subHireId);
  if (!parentSubHire || parentSubHire.organizationId !== organizationId) {
    throw new Error("Sub-hire group not found");
  }
  const existing = { subHire: parentSubHire };

  // Ungroup all child items then delete the group in one atomic Convex mutation.
  await (await getConvexClient()).mutation(api.subHireGroups.deleteWithUngroup, { id: groupId });

  // Regenerate line items (handles parent cleanup + ungrouped restructure)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Deleted group from ${existing.subHire.orderNumber}`,
  });
}

export async function setItemGroup(itemId: string, groupId: string | null) {
  const { organizationId } = await requirePermission("subHire", "update");

  const existingItem = await findSubHireItemById(itemId);
  if (!existingItem) throw new Error("Sub-hire item not found");
  const parentSubHire = await getSubHireById(existingItem.subHireId);
  if (!parentSubHire || parentSubHire.organizationId !== organizationId) {
    throw new Error("Sub-hire item not found");
  }
  const existing = { subHire: parentSubHire };

  // Update the item's group (null → clear groupId).
  await (await getConvexClient()).mutation(api.subHireItems.patchItem, {
    id: itemId,
    set: groupId ? { groupId } : {},
    clear: groupId ? [] : ["groupId"],
  });

  // Regenerate line items (handles parent-child restructuring)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);

  return serialize({ success: true });
}

export async function updateSubHireOrderPricing(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireOrderPricingSchema.parse(input);

  const subHire = await getSubHireById(subHireId);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");

  // pricingMode always set; orderTotalCost/Charge set when present, else cleared.
  const set: Record<string, unknown> = {
    pricingMode: data.pricingMode as SubHirePricingMode,
    updatedAt: Date.now(),
  };
  const clear: string[] = [];
  if (data.orderTotalCost != null) set.orderTotalCost = data.orderTotalCost;
  else clear.push("orderTotalCost");
  if (data.orderTotalCharge != null) set.orderTotalCharge = data.orderTotalCharge;
  else clear.push("orderTotalCharge");

  await (await getConvexClient()).mutation(api.subHires.patchSubHire, { id: subHireId, set, clear });

  await recalculateSubHireTotals(subHireId);

  // Recalculate project totals so sub-hire costs flow into margin
  if (subHire.projectId) {
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(subHire.projectId);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: subHire.orderNumber,
    summary: `Changed pricing mode to ${data.pricingMode} on ${subHire.orderNumber}`,
  });

  return serialize({ success: true });
}

// ─── Placement ──────────────────────────────────────────────────────────────

export async function updateSubHirePlacement(
  entityType: "order" | "group" | "item",
  entityId: string,
  input: unknown,
) {
  const { organizationId } = await requirePermission("subHire", "update");
  const data = subHirePlacementSchema.parse(input);

  let subHireId: string;
  let projectId: string | null;

  const convex = await getConvexClient();

  if (entityType === "order") {
    const subHire = await getSubHireById(entityId);
    if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");
    subHireId = subHire.id;
    projectId = subHire.projectId;

    const set: Record<string, unknown> = { updatedAt: Date.now() };
    const clear: string[] = [];
    if (data.targetCategoryId) set.defaultTargetCategoryId = data.targetCategoryId;
    else clear.push("defaultTargetCategoryId");
    if (data.targetGroupId) set.defaultTargetGroupId = data.targetGroupId;
    else clear.push("defaultTargetGroupId");
    await convex.mutation(api.subHires.patchSubHire, { id: entityId, set, clear });
  } else if (entityType === "group") {
    const group = await findSubHireGroupById(entityId);
    if (!group) throw new Error("Sub-hire group not found");
    const head = await getSubHireById(group.subHireId);
    if (!head || head.organizationId !== organizationId) throw new Error("Sub-hire group not found");
    subHireId = head.id;
    projectId = head.projectId;

    const set: Record<string, unknown> = {};
    const clear: string[] = [];
    if (data.targetCategoryId) set.targetCategoryId = data.targetCategoryId;
    else clear.push("targetCategoryId");
    if (data.targetGroupId) set.targetGroupId = data.targetGroupId;
    else clear.push("targetGroupId");
    await convex.mutation(api.subHireGroups.patchGroup, { id: entityId, set, clear });
  } else {
    const item = await findSubHireItemById(entityId);
    if (!item) throw new Error("Sub-hire item not found");
    const head = await getSubHireById(item.subHireId);
    if (!head || head.organizationId !== organizationId) throw new Error("Sub-hire item not found");
    subHireId = head.id;
    projectId = head.projectId;

    const set: Record<string, unknown> = {};
    const clear: string[] = [];
    if (data.targetCategoryId) set.targetCategoryId = data.targetCategoryId;
    else clear.push("targetCategoryId");
    if (data.targetGroupId) set.targetGroupId = data.targetGroupId;
    else clear.push("targetGroupId");
    await convex.mutation(api.subHireItems.patchItem, { id: entityId, set, clear });
  }

  // Regenerate line items with new placements
  await syncSubHireToProject(subHireId, organizationId, projectId);

  return serialize({ success: true });
}

// Helper: delete all line items for a sub-hire and regenerate from scratch
/**
 * Sync all sub-hire line items to the project. Works for any status (including DRAFT).
 * If the sub-hire has no projectId, this is a no-op.
 */
async function syncSubHireToProject(subHireId: string, organizationId: string, projectId: string | null) {
  if (!projectId) return;
  await regenerateSubHireLineItems(subHireId, organizationId, projectId);
}

async function regenerateSubHireLineItems(subHireId: string, organizationId: string, projectId: string) {
  // generateSubHireLineItems handles cleanup internally (all Convex now).
  await generateSubHireLineItems(subHireId, organizationId);

  const { recalculateProjectTotals } = await import("@/server/line-items");
  await recalculateProjectTotals(projectId);
}

// ─── Supplier Rate Memory ────────────────────────────────────────────────────

async function upsertSupplierModelRate(
  organizationId: string,
  supplierId: string,
  modelId: string,
  unitCost: number,
  pricingType: PricingType,
) {
  const convex = await getConvexClient();
  const now = Date.now();
  const existing = await convex.query(api.supplierModelRates.getByComposite, {
    organizationId,
    supplierId,
    modelId,
  });
  if (existing) {
    await convex.mutation(api.supplierModelRates.update, {
      id: existing.id,
      patch: { lastUnitCost: unitCost, pricingType: pricingType as "FLAT" | "PER_DAY" | "PER_WEEK" | "PER_HOUR" | "OPTIMIZED", lastUsedAt: now, updatedAt: now },
    });
  } else {
    await convex.mutation(api.supplierModelRates.createIfMissing, {
      id: createId(),
      organizationId,
      supplierId,
      modelId,
      lastUnitCost: unitCost,
      pricingType: pricingType as "FLAT" | "PER_DAY" | "PER_WEEK" | "PER_HOUR" | "OPTIMIZED",
      lastUsedAt: now,
      updatedAt: now,
    });
  }
}

export async function getSupplierModelRate(supplierId: string, modelId: string) {
  const { organizationId } = await getOrgContext();
  const convex = await getConvexClient();
  const rate = await convex.query(api.supplierModelRates.getByComposite, {
    organizationId,
    supplierId,
    modelId,
  });
  if (!rate) return null;
  return serialize({
    id: rate.id,
    organizationId: rate.organizationId,
    supplierId: rate.supplierId,
    modelId: rate.modelId,
    lastUnitCost: rate.lastUnitCost,
    pricingType: rate.pricingType ?? "FLAT",
    lastUsedAt: rate.lastUsedAt ? new Date(rate.lastUsedAt) : new Date(),
    updatedAt: rate.updatedAt ? new Date(rate.updatedAt) : new Date(),
  });
}

export async function getSupplierRateHistory(modelId: string) {
  const { organizationId } = await getOrgContext();
  const convex = await getConvexClient();
  const rates = await convex.query(api.supplierModelRates.listByModel, {
    organizationId,
    modelId,
  });
  const mapped = rates
    .sort((a, b) => a.lastUnitCost - b.lastUnitCost)
    .map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      supplierId: r.supplierId,
      modelId: r.modelId,
      lastUnitCost: r.lastUnitCost,
      pricingType: r.pricingType ?? "FLAT",
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : new Date(),
      updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
    }));
  const ratesWithSupplier = await attachSupplier(organizationId, mapped);
  return serialize(ratesWithSupplier);
}

// ─── Quick Duplicate ─────────────────────────────────────────────────────────

export async function duplicateSubHire(sourceId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "create");

  const source = await getSubHireById(sourceId);
  if (!source || source.organizationId !== organizationId) throw new Error("Sub-hire not found");
  const [sourceGroups, sourceItems] = await Promise.all([
    getSubHireGroups(sourceId),
    getSubHireItems(sourceId),
  ]);

  // Order-number reservation stays Prisma (org metadata counter).
  const orderNumber = await prisma.$transaction((tx) =>
    reserveSubHireOrderNumber(tx, organizationId),
  );

  const convex = await getConvexClient();
  const newId = createId();
  const now = Date.now();
  await convex.mutation(api.subHires.create, {
    id: newId,
    organizationId,
    supplierId: source.supplierId,
    createdById: userId,
    orderNumber,
    status: "DRAFT",
    pricingMode: source.pricingMode,
    orderTotalCost: source.orderTotalCost ?? undefined,
    orderTotalCharge: source.orderTotalCharge ?? undefined,
    showOnDocs: source.showOnDocs,
    notes: source.notes ?? undefined,
    totalCost: source.totalCost,
    totalCharge: source.totalCharge,
    createdAt: now,
    updatedAt: now,
  });

  // Pre-generate the old→new group id map in memory, then create groups + items
  // concurrently — ids are pre-assigned and Convex has no FK, so item inserts
  // don't need to wait for their group insert. Was one sequential mutation per
  // group then per item.
  const groupIdMap = new Map<string, string>();
  for (const group of sourceGroups) groupIdMap.set(group.id, createId());
  await Promise.all([
    ...sourceGroups.map((group) =>
      convex.mutation(api.subHireGroups.create, {
        id: groupIdMap.get(group.id)!,
        subHireId: newId,
        title: group.title,
        quantity: group.quantity,
        cost: group.cost ?? undefined,
        charge: group.charge ?? undefined,
        showOnQuote: group.showOnQuote,
        showOnDocs: group.showOnDocs,
        sortOrder: group.sortOrder,
        // Placement targets are NOT copied (new DRAFT starts uncategorized)
      }),
    ),
    ...sourceItems.map((item) =>
      convex.mutation(api.subHireItems.create, {
        id: createId(),
        subHireId: newId,
        groupId: (item.groupId ? groupIdMap.get(item.groupId) : undefined) || undefined,
        modelId: item.modelId ?? undefined,
        description: item.description,
        quantity: item.quantity,
        unitCost: item.unitCost,
        unitCharge: item.unitCharge,
        pricingType: item.pricingType,
        duration: item.duration,
        discount: item.discount,
        showOnQuote: item.showOnQuote,
        showOnDocs: item.showOnDocs,
        sortOrder: item.sortOrder,
        // Placement targets are NOT copied (new DRAFT starts uncategorized)
      }),
    ),
  ]);

  const result = await getSubHireById(newId);
  if (!result) throw new Error("Sub-hire not found after duplicate");

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: result.id,
    entityName: result.orderNumber,
    summary: `Duplicated sub-hire from ${source.orderNumber} to ${result.orderNumber}`,
    details: { sourceId: source.id },
  });

  return serialize(result);
}

export async function checkSubHireOpportunity(
  modelId: string,
  quantity: number,
  projectId: string,
  rentalStartDate?: string | null,
  rentalEndDate?: string | null,
) {
  const { organizationId } = await getOrgContext();

  // Use the existing checkAvailability function
  const { checkAvailability } = await import("@/server/line-items");
  const availability = await checkAvailability(modelId, rentalStartDate, rentalEndDate, projectId);

  const available = availability.available ?? 0;

  if (quantity <= available) {
    return serialize({ shortage: false as const });
  }

  // Model lives in Convex — fetch by id for the dialog.
  const model = await getModelById(modelId);

  return serialize({
    shortage: true as const,
    requested: quantity,
    available,
    shortfall: quantity - available,
    modelId,
    modelName: model?.name || "Unknown",
  });
}

// ─── Payment Status ─────────────────────────────────────────────────────────

export async function updateSubHirePaymentStatus(id: string, paymentStatus: SubHirePaymentStatus) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await getSubHireById(id);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  await (await getConvexClient()).mutation(api.subHires.patchSubHire, {
    id,
    set: { paymentStatus, updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Updated payment status to ${paymentStatus.replace(/_/g, " ").toLowerCase()} on ${subHire.orderNumber}`,
  });

  return serialize({ success: true });
}

// ─── Media / Attachments ────────────────────────────────────────────────────

export async function getSubHireMedia(subHireId: string) {
  const { organizationId } = await requirePermission("subHire", "read");

  // subHireMedia gallery from the Convex mirror (was a Prisma subHireMedia + file
  // join). Dual-written → identical data. See media-read.ts.
  const media = (await getSubHireMediaFromConvex(subHireId)).filter(
    (m) => m.organizationId === organizationId,
  );

  return serialize(media);
}

export async function addSubHireMedia(data: {
  subHireId: string;
  fileId: string;
  type?: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await requirePermission("subHire", "update");

  const subHire = await getSubHireById(data.subHireId);
  if (!subHire || subHire.organizationId !== organizationId) throw new Error("Sub-hire not found");

  // subHireMedia + its file_upload are Convex-only (Phase C). See media-write.ts.
  const media = await addMediaConvex("subHire", {
    organizationId,
    parentId: data.subHireId,
    fileId: data.fileId,
    type: data.type || "DOCUMENT",
    displayName: data.displayName,
  });

  return serialize(media);
}

export async function removeSubHireMedia(mediaId: string) {
  const { organizationId } = await requirePermission("subHire", "update");

  // Convex-only (Phase C). refCountFile re-implements the old cross-table UNION
  // guard (api.fileUploads.isReferencedByMedia) — only delete the file if no
  // other media row references it.
  await removeMediaConvex("subHire", { organizationId, mediaId, refCountFile: true });

  return serialize({ success: true });
}
