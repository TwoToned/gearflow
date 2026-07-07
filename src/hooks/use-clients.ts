"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive client hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `clients` table over a WebSocket, so any client create/update/archive (via the
 * server actions) pushes a live update to every subscriber. No staleTime, no
 * manual invalidation. Pass `undefined` to skip (e.g. before org context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type ClientDoc = Doc<"clients">;

export function useClients(orgId: string | undefined): ClientDoc[] | undefined {
  return useAuthedQuery(api.clients.list, orgId ? { orgId } : "skip");
}

export function useClient(id: string | undefined): ClientDoc | null | undefined {
  return useAuthedQuery(api.clients.getById, id ? { id } : "skip");
}

/**
 * Phase 7 — reactive INDEXED client search (`api.search.clients`, by name) instead of
 * loading the whole org list to JS-filter. `query === ""` returns a bounded
 * most-recent list. Pass `orgId: undefined` to skip.
 */
export function useClientSearch(
  orgId: string | undefined,
  query: string,
): ClientDoc[] | undefined {
  return useAuthedQuery(api.search.clients, orgId ? { orgId, query } : "skip");
}
