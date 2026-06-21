"use server";

import { getOrgContext } from "@/lib/org-context";
import { getClientsByOrg } from "@/lib/clients-read";
import { getModelsByOrg } from "@/lib/models-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { getKitsByOrg } from "@/lib/kits-read";
import { getLocationsByOrg } from "@/lib/locations-read";
import { getCategoriesByOrg } from "@/lib/categories-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getMaintenanceTagsByOrg } from "@/lib/maintenance-read";

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
    getAssetsByOrg(organizationId).then((as) => as.map((a) => ({ tags: a.tags ?? [] }))),
    getBulkAssetsByOrg(organizationId).then((bas) => bas.map((ba) => ({ tags: ba.tags ?? [] }))),
    getKitsByOrg(organizationId).then((ks) => ks.map((k) => ({ tags: k.tags ?? [] }))),
    getLocationsByOrg(organizationId).then((ls) => ls.map((l) => ({ tags: l.tags ?? [] }))),
    getCategoriesByOrg(organizationId).then((cs) => cs.map((c) => ({ tags: c.tags ?? [] }))),
    // Maintenance records live in Convex (dual-written) — normalise to { tags }.
    getMaintenanceTagsByOrg(organizationId),
    getProjectsByOrg(organizationId).then((ps) => ps.map((p) => ({ tags: p.tags ?? [] }))),
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
