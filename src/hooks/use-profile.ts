"use client";

import { createSharedResource } from "./use-shared-resource";
import { getProfile } from "@/server/user-profile";

/**
 * Shared, multi-reader store for the signed-in user's profile (Phase 6 — React
 * Query removal). Replaces the `useQuery({ queryKey: ["profile"], queryFn:
 * getProfile })` readers in the always-mounted layout `UserNav` (avatar/name in
 * the sidebar) and the account page.
 *
 * It MUST be a shared store, not `useServerQuery`: editing your name / avatar /
 * 2FA on the account page must live-update the always-mounted UserNav avatar —
 * the cross-component refresh React Query's shared `["profile"]` cache gave. The
 * account page (the sole writer) calls `refreshProfile(userId)`. Keyed by user
 * id so a sign-out + different sign-in never reads the prior user's entry.
 * Profile / Better Auth user data stays in Prisma forever.
 */
const resource = createSharedResource(getProfile);

/** Subscribe to the signed-in user's profile. `userId` is the store key. */
export const useProfile = resource.use;

/** Re-fetch the profile and push to every subscriber (the writer's invalidate analogue). */
export const refreshProfile = resource.refresh;
