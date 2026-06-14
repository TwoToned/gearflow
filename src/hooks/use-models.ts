"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive model hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `models` table over a WebSocket, so any model create/update/delete (via the
 * dual-write server actions) pushes a live update to every subscriber. No
 * staleTime, no manual invalidation. Pass `undefined` to skip (e.g. before org
 * context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type ModelDoc = Doc<"models">;

export function useModels(orgId: string | undefined): ModelDoc[] | undefined {
  return useAuthedQuery(api.models.list, orgId ? { orgId } : "skip");
}

export function useModel(id: string | undefined): ModelDoc | null | undefined {
  return useAuthedQuery(api.models.getById, id ? { id } : "skip");
}
