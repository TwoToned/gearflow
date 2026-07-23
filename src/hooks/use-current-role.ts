"use client";

import { createSharedResource } from "./use-shared-resource";
import type { PermissionMap } from "@/lib/permissions";

/**
 * Shared, multi-reader store for the viewer's effective role + permission set
 * (Phase 6 — React Query removal; the deliberate terminus). Replaces the
 * `useQuery({ queryKey: ["current-role", orgId], queryFn: fetchCurrentRole })`
 * reader in `use-permissions.ts`.
 *
 * Like `use-organization` / `use-custom-roles`, this MUST be a shared store
 * rather than `useServerQuery`: the datum is read across many components (every
 * `useCanDo` / `useIsViewer` call site) and written elsewhere (member-list role
 * change, role-editor permission edit), so a role change must live-update ALL
 * readers — the cross-component refresh React Query's shared `["current-role"]`
 * cache gave. Writers call `refreshCurrentRole(orgId)` (their old
 * `invalidateQueries(["current-role"])`). RBAC / permissions stay in Prisma
 * forever — Convex is never the authZ source of truth.
 *
 * The store key is the orgId (matching the old `["current-role", orgId]` key);
 * the fetcher ignores it because `/api/current-role` derives the org from the
 * session — the orgId key only forces a re-fetch on org switch, as before.
 */
export interface RoleData {
  role: string | null;
  roleName: string | null;
  permissions: PermissionMap | null;
  /** Opaque org-membership cuid, for PostHog `identify()` (POLICY.md R-8.9.4). */
  memberId: string | null;
}

async function fetchCurrentRole(): Promise<RoleData> {
  const res = await fetch("/api/current-role");
  if (!res.ok) return { role: null, roleName: null, permissions: null, memberId: null };
  return res.json();
}

const resource = createSharedResource<RoleData>(() => fetchCurrentRole());

/** Subscribe to the viewer's effective role/permissions. `orgId` is the store key. */
export const useCurrentRoleResource = resource.use;

/** Re-fetch the current role and push to every subscriber (the writer's invalidate analogue). */
export const refreshCurrentRole = resource.refresh;
