"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive kit hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `kits` table over a WebSocket, so any kit create/update/archive/delete (via the
 * dual-write server actions) pushes a live update to every subscriber. No
 * staleTime, no manual invalidation. Pass `undefined` to skip (e.g. before org
 * context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type KitDoc = Doc<"kits">;

export function useKit(id: string | undefined): KitDoc | null | undefined {
  return useAuthedQuery(api.kits.getById, id ? { id } : "skip");
}

/**
 * Phase 7 — reactive INDEXED kit search (`api.search.kits`, by name) instead of
 * loading the whole org list to JS-filter. `query === ""` returns a bounded
 * most-recent list. Pass `orgId: undefined` to skip.
 */
export function useKitSearch(
  orgId: string | undefined,
  query: string,
): KitDoc[] | undefined {
  return useAuthedQuery(api.search.kits, orgId ? { orgId, query } : "skip");
}
