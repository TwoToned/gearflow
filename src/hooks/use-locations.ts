"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive location hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `locations` table over a WebSocket, so any location create/update/delete (via
 * the dual-write server actions) pushes a live update to every subscriber. No
 * staleTime, no manual invalidation. Pass `undefined` to skip (e.g. before org
 * context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type LocationDoc = Doc<"locations">;

export function useLocations(orgId: string | undefined): LocationDoc[] | undefined {
  return useQuery(api.locations.list, orgId ? { orgId } : "skip");
}

export function useLocation(id: string | undefined): LocationDoc | null | undefined {
  return useQuery(api.locations.getById, id ? { id } : "skip");
}
