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
  type SubHireRow,
} from "@/lib/sub-hire-read";
import { api } from "../../convex/_generated/api";
import {
  attachSupplier,
  getMatchingSupplierIds,
  getSupplierById,
} from "@/lib/suppliers-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { serialize } from "@/lib/serialize";
import type { SubHireStatus, MediaType } from "@/generated/prisma/client";

// ─── Core CRUD (reads) ───────────────────────────────────────────────────────
//
// PR-2 of the sub-hire browser-direct migration deleted every write from this
// file. What remains: the 5 reads (getSubHires / getSubHire / getSupplierModelRate
// / getSupplierRateHistory / checkSubHireOpportunity) + the media trio
// (getSubHireMedia / addSubHireMedia / removeSubHireMedia — removeSubHireMedia keeps
// a cross-table refCount union guard not portable to a native mutation). All group
// CRUD / placement / order-pricing / setItemGroup / changeProject / duplicate now
// route through api.subHiresWrites.* via useSubHireWrites().

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
      (await getConvexClient()).query(api.projectGroups.listByProject, { projectId: filters.projectId, orgId: organizationId }),
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
  const [items, groups, createdBy, modelMap, supplier, convexProject, media, projectCategories, projectGroups, linkedOrder] =
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
      // WS7 #946 — the linked purchase order (if any), for the manage view's
      // "linked PO" panel + quoted-vs-invoiced reconciliation below.
      subHire.supplierOrderId ? client.query(api.supplierOrders.getById, { id: subHire.supplierOrderId }) : Promise.resolve(null),
    ]);

  // Reconciliation (quoted vs invoiced) — DERIVED ON READ, never denormalised
  // (app-cleanup-unification.md:606 rule). Quoted = subHire.totalCost (from items);
  // invoiced = the linked order's total once it has one (RECEIVED or otherwise
  // invoiced); null while unlinked or before the order carries a total.
  const linkedOrderOut = linkedOrder && linkedOrder.organizationId === organizationId
    ? {
        id: linkedOrder.id,
        orderNumber: linkedOrder.orderNumber,
        status: linkedOrder.status ?? "DRAFT",
        total: linkedOrder.total ?? null,
      }
    : null;
  const quoted = subHire.totalCost ?? 0;
  const invoiced = linkedOrderOut?.total ?? null;
  const reconciliation = {
    quoted,
    invoiced,
    variance: invoiced != null ? Math.round((invoiced - quoted) * 100) / 100 : null,
  };

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
    // WS7 #946 — linked purchase order + quoted-vs-invoiced reconciliation.
    linkedOrder: linkedOrderOut,
    reconciliation,
  });
}

// ─── Supplier Rate Memory ────────────────────────────────────────────────────

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

export async function checkSubHireOpportunity(
  modelId: string,
  quantity: number,
  projectId: string,
  rentalStartDate?: string | null,
  rentalEndDate?: string | null,
) {
  await getOrgContext();

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
