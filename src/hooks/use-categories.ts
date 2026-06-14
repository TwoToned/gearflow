"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive category hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `categories` table over a WebSocket, so any category create/update/delete (via
 * the dual-write server actions) pushes a live update to every subscriber. No
 * staleTime, no manual invalidation. Pass `undefined` to skip (e.g. before org
 * context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type CategoryDoc = Doc<"categories">;

export function useCategories(orgId: string | undefined): CategoryDoc[] | undefined {
  return useQuery(api.categories.list, orgId ? { orgId } : "skip");
}

export function useCategory(id: string | undefined): CategoryDoc | null | undefined {
  return useQuery(api.categories.getById, id ? { id } : "skip");
}

export type CategoryWithParent = CategoryDoc & { parent: { name: string } | null };

/**
 * Categories with a synthetic `parent: { name }` resolved from the flat list and
 * sorted by sortOrder then name — mirrors the old getCategories() server query
 * (`include: { parent }`, `orderBy: [{ sortOrder }, { name }]`). Most category
 * dropdowns/labels only read `cat.parent?.name`, so this lets them drop the React
 * Query getCategories() read with no shape change. Returns `undefined` while the
 * underlying reactive list is still loading.
 */
export function useCategoriesWithParent(
  orgId: string | undefined
): CategoryWithParent[] | undefined {
  const categories = useCategories(orgId);
  return useMemo(() => {
    if (!categories) return undefined;
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    return [...categories]
      .sort((a, b) => {
        const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        return so !== 0
          ? so
          : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      })
      .map((c) => ({
        ...c,
        parent: c.parentId ? { name: nameById.get(c.parentId) ?? "" } : null,
      }));
  }, [categories]);
}
