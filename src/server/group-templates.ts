"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { getModelMap } from "@/lib/models-read";
import { getKitMap } from "@/lib/kits-read";
import { getProjectById } from "@/lib/projects-read";
import {
  getGroupTemplateParents,
  getGroupTemplateParentById,
} from "@/lib/group-templates-read";
import {
  groupTemplateSchema,
  applyGroupTemplateSchema,
  type GroupTemplateFormValues,
} from "@/lib/validations/group-template";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import { calculateSuggestedPrice } from "./project-groups";
import { addKitLineItem, recalculateProjectTotals } from "./line-items";

// Group templates are FULLY CONVEX (Phase-1 decommission — both parent + children
// inverted; the Postgres `group_template` and `group_template_item` tables are now
// frozen and slated for DROP):
//
//  - The PARENT `groupTemplate` writes the Convex `groupTemplates` doc as the sole
//    source of truth (createId() + `api.groupTemplates.create/update/remove`). The
//    org-guard for update/delete reads the target via `getGroupTemplateParentById`
//    and verifies `organizationId`.
//
//  - The CHILD `groupTemplateItem` rows are now the Convex `groupTemplateItems`
//    table (`api.groupTemplateItems.*`), backfilled from Postgres. `templateId` is a
//    plain string holding the Convex parent cuid (the inbound Cascade FK to
//    group_template was dropped in migration 20260617131400). model/kit joins are
//    still resolved from the Convex model/kit maps at read time.
//
//  - CASCADE is re-implemented CROSS-DOC: Convex has no FK cascade, so
//    updateGroupTemplate (replace) and deleteGroupTemplate remove the child docs
//    explicitly. Ordered children-first on delete so a mid-failure can't orphan.
//    NOTE: the item replace/delete is per-item (not a single atomic tx like the old
//    Prisma `$transaction`); on this surface (tiny templates) that's an acceptable
//    loss of atomicity — a partial failure leaves a self-consistent subset.
//
// See FEATUREDOCS/54 + docs/designs/convex-decommission-RUNBOOK.md.

// ── Convex groupTemplateItems helpers (replace the old prisma.groupTemplateItem
//    reads/writes). `list` is org-scoped; we filter by templateId in JS. ──────────
type TemplateItemInput = {
  modelId?: string | null;
  kitId?: string | null;
  quantity: number;
  sortOrder?: number | null;
};

async function listTemplateItems(orgId: string, templateId: string) {
  const all = await (await getConvexClient()).query(api.groupTemplateItems.list, { orgId });
  return all
    .filter((it) => it.templateId === templateId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function createTemplateItems(orgId: string, templateId: string, items: TemplateItemInput[]) {
  const client = await getConvexClient();
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    await client.mutation(api.groupTemplateItems.create, {
      id: createId(),
      organizationId: orgId,
      templateId,
      modelId: it.modelId ?? undefined,
      kitId: it.kitId ?? undefined,
      quantity: it.quantity,
      sortOrder: it.sortOrder ?? idx,
    });
  }
}

async function deleteTemplateItems(orgId: string, templateId: string) {
  const client = await getConvexClient();
  const existing = (await client.query(api.groupTemplateItems.list, { orgId })).filter(
    (it) => it.templateId === templateId,
  );
  for (const e of existing) {
    await client.mutation(api.groupTemplateItems.remove, { id: e.id });
  }
}

export async function getGroupTemplates() {
  const { organizationId } = await requirePermission("project", "read");

  // HYBRID read (Phase A): parent rows from Convex (the dual-write source of
  // truth for group-template scalars), child `items` attached from Prisma — the
  // mirror strips `items` before writing, so the children are the Prisma
  // terminus for this surface. No Prisma fallback on a parent miss. See
  // src/lib/group-templates-read.ts + FEATUREDOCS/54.
  const parents = await getGroupTemplateParents(organizationId);
  if (parents.length === 0) return serialize([]);

  // One Convex round-trip for ALL org group-template items, filtered to these
  // parents + sorted, then attach model + kit from the Convex maps (model/kit are
  // Convex-only). Replaces the old prisma.groupTemplateItem.findMany.
  const parentIds = new Set(parents.map((p) => p.id));
  const [allItems, modelMap, kitMap] = await Promise.all([
    (await getConvexClient()).query(api.groupTemplateItems.list, { orgId: organizationId }),
    getModelMap(organizationId),
    getKitMap(organizationId),
  ]);
  const rawItems = allItems
    .filter((it) => parentIds.has(it.templateId))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const items = rawItems.map((it) => {
    const m = it.modelId ? modelMap.get(it.modelId) : undefined;
    const k = it.kitId ? kitMap.get(it.kitId) : undefined;
    return {
      ...it,
      model: m ? { id: m.id, name: m.name, dailyRate: m.dailyRate ?? null, weeklyRate: m.weeklyRate ?? null } : null,
      kit: k ? { id: k.id, name: k.name, assetTag: k.assetTag ?? null } : null,
    };
  });

  const itemsByTemplate = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByTemplate.get(item.templateId);
    if (list) list.push(item);
    else itemsByTemplate.set(item.templateId, [item]);
  }

  const templates = parents.map((p) => ({
    ...p,
    items: itemsByTemplate.get(p.id) ?? [],
  }));

  return serialize(templates);
}

export async function createGroupTemplate(data: GroupTemplateFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items"
  );
  const parsed = groupTemplateSchema.parse(data);

  // PARENT → Convex-only (explicit cuid so the Prisma child items reference the
  // same id Convex stores).
  const templateId = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.groupTemplates.create, {
    id: templateId,
    organizationId,
    name: parsed.name,
    description: parsed.description || undefined,
    createdAt: now,
    updatedAt: now,
  });

  // CHILD items → Convex groupTemplateItems.
  await createTemplateItems(organizationId, templateId, parsed.items);

  const template = {
    id: templateId,
    organizationId,
    name: parsed.name,
    description: parsed.description || null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "group_template",
    entityId: template.id,
    entityName: parsed.name,
    summary: `Created group template "${parsed.name}" with ${parsed.items.length} item(s)`,
  });

  return serialize(template);
}

export async function saveGroupAsTemplate(
  groupId: string,
  name: string,
  description?: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items"
  );

  const client = await getConvexClient();
  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group || group.organizationId !== organizationId) {
    throw new Error("Group not found");
  }

  // Line items live in Convex — read the group's project, filter to this group.
  const groupLineItems = (
    await client.query(api.projectLineItems.listByProject, { projectId: group.projectId, orgId: organizationId })
  )
    .filter((li) => li.groupId === groupId && !li.isKitChild)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((li) => ({
      modelId: li.modelId ?? null,
      kitId: li.kitId ?? null,
      quantity: li.quantity ?? 0,
      sortOrder: li.sortOrder ?? 0,
    }));

  // Only items that reference either a model or a kit can be templated.
  // Free-text/service lines (no modelId AND no kitId) are skipped.
  const templatable = groupLineItems.filter(
    (li) => li.modelId != null || li.kitId != null,
  );
  if (templatable.length === 0) {
    throw new Error("Group has no model- or kit-backed items to template");
  }

  // PARENT → Convex-only; CHILD items → Prisma (templateId = the new cuid).
  const templateId = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.groupTemplates.create, {
    id: templateId,
    organizationId,
    name,
    description: description || undefined,
    createdAt: now,
    updatedAt: now,
  });

  // sortOrder is reindexed 0..n by createTemplateItems (templatable is already in
  // group order); pass without sortOrder so it assigns the index.
  await createTemplateItems(
    organizationId,
    templateId,
    templatable.map((li) => ({ modelId: li.modelId, kitId: li.kitId, quantity: li.quantity })),
  );

  const template = {
    id: templateId,
    organizationId,
    name,
    description: description || null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "group_template",
    entityId: template.id,
    entityName: name,
    summary: `Saved group "${group.title ?? groupId}" as template "${name}"`,
  });

  return serialize(template);
}

export async function applyGroupTemplate(
  projectId: string,
  data: { templateId: string; categoryId: string; title: string }
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items"
  );
  const parsed = applyGroupTemplateSchema.parse(data);

  // PARENT from Convex (org-guard via the mapped row), CHILD items from Prisma
  // (with the kit join — items stay a Prisma table). No Prisma fallback for the
  // parent read.
  const template = await getGroupTemplateParentById(parsed.templateId);
  if (!template || template.organizationId !== organizationId) {
    throw new Error("Group template not found");
  }
  const templateItems = await listTemplateItems(organizationId, parsed.templateId);
  // model + kit are Convex-only — resolve both from the Convex maps (the old
  // `include: { kit: true }` returned null and silently dropped kit items).
  const [modelMap, kitMap] = await Promise.all([
    getModelMap(organizationId),
    getKitMap(organizationId),
  ]);
  const itemsWithModels = templateItems.map((i) => ({
    ...i,
    // quantity is optional on the Convex doc (was NOT NULL in Prisma, default 1) —
    // coerce to a definite number for the line-item expansion below.
    quantity: i.quantity ?? 1,
    model: i.modelId ? modelMap.get(i.modelId) ?? null : null,
    kit: i.kitId ? kitMap.get(i.kitId) ?? null : null,
  }));

  const client = await getConvexClient();

  // Get project defaults for rental period
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  // Split items by type — model items go in the line-item tx, kit items get
  // delegated to addKitLineItem after the group is created.
  const modelItems = itemsWithModels.filter((i) => i.modelId && i.model);
  const kitItems = itemsWithModels.filter((i) => i.kitId && i.kit);

  // Create the group in Convex first so it has a stable ID for line items.
  // Atomic create-at-end: sortOrder within the (project, category) bucket is
  // computed inside the mutation (no read-max-then-insert TOCTOU).
  const groupId = createId();
  const now = Date.now();
  const rentalPeriod = project.defaultRentalPeriod ?? undefined;
  const rentalQuantity = project.defaultRentalQuantity ?? undefined;
  const { sortOrder: groupSortOrder } = await client.mutation(api.projectGroups.createAtEnd, {
    id: groupId,
    organizationId,
    projectId,
    categoryId: parsed.categoryId || undefined,
    title: parsed.title,
    description: template.description || undefined,
    quantity: 1,
    rentalPeriod,
    rentalQuantity,
    suggestedPrice: 0,
    now,
  });

  const group = {
    id: groupId,
    organizationId,
    projectId,
    categoryId: parsed.categoryId ?? null,
    title: parsed.title,
    description: template.description || null,
    quantity: 1,
    price: null as number | null,
    suggestedPrice: 0,
    rentalPeriod: project.defaultRentalPeriod ?? null,
    rentalQuantity: project.defaultRentalQuantity ?? null,
    sortOrder: groupSortOrder,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  // Create model line items in Convex (sortOrder computed in-mutation). Accessory
  // expansion is suppressed — template lines are bare model rows.
  for (const item of modelItems) {
    const period = project.defaultRentalPeriod ?? "DAILY";
    const rate =
      period === "WEEKLY"
        ? Number(item.model?.weeklyRate ?? item.model?.dailyRate ?? 0)
        : Number(item.model?.dailyRate ?? 0);

    await client.mutation(api.projectLineItems.createLineItem, {
      id: createId(),
      organizationId,
      projectId,
      fields: {
        categoryId: parsed.categoryId || undefined,
        groupId,
        modelId: item.modelId!,
        description: item.model!.name,
        quantity: item.quantity,
        unitPrice: rate,
        lineTotal: rate * item.quantity,
      },
      includeAccessories: false,
      now: Date.now(),
    });
  }

  // Expand kit items outside the tx. Each call creates parent + children and
  // runs its own availability check. We skip kits that conflict (already on an
  // overlapping project) rather than aborting the whole apply, so warehouse
  // staff still get the model items they can use.
  const kitWarnings: string[] = [];
  for (const item of kitItems) {
    try {
      // Call addKitLineItem per unit of quantity — a template line of "2x rack
      // kit" means two independent parent rows, matching how a warehouse would
      // physically pull two racks.
      for (let i = 0; i < item.quantity; i++) {
        await addKitLineItem(
          projectId,
          item.kitId!,
          "ITEMIZED",
          undefined,
          undefined,
          parsed.categoryId,
          group.id,
          false, // grouped template event below covers these — no per-kit spam
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      kitWarnings.push(`${item.kit?.assetTag ?? item.kitId}: ${msg}`);
    }
  }

  // Calculate suggested price after items are created and update in Convex.
  const suggested = await calculateSuggestedPrice(group.id);
  await client.mutation(api.projectGroups.update, {
    id: group.id,
    patch: { suggestedPrice: suggested, updatedAt: Date.now() },
  });

  // Kit expansion touched line items — refresh project totals.
  if (kitItems.length > 0) {
    await recalculateProjectTotals(projectId);
  }

  const summary =
    kitWarnings.length > 0
      ? `Applied template "${template.name}" as group "${parsed.title}" with ${templateItems.length} item(s); skipped ${kitWarnings.length} kit item(s): ${kitWarnings.join("; ")}`
      : `Applied template "${template.name}" as group "${parsed.title}" with ${templateItems.length} item(s)`;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "project",
    entityId: projectId,
    entityName: parsed.title,
    summary,
  });

  // One grouped activity-feed event for the whole import — not one per line.
  await writeCollabActivityEvent(
    { organizationId, userId, userName },
    {
      entityType: "project",
      entityId: projectId,
      action: "template_applied",
      summary: `imported ${templateItems.length} item${templateItems.length === 1 ? "" : "s"} from template "${template.name}" into "${parsed.title}"`,
      targetType: "group",
      targetId: group.id,
    },
  );

  return serialize({ ...group, warnings: kitWarnings });
}

export async function updateGroupTemplate(
  templateId: string,
  data: Partial<GroupTemplateFormValues>
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items"
  );

  // Org-guard via the Convex parent (replaces Prisma where:{id,organizationId}).
  const existing = await getGroupTemplateParentById(templateId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Group template not found");
  }

  // PARENT → Convex-only patch. Convex `db.patch` treats `undefined` as "leave
  // unchanged"; matching the old conditional spread, only provided fields are
  // sent. `description: ""` clears to undefined (the old `|| null`).
  const patch: { name?: string; description?: string; updatedAt: number } = {
    updatedAt: Date.now(),
  };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description || undefined;
  await (await getConvexClient()).mutation(api.groupTemplates.update, {
    id: templateId,
    patch,
  });

  // CHILD items → Prisma. If items are provided, replace all of them.
  if (data.items !== undefined) {
    const parsed = groupTemplateSchema.shape.items.parse(data.items);
    // Replace all items (cross-doc, not atomic — see header note): remove existing
    // Convex items for this template, then create the new set.
    await deleteTemplateItems(organizationId, templateId);
    await createTemplateItems(organizationId, templateId, parsed);
  }

  const template = {
    id: templateId,
    organizationId,
    name: data.name !== undefined ? data.name : existing.name,
    description:
      data.description !== undefined
        ? data.description || null
        : existing.description,
    createdAt: existing.createdAt,
    updatedAt: new Date(),
  };

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "group_template",
    entityId: templateId,
    entityName: template.name,
    summary: `Updated group template "${template.name}"`,
  });

  return serialize(template);
}

export async function deleteGroupTemplate(templateId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items"
  );

  // Org-guard via the Convex parent (replaces Prisma findUniqueOrThrow).
  const template = await getGroupTemplateParentById(templateId);
  if (!template || template.organizationId !== organizationId) {
    throw new Error("Group template not found");
  }

  // CROSS-DOC cascade re-implementation: Convex has no FK cascade. Delete the child
  // items FIRST, then the Convex parent — so a mid-failure leaves (at worst) an empty
  // parent, never orphaned children pointing at a missing template.
  await deleteTemplateItems(organizationId, templateId);
  await (await getConvexClient()).mutation(api.groupTemplates.remove, { id: templateId });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "group_template",
    entityId: templateId,
    entityName: template.name,
    summary: `Deleted group template "${template.name}"`,
  });

  return serialize({ success: true });
}
