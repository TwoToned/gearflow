"use server";

import { getOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import { getClientsByOrg } from "@/lib/clients-read";
import { getModelsByOrg } from "@/lib/models-read";

/**
 * Get all distinct tags used across the organization.
 * Powers the autocomplete in TagInput.
 */
export async function getOrgTags(): Promise<string[]> {
  const { organizationId } = await getOrgContext();

  // Query tags from all entity types that have them
  const [models, assets, bulkAssets, kits, locations, categories, maintenance, projects, clients] = await Promise.all([
    // Model lives in Convex — fetch tags from Convex store.
    getModelsByOrg(organizationId).then((ms) => ms.map((m) => ({ tags: m.tags ?? [] }))),
    prisma.asset.findMany({ where: { organizationId }, select: { tags: true } }),
    prisma.bulkAsset.findMany({ where: { organizationId }, select: { tags: true } }),
    prisma.kit.findMany({ where: { organizationId }, select: { tags: true } }),
    prisma.location.findMany({ where: { organizationId }, select: { tags: true } }),
    prisma.category.findMany({ where: { organizationId }, select: { tags: true } }),
    prisma.maintenanceRecord.findMany({ where: { organizationId }, select: { tags: true } }),
    prisma.project.findMany({ where: { organizationId }, select: { tags: true } }),
    // Clients live in Convex now — normalise to the same { tags } shape.
    getClientsByOrg(organizationId).then((cs) => cs.map((c) => ({ tags: c.tags ?? [] }))),
  ]);

  const allTags = new Set<string>();
  for (const list of [models, assets, bulkAssets, kits, locations, categories, maintenance, projects, clients]) {
    for (const item of list) {
      for (const tag of item.tags) {
        allTags.add(tag);
      }
    }
  }

  return Array.from(allTags).sort();
}
