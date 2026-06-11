"use client";

import { createSharedResource } from "./use-shared-resource";
import { getSSOProviders } from "@/server/sso";

/**
 * Shared store for the org's configured SSO identity providers (Phase 6 — React
 * Query removal). Replaces the `useQuery({ queryKey: ["sso-providers"], queryFn:
 * getSSOProviders })` reader on the SSO settings page. The page reads the list,
 * but the nested add / edit / delete provider forms write it — a shared-store
 * `refresh` lets each nested writer push an update without prop-drilling a
 * callback through `SSOProviderSection → ProviderRow / EditProviderForm /
 * AddProviderForm`, reproducing the shared `["sso-providers"]` cache refresh.
 * Writers call `refreshSSOProviders(orgId)`. Stays in Prisma.
 */
const resource = createSharedResource(getSSOProviders);

/** Subscribe to the org's SSO providers. `orgId` is the store key. */
export const useSSOProviders = resource.use;

/** Re-fetch SSO providers and push to every subscriber. */
export const refreshSSOProviders = resource.refresh;
