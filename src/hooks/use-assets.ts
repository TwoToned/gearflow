"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive asset + bulk-asset hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `assets` / `bulkAssets` tables over a WebSocket, so any create/update/delete
 * (via the dual-write server actions) AND any warehouse status/location change
 * pushes a live update to every subscriber. No staleTime, no manual invalidation.
 * Pass `undefined` to skip (e.g. before org context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type AssetDoc = Doc<"assets">;
export type BulkAssetDoc = Doc<"bulkAssets">;

export function useAssets(orgId: string | undefined): AssetDoc[] | undefined {
  return useQuery(api.assets.list, orgId ? { orgId } : "skip");
}

export function useAsset(id: string | undefined): AssetDoc | null | undefined {
  return useQuery(api.assets.getById, id ? { id } : "skip");
}

export function useBulkAssets(orgId: string | undefined): BulkAssetDoc[] | undefined {
  return useQuery(api.bulkAssets.list, orgId ? { orgId } : "skip");
}

export function useBulkAsset(id: string | undefined): BulkAssetDoc | null | undefined {
  return useQuery(api.bulkAssets.getById, id ? { id } : "skip");
}
