"use client";

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
