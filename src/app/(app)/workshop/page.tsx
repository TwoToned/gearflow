"use client";

/**
 * Workshop kanban — visual queue across the 4 active maintenance stages
 * (SCHEDULED, AWAITING_PARTS, IN_PROGRESS, QA). Plus a 5th column showing
 * recently COMPLETED records as a victory lap.
 *
 * Click-to-advance instead of drag-and-drop: warehouse staff often run
 * this on phones and tablets where drag UX is fiddly. Each card has
 * forward / back arrows to move it one step in the flow. Faster, more
 * accessible, no DnD library dependency.
 *
 * Asset state machine (in src/server/maintenance.ts) handles asset
 * hold/release. The kanban only triggers status transitions — it never
 * touches Asset.status directly.
 */

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wrench,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Package,
  User as UserIcon,
  CheckCircle2,
  XCircle,
  Search,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { getWorkshopQueue, setMaintenanceStatus } from "@/server/maintenance";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { showError } from "@/lib/show-error";
import { cn } from "@/lib/utils";

type WorkshopStatus = "SCHEDULED" | "AWAITING_PARTS" | "IN_PROGRESS" | "QA";

/** Ordered flow. setStatus accepts COMPLETED but the column itself is
 *  reserved for the "victory lap" rendering at the right edge. */
const FLOW: WorkshopStatus[] = ["SCHEDULED", "AWAITING_PARTS", "IN_PROGRESS", "QA"];

const COLUMNS: Array<{
  status: WorkshopStatus;
  label: string;
  desc: string;
  headerClass: string;
}> = [
  {
    status: "SCHEDULED",
    label: "Scheduled",
    desc: "Not yet started",
    headerClass: "border-blue-500/40 bg-blue-500/5",
  },
  {
    status: "AWAITING_PARTS",
    label: "Awaiting Parts",
    desc: "Parts ordered",
    headerClass: "border-purple-500/40 bg-purple-500/5",
  },
  {
    status: "IN_PROGRESS",
    label: "In Progress",
    desc: "Being worked on",
    headerClass: "border-amber-500/40 bg-amber-500/5",
  },
  {
    status: "QA",
    label: "QA",
    desc: "Verification before release",
    headerClass: "border-cyan-500/40 bg-cyan-500/5",
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Record_ = any;

function CardRow({
  record,
  onAdvance,
  onRegress,
  onResolvePass,
  onResolveFail,
  pending,
}: {
  record: Record_;
  onAdvance: (id: string) => void;
  onRegress: (id: string) => void;
  onResolvePass: (id: string) => void;
  onResolveFail: (id: string) => void;
  pending: boolean;
}) {
  const status = record.status as WorkshopStatus;
  const idx = FLOW.indexOf(status);
  const canRegress = idx > 0;
  const canAdvance = idx < FLOW.length - 1;
  const isFinalStage = status === "QA";

  const assetTags = (record.assets ?? []) as Array<{
    asset: { id: string; assetTag: string; model: { name: string } | null };
  }>;
  const firstTag = assetTags[0]?.asset.assetTag;
  const moreCount = Math.max(0, assetTags.length - 1);
  const photos = (record.photos ?? []) as string[];

  return (
    <Link
      href={`/maintenance/${record.id}`}
      className="block rounded-md border bg-bg-surface p-3 transition-colors hover:bg-bg-inset"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{record.title}</div>
          {assetTags.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-xs text-fg-3">
              <Package className="size-3" />
              <span className="truncate">
                {firstTag}
                {moreCount > 0 && (
                  <span className="ml-1 text-fg-4">+ {moreCount} more</span>
                )}
              </span>
            </div>
          )}
          {record.project && (
            <div className="mt-0.5 text-[11px] text-fg-4">
              {record.project.projectNumber}
            </div>
          )}
        </div>
        {record.assignedTo && (
          <div
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-inset text-[10px] font-medium text-fg-3"
            title={`Assigned to ${record.assignedTo.name}`}
          >
            {record.assignedTo.name?.[0] ?? "?"}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-1 text-[11px] text-fg-4">
        <div className="flex items-center gap-1">
          {record.scheduledDate ? (
            <>
              <Calendar className="size-3" />
              <span>{format(new Date(record.scheduledDate), "d MMM")}</span>
            </>
          ) : (
            <span>
              Reported {formatDistanceToNow(new Date(record.reportedAt ?? record.createdAt))} ago
            </span>
          )}
        </div>
        {record.cost != null && (
          <span className="tabular-nums">${Number(record.cost).toFixed(0)}</span>
        )}
      </div>

      {/* Photo thumbnails (up to 4). Visual evidence on the card. */}
      {photos.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-1">
          {photos.slice(0, 4).map((url, i) => (
            <div
              key={url}
              className="relative aspect-square overflow-hidden rounded bg-bg-inset"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              {i === 3 && photos.length > 4 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-semibold text-white">
                  +{photos.length - 4}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action row — stop bubbling so clicks don't navigate */}
      <div
        className="mt-2 flex items-center justify-between gap-1 border-t pt-2"
        onClick={(e) => e.preventDefault()}
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 disabled:opacity-30"
          disabled={!canRegress || pending}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRegress(record.id);
          }}
          title="Move back one stage"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {isFinalStage ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-red-600 hover:text-red-700"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResolveFail(record.id);
              }}
              title="Mark FAIL (asset stays held)"
            >
              <XCircle className="size-3.5" />
              Fail
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-green-600 hover:text-green-700"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResolvePass(record.id);
              }}
              title="Mark PASS (asset returns to AVAILABLE)"
            >
              <CheckCircle2 className="size-3.5" />
              Pass
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 disabled:opacity-30"
            disabled={!canAdvance || pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAdvance(record.id);
            }}
            title="Move forward one stage"
          >
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </Link>
  );
}

function WorkshopContent() {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const searchParams = useSearchParams();
  const urlProjectId = searchParams.get("projectId") ?? undefined;

  const [search, setSearch] = useState("");

  const { data: records, isLoading } = useQuery({
    queryKey: ["workshop-queue", orgId, search, urlProjectId],
    queryFn: () =>
      getWorkshopQueue({
        search: search || undefined,
        projectId: urlProjectId,
      }),
    enabled: !!orgId,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      nextStatus,
      result,
    }: {
      id: string;
      nextStatus: "SCHEDULED" | "AWAITING_PARTS" | "IN_PROGRESS" | "QA" | "COMPLETED";
      result?: "PASS" | "FAIL";
    }) => setMaintenanceStatus(id, nextStatus, result),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.nextStatus === "COMPLETED"
          ? vars.result === "FAIL"
            ? "Marked FAIL — asset stays held"
            : "Marked PASS — asset released"
          : `Moved to ${vars.nextStatus.replace("_", " ")}`,
      );
      queryClient.invalidateQueries({ queryKey: ["workshop-queue"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-records"] });
    },
    onError: (e) => showError(e),
  });

  // Group records by status.
  const byStatus = useMemo(() => {
    const buckets: Record<WorkshopStatus, Record_[]> = {
      SCHEDULED: [],
      AWAITING_PARTS: [],
      IN_PROGRESS: [],
      QA: [],
    };
    for (const r of (records ?? []) as Record_[]) {
      const s = r.status as WorkshopStatus;
      if (buckets[s]) buckets[s].push(r);
    }
    return buckets;
  }, [records]);

  function advance(id: string, currentStatus: WorkshopStatus) {
    const idx = FLOW.indexOf(currentStatus);
    if (idx < 0 || idx === FLOW.length - 1) return;
    statusMutation.mutate({ id, nextStatus: FLOW[idx + 1] });
  }
  function regress(id: string, currentStatus: WorkshopStatus) {
    const idx = FLOW.indexOf(currentStatus);
    if (idx <= 0) return;
    statusMutation.mutate({ id, nextStatus: FLOW[idx - 1] });
  }
  function resolvePass(id: string) {
    statusMutation.mutate({ id, nextStatus: "COMPLETED", result: "PASS" });
  }
  function resolveFail(id: string) {
    statusMutation.mutate({ id, nextStatus: "COMPLETED", result: "FAIL" });
  }

  const totalCards = (records?.length ?? 0);

  return (
    <FadeIn className="space-y-4">
      <PageHeader
        title="Workshop"
        description={
          totalCards === 0
            ? "No active maintenance. The queue lives here when there's work in flight."
            : `${totalCards} active ticket${totalCards === 1 ? "" : "s"} across the workshop.`
        }
        actions={
          <Button render={<Link href="/maintenance/new" />}>
            <Wrench className="mr-2 size-4" />
            New ticket
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-fg-4" />
        <Input
          placeholder="Search title, description, asset tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {urlProjectId && (
        <div className="rounded-md border bg-bg-inset/40 px-3 py-2 text-xs text-fg-3">
          Filtered to project {urlProjectId.slice(0, 8)}…{" "}
          <Link href="/workshop" className="ml-2 underline-offset-2 hover:underline">
            Clear filter
          </Link>
        </div>
      )}

      {/* Kanban columns */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = byStatus[col.status];
          return (
            <div key={col.status} className="flex flex-col">
              <div
                className={cn(
                  "rounded-t-md border border-b-0 px-3 py-2",
                  col.headerClass,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{col.label}</div>
                  <Badge variant="outline" className="bg-bg-surface tabular-nums">
                    {items.length}
                  </Badge>
                </div>
                <div className="text-[11px] text-fg-4">{col.desc}</div>
              </div>
              <div className="flex-1 space-y-2 rounded-b-md border bg-bg-inset/20 p-2 min-h-[160px]">
                {isLoading ? (
                  <p className="px-2 py-4 text-center text-xs text-fg-4">Loading…</p>
                ) : items.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-fg-4">No cards</p>
                ) : (
                  items.map((r) => (
                    <CardRow
                      key={r.id}
                      record={r}
                      pending={statusMutation.isPending}
                      onAdvance={(id) => advance(id, col.status)}
                      onRegress={(id) => regress(id, col.status)}
                      onResolvePass={resolvePass}
                      onResolveFail={resolveFail}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </FadeIn>
  );
}

export default function WorkshopPage() {
  return (
    <RequirePermission resource="maintenance" action="read">
      <Suspense fallback={<div className="p-6 text-fg-3">Loading…</div>}>
        <WorkshopContent />
      </Suspense>
    </RequirePermission>
  );
}
