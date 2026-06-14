"use client";

import { createSharedResource } from "./use-shared-resource";
import { getMembers } from "@/server/settings";

/**
 * Shared, multi-reader store for the org's member roster as the members settings
 * page sees it (Phase 6 — React Query removal). Replaces the member-list
 * `useQuery({ queryKey: ["org-members", orgId], queryFn: getMembers })` reader.
 *
 * It's a shared store because the invite form (`InviteMember`) and the roster
 * (`MemberList`) co-mount on the members settings page: adding/inviting a member,
 * or changing/removing one, must live-update the list — the cross-component
 * refresh React Query's shared `["org-members"]` cache gave. Writers call
 * `refreshOrgMembers(orgId)`.
 *
 * NOTE: the project form reads `["org-members"]` too, but via a *different*
 * server action (`getOrgMembers`, paginated) with a different shape — an
 * incidental key collision under React Query (they never co-mount). That reader
 * is a no-liveness dropdown and uses `useServerQuery` directly, NOT this store.
 * Org membership / Better Auth data stays in Prisma forever.
 */
const resource = createSharedResource(getMembers);

/** Subscribe to the org member roster (getMembers shape). `orgId` is the store key. */
export const useOrgMembers = resource.use;

/** Re-fetch the roster and push to every subscriber (the writer's invalidate analogue). */
export const refreshOrgMembers = resource.refresh;
