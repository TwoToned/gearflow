"use client";
// Extracted out of `/today/page.tsx` (FEATUREDOCS/79) so the day rail can
// also live on the dashboard board (#1267) — same one-shot-polled hooks
// (`useFocusPolledQuery` + `useTodayDayRail`), same presentational
// `TodayDayRail` component (R-3.1).

import { useFocusPolledQuery } from "@/hooks/use-focus-polled-query";
import { useTodayDayRail } from "@/hooks/use-today-day-rail";
import { TodayDayRail } from "@/components/today/today-day-rail";
import { api } from "../../../../convex/_generated/api";

const MINUTE = 60_000;

export function TodayDayRailWidget({
  orgId,
  /** Defaults to `true` — the dashboard-board registry only ever calls this
   *  as `<Component orgId={orgId} />` (see `DashboardWidgetDef.component`'s
   *  fixed `{orgId}` signature), where it's always hosted inside the shared
   *  `<DashboardCard>` shell. `/today/page.tsx` is the one OTHER caller, and
   *  passes `bare={false}` explicitly to get this component's own card +
   *  "Your day" heading back (its pre-#1267 look). */
  bare = true,
}: {
  orgId: string | undefined;
  bare?: boolean;
}) {
  const nowBucket = Math.floor(Date.now() / MINUTE) * MINUTE;
  const home = useFocusPolledQuery(api.dashboardLists.home, orgId ? { orgId } : "skip");
  const dayRail = useTodayDayRail(orgId, nowBucket, home.data?.myProjects);

  return (
    <TodayDayRail
      entries={dayRail.entries}
      asOf={dayRail.asOf}
      error={dayRail.error}
      onRefresh={dayRail.refresh}
      bare={bare}
    />
  );
}
