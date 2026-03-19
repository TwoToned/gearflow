"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { logActivity } from "@/lib/activity-log";
import { serialize } from "@/lib/serialize";
import { templateSectionsSchema } from "@/lib/validations/template-section";

/**
 * Get all section presets for the current org.
 */
export async function getSectionPresets() {
  const { organizationId } = await requirePermission("document", "view");

  const presets = await prisma.sectionPreset.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });

  return serialize(presets);
}

/**
 * Create a new section preset.
 */
export async function createSectionPreset(data: {
  name: string;
  description?: string;
  sections: unknown[];
}) {
  const { organizationId, userId, userName } = await requirePermission("document", "manage_templates");

  // Validate sections
  const parsed = templateSectionsSchema.safeParse(data.sections);
  if (!parsed.success) {
    throw new Error("Invalid sections data");
  }

  const preset = await prisma.sectionPreset.create({
    data: {
      organizationId,
      name: data.name,
      description: data.description || null,
      sections: JSON.stringify(parsed.data),
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "SECTION_PRESET",
    entityId: preset.id,
    entityName: data.name,
    summary: `Created section preset "${data.name}"`,
  });

  return serialize(preset);
}

/**
 * Update an existing section preset.
 */
export async function updateSectionPreset(
  id: string,
  data: {
    name?: string;
    description?: string;
    sections?: unknown[];
  },
) {
  const { organizationId, userId, userName } = await requirePermission("document", "manage_templates");

  // Verify ownership
  const existing = await prisma.sectionPreset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Section preset not found");

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description || null;
  if (data.sections !== undefined) {
    const parsed = templateSectionsSchema.safeParse(data.sections);
    if (!parsed.success) throw new Error("Invalid sections data");
    updateData.sections = JSON.stringify(parsed.data);
  }

  const preset = await prisma.sectionPreset.update({
    where: { id },
    data: updateData,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "SECTION_PRESET",
    entityId: preset.id,
    entityName: preset.name,
    summary: `Updated section preset "${preset.name}"`,
  });

  return serialize(preset);
}

/**
 * Delete a section preset.
 */
export async function deleteSectionPreset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("document", "manage_templates");

  const existing = await prisma.sectionPreset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Section preset not found");

  await prisma.sectionPreset.delete({ where: { id } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "SECTION_PRESET",
    entityId: id,
    entityName: existing.name,
    summary: `Deleted section preset "${existing.name}"`,
  });

  return { success: true };
}
