import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Categories domain (Phase 3 cutover).
 *
 * Categories are dual-written like Suppliers/Locations/Models: every
 * create/update/delete writes BOTH the Prisma `category` row (the durable FK
 * anchor — `model.categoryId` and `kit.categoryId` carry a live, nullable FK, and
 * the self-referential `parentId`) AND the Convex `categories` doc (the reactive
 * read source). A Convex-only category would FK-fail the moment it's assigned to a
 * model or kit, so Prisma stays the anchor. Reads that want reactivity — the
 * category manager — go through Convex via this helper / the `use-categories`
 * hooks. Cross-domain `category` joins and the dropdowns in cross-domain-composing
 * forms stay on the always-fresh Prisma mirror and migrate at decommission.
 * See FEATUREDOCS/54.
 */
export type ConvexCategory = Doc<"categories">;

export async function getCategoryById(id: string): Promise<ConvexCategory | null> {
  return await (await getConvexClient()).query(api.categories.getById, { id });
}

export async function getCategoriesByOrg(orgId: string): Promise<ConvexCategory[]> {
  return await (await getConvexClient()).query(api.categories.list, { orgId });
}

/** All of an org's categories keyed by cuid `id`, for attaching to joined rows. */
export async function getCategoryMap(orgId: string): Promise<Map<string, ConvexCategory>> {
  const all = await getCategoriesByOrg(orgId);
  return new Map(all.map((c) => [c.id, c]));
}
