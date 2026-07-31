import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { loadSubHireContents } from "./subHireTotals";
import { computeGroupSuggestedPrice } from "./suggestedPrice";

/**
 * BYTE-PARITY native port of src/server/sub-hires.ts `generateSubHireLineItems`
 * (+ its `resolvePlacement` helper), the DELETE-AND-RECREATE of a sub-hire's
 * project line items. This is the crux of the sub-hire money gate: it reconciles
 * a sub-hire's groups/items into project line items (parents + kit-child members +
 * standalone), exactly as the server did.
 *
 * Called from within a trusted native mutation (PR-1+), so line-item cuids are
 * minted inline via createId() (server-trusted). No-op (matching syncSubHireToProject)
 * when the sub-hire has no project. `roundCurrency` == Math.round(x*100)/100.
 *
 * INTENTIONAL DEVIATION (latent-bug fix): the server called the PURE
 * calculateSuggestedPrice and discarded the result. Here we PERSIST the recomputed
 * suggestedPrice onto each affected project group (matching the native
 * projectGroupsWrites path + the reactive equipment tab), which is the intended
 * behaviour.
 */

const round = (v: number): number => Math.round(v * 100) / 100;

// Resolve where a line item should be placed on the project.
// Priority: entity-level target > order-level default > uncategorized.
// When targetGroupId is set, categoryId is resolved from the group.
function resolvePlacement(
  entity: { targetGroupId?: string | null; targetCategoryId?: string | null },
  orderDefaults: { defaultTargetGroupId?: string | null; defaultTargetCategoryId?: string | null },
  groupCategoryMap: Map<string, string | null>,
): { groupId: string | null; categoryId: string | null } {
  const gId = entity.targetGroupId ?? orderDefaults.defaultTargetGroupId ?? null;
  if (gId) {
    return { groupId: gId, categoryId: groupCategoryMap.get(gId) ?? null };
  }
  const cId = entity.targetCategoryId ?? orderDefaults.defaultTargetCategoryId ?? null;
  return { groupId: null, categoryId: cId };
}

export async function regenerateSubHireLines(
  ctx: MutationCtx,
  subHireId: string,
  orgId: string,
  now: number,
): Promise<void> {
  const head = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", subHireId)).first();
  // No-op if the sub-hire is gone / cross-org / has no project (matches
  // syncSubHireToProject, which no-ops without a project).
  if (!head || head.organizationId !== orgId) return;
  const projectId = head.projectId;
  if (!projectId) return;

  const { groups: allGroups, items: allItems } = await loadSubHireContents(ctx, subHireId);
  const subHire = {
    id: head.id,
    orderNumber: head.orderNumber,
    supplierId: head.supplierId,
    // WS7 #946 — the linked purchase order's cuid (if any), stamped onto every
    // generated line so the dormant `projectLineItems.supplierOrderId` finally
    // gets a writer (was previously set nowhere; only supplierId/orderNumber were).
    supplierOrderId: head.supplierOrderId ?? null,
    defaultTargetGroupId: head.defaultTargetGroupId ?? null,
    defaultTargetCategoryId: head.defaultTargetCategoryId ?? null,
    groups: allGroups.map((g) => ({ ...g, items: allItems.filter((it) => it.groupId === g.id) })),
    items: allItems,
  };

  // 1. Clean up existing line items first to prevent duplicates. Read the project's
  // lines once (org-filtered — by_projectId is a GLOBAL index) and reuse for both
  // the cleanup cascade AND the nextSort derivation (no extra round trip).
  const existingLines = (
    await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
  ).filter((l) => l.organizationId === orgId);

  // Delete this sub-hire's lines. Sub-hire lines have parent + children but NO
  // fulfillment units, so an inline cascade (children via by_parentLineItemId, then
  // the parent) suffices — no deleteLineWithUnits needed. Iterate only the TOP-LEVEL
  // (!isKitChild) sub-hire lines so each child is deleted exactly once via its parent
  // (mirrors removeManyCascade's skip-isKitChild guard; avoids a double-delete).
  for (const line of existingLines) {
    if (line.subHireId !== subHireId || line.isKitChild) continue;
    const children = (
      await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", line.id)).collect()
    ).filter((c) => c.organizationId === orgId);
    for (const c of children) await ctx.db.delete(c._id);
    await ctx.db.delete(line._id);
  }

  // 2. Build projectGroupId → categoryId map for placement resolution.
  const targetGroupIds = new Set<string>();
  if (subHire.defaultTargetGroupId) targetGroupIds.add(subHire.defaultTargetGroupId);
  for (const g of subHire.groups) if (g.targetGroupId) targetGroupIds.add(g.targetGroupId);
  for (const i of subHire.items) if (i.targetGroupId) targetGroupIds.add(i.targetGroupId);

  const groupCategoryMap = new Map<string, string | null>();
  for (const gId of targetGroupIds) {
    const pg = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", gId)).first();
    // by_cuid is GLOBAL — org-check the fetched project group before trusting it.
    if (pg && pg.organizationId === orgId) groupCategoryMap.set(pg.id, pg.categoryId ?? null);
  }

  const orderDefaults = {
    defaultTargetGroupId: subHire.defaultTargetGroupId,
    defaultTargetCategoryId: subHire.defaultTargetCategoryId,
  };

  // 3. Next sort order on the project — derived from the OTHER lines already read
  // (this sub-hire's were just deleted). No extra round trip.
  let nextSort =
    existingLines
      .filter((l) => l.organizationId === orgId && l.subHireId !== subHireId)
      .reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;

  const affectedProjectGroupIds = new Set<string>();
  const groupedItemIds = new Set<string>();

  // 4. Grouped items — each sub-hire group becomes a parent with children.
  for (const group of subHire.groups) {
    if (group.items.length === 0) continue;
    // Skip groups that shouldn't appear on quotes (but mark their items so step 5 skips them).
    if (!group.showOnQuote) {
      for (const item of group.items) groupedItemIds.add(item.id);
      continue;
    }

    const placement = resolvePlacement(group, orderDefaults, groupCategoryMap);
    if (placement.groupId) affectedProjectGroupIds.add(placement.groupId);

    // showSubhireOnDocs: group-level toggle, falling back to any item's showOnDocs.
    const showAsSubhired = group.showOnDocs || group.items.some((i) => i.showOnDocs);

    const hasGroupCharge = group.charge != null;
    const groupCharge = hasGroupCharge ? Number(group.charge) : 0;
    const groupDiscount = Number(group.discount ?? 0);
    const groupLineTotal = hasGroupCharge
      ? round(groupCharge * group.quantity * (1 - groupDiscount / 100))
      : 0;

    const parentId = createId();
    await ctx.db.insert("projectLineItems", {
      id: parentId,
      organizationId: orgId,
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
      supplierOrderId: subHire.supplierOrderId ?? undefined,
      showSubhireOnDocs: showAsSubhired,
      subhireOrderNumber: subHire.orderNumber,
      categoryId: placement.categoryId ?? undefined,
      groupId: placement.groupId ?? undefined,
      status: "QUOTED",
      sortOrder: nextSort++,
      createdAt: now,
      updatedAt: now,
    });

    // Child line per item. Children inherit the parent's categoryId/groupId.
    for (const item of group.items) {
      groupedItemIds.add(item.id);
      const chargeAfterDiscount = Number(item.unitCharge) * (1 - Number(item.discount) / 100);
      const lineTotal = round(chargeAfterDiscount * item.quantity * item.duration);

      await ctx.db.insert("projectLineItems", {
        id: createId(),
        organizationId: orgId,
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
        supplierOrderId: subHire.supplierOrderId ?? undefined,
        showSubhireOnDocs: item.showOnDocs,
        subhireOrderNumber: subHire.orderNumber,
        modelId: item.modelId ?? undefined,
        categoryId: placement.categoryId ?? undefined,
        groupId: placement.groupId ?? undefined,
        notes: item.notes ?? undefined,
        status: "QUOTED",
        sortOrder: nextSort++,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 5. Ungrouped items → standalone line items.
  for (const item of subHire.items) {
    if (groupedItemIds.has(item.id)) continue;
    if (item.groupId) continue; // double-check: skip items with groupId
    if (!item.showOnQuote) continue; // skip items that shouldn't appear on quotes

    const placement = resolvePlacement(item, orderDefaults, groupCategoryMap);
    if (placement.groupId) affectedProjectGroupIds.add(placement.groupId);

    const chargeAfterDiscount = Number(item.unitCharge) * (1 - Number(item.discount) / 100);
    const lineTotal = round(chargeAfterDiscount * item.quantity * item.duration);

    await ctx.db.insert("projectLineItems", {
      id: createId(),
      organizationId: orgId,
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
      supplierOrderId: subHire.supplierOrderId ?? undefined,
      showSubhireOnDocs: item.showOnDocs,
      subhireOrderNumber: subHire.orderNumber,
      modelId: item.modelId ?? undefined,
      categoryId: placement.categoryId ?? undefined,
      groupId: placement.groupId ?? undefined,
      notes: item.notes ?? undefined,
      status: "QUOTED",
      sortOrder: nextSort++,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 6. Recompute + PERSIST suggestedPrice on any project groups that received items.
  // (Server discarded the pure result; persisting matches native projectGroupsWrites
  // + the reactive tab — the intentional deviation noted above.)
  if (affectedProjectGroupIds.size > 0) {
    const projectCache = new Map<string, Doc<"projects"> | null>();
    for (const pgId of affectedProjectGroupIds) {
      const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", pgId)).first();
      if (!group || group.organizationId !== orgId) continue;
      let project = projectCache.get(group.projectId);
      if (project === undefined) {
        project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", group.projectId)).first();
        if (project && project.organizationId !== orgId) project = null;
        projectCache.set(group.projectId, project);
      }
      const suggested = await computeGroupSuggestedPrice(ctx, {
        projectId: group.projectId,
        groupId: pgId,
        orgId,
        rentalStartDate: project?.rentalStartDate ?? undefined,
        rentalEndDate: project?.rentalEndDate ?? undefined,
      });
      await ctx.db.patch(group._id, { suggestedPrice: suggested, updatedAt: now });
    }
  }
}
