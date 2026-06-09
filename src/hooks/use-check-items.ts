"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive check-item hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `checkItems` table over a WebSocket, so any check-item create/update/delete (via
 * the dual-write server actions) pushes a live update to every subscriber. No
 * staleTime, no manual invalidation. Pass `undefined` to skip (e.g. before org
 * context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type CheckItemDoc = Doc<"checkItems">;

export function useCheckItems(orgId: string | undefined): CheckItemDoc[] | undefined {
  return useQuery(api.checkItems.list, orgId ? { orgId } : "skip");
}

export function useCheckItem(id: string | undefined): CheckItemDoc | null | undefined {
  return useQuery(api.checkItems.getById, id ? { id } : "skip");
}
