"use client";

import { createSharedResource } from "./use-shared-resource";
import { getSSOSettings } from "@/server/sso";

/**
 * Shared store for the org's SSO settings (Phase 6 — React Query removal).
 * Replaces the `useQuery({ queryKey: ["sso-settings"], queryFn: getSSOSettings })`
 * reader on the SSO settings page. The page reads it, but several nested child
 * editors write it (group-mapping save, provider edit, the page's own toggles),
 * so a shared-store `refresh` avoids prop-drilling a callback through the nested
 * provider/mapping components — the cross-component refresh React Query's shared
 * `["sso-settings"]` cache gave. Writers call `refreshSSOSettings(orgId)`. Stays
 * in Prisma.
 */
const resource = createSharedResource(getSSOSettings);

/** Subscribe to the org's SSO settings. `orgId` is the store key. */
export const useSSOSettings = resource.use;

/** Re-fetch SSO settings and push to every subscriber. */
export const refreshSSOSettings = resource.refresh;
