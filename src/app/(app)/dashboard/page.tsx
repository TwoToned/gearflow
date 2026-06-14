"use client";

import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  ScanBarcode,
  Zap,
  Wrench,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  AnimatedNumber,
} from "@/components/ui/motion";
import { DateRangeBar } from "@/components/ui/sparkline";
import { SectionHeader } from "@/components/layout/page-layouts";
import { getStatusIntent } from "@/lib/status-colors";
import {
  getDashboardStats,
  getUpcomingProjects,
  getRecentActivity,
  getMyHomeData,
} from "@/server/dashboard";
import { MyWorkSection } from "@/components/dashboard/my-work-section";
import { getSubHireDashboardStats } from "@/server/sub-hires";
import { formatDistanceToNow, format } from "date-fns";
import { formatCurrency } from "@/lib/formatters";

// Color mapping from status intent to a left-border CSS class
const intentBorderColor: Record<string, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  error: "border-l-error",
  info: "border-l-info",
  neutral: "border-l-fg-3",
  primary: "border-l-primary",
};

export default function DashboardPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: stats } = useServerQuery({
    queryKey: ["dashboard-stats", orgId],
    queryFn: getDashboardStats,
  });

  const { data: upcoming } = useServerQuery({
    queryKey: ["dashboard-upcoming", orgId],
    queryFn: getUpcomingProjects,
  });

  const { data: activity } = useServerQuery({
    queryKey: ["dashboard-activity", orgId],
    queryFn: getRecentActivity,
  });

  const { data: subHireStats } = useServerQuery({
    queryKey: ["dashboard-sub-hire-stats", orgId],
    queryFn: getSubHireDashboardStats,
  });

  const { data: myHome } = useServerQuery({
    queryKey: ["my-home", orgId],
    queryFn: getMyHomeData,
  });

  // Greeting logic — personalised with the user's first name.
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = myHome?.userName ? String(myHome.userName).split(" ")[0] : "";

  // 60-day window for date range bars: today - 7 days to today + 53 days
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + 53);

  // Build activity timeline
  const activityItems = buildActivityTimeline(activity);

  return (
    <div className="space-y-6">
      {/* ── Top: Greeting + Alerts ── */}
      <FadeIn>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="t-title text-fg">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="t-body text-fg-3">
              {format(now, "EEEE, d MMMM yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {stats?.overdueReturns ? (
              <Link
                href="/projects"
                className="inline-flex items-center gap-2 rounded-md bg-error-subtle px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/15"
              >
                <span className="size-1.5 rounded-full bg-error" />
                {stats.overdueReturns} overdue return
                {stats.overdueReturns > 1 ? "s" : ""}
              </Link>
            ) : null}
            {stats?.maintenanceDue ? (
              <Link
                href="/maintenance"
                className="inline-flex items-center gap-2 rounded-md bg-warning-subtle px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/15"
              >
                <span className="size-1.5 rounded-full bg-warning" />
                {stats.maintenanceDue} maintenance due
              </Link>
            ) : null}
            {!stats?.overdueReturns && !stats?.maintenanceDue && stats && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                All clear
              </span>
            )}
          </div>
        </div>
      </FadeIn>

      {/* ── Your work (user-centric) ── */}
      <FadeIn delay={0.04}>
        <MyWorkSection projects={myHome?.myProjects ?? []} stats={stats} />
      </FadeIn>

      {/* ── Metrics Strip ── */}
      <FadeIn delay={0.05}>
        <div className="rounded-lg bg-bg-surface surface-ring">
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <MetricCell
              label="Total Assets"
              value={stats?.totalAssets}
              href="/assets/registry"
            />
            <MetricCell
              label="Deployed"
              value={stats?.checkedOutAssets}
              href="/assets/registry"
              className="border-l border-border"
            />
            <MetricCell
              label="Active Projects"
              value={stats?.activeProjects}
              href="/projects"
              className="border-l border-border max-sm:border-l-0 max-sm:border-t"
            />
            <MetricCell
              label="Crew"
              value={stats?.activeCrew}
              href="/crew"
              className="border-l border-border max-sm:border-t"
            />
          </div>
          {(subHireStats?.activeSubHires || subHireStats?.overdueReturns) ? (
            <div className="grid grid-cols-3 border-t border-border">
              <MetricCell
                label="Active Sub-Hires"
                value={subHireStats?.activeSubHires}
              />
              <MetricCell
                label="Monthly Sub-Hire Cost"
                value={subHireStats?.monthlySubHireCost}
                className="border-l border-border"
                format="currency"
              />
              <MetricCell
                label="Overdue Returns"
                value={subHireStats?.overdueReturns}
                className={`border-l border-border ${subHireStats?.overdueReturns ? "text-error" : ""}`}
              />
            </div>
          ) : null}
        </div>
      </FadeIn>

      {/* ── Bottom: Projects + Activity ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* LEFT: Upcoming Projects (60%) */}
        <FadeIn delay={0.1} className="lg:col-span-3">
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <SectionHeader label="Upcoming Projects" className="mb-4" />
            {!upcoming || upcoming.length === 0 ? (
              <p className="text-sm text-fg-3">No upcoming projects.</p>
            ) : (
              <StaggerList className="space-y-1">
                {upcoming.map((project: Record<string, unknown>) => {
                  const status = project.status as string;
                  const intent = getStatusIntent("project", status);
                  const borderClass =
                    intentBorderColor[intent] || "border-l-fg-3";
                  const client = project.client as Record<
                    string,
                    string
                  > | null;
                  const startDate = project.rentalStartDate
                    ? new Date(project.rentalStartDate as string)
                    : null;
                  const endDate = project.rentalEndDate
                    ? new Date(project.rentalEndDate as string)
                    : null;
                  const lineItemCount =
                    (project._count as Record<string, number>)?.lineItems || 0;

                  return (
                    <StaggerItem key={project.id as string}>
                      <Link
                        href={`/projects/${project.id}`}
                        className={`group block rounded-md border-l-[3px] py-3 pl-4 pr-3 transition-colors hover:bg-bg-elevated ${borderClass}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-fg-3">
                                {project.projectNumber as string}
                              </span>
                              {client?.name && (
                                <>
                                  <span className="text-fg-3">&middot;</span>
                                  <span className="truncate text-[11px] text-fg-3">
                                    {client.name}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="mt-0.5 text-sm font-medium text-fg truncate">
                              {project.name as string}
                            </p>
                            {startDate && endDate && (
                              <div className="mt-2 flex items-center gap-2">
                                <DateRangeBar
                                  start={startDate}
                                  end={endDate}
                                  rangeStart={rangeStart}
                                  rangeEnd={rangeEnd}
                                  className="flex-1"
                                />
                                <span className="shrink-0 text-[10px] text-fg-3">
                                  {format(startDate, "MMM d")} &ndash;{" "}
                                  {format(endDate, "MMM d")}
                                </span>
                              </div>
                            )}
                          </div>
                          <span className="shrink-0 mt-1 text-[11px] text-fg-3">
                            {lineItemCount} item{lineItemCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </Link>
                    </StaggerItem>
                  );
                })}
              </StaggerList>
            )}
            {upcoming && upcoming.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <Link
                  href="/projects"
                  className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg transition-colors"
                >
                  View all projects <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        </FadeIn>

        {/* RIGHT: Activity Feed (40%) */}
        <FadeIn delay={0.15} className="lg:col-span-2">
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <SectionHeader label="Recent Activity" className="mb-4" />
            {activityItems.length === 0 ? (
              <p className="text-sm text-fg-3">
                No recent activity. Scan assets to see activity here.
              </p>
            ) : (
              <StaggerList className="space-y-4">
                {activityItems.map((item) => (
                  <StaggerItem key={item.key}>
                    <ActivityItem item={item} />
                  </StaggerItem>
                ))}
              </StaggerList>
            )}
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

// ─── Metrics Cell ──────────────────────────────────────────────

function MetricCell({
  label,
  value,
  href,
  className,
  format: fmt,
}: {
  label: string;
  value: number | undefined;
  href?: string;
  className?: string;
  format?: "currency";
}) {
  const content = (
    <>
      <p className="t-micro text-fg-3">{label}</p>
      <div className="mt-1 t-title t-data">
        {typeof value === "number" ? (
          fmt === "currency" ? (
            <span className="tabular-nums">{formatCurrency(value)}</span>
          ) : (
            <AnimatedNumber value={value} />
          )
        ) : (
          <span className="text-fg-3">&mdash;</span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`group block px-5 py-4 transition-colors hover:bg-bg-elevated ${className ?? ""}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={`block px-5 py-4 ${className ?? ""}`}>
      {content}
    </div>
  );
}

// ─── Activity Timeline Types & Builder ─────────────────────────

interface TimelineItem {
  key: string;
  type: "scan" | "test" | "maintenance";
  time: Date;
  data: Record<string, unknown>;
}

function buildActivityTimeline(
  activity: Record<string, unknown> | undefined
): TimelineItem[] {
  if (!activity) return [];

  const logs = activity.logs as Record<string, unknown>[] | undefined;
  const testRecords = activity.testRecords as
    | Record<string, unknown>[]
    | undefined;
  const maintRecords = activity.maintenanceRecords as
    | Record<string, unknown>[]
    | undefined;

  const items: TimelineItem[] = [];
  for (const log of logs || []) {
    items.push({
      key: `scan-${log.id}`,
      type: "scan",
      time: new Date(log.scannedAt as string),
      data: log,
    });
  }
  for (const rec of testRecords || []) {
    items.push({
      key: `test-${rec.id}`,
      type: "test",
      time: new Date(rec.testDate as string),
      data: rec,
    });
  }
  for (const mr of maintRecords || []) {
    items.push({
      key: `maint-${mr.id}`,
      type: "maintenance",
      time: new Date(mr.updatedAt as string),
      data: mr,
    });
  }

  items.sort((a, b) => b.time.getTime() - a.time.getTime());
  return items.slice(0, 12);
}

// ─── Activity Item Component ───────────────────────────────────

function ActivityItem({ item }: { item: TimelineItem }) {
  if (item.type === "scan") {
    const log = item.data;
    const asset = log.asset as Record<string, unknown> | null;
    const bulkAsset = log.bulkAsset as Record<string, unknown> | null;
    const project = log.project as Record<string, unknown> | null;
    const user = log.scannedBy as Record<string, unknown> | null;
    const model = asset
      ? (asset.model as Record<string, unknown>)
      : bulkAsset
        ? (bulkAsset.model as Record<string, unknown>)
        : null;
    const isCheckOut = log.action === "CHECK_OUT";

    return (
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
            isCheckOut
              ? "bg-teal-500/10 text-teal-500"
              : "bg-teal-500/10 text-teal-500"
          }`}
        >
          <ScanBarcode className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug">
            <span className="font-medium">
              {(model?.name as string) || "Asset"}
            </span>{" "}
            <span className="text-fg-3">
              {isCheckOut ? "deployed to" : "returned from"}
            </span>{" "}
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                className="font-medium hover:underline"
              >
                {project.name as string}
              </Link>
            ) : (
              <span className="text-fg-3">unknown project</span>
            )}
          </p>
          <p className="text-[11px] text-fg-3 mt-0.5">
            {(user?.name as string) || "Unknown"} &middot;{" "}
            {formatDistanceToNow(item.time, { addSuffix: true })}
          </p>
        </div>
      </div>
    );
  }

  if (item.type === "test") {
    const rec = item.data;
    const ttAsset = rec.testTagAsset as Record<string, unknown> | null;
    const tester = rec.testedBy as Record<string, unknown> | null;
    const result = rec.result as string;
    const resultColor =
      result === "PASS"
        ? "text-success"
        : result === "FAIL"
          ? "text-error"
          : "text-warning";

    return (
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
          <Zap className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug">
            <span className="font-medium">
              {(ttAsset?.description as string) ||
                (ttAsset?.testTagId as string) ||
                "Item"}
            </span>{" "}
            <span className="text-fg-3">tested &mdash;</span>{" "}
            <span className={`font-medium ${resultColor}`}>{result}</span>
          </p>
          <p className="text-[11px] text-fg-3 mt-0.5">
            {(tester?.name as string) || "Unknown"} &middot;{" "}
            {formatDistanceToNow(item.time, { addSuffix: true })}
          </p>
        </div>
      </div>
    );
  }

  // Maintenance record
  const mr = item.data;
  const mrAssets = (mr.assets as Record<string, unknown>[]) || [];
  const firstAsset = mrAssets[0]?.asset as Record<string, unknown> | undefined;
  const firstModel = firstAsset?.model as Record<string, unknown> | undefined;
  const reporter = mr.reportedBy as Record<string, unknown> | null;
  const mrStatus = mr.status as string;
  const mrStatusColor =
    mrStatus === "COMPLETED"
      ? "text-success"
      : mrStatus === "IN_PROGRESS"
        ? "text-warning"
        : "text-info";
  const mrStatusLabel: Record<string, string> = {
    SCHEDULED: "scheduled",
    IN_PROGRESS: "in progress",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  };

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
        <Wrench className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          <Link
            href={`/maintenance/${mr.id}`}
            className="font-medium hover:underline"
          >
            {mr.title as string}
          </Link>{" "}
          <span className="text-fg-3">&mdash;</span>{" "}
          <span className={`font-medium ${mrStatusColor}`}>
            {mrStatusLabel[mrStatus] || mrStatus}
          </span>
        </p>
        <p className="text-[11px] text-fg-3 truncate mt-0.5">
          {firstModel
            ? `${firstAsset?.assetTag as string} ${firstModel.name as string}`
            : ""}
          {mrAssets.length > 1 ? ` + ${mrAssets.length - 1} more` : ""}
        </p>
        <p className="text-[11px] text-fg-3">
          {(reporter?.name as string) || "Unknown"} &middot;{" "}
          {formatDistanceToNow(item.time, { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}
