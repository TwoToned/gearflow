"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useNativeOrgFinanceCounts, useNativeOverbookingCounts } from "@/hooks/use-native-dashboard";
import { useStableNow } from "@/hooks/use-stable-now";
import { formatNavCount, type NavCountSource, type NavCountText } from "@/lib/nav-counts";
import { api } from "../../convex/_generated/api";
import type { NavCount } from "../../convex/navCounts";

/**
 * One More-sheet row's count. Call it only from a row that is on screen: the
 * sheet's rows mount only while it is open, and only for the rows `useNavItems`
 * kept for this role, so a count is subscribed exactly while it can be seen
 * (and never for a row the role can't open). The server role-checks again.
 * Finance and Overbookings read their existing counts; the rest `navCounts.get`.
 */
export function useNavCount(source: NavCountSource | undefined, orgId: string | undefined): NavCountText | null {
  const now = useStableNow();
  const own = (s: NavCountSource) => (source === s ? orgId : undefined);
  const finance = useNativeOrgFinanceCounts(own("invoicesOverdue"));
  const overbookings = useNativeOverbookingCounts(own("overbookings"));
  const server = source && source !== "invoicesOverdue" && source !== "overbookings" && orgId ? source : null;
  const counted = useAuthedQuery(api.navCounts.get, server && orgId ? { orgId, source: server, now } : "skip");
  if (!source) return null;
  return formatNavCount(source, pick(source, { finance, overbookings, counted }));
}

function pick(
  source: NavCountSource,
  r: {
    finance: ReturnType<typeof useNativeOrgFinanceCounts>;
    overbookings: ReturnType<typeof useNativeOverbookingCounts>;
    counted: NavCount | null | undefined;
  },
): NavCount | null | undefined {
  if (source === "invoicesOverdue") return r.finance ? { value: r.finance.overdueCount ?? 0, truncated: !!r.finance.overdueTruncated } : undefined;
  if (source === "overbookings") return r.overbookings ? { value: r.overbookings.hardCount, truncated: false } : undefined;
  return r.counted;
}
