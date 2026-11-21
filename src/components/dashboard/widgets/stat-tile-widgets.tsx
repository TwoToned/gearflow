"use client";
// The four stat tiles share one presentational core (R-3.6/R-3.1): a calm number,
// a label and a sub-line, each deep-linked to the list it counts (D85/D86), with
// a tooltip naming the target. Hrefs come from the one link table.

import Link from "next/link";
import { useNativeDashboardStats } from "@/hooks/use-native-dashboard";
import { AnimatedNumber } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { DASHBOARD_LINKS, type DashboardLink } from "@/lib/dashboard-links";
import { cn, focusRing } from "@/lib/utils";

interface StatValue {
  value: number | undefined;
  /** A read cap was hit: the figure prints `n+`. */
  truncated?: boolean;
  loading: boolean;
  /** Red when non-zero (Overdue returns). */
  bad?: boolean;
}

function figureText({ value, truncated }: StatValue): string {
  if (typeof value !== "number") return "—";
  return truncated ? `${value}+` : String(value);
}

function StatFigure({ value, truncated, loading, bad }: StatValue) {
  if (loading) return <Skeleton className="h-8 w-14" />;
  if (typeof value !== "number") return <span className="block font-display text-[32px] leading-none text-faint">&mdash;</span>;
  return (
    <span
      className={cn(
        "block font-display text-[32px] font-extrabold leading-none tracking-tight tabular-nums",
        bad && value > 0 ? "text-t-out" : "text-ink",
      )}
    >
      <AnimatedNumber value={value} />
      {truncated && "+"}
    </span>
  );
}

function StatTile({
  label,
  sub,
  link,
  children,
  ...figure
}: StatValue & { label: string; sub: string; link: DashboardLink; children?: React.ReactNode }) {
  return (
    <Link
      href={link.href}
      title={link.tip}
      aria-label={`${label}: ${figureText(figure)}, ${sub}. Opens ${link.tip}`}
      className={cn("group block min-w-0 rounded-sm text-ink", focusRing)}
    >
      <StatFigure {...figure} />
      <span className="mt-2 block text-[13px] font-semibold group-hover:underline">{label}</span>
      <span className="mt-px block text-[12px] text-muted">{sub}</span>
      {children}
    </Link>
  );
}

export function StatActiveJobsWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  return <StatTile label="Active jobs" value={stats?.activeProjects} loading={isLoading} sub="booked and out" link={DASHBOARD_LINKS.activeJobs} />;
}

/** D85: the number is JOBS (what `?overdue=1` lists); the lines still out are the sub-line. */
export function StatOverdueReturnsWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  const jobs = stats?.overdueReturnJobs ?? 0;
  const lines = stats?.overdueReturns ?? 0;
  return (
    <StatTile
      label="Overdue returns"
      value={stats?.overdueReturnJobs}
      truncated={stats?.overdueTruncated}
      loading={isLoading}
      sub={jobs > 0 ? `${lines} item${lines === 1 ? "" : "s"} to chase` : "all back"}
      link={DASHBOARD_LINKS.overdueReturns}
      bad
    />
  );
}

export function StatCrewBookedWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  return <StatTile label="Crew booked" value={stats?.activeCrew} loading={isLoading} sub="on the books" link={DASHBOARD_LINKS.crewBooked} />;
}

export function StatGearDeployedWidget({ orgId }: { orgId: string | undefined }) {
  const { data: stats, isLoading } = useNativeDashboardStats(orgId);
  const deployed = stats?.checkedOutAssets ?? 0;
  const total = stats?.totalAssets ?? 0;
  const util = total > 0 ? Math.round((deployed / total) * 100) : 0;
  const meter = util >= 85 ? "bg-t-out" : util >= 60 ? "bg-warn" : "bg-ink-2";
  return (
    <StatTile
      label="Gear deployed"
      value={stats?.checkedOutAssets}
      loading={isLoading}
      sub={`${util}% of ${total} out`}
      link={DASHBOARD_LINKS.gearDeployed}
    >
      <span className="mt-2.5 block h-[3px] max-w-[140px] overflow-hidden rounded-sm bg-line-2" aria-hidden>
        <span className={cn("block h-full", meter)} style={{ width: `${Math.min(util, 100)}%` }} />
      </span>
    </StatTile>
  );
}
