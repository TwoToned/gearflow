"use client";

import { createSharedResource } from "@/hooks/use-shared-resource";

interface PlatformBranding {
  name: string;
  icon: string | null;
}

async function fetchPlatformBranding(): Promise<PlatformBranding> {
  const res = await fetch("/api/platform-name");
  if (!res.ok) return { name: "GearFlow", icon: null };
  const data = await res.json();
  return {
    name: data.name || "GearFlow",
    icon: data.icon || null,
  };
}

/**
 * Shared, multi-reader store for the platform branding (Phase 6 — React Query
 * removal). Replaces the `useQuery({ queryKey: ["platform-branding"], queryFn:
 * fetchPlatformBranding })` readers spread across the always-mounted layout
 * (`AppSidebar` / `TopBar` / `DynamicFavicon` / `PageMeta`) + the auth pages.
 *
 * It MUST be a shared store, not `useServerQuery`: the platform name/icon is read
 * by several always-mounted components at once, and the admin Platform Settings
 * save must live-update them — exactly the cross-component refresh React Query's
 * shared `["platform-branding"]` cache gave. The writer calls
 * `refreshPlatformBranding()` (its old `invalidateQueries(["platform-branding"])`).
 *
 * The datum is platform-wide (not per-org), so the store key is a single
 * constant; the fetcher ignores it.
 */
const resource = createSharedResource<PlatformBranding>(fetchPlatformBranding);
const STORE_KEY = "platform";

/** Re-fetch the platform branding and push to every subscriber. */
export const refreshPlatformBranding = () => resource.refresh(STORE_KEY);

export function usePlatformName(): string {
  const { data } = resource.use(STORE_KEY);
  return data?.name || "GearFlow";
}

export function usePlatformBranding(): PlatformBranding {
  const { data } = resource.use(STORE_KEY);
  return data || { name: "GearFlow", icon: null };
}
