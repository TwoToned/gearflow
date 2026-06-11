"use client";

import { createSharedResource } from "./use-shared-resource";
import { getCustomRoles } from "@/server/custom-roles";

/**
 * Shared, multi-reader store for the active org's custom RBAC roles (Phase 6 —
 * React Query removal). Replaces the `useQuery({ queryKey: ["custom-roles",
 * orgId], queryFn: getCustomRoles })` readers across the six RBAC surfaces
 * (role manager, invite-member, member-list, SSO group-mapping / provisioning /
 * pending-approvals).
 *
 * Like `use-organization`, it MUST be a shared store rather than
 * `useServerQuery`: the role manager writes (create / update / delete /
 * duplicate) and every other reader must reflect the change — the cross-component
 * refresh React Query's shared `["custom-roles"]` cache gave. Writers call
 * `refreshCustomRoles(orgId)` (their old `invalidateQueries(["custom-roles"])`).
 * RBAC / `custom_role` stays in Prisma forever — Convex is never the authZ source.
 */
const resource = createSharedResource(getCustomRoles);

/** Subscribe to the active org's custom roles. `orgId` is the store key. */
export const useCustomRoles = resource.use;

/** Re-fetch the custom roles and push to every subscriber (the writer's invalidate analogue). */
export const refreshCustomRoles = resource.refresh;
