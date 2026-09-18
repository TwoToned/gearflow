"use client";
// use-client: interactive route — live subscription, keyboard nav, optimistic writes (R-8.1.1)

import { useState } from "react";
import { useActiveOrganization } from "@/lib/auth-client";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { TodayWorkListWidget, type TodayWorkListStatus } from "@/components/dashboard/widgets/today-work-list-widget";
import { TodayDayRailWidget } from "@/components/dashboard/widgets/today-day-rail-widget";
import { TodayNeedsYouRailWidget } from "@/components/dashboard/widgets/today-needs-you-rail-widget";

/**
 * `/today` — the personal landing page (FEATUREDOCS/79). The work list and
 * both rails are now shared widget components under
 * `src/components/dashboard/widgets/` (#1267) — this page renders the SAME
 * implementation the dashboard board's "Work list"/"Your day"/"Needs you"
 * widgets use (R-3.1), just laid out as fixed page furniture rather than a
 * grid cell. Greeting/quick-actions stay page-level exactly as before.
 */
export default function TodayPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const [status, setStatus] = useState<TodayWorkListStatus>({ isLoading: true, isEmpty: false, hasOverdue: false });

  return (
    <div className="space-y-6">
      <FadeIn>
        <PageHeader
          title={greeting}
          description={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          meta={
            !status.hasOverdue && !status.isLoading && !status.isEmpty ? (
              <p className="font-hand text-[15px] text-muted">Nothing on fire.</p>
            ) : undefined
          }
        />
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TodayWorkListWidget orgId={orgId} onStatusChange={setStatus} />

        <div className="space-y-4">
          {/* `bare={false}`: on /today these rails are page furniture with
              their own card + heading, unlike on the dashboard board where
              `<DashboardCard>` already supplies both. */}
          <TodayDayRailWidget orgId={orgId} bare={false} />
          <TodayNeedsYouRailWidget orgId={orgId} bare={false} />
        </div>
      </div>
    </div>
  );
}
