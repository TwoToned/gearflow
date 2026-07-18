"use client";

import { useEffect, useState, type ComponentType } from "react";

interface ApiProviderProps {
  apiKey: string;
  children: React.ReactNode;
}

/**
 * Provides the Google Maps context to the whole app WITHOUT shipping the maps
 * SDK in the shared/first-load bundle (POLICY.md R-8.1.3). `@vis.gl/react-google-maps`
 * is ~1.3 MB unpacked and was statically imported here in the root layout, so it
 * loaded on every page even though only address forms/maps use it.
 *
 * We now import the SDK lazily (client-only, via `import()`), and — critically —
 * render `children` unconditionally the whole time. Before the SDK resolves we
 * render a bare fragment; once it resolves we swap in the real `<APIProvider>`.
 * Children never unmount, so there is no first-paint flash. Maps are never
 * first-paint content, and `address-map-inner` is itself dynamically imported,
 * so consumers pick up the context as soon as it mounts.
 */
export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [ApiProvider, setApiProvider] =
    useState<ComponentType<ApiProviderProps> | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    void import("@/lib/maps-sdk").then((mod) => {
      if (active) {
        setApiProvider(() => mod.APIProvider as ComponentType<ApiProviderProps>);
      }
    });
    return () => {
      active = false;
    };
  }, [apiKey]);

  // Children render immediately, with or without the maps context loaded.
  if (!apiKey || !ApiProvider) return <>{children}</>;

  return <ApiProvider apiKey={apiKey}>{children}</ApiProvider>;
}
