"use client";

import { useQuery } from "convex/react";
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

export function useKits(orgId: string | undefined): KitDoc[] | undefined {
  return useQuery(api.kits.list, orgId ? { orgId } : "skip");
}

export function useKit(id: string | undefined): KitDoc | null | undefined {
  return useQuery(api.kits.getById, id ? { id } : "skip");
}

/**
 * Reactive "version vector" for the kit DETAIL page — subscribes to
 * `api.kitDetail.version` (kit doc updatedAt + content signatures of the member /
 * media sub-tables). Returns `undefined` while connecting. Pass it as the `watch`
 * of `useReactiveServerQuery` so the unchanged `getKit` server action re-runs
 * whenever the kit or its contents change (cross-user, over the WebSocket). See
 * convex/kitDetail.ts and src/hooks/use-reactive-server-query.ts.
 */
export function useKitDetailVersion(id: string | undefined) {
  return useQuery(api.kitDetail.version, id ? { id } : "skip");
}
