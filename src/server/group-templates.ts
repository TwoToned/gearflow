"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import {
  groupTemplateSchema,
  applyGroupTemplateSchema,
  type GroupTemplateFormValues,
} from "@/lib/validations/group-template";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { calculateSuggestedPrice } from "./project-groups";

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
        },
        orderBy: { model: { name: "asc" } },
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
        create: parsed.items.map((item) => ({
          organizationId,
          modelId: item.modelId,
          quantity: item.quantity,
        })),
      },
    },
    include: {
      items: {
        include: {
          model: {
            select: { id: true, name: true, dailyRate: true, weeklyRate: true },
          },
        },
      },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "group_template",
    entityId: template.id,
    details: `Created group template "${parsed.name}" with ${parsed.items.length} item(s)`,
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
        where: { isKitChild: false },
        select: { modelId: true, quantity: true },
      },
    },
  });

  // Only items with a model can be templated
  const itemsWithModel = group.lineItems.filter((li) => li.modelId != null);
  if (itemsWithModel.length === 0) {
    throw new Error("Group has no model-backed items to template");
  }

  const template = await prisma.groupTemplate.create({
    data: {
      organizationId,
      name,
      description: description || null,
      items: {
        create: itemsWithModel.map((li) => ({
          organizationId,
          modelId: li.modelId!,
          quantity: li.quantity,
        })),
      },
    },
    include: {
      items: {
        include: {
          model: {
            select: { id: true, name: true, dailyRate: true, weeklyRate: true },
          },
        },
      },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "group_template",
    entityId: template.id,
    details: `Saved group "${group.title}" as template "${name}"`,
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
        include: { model: true },
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

  // Create group + line items in a transaction
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

    // Get next sort order for line items
    const maxItemSort = await tx.projectLineItem.aggregate({
      where: { groupId: newGroup.id },
      _max: { sortOrder: true },
    });

    let sortOrder = (maxItemSort._max.sortOrder ?? -1) + 1;

    for (const item of template.items) {
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
          modelId: item.modelId,
          description: item.model.name,
          quantity: item.quantity,
          unitPrice: rate,
          lineTotal: rate * item.quantity,
          sortOrder: sortOrder++,
        },
      });
    }

    return newGroup;
  });

  // Calculate suggested price after items are created
  const suggested = await calculateSuggestedPrice(group.id);
  await prisma.projectGroup.update({
    where: { id: group.id },
    data: { suggestedPrice: suggested },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "project",
    entityId: projectId,
    details: `Applied template "${template.name}" as group "${parsed.title}" with ${template.items.length} item(s)`,
  });

  return serialize(group);
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
        data: parsed.map((item) => ({
          organizationId,
          templateId,
          modelId: item.modelId,
          quantity: item.quantity,
        })),
      });
    }

    return updated;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "group_template",
    entityId: templateId,
    details: `Updated group template "${template.name}"`,
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

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "group_template",
    entityId: templateId,
    details: `Deleted group template "${template.name}"`,
  });

  return serialize({ success: true });
}
