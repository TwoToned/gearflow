"use client";

import { api } from "../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";

/**
 * The single client-side gate for every Xero-linked-only UI surface (WS1
 * #940): coding-cascade fields on category/model/kit/line/service forms, the
 * client "Xero contact" card, the Settings -> Xero coding sections. Server-
 * side mirror: `convex/lib/xeroGate.ts` `isXeroLinked()` — both read the same
 * `xeroIntegrations.isConnected` flag via `xeroIntegrations.getForOrg`, so
 * "fields absent when unlinked" can never silently drift between what the UI
 * shows and what the server actually enforces.
 *
 * Returns `false` while loading (fail closed — coding fields stay hidden
 * until we KNOW the org is linked, never flash them on for an unlinked org).
 */
export function useXeroLinked(): boolean {
  const { data: activeOrg } = useActiveOrganization();
  const integration = useAuthedQuery(
    api.xeroIntegrations.getForOrg,
    activeOrg?.id ? { organizationId: activeOrg.id } : "skip",
  );
  return integration?.isConnected === true;
}

/** The full cached integration doc (accounts/tax rates/settings), or
 *  undefined while loading, or null when never connected. Used by the
 *  Settings -> Xero page and the various account/tax pickers. */
export function useXeroIntegration() {
  const { data: activeOrg } = useActiveOrganization();
  return useAuthedQuery(
    api.xeroIntegrations.getForOrg,
    activeOrg?.id ? { organizationId: activeOrg.id } : "skip",
  );
}
