"use client";
// Extracted from dashboard/page.tsx's Zone 3 stat tiles — v1's widget catalog
// wants each stat as its OWN widget (CLAUDE.md: "4 separate widgets, not
// one"), but they share one small presentational core (R-3.6/R-3.1: one
// StatTile/DeployTile implementation, not four copies).

import Link from "next/link";
import { useNativeDashboardStats } from "@/hooks/use-native-dashboard";
import { AnimatedNumber } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { focusRing } from "@/lib/utils";

type Hue = "blue" | "amber" | "green" | "purple" | "coral" | "teal" | "red";
const hueDot: Record<Hue, string> = {
  blue: "bg-blue",
  amber: "bg-amber",
  green: "bg-green",
  purple: "bg-purple",
  coral: "bg-coral",
  teal: "bg-teal",
  red: "bg-red",
};

const TILE_LINK = `${focusRing} block h-full transition-all motion-safe:hover:-translate-y-0.5`;

function StatTileBody({
  label,
  value,
  loading,
  hue,
  sub,
  href,
  problem = false,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  hue: Hue;
  sub: string;
  href: string;
  problem?: boolean;
}) {
  return (
    <Link href={href} className={TILE_LINK} aria-label={label}>
      <span className={`inline-block size-1.5 rounded-full ${hueDot[hue]}`} aria-hidden />
      {loading ? (
        <Skeleton className="mt-2 h-9 w-14" />
      ) : (
        <p
          className={`mt-1 font-display text-[38px] font-extrabold leading-none tracking-tight tabular-nums ${
            problem && value ? "text-t-out" : "text-ink"
          }`}
        >
          {typeof value === "number" ? <AnimatedNumber value={value} /> : <span className="text-faint">&mdash;</span>}
        </p>
      )}
      <p className="mt-1.5 t-micro text-faint">{sub}</p>
    </Link>
  );
}

export function StatActiveJobsWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  return (
    <StatTileBody
      label="Active jobs"
      value={stats?.activeProjects}
      loading={isLoading}
      hue="blue"
      sub="in flight"
      href="/projects"
    />
  );
}

export function StatOverdueReturnsWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  const overdue = stats?.overdueReturns ?? 0;
  return (
    <StatTileBody
      label="Overdue returns"
      value={overdue}
      loading={isLoading}
      hue="red"
      sub={overdue > 0 ? "chase them" : "all back"}
      href="/projects"
      problem={overdue > 0}
    />
  );
}

export function StatCrewBookedWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  return (
    <StatTileBody
      label="Crew booked"
      value={stats?.activeCrew}
      loading={isLoading}
      hue="purple"
      sub="on the books"
      href="/crew"
    />
  );
}

export function StatGearDeployedWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  const deployed = stats?.checkedOutAssets ?? 0;
  const total = stats?.totalAssets ?? 0;
  const util = total > 0 ? Math.round((deployed / total) * 100) : 0;
  const meterHue = util >= 85 ? "bg-t-out" : util >= 60 ? "bg-warn" : "bg-amber";
  return (
    <Link href="/assets/registry" className={TILE_LINK} aria-label="Gear deployed">
      <span className="inline-block size-1.5 rounded-full bg-amber" aria-hidden />
      {isLoading ? (
        <Skeleton className="mt-2 h-9 w-14" />
      ) : (
        <p className="mt-1 font-display text-[38px] font-extrabold leading-none tracking-tight tabular-nums text-ink">
          <AnimatedNumber value={deployed} />
        </p>
      )}
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-elev">
        <div className={`h-full rounded-full ${meterHue} transition-all`} style={{ width: `${Math.min(util, 100)}%` }} />
      </div>
      <p className="mt-1.5 t-micro text-faint">
        {util}% of {total} out
      </p>
    </Link>
  );
}
