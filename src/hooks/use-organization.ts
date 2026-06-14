"use client";

import { createSharedResource } from "./use-shared-resource";
import { getOrganization } from "@/server/settings";

/**
 * Shared, multi-reader store for the active organization (Phase 6 — React Query
 * removal). Replaces the `useQuery({ queryKey: ["organization", orgId], queryFn:
 * getOrganization })` readers spread across the layout + settings pages.
 *
 * It MUST be a shared store, not `useServerQuery`: the always-mounted
 * `BrandingProvider` + `DynamicFavicon` read the org branding, and a settings
 * edit must live-update them — exactly the cross-component refresh React Query's
 * shared cache gave the `["organization"]` key. Writers call `refreshOrganization`
 * (their old `invalidateQueries(["organization"])`). Stays in Prisma forever.
 */
const resource = createSharedResource(getOrganization);

/** Subscribe to the active org's settings/branding. `orgId` is the store key. */
export const useOrganization = resource.use;

/** Re-fetch the org and push to every subscriber (the writer's invalidate analogue). */
export const refreshOrganization = resource.refresh;
