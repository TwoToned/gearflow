"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive test-profile hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `testProfiles` table over a WebSocket, so any profile create/update/duplicate/
 * seed/delete (via the dual-write server actions) pushes a live update to every
 * subscriber. No staleTime, no manual invalidation. Pass `undefined` to skip
 * (e.g. before org context loads). Note: the Convex `list` returns ALL profiles
 * including inactive — re-apply the `isActive` filter client-side to match the old
 * `getTestProfiles` default.
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type TestProfileDoc = Doc<"testProfiles">;

export function useTestProfiles(orgId: string | undefined): TestProfileDoc[] | undefined {
  return useQuery(api.testProfiles.list, orgId ? { orgId } : "skip");
}

export function useTestProfile(id: string | undefined): TestProfileDoc | null | undefined {
  return useQuery(api.testProfiles.getById, id ? { id } : "skip");
}
