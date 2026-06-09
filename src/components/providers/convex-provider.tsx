"use client";

import { useState } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

/**
 * Convex client provider — the reactive data layer.
 *
 * Wraps the app so components can subscribe to Convex queries via useQuery from
 * "convex/react". Reads NEXT_PUBLIC_CONVEX_URL (inlined at build time).
 *
 * During the migration this coexists with QueryProvider (React Query): domains
 * are moved from React Query to Convex one at a time. Removed in Phase 6 once
 * React Query is gone. See docs/designs/convex-hybrid-migration.md.
 *
 * NOTE: only reads flow browser -> Convex. Writes go through Next.js server
 * actions (admin key). This provider does not handle auth — that's Phase 5.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(() =>
    convexUrl ? new ConvexReactClient(convexUrl) : null,
  );

  // If Convex isn't configured (e.g. a deploy without the backend yet), render
  // children unwrapped rather than crashing. useQuery sites are gated behind the
  // per-domain migration, so nothing depends on Convex until its domain lands.
  if (!client) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[convex] NEXT_PUBLIC_CONVEX_URL is not set — Convex provider is inert.",
      );
    }
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
