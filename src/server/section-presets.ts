"use server";

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { logActivity } from "@/lib/activity-log";
import { serialize } from "@/lib/serialize";
import { templateSectionsSchema } from "@/lib/validations/template-section";

// Section presets are DUAL-WRITTEN: every create/update/delete writes the Prisma
// `section_preset` row AND the Convex `sectionPresets` doc. `sections` is a JSON
// string, passed straight through. getSectionPresets is consumed only by the
// (cross-domain) document editor, which stays on the always-fresh Prisma mirror —
// so this is dual-write infra, no Phase 4 reader conversion. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma section-preset row into Convex (create). */
async function mirrorSectionPresetToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.sectionPresets.create,
    toConvexDoc(row) as FunctionArgs<typeof api.sectionPresets.create>,
  );
}

/** Mirror an updated Prisma section-preset row into Convex (patch, id stripped). */
async function patchSectionPresetInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.sectionPresets.update, {
    id,
    patch: patch as FunctionArgs<typeof api.sectionPresets.update>["patch"],
  });
}

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
  await mirrorSectionPresetToConvex(preset);

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
  await patchSectionPresetInConvex(id, preset);

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
  await (await getConvexClient()).mutation(api.sectionPresets.remove, { id });

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
