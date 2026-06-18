"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { getModelMap } from "@/lib/models-read";
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

// Group templates are SPLIT-STORE (Phase B write inversion):
//
//  - The PARENT `groupTemplate` is CONVEX-ONLY. create/update/delete write the
//    Convex `groupTemplates` doc as the sole source of truth (createId() + the
//    `api.groupTemplates.create/update/remove` mutations). No Prisma
//    `group_template` row is written; no mirror. The org-guard for update/delete
//    reads the target via `getGroupTemplateParentById` and verifies
//    `organizationId` (replaces the old Prisma findUniqueOrThrow /
//    where:{id,organizationId}). No Prisma fallback for the parent read.
//
//  - The CHILD `groupTemplateItem` rows STAY a Prisma table (not a Convex
//    domain). They carry model/kit joins and are composed by getGroupTemplates
//    (hybrid read: Convex parents + Prisma items). Their inbound Cascade FK to
//    group_template was DROPPED (migration 20260617131400) so a Convex-only
//    parent doesn't reject the child write — `templateId` is now a plain string
//    holding the Convex cuid.
//
//  - CASCADE re-implemented CROSS-STORE: the dropped Cascade auto-deleted a
//    template's child items on parent delete. deleteGroupTemplate now removes the
//    Convex parent AND deletes the Prisma child items explicitly (ordered so a
//    failure can't orphan — children first, then parent).
//
// See FEATUREDOCS/54 + docs/designs/convex-decommission-RUNBOOK.md.

export async function getGroupTemplates() {
  const { organizationId } = await requirePermission("project", "read");

  // HYBRID read (Phase A): parent rows from Convex (the dual-write source of
  // truth for group-template scalars), child `items` attached from Prisma — the
  // mirror strips `items` before writing, so the children are the Prisma
  // terminus for this surface. No Prisma fallback on a parent miss. See
  // src/lib/group-templates-read.ts + FEATUREDOCS/54.
  const parents = await getGroupTemplateParents(organizationId);
  if (parents.length === 0) return serialize([]);

  // One Prisma round-trip for ALL templates' items, then group by templateId —
  // reproduces the per-template `include: { items: { include: { model, kit } } }`
  // with the same selects and `orderBy: { sortOrder: "asc" }`.
  const items = await prisma.groupTemplateItem.findMany({
    where: { organizationId, templateId: { in: parents.map((p) => p.id) } },
    include: {
      model: {
        select: { id: true, name: true, dailyRate: true, weeklyRate: true },
      },
      kit: {
        select: { id: true, name: true, assetTag: true },
      },
    },
    orderBy: { sortOrder: "asc" },
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

  // CHILD items → Prisma (stay a Prisma table).
  await prisma.groupTemplateItem.createMany({
    data: parsed.items.map((item, idx) => ({
      organizationId,
      templateId,
      modelId: item.modelId ?? null,
      kitId: item.kitId ?? null,
      quantity: item.quantity,
      sortOrder: item.sortOrder ?? idx,
    })),
  });

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

  // Line items stay Prisma — read separately.
  const groupLineItems = await prisma.projectLineItem.findMany({
    where: { groupId, organizationId, isKitChild: false },
    select: { modelId: true, kitId: true, quantity: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });

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

  await prisma.groupTemplateItem.createMany({
    data: templatable.map((li, idx) => ({
      organizationId,
      templateId,
      modelId: li.modelId ?? null,
      kitId: li.kitId ?? null,
      quantity: li.quantity,
      sortOrder: idx,
    })),
  });

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
  const templateItems = await prisma.groupTemplateItem.findMany({
    where: { templateId: parsed.templateId, organizationId },
    include: { kit: true },
    orderBy: { sortOrder: "asc" },
  });
  const modelMap = await getModelMap(organizationId);
  const itemsWithModels = templateItems.map((i) => ({
    ...i,
    model: i.modelId ? modelMap.get(i.modelId) ?? null : null,
  }));

  // Get next sort order for the group within category from Convex
  const client = await getConvexClient();
  const allGroups = await client.query(api.projectGroups.listByProject, { projectId, orgId: organizationId });
  const inBucket = allGroups.filter((g) => (g.categoryId ?? null) === (parsed.categoryId ?? null));
  const maxSortOrder = inBucket.reduce((m, g) => Math.max(m, g.sortOrder ?? -1), -1);

  // Get project defaults for rental period
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  // Split items by type — model items go in the line-item tx, kit items get
  // delegated to addKitLineItem after the group is created.
  const modelItems = itemsWithModels.filter((i) => i.modelId && i.model);
  const kitItems = itemsWithModels.filter((i) => i.kitId && i.kit);

  // Create the group in Convex first so it has a stable ID for line items.
  const groupId = createId();
  const now = Date.now();
  const rentalPeriod = project.defaultRentalPeriod ?? undefined;
  const rentalQuantity = project.defaultRentalQuantity ?? undefined;
  await client.mutation(api.projectGroups.create, {
    id: groupId,
    organizationId,
    projectId,
    categoryId: parsed.categoryId || undefined,
    title: parsed.title,
    description: template.description || undefined,
    quantity: 1,
    rentalPeriod,
    rentalQuantity,
    sortOrder: maxSortOrder + 1,
    suggestedPrice: 0,
    createdAt: now,
    updatedAt: now,
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
    sortOrder: maxSortOrder + 1,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  // Create model line items in a Prisma transaction.
  let sortOrder = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of modelItems) {
      const period = project.defaultRentalPeriod ?? "DAILY";
      const rate =
        period === "WEEKLY"
          ? Number(item.model?.weeklyRate ?? item.model?.dailyRate ?? 0)
          : Number(item.model?.dailyRate ?? 0);

      await tx.projectLineItem.create({
        data: {
          organizationId,
          projectId,
          categoryId: parsed.categoryId,
          groupId,
          modelId: item.modelId!,
          description: item.model!.name,
          quantity: item.quantity,
          unitPrice: rate,
          lineTotal: rate * item.quantity,
          sortOrder: sortOrder++,
        },
      });
    }
  });

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
    await prisma.$transaction(async (tx) => {
      await tx.groupTemplateItem.deleteMany({
        where: { templateId, organizationId },
      });
      await tx.groupTemplateItem.createMany({
        data: parsed.map((item, idx) => ({
          organizationId,
          templateId,
          modelId: item.modelId ?? null,
          kitId: item.kitId ?? null,
          quantity: item.quantity,
          sortOrder: item.sortOrder ?? idx,
        })),
      });
    });
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

  // CROSS-STORE cascade re-implementation: the dropped Cascade FK auto-deleted
  // a template's child items on parent delete. Delete the Prisma children FIRST,
  // then the Convex parent — so a mid-failure leaves (at worst) an empty parent,
  // never orphaned children pointing at a missing template. Both ops are
  // idempotent (deleteMany on no rows + a remove that 404s harmlessly on retry).
  await prisma.groupTemplateItem.deleteMany({
    where: { templateId, organizationId },
  });
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
