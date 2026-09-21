"use client";
// Extracted out of the now-hidden `/today` page (D10C; FEATUREDOCS/79) so the
// day rail can also live on the dashboard board — same one-shot-polled hooks
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
   *  `<DashboardCard>` shell. `bare={false}` is `/today`'s pre-hide (D10C)
   *  page-furniture rendering — kept on the prop for `TodayDayRail`'s own
   *  direct-render tests. */
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
