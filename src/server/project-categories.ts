"use server";

import { createId } from "@paralleldrive/cuid2";
import { requirePermission } from "@/lib/org-context";
import { projectCategorySchema, type ProjectCategoryFormValues } from "@/lib/validations/project-category";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { computeOverbookedStatus } from "@/lib/availability";
import { getProjectById } from "@/lib/projects-read";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  resolveAttachedSupplier,
} from "@/lib/line-item-tree-read";
import {
  mapLineItemDoc,
  type MappedLineItem,
} from "@/lib/project-line-item-read";
import {
  indexChildren,
  reconstructScope,
} from "@/lib/project-line-item-tree-read";
import { getAssetsByOrg, getBulkAssetsByOrg, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getKitsByOrg, type ConvexKit } from "@/lib/kits-read";
import { getSubHiresByProject, getSubHireGroups, getSubHireItems } from "@/lib/sub-hire-read";
import type { LineItemAttachMaps } from "@/lib/line-item-tree-read";

// ── Reads ────────────────────────────────────────────────────────────────────

const ASSET_DATE_KEYS = [
  "purchaseDate",
  "warrantyExpiry",
  "lastTestAndTagDate",
  "nextTestAndTagDate",
  "createdAt",
  "updatedAt",
] as const;
const BULK_ASSET_DATE_KEYS = ["lastReorderedAt", "createdAt", "updatedAt"] as const;
const KIT_DATE_KEYS = ["purchaseDate", "createdAt", "updatedAt"] as const;

function stripMetaDates<T extends Record<string, unknown>>(doc: T, dateKeys: readonly string[]): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = doc as Record<string, unknown>;
  void _id;
  void _creationTime;
  for (const k of dateKeys) {
    if (rest[k] != null) rest[k] = new Date(rest[k] as number);
  }
  return rest;
}

/**
 * Attach `asset` / `bulkAsset` / `kit` (full Convex docs, meta stripped, dates →
 * Date) onto every node of a model/supplier-attached tree, recursing into
 * `childLineItems`. Mirrors the plain attach in project-line-item-read.ts
 * (getProject shape — plain kit, no `_count`). A miss → null (no Prisma fallback).
 */
function attachAssetBulkKitPlain<T extends { assetId?: string | null; bulkAssetId?: string | null; kitId?: string | null; childLineItems?: unknown }>(
  rows: T[],
  assetMap: Map<string, ConvexAsset>,
  bulkAssetMap: Map<string, ConvexBulkAsset>,
  kitMap: Map<string, ConvexKit>,
): T[] {
  return rows.map((row) => {
    const children = row.childLineItems;
    const assetDoc = row.assetId ? assetMap.get(row.assetId) : undefined;
    const bulkDoc = row.bulkAssetId ? bulkAssetMap.get(row.bulkAssetId) : undefined;
    const kitDoc = row.kitId ? kitMap.get(row.kitId) : undefined;
    return {
      ...row,
      asset: assetDoc ? stripMetaDates(assetDoc, ASSET_DATE_KEYS) : null,
      bulkAsset: bulkDoc ? stripMetaDates(bulkDoc, BULK_ASSET_DATE_KEYS) : null,
      kit: kitDoc ? stripMetaDates(kitDoc, KIT_DATE_KEYS) : null,
      ...(Array.isArray(children)
        ? { childLineItems: attachAssetBulkKitPlain(children as T[], assetMap, bulkAssetMap, kitMap) }
        : {}),
    };
  }) as T[];
}

interface AttachContext {
  attachMaps: LineItemAttachMaps;
  assetMap: Map<string, ConvexAsset>;
  bulkAssetMap: Map<string, ConvexBulkAsset>;
  kitMap: Map<string, ConvexKit>;
}

/** Load the org-scoped maps the line-item tree attach needs (one round trip). */
async function loadAttachContext(orgId: string): Promise<AttachContext> {
  const [attachMaps, assetArr, bulkArr, kitArr] = await Promise.all([
    buildLineItemAttachMaps(orgId),
    getAssetsByOrg(orgId),
    getBulkAssetsByOrg(orgId),
    getKitsByOrg(orgId),
  ]);
  return {
    attachMaps,
    assetMap: new Map(assetArr.map((a) => [a.id, a])),
    bulkAssetMap: new Map(bulkArr.map((b) => [b.id, b])),
    kitMap: new Map(kitArr.map((k) => [k.id, k])),
  };
}

/** Reconstruct (childLineItems depth 1, no units) + fully attach a scope of
 *  mapped line items — matching the old Prisma include shape used by these reads. */
function attachScopeRows(
  scopeRows: MappedLineItem[],
  byParent: Map<string, MappedLineItem[]>,
  ctx: AttachContext,
) {
  const reconstructed = reconstructScope(scopeRows, byParent, {
    unitsByLineItem: new Map(),
    depth: 1,
  });
  const withModelSupplier = attachLineItemTree(reconstructed, ctx.attachMaps);
  return attachAssetBulkKitPlain(withModelSupplier as never[], ctx.assetMap, ctx.bulkAssetMap, ctx.kitMap);
}

export async function getProjectCategories(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const client = await getConvexClient();

  // 1. Convex: categories + groups + slots + line items
  const [convexCategories, convexGroups, liDocs] = await Promise.all([
    client.query(api.projectCategories.listByProject, { projectId, orgId: organizationId }),
    client.query(api.projectGroups.listByProject, { projectId, orgId: organizationId }),
    client.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId }),
  ]);

  // Fetch all category slots in parallel (one call per category, typically ≤10)
  const slotArrays = await Promise.all(
    convexCategories.map((cat) => client.query(api.categorySlots.list, { projectCategoryId: cat.id })),
  );
  const allSlots = slotArrays.flat();
  const slotByGroupId = new Map(allSlots.filter((s) => s.projectGroupId).map((s) => [s.projectGroupId!, s]));
  const slotBySubHireGroupId = new Map(allSlots.filter((s) => s.subHireGroupId).map((s) => [s.subHireGroupId!, s]));

  // 2. Convex line items → mapped rows; sub-hire groups also from Convex
  // (dual-written). Their `lineItems` are Convex-only — the old Prisma include
  // returned stale `project_line_item` rows after the mega-flip froze that table.
  const mappedLineItems = liDocs.map(mapLineItemDoc);

  // Categorized sub-hire groups across all the project's sub-hires.
  const projectSubHires = await getSubHiresByProject(projectId, organizationId);
  const subHireById = new Map(projectSubHires.map((sh) => [sh.id, sh]));
  const subHireGroupRows = (
    await Promise.all(projectSubHires.map((sh) => getSubHireGroups(sh.id)))
  )
    .flat()
    .filter((g) => g.targetCategoryId != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const subHireGroupIdSet = new Set(subHireGroupRows.map((g) => g.id));

  // Items for each sub-hire group (filtered from its sub-hire's item list).
  const subHireItemsBySubHire = new Map(
    await Promise.all(
      projectSubHires.map(async (sh) => [sh.id, await getSubHireItems(sh.id)] as const),
    ),
  );

  // Convex line items for the sub-hire groups: top-level lines keyed by `subHireGroupId`.
  const subHireGroupLineItems = new Map<string, MappedLineItem[]>();
  for (const li of mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.subHireGroupId && subHireGroupIdSet.has(li.subHireGroupId)) {
      const arr = subHireGroupLineItems.get(li.subHireGroupId) ?? [];
      arr.push(li);
      subHireGroupLineItems.set(li.subHireGroupId, arr);
    }
  }

  // Compose the Prisma-include shape this read previously returned.
  const subHireGroups = subHireGroupRows.map((g) => {
    const subHire = subHireById.get(g.subHireId)!;
    const items = (subHireItemsBySubHire.get(g.subHireId) ?? []).filter((i) => i.groupId === g.id);
    return {
      ...g,
      items,
      subHire: {
        id: subHire.id,
        orderNumber: subHire.orderNumber,
        status: subHire.status,
        supplierId: subHire.supplierId,
      },
    };
  });

  // 3. Build lookup maps + tree-attach helpers
  const ctx = await loadAttachContext(organizationId);
  const attachMaps = ctx.attachMaps;

  // childLineItems matched globally by parentLineItemId (depth 1, no units —
  // matching the old Prisma include shape used by this read).
  const byParent = indexChildren(mappedLineItems);
  const attachScope = (scopeRows: MappedLineItem[]) => attachScopeRows(scopeRows, byParent, ctx);

  const topLevel = mappedLineItems.filter((li) => !li.isKitChild && !li.parentLineItemId);
  const lineItemsByGroupId = new Map<string, MappedLineItem[]>();
  const lineItemsByCatId = new Map<string, MappedLineItem[]>();
  for (const li of topLevel) {
    if (li.groupId) {
      const arr = lineItemsByGroupId.get(li.groupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.groupId, arr);
    } else if (li.categoryId) {
      const arr = lineItemsByCatId.get(li.categoryId) ?? [];
      arr.push(li);
      lineItemsByCatId.set(li.categoryId, arr);
    }
  }

  const subHireGroupsByCategory = new Map<string, typeof subHireGroups[number][]>();
  for (const sg of subHireGroups) {
    if (!sg.targetCategoryId) continue;
    const arr = subHireGroupsByCategory.get(sg.targetCategoryId) ?? [];
    arr.push(sg);
    subHireGroupsByCategory.set(sg.targetCategoryId, arr);
  }

  const groupsByCategoryId = new Map<string, typeof convexGroups[number][]>();
  for (const g of convexGroups) {
    if (g.categoryId) {
      const arr = groupsByCategoryId.get(g.categoryId) ?? [];
      arr.push(g);
      groupsByCategoryId.set(g.categoryId, arr);
    }
  }

  // 4. Reconstruct categories
  const withMixed = convexCategories
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((cat) => {
      type MixedSlot =
        | { kind: "project"; sortOrder: number; projectGroupId: string }
        | { kind: "subHire"; sortOrder: number; subHireGroupId: string };

      const catGroups = (groupsByCategoryId.get(cat.id) ?? [])
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((g) => {
          const slot = slotByGroupId.get(g.id);
          return {
            ...g,
            price: g.price ?? null,
            suggestedPrice: g.suggestedPrice ?? null,
            rentalPeriod: g.rentalPeriod ?? null,
            rentalQuantity: g.rentalQuantity ?? null,
            createdAt: new Date(g.createdAt ?? 0),
            updatedAt: new Date(g.updatedAt ?? 0),
            slot: slot
              ? { ...slot, createdAt: new Date(slot.createdAt ?? 0), updatedAt: new Date(slot.updatedAt ?? 0) }
              : null,
            lineItems: attachScope(lineItemsByGroupId.get(g.id) ?? []),
          };
        });

      const catSubHireGroups = (subHireGroupsByCategory.get(cat.id) ?? []).map((sg) => {
        const slot = slotBySubHireGroupId.get(sg.id);
        return {
          ...sg,
          slot: slot
            ? { ...slot, createdAt: new Date(slot.createdAt ?? 0), updatedAt: new Date(slot.updatedAt ?? 0) }
            : null,
          subHire: {
            ...sg.subHire,
            supplier: resolveAttachedSupplier(sg.subHire.supplierId, attachMaps),
          },
          lineItems: attachScope(subHireGroupLineItems.get(sg.id) ?? []),
        };
      });

      const mixedGroups: MixedSlot[] = [
        ...catGroups.map((g) => ({
          kind: "project" as const,
          sortOrder: g.slot?.sortOrder ?? g.sortOrder ?? 0,
          projectGroupId: g.id,
        })),
        ...catSubHireGroups.map((sg) => ({
          kind: "subHire" as const,
          sortOrder: sg.slot?.sortOrder ?? sg.sortOrder ?? 0,
          subHireGroupId: sg.id,
        })),
      ].sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        ...cat,
        createdAt: new Date(cat.createdAt ?? 0),
        updatedAt: new Date(cat.updatedAt ?? 0),
        groups: catGroups,
        subHireGroupTargets: catSubHireGroups,
        lineItems: attachScope(lineItemsByCatId.get(cat.id) ?? []),
        mixedGroups,
      };
    });

  return serialize(withMixed);
}

export async function getUncategorizedLineItems(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const client = await getConvexClient();

  const liDocs = await client.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const mappedLineItems = liDocs.map(mapLineItemDoc);

  // Top-level items with no category AND no group (childLineItems matched globally).
  const byParent = indexChildren(mappedLineItems);
  const scope = mappedLineItems.filter(
    (li) => !li.isKitChild && !li.parentLineItemId && li.categoryId == null && li.groupId == null,
  );

  const ctx = await loadAttachContext(organizationId);
  return serialize(attachScopeRows(scope, byParent, ctx));
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createProjectCategory(
  projectId: string,
  data: ProjectCategoryFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = projectCategorySchema.parse(data);
  const client = await getConvexClient();

  // Atomic create-at-end: max(sortOrder)+1 computed inside the mutation (no TOCTOU).
  const id = createId();
  const now = Date.now();
  const { sortOrder } = await client.mutation(api.projectCategories.createAtEnd, {
    id,
    organizationId,
    projectId,
    name: parsed.name,
    now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "project",
    entityId: projectId,
    entityName: parsed.name,
    summary: `Created category "${parsed.name}"`,
  });

  return serialize({ id, organizationId, projectId, name: parsed.name, sortOrder, createdAt: new Date(now), updatedAt: new Date(now) });
}

export async function updateProjectCategory(
  categoryId: string,
  data: Partial<ProjectCategoryFormValues>,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  const category = await client.query(api.projectCategories.getById, { id: categoryId });
  if (!category || category.organizationId !== organizationId) {
    throw new Error("Category not found");
  }

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder);

  await client.mutation(api.projectCategories.update, { id: categoryId, patch });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: category.projectId,
    entityName: category.name,
    summary: `Updated category "${category.name}"`,
  });

  if (data.name !== undefined) {
    await writeCollabActivityEvent(
      { organizationId, userId, userName },
      {
        entityType: "project",
        entityId: category.projectId,
        action: "category_updated",
        summary: `renamed a category to "${data.name}"`,
        targetType: "category",
        targetId: categoryId,
      },
    );
  }

  return serialize({ ...category, ...patch, createdAt: new Date(category.createdAt ?? 0), updatedAt: new Date(patch.updatedAt as number) });
}

export async function deleteProjectCategory(categoryId: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  const category = await client.query(api.projectCategories.getById, { id: categoryId });
  if (!category || category.organizationId !== organizationId) {
    throw new Error("Category not found");
  }

  // 1. Get all groups in this category from Convex
  const categoryGroups = await client.query(api.projectGroups.listByCategoryId, { categoryId });

  // 2. Get IDs of all line items in this category (for cascade null-out), from Convex.
  const groupIdSet = new Set(categoryGroups.map((g) => g.id));
  const projectLineItems = await client.query(api.projectLineItems.listByProject, {
    projectId: category.projectId,
    orgId: organizationId,
  });
  const affected = projectLineItems.filter(
    (li) =>
      (li.groupId != null && groupIdSet.has(li.groupId)) ||
      (li.categoryId === categoryId && li.groupId == null),
  );
  const lineItemIds = affected.map((li) => li.id);

  // 3. Null out categoryId/groupId on the affected line items (Convex).
  const nowClear = Date.now();
  for (const li of affected) {
    await client.mutation(api.projectLineItems.patchLineItem, {
      id: li.id,
      set: { updatedAt: nowClear },
      clear: ["categoryId", "groupId"],
    });
  }

  // 4. Atomic Convex cascade: all groups (+ their slots), all category slots,
  //    then the category — one transaction, no partial-cascade on mid-failure.
  await client.mutation(api.projectCategories.deleteCascade, { categoryId });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "project",
    entityId: category.projectId,
    entityName: category.name,
    summary: `Deleted category "${category.name}" — ${lineItemIds.length} items moved to uncategorized`,
  });

  return serialize({ success: true });
}

export async function reorderProjectCategories(
  projectId: string,
  orderedIds: string[],
) {
  await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  // Atomic reorder: contiguous sortOrder guaranteed in one transaction.
  await client.mutation(api.projectCategories.reorder, { orderedIds, now: Date.now() });

  return serialize({ success: true });
}

/**
 * Returns a map of lineItemId → overbookedInfo for all line items in a project.
 */
export async function getProjectOverbookedStatus(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) {
    return serialize({});
  }

  const client = await getConvexClient();
  const liDocs = await client.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const lineItems = liDocs
    .map(mapLineItemDoc)
    .filter((li) => li.status !== "CANCELLED");

  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    lineItems,
    project.rentalStartDate != null ? new Date(project.rentalStartDate) : null,
    project.rentalEndDate != null ? new Date(project.rentalEndDate) : null,
    project.id,
  );

  const result: Record<string, {
    overBy: number;
    totalStock: number;
    effectiveStock?: number;
    totalBooked: number;
    inherited?: boolean;
    unavailableAssets?: number;
    reducedOnly?: boolean;
    hasOverbookedChildren?: boolean;
    hasReducedChildren?: boolean;
  }> = {};

  for (const [id, info] of overbookedMap) {
    result[id] = info;
  }

  return serialize(result);
}
