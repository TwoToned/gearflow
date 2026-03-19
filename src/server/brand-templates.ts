"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  createBrandTemplateSchema,
  updateBrandTemplateSchema,
} from "@/lib/validations/template-section";
import type {
  CreateBrandTemplateValues,
  UpdateBrandTemplateValues,
} from "@/lib/validations/template-section";

/**
 * List all brand templates for the current org.
 */
export async function getBrandTemplates() {
  const { organizationId } = await getOrgContext();

  const templates = await prisma.brandTemplate.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      accentColor: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { documentTemplates: true } },
    },
  });

  return serialize(templates);
}

/**
 * Get a single brand template with full settings.
 */
export async function getBrandTemplate(id: string) {
  const { organizationId } = await getOrgContext();

  const template = await prisma.brandTemplate.findFirst({
    where: { id, organizationId },
  });

  if (!template) throw new Error("Brand template not found");

  return serialize({
    ...template,
    headerSettings: JSON.parse(template.headerSettings),
    footerSettings: JSON.parse(template.footerSettings),
  });
}

/**
 * Create a new brand template.
 */
export async function createBrandTemplate(data: CreateBrandTemplateValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = createBrandTemplateSchema.parse(data);

  const template = await prisma.brandTemplate.create({
    data: {
      organizationId,
      name: validated.name,
      headerSettings: JSON.stringify(validated.headerSettings),
      footerSettings: JSON.stringify(validated.footerSettings),
      accentColor: validated.accentColor || null,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "brand_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Created brand template "${template.name}"`,
  });

  return serialize(template);
}

/**
 * Update a brand template.
 */
export async function updateBrandTemplate(data: UpdateBrandTemplateValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = updateBrandTemplateSchema.parse(data);
  const { id, ...updateFields } = validated;

  const updateData: Record<string, unknown> = {};
  if (updateFields.name !== undefined) updateData.name = updateFields.name;
  if (updateFields.headerSettings !== undefined) {
    updateData.headerSettings = JSON.stringify(updateFields.headerSettings);
  }
  if (updateFields.footerSettings !== undefined) {
    updateData.footerSettings = JSON.stringify(updateFields.footerSettings);
  }
  if (updateFields.accentColor !== undefined) {
    updateData.accentColor = updateFields.accentColor || null;
  }

  const template = await prisma.brandTemplate.update({
    where: { id, organizationId },
    data: updateData,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "brand_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Updated brand template "${template.name}"`,
  });

  return serialize(template);
}

/**
 * Delete a brand template. Unlinks any document templates using it.
 */
export async function deleteBrandTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.brandTemplate.findFirst({
    where: { id, organizationId },
  });

  if (!template) throw new Error("Brand template not found");

  await prisma.$transaction([
    // Unlink document templates using this brand template
    prisma.documentTemplate.updateMany({
      where: { brandTemplateId: id, organizationId },
      data: { brandTemplateId: null },
    }),
    prisma.brandTemplate.delete({
      where: { id },
    }),
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "brand_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Deleted brand template "${template.name}"`,
  });

  return serialize({ success: true });
}

/**
 * Set a brand template as the org default.
 * Unsets any previous default.
 */
export async function setDefaultBrandTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.brandTemplate.findFirst({
    where: { id, organizationId },
  });

  if (!template) throw new Error("Brand template not found");

  await prisma.$transaction([
    prisma.brandTemplate.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.brandTemplate.update({
      where: { id },
      data: { isDefault: true },
    }),
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "set_default",
    entityType: "brand_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Set "${template.name}" as default brand template`,
  });

  return serialize({ success: true });
}

/**
 * Remove a brand template's default status.
 */
export async function unsetDefaultBrandTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.brandTemplate.update({
    where: { id, organizationId },
    data: { isDefault: false },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "unset_default",
    entityType: "brand_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Removed "${template.name}" as default brand template`,
  });

  return serialize({ success: true });
}
