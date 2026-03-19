"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  Package,
  FolderOpen,
  Wrench,
  AlertTriangle,
  PackageCheck,
  ArrowRight,
  ScanBarcode,
  Zap,
  HardHat,
} from "lucide-react";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  getDashboardStats,
  getUpcomingProjects,
  getRecentActivity,
} from "@/server/dashboard";
import { formatDistanceToNow, format } from "date-fns";

export default function DashboardPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", orgId],
    queryFn: getDashboardStats,
  });

  const { data: upcoming } = useQuery({
    queryKey: ["dashboard-upcoming", orgId],
    queryFn: getUpcomingProjects,
  });

  const { data: activity } = useQuery({
    queryKey: ["dashboard-activity", orgId],
    queryFn: getRecentActivity,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="t-title text-fg">Dashboard</h1>
        <p className="text-[13px] text-fg-3">
          Overview of your operations.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          title="Total Assets"
          value={stats?.totalAssets ?? "—"}
          description="Across all categories"
          icon={Package}
          href="/assets/registry"
        />
        <StatCard
          title="Deployed"
          value={stats?.checkedOutAssets ?? "—"}
          description="Currently on projects"
          icon={PackageCheck}
          href="/assets/registry"
        />
        <StatCard
          title="Active Projects"
          value={stats?.activeProjects ?? "—"}
          description="In progress"
          icon={FolderOpen}
          href="/projects"
        />
        <StatCard
          title="Maintenance Due"
          value={stats?.maintenanceDue ?? "—"}
          description="Overdue or due now"
          icon={Wrench}
          href="/maintenance"
        />
        <StatCard
          title="Overdue Returns"
          value={stats?.overdueReturns ?? "—"}
          description="Past rental end date"
          icon={AlertTriangle}
          href="/projects"
          alert={!!stats?.overdueReturns}
        />
        <StatCard
          title="Active Crew"
          value={stats?.activeCrew ?? "—"}
          description="Crew members"
          icon={HardHat}
          href="/crew"
        />
        <StatCard
          title="Crew Offers"
          value={stats?.pendingCrewOffers ?? "—"}
          description="Pending & offered"
          icon={HardHat}
          href="/crew"
          alert={!!stats?.pendingCrewOffers}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Upcoming Projects */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="t-heading text-fg">Upcoming Projects</h3>
            <Link
              href="/projects"
              className="text-xs text-fg-3 hover:text-fg flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
            {!upcoming || upcoming.length === 0 ? (
              <p className="text-sm text-fg-3">
                No upcoming projects.
              </p>
            ) : (
              <div className="space-y-3">
                {upcoming.map((project: Record<string, unknown>) => (
                  <Link
                    key={project.id as string}
                    href={`/projects/${project.id}`}
                    className="flex items-center justify-between rounded-md border p-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-fg-3">
                          {project.projectNumber as string}
                        </span>
                        <StatusIndicator category="project" value={project.status as string} label={project.status as string} variant="pill" />
                      </div>
                      <p className="font-medium text-sm truncate">
                        {project.name as string}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-fg-3 mt-0.5">
                        {(() => {
                          const client = project.client as Record<string, string> | null;
                          return client?.name ? <span>{client.name}</span> : null;
                        })()}
                        {project.rentalStartDate ? (
                          <span>
                            Starts {format(new Date(project.rentalStartDate as string), "MMM d")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-xs text-fg-3 ml-2">
                      {(project._count as Record<string, number>)?.lineItems || 0} items
                    </div>
                  </Link>
                ))}
              </div>
            )}
        </div>

        {/* Recent Activity */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">Recent Activity</h3>
            {(() => {
              const logs = (activity as Record<string, unknown> | undefined)?.logs as Record<string, unknown>[] | undefined;
              const testRecords = (activity as Record<string, unknown> | undefined)?.testRecords as Record<string, unknown>[] | undefined;
              const maintRecords = (activity as Record<string, unknown> | undefined)?.maintenanceRecords as Record<string, unknown>[] | undefined;

              // Merge into a unified timeline
              const items: { type: "scan" | "test" | "maintenance"; time: Date; data: Record<string, unknown> }[] = [];
              for (const log of logs || []) {
                items.push({ type: "scan", time: new Date(log.scannedAt as string), data: log });
              }
              for (const rec of testRecords || []) {
                items.push({ type: "test", time: new Date(rec.testDate as string), data: rec });
              }
              for (const mr of maintRecords || []) {
                items.push({ type: "maintenance", time: new Date(mr.updatedAt as string), data: mr });
              }
              items.sort((a, b) => b.time.getTime() - a.time.getTime());
              const displayed = items.slice(0, 12);

              if (displayed.length === 0) {
                return (
                  <p className="text-sm text-fg-3">
                    No recent activity. Scan assets to see activity here.
                  </p>
                );
              }

              return (
                <div className="space-y-3">
                  {displayed.map((item) => {
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
                        <div key={`scan-${log.id}`} className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 rounded-full p-1.5 ${
                              isCheckOut
                                ? "bg-purple-500/10 text-purple-500"
                                : "bg-teal-500/10 text-teal-500"
                            }`}
                          >
                            <ScanBarcode className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className="font-medium">
                                {model?.name as string || "Asset"}
                              </span>
                              {" "}
                              <span className="text-fg-3">
                                {isCheckOut ? "deployed to" : "returned from"}
                              </span>
                              {" "}
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
                            <p className="text-xs text-fg-3">
                              {user?.name as string || "Unknown"} &middot;{" "}
                              {formatDistanceToNow(item.time, { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "test") {
                      // Test & tag record
                      const rec = item.data;
                      const ttAsset = rec.testTagAsset as Record<string, unknown> | null;
                      const tester = rec.testedBy as Record<string, unknown> | null;
                      const result = rec.result as string;
                      const resultColor = result === "PASS"
                        ? "text-green-500"
                        : result === "FAIL"
                          ? "text-red-500"
                          : "text-amber-500";

                      return (
                        <div key={`test-${rec.id}`} className="flex items-start gap-3">
                          <div className="mt-0.5 rounded-full p-1.5 bg-blue-500/10 text-blue-500">
                            <Zap className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className="font-medium">
                                {ttAsset?.description as string || ttAsset?.testTagId as string || "Item"}
                              </span>
                              {" "}
                              <span className="text-fg-3">tested —</span>
                              {" "}
                              <span className={`font-medium ${resultColor}`}>
                                {result}
                              </span>
                            </p>
                            <p className="text-xs text-fg-3">
                              {tester?.name as string || "Unknown"} &middot;{" "}
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
                    const mrStatusColor = mrStatus === "COMPLETED"
                      ? "text-green-500"
                      : mrStatus === "IN_PROGRESS"
                        ? "text-amber-500"
                        : "text-blue-500";
                    const mrStatusLabel: Record<string, string> = {
                      SCHEDULED: "scheduled",
                      IN_PROGRESS: "in progress",
                      COMPLETED: "completed",
                      CANCELLED: "cancelled",
                    };

                    return (
                      <div key={`maint-${mr.id}`} className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full p-1.5 bg-amber-500/10 text-amber-500">
                          <Wrench className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">
                            <Link
                              href={`/maintenance/${mr.id}`}
                              className="font-medium hover:underline"
                            >
                              {mr.title as string}
                            </Link>
                            {" "}
                            <span className="text-fg-3">—</span>
                            {" "}
                            <span className={`font-medium ${mrStatusColor}`}>
                              {mrStatusLabel[mrStatus] || mrStatus}
                            </span>
                          </p>
                          <p className="text-xs text-fg-3 truncate">
                            {firstModel
                              ? `${firstAsset?.assetTag as string} ${firstModel.name as string}`
                              : ""}
                            {mrAssets.length > 1 ? ` + ${mrAssets.length - 1} more` : ""}
                          </p>
                          <p className="text-xs text-fg-3">
                            {reporter?.name as string || "Unknown"} &middot;{" "}
                            {formatDistanceToNow(item.time, { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  href,
  alert,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link href={href} className={`rounded-lg bg-bg-surface p-4 surface-ring hover:bg-bg-elevated transition-colors ${alert ? "ring-destructive/50" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-fg-2">{title}</p>
        <Icon className={`h-4 w-4 ${alert ? "text-destructive" : "text-fg-3"}`} />
      </div>
      <div className={`text-2xl font-bold t-data ${alert ? "text-destructive" : ""}`}>
        {value}
      </div>
      <p className="text-xs text-fg-3">{description}</p>
    </Link>
  );
}
