"use client";
// Extracted from dashboard/page.tsx's "Recent activity" tile — same
// hook/timeline-builder/JSX (R-3.1).

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useNativeActivity } from "@/hooks/use-native-dashboard";
import { StaggerList, StaggerItem } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanBarcode, Zap, Wrench } from "lucide-react";

interface TimelineItem {
  key: string;
  type: "scan" | "test" | "maintenance";
  time: Date;
  data: Record<string, unknown>;
}

function buildActivityTimeline(activity: Record<string, unknown> | undefined): TimelineItem[] {
  if (!activity) return [];
  const logs = activity.logs as Record<string, unknown>[] | undefined;
  const testRecords = activity.testRecords as Record<string, unknown>[] | undefined;
  const maintRecords = activity.maintenanceRecords as Record<string, unknown>[] | undefined;
  const items: TimelineItem[] = [];
  for (const log of logs || []) items.push({ key: `scan-${log.id}`, type: "scan", time: new Date(log.scannedAt as string), data: log });
  for (const rec of testRecords || []) items.push({ key: `test-${rec.id}`, type: "test", time: new Date(rec.testDate as string), data: rec });
  for (const mr of maintRecords || []) items.push({ key: `maint-${mr.id}`, type: "maintenance", time: new Date(mr.updatedAt as string), data: mr });
  items.sort((a, b) => b.time.getTime() - a.time.getTime());
  return items.slice(0, 9);
}

function ActivityItem({ item }: { item: TimelineItem }) {
  if (item.type === "scan") {
    const log = item.data;
    const asset = log.asset as Record<string, unknown> | null;
    const bulkAsset = log.bulkAsset as Record<string, unknown> | null;
    const project = log.project as Record<string, unknown> | null;
    const user = log.scannedBy as Record<string, unknown> | null;
    const model = asset ? (asset.model as Record<string, unknown>) : bulkAsset ? (bulkAsset.model as Record<string, unknown>) : null;
    const isCheckOut = log.action === "CHECK_OUT";
    return (
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-green-soft text-green">
          <ScanBarcode className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug text-ink">
            <span className="font-medium">{(model?.name as string) || "Asset"}</span>{" "}
            <span className="text-muted">{isCheckOut ? "deployed to" : "returned from"}</span>{" "}
            {project ? (
              <Link href={`/projects/${project.id}`} className="font-medium hover:underline">
                {project.name as string}
              </Link>
            ) : (
              <span className="text-muted">unknown project</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {(user?.name as string) || "Unknown"} &middot; {formatDistanceToNow(item.time, { addSuffix: true })}
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
    const resultColor = result === "PASS" ? "text-ok" : result === "FAIL" ? "text-t-out" : "text-warn";
    return (
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal">
          <Zap className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug text-ink">
            <span className="font-medium">{(ttAsset?.description as string) || (ttAsset?.testTagId as string) || "Item"}</span>{" "}
            <span className="text-muted">tested &mdash;</span> <span className={`font-medium ${resultColor}`}>{result}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {(tester?.name as string) || "Unknown"} &middot; {formatDistanceToNow(item.time, { addSuffix: true })}
          </p>
        </div>
      </div>
    );
  }
  const mr = item.data;
  const mrAssets = (mr.assets as Record<string, unknown>[]) || [];
  const firstAsset = mrAssets[0]?.asset as Record<string, unknown> | undefined;
  const firstModel = firstAsset?.model as Record<string, unknown> | undefined;
  const reporter = mr.reportedBy as Record<string, unknown> | null;
  const mrStatus = mr.status as string;
  const mrStatusColor = mrStatus === "COMPLETED" ? "text-ok" : mrStatus === "IN_PROGRESS" ? "text-warn" : "text-blue";
  const mrStatusLabel: Record<string, string> = { SCHEDULED: "scheduled", IN_PROGRESS: "in progress", COMPLETED: "completed", CANCELLED: "cancelled" };
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-coral-soft text-coral">
        <Wrench className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug text-ink">
          <Link href={`/maintenance/${mr.id}`} className="font-medium hover:underline">
            {mr.title as string}
          </Link>{" "}
          <span className="text-muted">&mdash;</span> <span className={`font-medium ${mrStatusColor}`}>{mrStatusLabel[mrStatus] || mrStatus}</span>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted">
          {firstModel ? `${firstAsset?.assetTag as string} ${firstModel.name as string}` : ""}
          {mrAssets.length > 1 ? ` + ${mrAssets.length - 1} more` : ""}
        </p>
        <p className="text-[11px] text-muted">
          {(reporter?.name as string) || "Unknown"} &middot; {formatDistanceToNow(item.time, { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

export function RecentActivityWidget({ orgId }: { orgId: string | undefined }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activity = useNativeActivity(orgId) as any;
  const activityItems = buildActivityTimeline(activity);

  return (
    <div className="h-full">
      {!activity ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : activityItems.length === 0 ? (
        <p className="t-body text-muted">Quiet so far. Scan some gear and it&rsquo;ll show up here.</p>
      ) : (
        <StaggerList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activityItems.map((item) => (
            <StaggerItem key={item.key}>
              <ActivityItem item={item} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}
