"use server";

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import {
  groupTemplateSchema,
  applyGroupTemplateSchema,
  type GroupTemplateFormValues,
} from "@/lib/validations/group-template";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { mirrorProjectGroupCreate, syncProjectGroupsToConvex } from "@/lib/project-grouping-mirror";
import { calculateSuggestedPrice } from "./project-groups";
import { addKitLineItem, recalculateProjectTotals } from "./line-items";

// Group templates are DUAL-WRITTEN: every create/update/delete writes the Prisma
// `group_template` row (the durable FK anchor — group_template_item carries a
// required + Cascade FK to it) AND the Convex `groupTemplates` doc. Only the PARENT
// scalar fields live in Convex; the child items (with model/kit joins) stay in
// Prisma and are composed by getGroupTemplates, which therefore stays on the
// always-fresh Prisma mirror (no Phase 4 reactive conversion). The nested `items`
// relation is stripped before mirroring. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma group-template parent row into Convex (create). */
async function mirrorGroupTemplateToConvex(row: Record<string, unknown>) {
  const { items: _items, ...scalar } = row;
  await (await getConvexClient()).mutation(
    api.groupTemplates.createIfMissing,
    toConvexDoc(scalar) as FunctionArgs<typeof api.groupTemplates.createIfMissing>,
  );
}

/** Mirror an updated Prisma group-template parent row into Convex (patch, id stripped). */
async function patchGroupTemplateInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, items: _items, ...rest } = row;
  const patch = toConvexDoc(rest);
  await (await getConvexClient()).mutation(api.groupTemplates.update, {
    id,
    patch: patch as FunctionArgs<typeof api.groupTemplates.update>["patch"],
  });
}

export async function getGroupTemplates() {
  const { organizationId } = await requirePermission("project", "read");

  const templates = await prisma.groupTemplate.findMany({
    where: { organizationId },
    include: {
      items: {
        include: {
          model: {
            select: {
              id: true,
              name: true,
              dailyRate: true,
              weeklyRate: true,
            },
          },
          kit: {
            select: {
              id: true,
              name: true,
              assetTag: true,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return serialize(templates);
}

export async function createGroupTemplate(data: GroupTemplateFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items"
  );
  const parsed = groupTemplateSchema.parse(data);

  const template = await prisma.groupTemplate.create({
    data: {
      organizationId,
      name: parsed.name,
      description: parsed.description || null,
      items: {
        create: parsed.items.map((item, idx) => ({
          organizationId,
          modelId: item.modelId ?? null,
          kitId: item.kitId ?? null,
          quantity: item.quantity,
          sortOrder: item.sortOrder ?? idx,
        })),
      },
    },
    include: {
      items: {
        include: {
          model: {
            select: { id: true, name: true, dailyRate: true, weeklyRate: true },
          },
          kit: { select: { id: true, name: true, assetTag: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  await mirrorGroupTemplateToConvex(template);

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

  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId, organizationId },
    include: {
      lineItems: {
        // Only parent rows — kit children get auto-expanded on apply via
        // addKitLineItem, so templating them again would double-count.
        where: { isKitChild: false },
        select: {
          modelId: true,
          kitId: true,
          quantity: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  // Only items that reference either a model or a kit can be templated.
  // Free-text/service lines (no modelId AND no kitId) are skipped.
  const templatable = group.lineItems.filter(
    (li) => li.modelId != null || li.kitId != null,
  );
  if (templatable.length === 0) {
    throw new Error("Group has no model- or kit-backed items to template");
  }

  const template = await prisma.groupTemplate.create({
    data: {
      organizationId,
      name,
      description: description || null,
      items: {
        create: templatable.map((li, idx) => ({
          organizationId,
          modelId: li.modelId ?? null,
          kitId: li.kitId ?? null,
          quantity: li.quantity,
          sortOrder: idx,
        })),
      },
    },
    include: {
      items: {
        include: {
          model: {
            select: { id: true, name: true, dailyRate: true, weeklyRate: true },
          },
          kit: { select: { id: true, name: true, assetTag: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  await mirrorGroupTemplateToConvex(template);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "group_template",
    entityId: template.id,
    entityName: name,
    summary: `Saved group "${group.title}" as template "${name}"`,
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

  const template = await prisma.groupTemplate.findUniqueOrThrow({
    where: { id: parsed.templateId, organizationId },
    include: {
      items: {
        include: { model: true, kit: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  // Get next sort order for the group within category
  const maxSort = await prisma.projectGroup.aggregate({
    where: { categoryId: parsed.categoryId, organizationId },
    _max: { sortOrder: true },
  });

  // Get project defaults for rental period
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId, organizationId },
    select: { defaultRentalPeriod: true, defaultRentalQuantity: true },
  });

  // Split items by type — model items go in the same tx as the group create,
  // kit items get delegated to addKitLineItem *after* the tx commits so it can
  // run its own transaction for the parent + children expansion.
  const modelItems = template.items.filter((i) => i.modelId && i.model);
  const kitItems = template.items.filter((i) => i.kitId && i.kit);

  const group = await prisma.$transaction(async (tx) => {
    const newGroup = await tx.projectGroup.create({
      data: {
        organizationId,
        projectId,
        categoryId: parsed.categoryId,
        title: parsed.title,
        description: template.description,
        quantity: 1,
        rentalPeriod: project.defaultRentalPeriod,
        rentalQuantity: project.defaultRentalQuantity,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        suggestedPrice: 0,
      },
    });

    // Start line-item sortOrder at 0 for a freshly-created group
    let sortOrder = 0;

    for (const item of modelItems) {
      const rentalPeriod =
        newGroup.rentalPeriod ?? project.defaultRentalPeriod ?? "DAILY";
      const rate =
        rentalPeriod === "WEEKLY"
          ? Number(item.model?.weeklyRate ?? item.model?.dailyRate ?? 0)
          : Number(item.model?.dailyRate ?? 0);

      await tx.projectLineItem.create({
        data: {
          organizationId,
          projectId,
          categoryId: parsed.categoryId,
          groupId: newGroup.id,
          modelId: item.modelId!,
          description: item.model!.name,
          quantity: item.quantity,
          unitPrice: rate,
          lineTotal: rate * item.quantity,
          sortOrder: sortOrder++,
        },
      });
    }

    return newGroup;
  });
  // Mirror the new project group to Convex (line items are step-4 domain).
  await mirrorProjectGroupCreate(group);

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
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      kitWarnings.push(`${item.kit?.assetTag ?? item.kitId}: ${msg}`);
    }
  }

  // Calculate suggested price after items are created
  const suggested = await calculateSuggestedPrice(group.id);
  await prisma.projectGroup.update({
    where: { id: group.id },
    data: { suggestedPrice: suggested },
  });
  await syncProjectGroupsToConvex([group.id]);

  // Kit expansion touched line items — refresh project totals.
  if (kitItems.length > 0) {
    await recalculateProjectTotals(projectId);
  }

  const summary =
    kitWarnings.length > 0
      ? `Applied template "${template.name}" as group "${parsed.title}" with ${template.items.length} item(s); skipped ${kitWarnings.length} kit item(s): ${kitWarnings.join("; ")}`
      : `Applied template "${template.name}" as group "${parsed.title}" with ${template.items.length} item(s)`;

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

  const template = await prisma.$transaction(async (tx) => {
    const updated = await tx.groupTemplate.update({
      where: { id: templateId, organizationId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description || null,
        }),
      },
    });

    // If items are provided, replace all items
    if (data.items !== undefined) {
      const parsed = groupTemplateSchema.shape.items.parse(data.items);

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
    }

    return updated;
  });
  await patchGroupTemplateInConvex(templateId, template);

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

  const template = await prisma.groupTemplate.findUniqueOrThrow({
    where: { id: templateId, organizationId },
  });

  await prisma.groupTemplate.delete({
    where: { id: templateId, organizationId },
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
