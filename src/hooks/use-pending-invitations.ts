"use client";

import { createSharedResource } from "./use-shared-resource";
import { getPendingInvitations } from "@/server/settings";

/**
 * Shared, multi-reader store for the org's pending invitations (Phase 6 — React
 * Query removal). Replaces the member-list `useQuery({ queryKey:
 * ["pending-invitations", orgId], queryFn: getPendingInvitations })` reader.
 *
 * Shared store because the invite form writes it (a new invite appears as
 * pending) while the roster reads it, and the two co-mount on the members
 * settings page — the cross-component refresh React Query's shared
 * `["pending-invitations"]` cache gave. Writers (invite-member add,
 * member-list revoke) call `refreshPendingInvitations(orgId)`. Stays in Prisma.
 */
const resource = createSharedResource(getPendingInvitations);

/** Subscribe to the org's pending invitations. `orgId` is the store key. */
export const usePendingInvitations = resource.use;

/** Re-fetch pending invitations and push to every subscriber. */
export const refreshPendingInvitations = resource.refresh;
