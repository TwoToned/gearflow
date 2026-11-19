"use client";

import { useCallback, useState } from "react";
import { useConvex } from "convex/react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { api } from "../../convex/_generated/api";

export type ScanLookupState =
  | { status: "idle" }
  | { status: "loading"; value: string }
  | { status: "found"; value: string; url: string; label: string; cta: string }
  | { status: "notFound"; value: string }
  | { status: "error"; value: string }
  | { status: "noPermission"; value: string };

/** `Open asset ›` / `Open kit ›` / `Open test record ›`, from where the target lives. */
export function scanOpenLabel(url: string): string {
  if (url.startsWith("/kits")) return "Open kit ›";
  if (url.startsWith("/test-and-tag")) return "Open test record ›";
  return "Open asset ›";
}

/**
 * One-shot, outside-a-job scan lookup (`convex/scanLookup.resolve`) with the four
 * states the shell must show: found, not found, error/offline, no permission.
 * One-shot on purpose — a scan is an event, not a subscription.
 */
export function useScanLookup() {
  const convex = useConvex();
  const { data: org } = useActiveOrganization();
  const canLookUp = useCanDo("warehouse", "read");
  const [state, setState] = useState<ScanLookupState>({ status: "idle" });
  const orgId = org?.id;

  const run = useCallback(
    async (value: string) => {
      if (!canLookUp) return setState({ status: "noPermission", value });
      if (!orgId || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        return setState({ status: "error", value });
      }
      setState({ status: "loading", value });
      try {
        const res = await convex.query(api.scanLookup.resolve, { orgId, value });
        if (!res.url) return setState({ status: "notFound", value });
        setState({ status: "found", value, url: res.url, label: res.label ?? value, cta: scanOpenLabel(res.url) });
      } catch {
        setState({ status: "error", value });
      }
    },
    [canLookUp, convex, orgId],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset };
}
