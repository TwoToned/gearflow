"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useNativeWarehouseList } from "@/hooks/use-native-warehouse";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  PackageCheck,
  PackageOpen,
  CheckCircle,
  AlertTriangle,
  ScanBarcode,
  Boxes,
  Truck,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { updateProjectStatus } from "@/server/projects";
import { batchCloseOut } from "@/server/warehouse-close";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { focusRing } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  AnimatedNumber,
} from "@/components/ui/motion";

const WAREHOUSE_STATUSES = [
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
];

const statusLabels: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On site",
  RETURNED: "Returned",
};

function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined
) {
  if (!start && !end) return "No dates";
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

type Project = {
  id: string;
  name: string;
  projectNumber: string;
  status: string;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
  client?: { name: string } | null;
  lineItems?: Array<{ status: string; type: string; isKitChild: boolean }>;
};

type PendingAction = {
  project: Project;
  targetStatus: "CHECKED_OUT" | "RETURNED" | "COMPLETED";
  warningMessage: string;
};

type UrgencyGroup = "overdue" | "today" | "out" | "upcoming" | "returned";

function getProjectUrgency(project: Project): UrgencyGroup {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // The "today" prep window covers today AND tomorrow (header reads
  // "Today / Tomorrow"); the cutoff is the start of the day after tomorrow.
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(today.getDate() + 2);
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // Gear is physically back — awaiting close-out (also surfaced in the
  // close-out bar). Never "overdue" — it's already returned.
  if (project.status === "RETURNED") return "returned";

  const isOut = project.status === "CHECKED_OUT" || project.status === "ON_SITE";
  if (isOut) {
    // Deployed gear is OVERDUE only when it's past its due-back (in / end) date
    // and still out — NOT just because the out date has passed. Otherwise it's
    // out on site and on schedule.
    const end = project.rentalEndDate ? dayOf(new Date(project.rentalEndDate)) : null;
    if (end && end < today) return "overdue";
    return "out";
  }

  // Not yet out (confirmed / prepping): the prep queue, ordered by the out date.
  const start = project.rentalStartDate ? dayOf(new Date(project.rentalStartDate)) : null;
  if (!start) return "upcoming";
  if (start < dayAfterTomorrow) return "today";
  return "upcoming";
}

// ─── Prep / lifecycle progress ─────────────────────────────────
//
// The detail page runs a 5-stage lifecycle (Pick/prep → Prepped → Deployed →
// Returned → De-prepped). The landing cards echo it: where each project sits
// + how far its prep has progressed. We only have top-level EQUIPMENT line-item
// `status` (no dedicated prepStatus column), so we derive a simple count of how
// many items have advanced past "to prep".

type LineStage = "topack" | "prepped" | "deployed" | "returned";

function lineStage(status: string): LineStage {
  switch (status) {
    case "PREPPED":
      return "prepped";
    case "CHECKED_OUT":
      return "deployed";
    case "RETURNED":
      return "returned";
    default:
      // QUOTED / CONFIRMED / anything else = still on the floor to be picked
      return "topack";
  }
}

type PrepSummary = {
  total: number;
  packed: number; // anything past "to pack"
  counts: Record<LineStage, number>;
};

function getPrepSummary(project: Project): PrepSummary {
  const items = (project.lineItems || []).filter(
    (li) => li.type === "EQUIPMENT" && !li.isKitChild
  );
  const counts: Record<LineStage, number> = {
    topack: 0,
    prepped: 0,
    deployed: 0,
    returned: 0,
  };
  for (const li of items) counts[lineStage(li.status)] += 1;
  const total = items.length;
  const packed = total - counts.topack;
  return { total, packed, counts };
}

// The 5 lifecycle stages, in order. `current` is derived from project status so
// the card stepper highlights where the project sits at a glance (Gopuff-style).
const LIFECYCLE_STAGES = [
  { key: "prep", label: "Prep" },
  { key: "prepped", label: "Prepped" },
  { key: "deployed", label: "Deployed" },
  { key: "returned", label: "Returned" },
  { key: "closed", label: "Closed" },
] as const;

function currentStageIndex(status: string): number {
  switch (status) {
    case "CONFIRMED":
      return 0; // prep
    case "PREPPING":
      return 1; // prepped (in progress)
    case "CHECKED_OUT":
    case "ON_SITE":
      return 2; // deployed
    case "RETURNED":
      return 3; // returned, awaiting close-out
    default:
      return 0;
  }
}

const urgencyMeta: Record<
  UrgencyGroup,
  { label: string; dot: string; chip: string }
> = {
  overdue: {
    label: "Overdue",
    dot: "bg-t-out",
    chip: "bg-out-soft text-t-out",
  },
  today: {
    label: "Today / tomorrow",
    dot: "bg-warn",
    chip: "bg-warn-soft text-warn",
  },
  out: {
    label: "Out on site",
    dot: "bg-red",
    chip: "bg-red-soft text-red",
  },
  upcoming: {
    label: "Upcoming",
    dot: "bg-lime",
    chip: "bg-lime/15 text-lime",
  },
  returned: {
    label: "Returned · to close out",
    dot: "bg-rep",
    chip: "bg-rep-soft text-rep",
  },
};

export default function WarehousePage() {
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [selectedForClose, setSelectedForClose] = useState<Set<string>>(new Set());
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Native warehouse landing list (Phase 4 — the version-vector + getProjects
  // server-action path is retired). ONE warehouseList.bundle subscription returns
  // the warehouse-pipeline projects (thin line items + client), reactive over the
  // WebSocket. Search is applied client-side below (was a getProjects server param).
  const { projects: nativeProjects, isLoading } = useNativeWarehouseList(orgId);
  const data = useMemo(
    () =>
      nativeProjects
        ? { projects: nativeProjects as unknown as Project[] }
        : undefined,
    [nativeProjects],
  );
  // Post-write refresh is a no-op: the subscription pushes every change live.
  const refetch = useCallback(() => {}, []);

  const statusMutation = useServerMutation({
    mutationFn: ({ id, status }: { id: string; status: "CHECKED_OUT" | "RETURNED" | "COMPLETED" }) =>
      updateProjectStatus(id, status),
    onSuccess: (_, { status }) => {
      const label = status === "CHECKED_OUT" ? "Deployed" : status === "RETURNED" ? "Returned" : "Completed";
      toast.success(`Project marked as ${label}`);
      refetch();
      setPendingAction(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const batchCloseMutation = useServerMutation({
    mutationFn: (projectIds: string[]) => batchCloseOut(projectIds),
    onSuccess: (results) => {
      const r = results as Array<{ projectId: string; success: boolean; error?: string }>;
      const succeeded = r.filter((r) => r.success).length;
      const failed = r.filter((r) => !r.success).length;
      if (failed === 0) {
        toast.success(`${succeeded} project${succeeded !== 1 ? "s" : ""} closed out`);
      } else {
        toast.warning(`${succeeded} closed, ${failed} failed`);
      }
      setSelectedForClose(new Set());
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const searchLower = search.trim().toLowerCase();
  const projects = (data?.projects || []).filter(
    (p) =>
      WAREHOUSE_STATUSES.includes(p.status) &&
      (searchLower === "" ||
        p.name.toLowerCase().includes(searchLower) ||
        p.projectNumber.toLowerCase().includes(searchLower)),
  ) as Project[];

  const returnedProjects = projects.filter((p) => p.status === "RETURNED");

  function toggleCloseSelection(projectId: string) {
    setSelectedForClose((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else if (next.size < 25) next.add(projectId);
      else toast.error("Maximum 25 projects per batch close-out");
      return next;
    });
  }

  function toggleAllReturned() {
    if (selectedForClose.size === returnedProjects.length) {
      setSelectedForClose(new Set());
    } else {
      setSelectedForClose(new Set(returnedProjects.slice(0, 25).map((p) => p.id)));
    }
  }

  // Group projects by urgency
  const grouped = useMemo(() => {
    const groups: Record<UrgencyGroup, Project[]> = {
      overdue: [],
      today: [],
      out: [],
      upcoming: [],
      returned: [],
    };
    for (const p of projects) {
      groups[getProjectUrgency(p)].push(p);
    }
    return groups;
  }, [projects]);

  // Header stat strip — the room at a glance.
  const readyToPrep = projects.filter((p) => p.status === "CONFIRMED").length;
  const prepping = projects.filter((p) => p.status === "PREPPING").length;
  const deployedCount = projects.filter(
    (p) => p.status === "CHECKED_OUT" || p.status === "ON_SITE"
  ).length;
  const returnedCount = returnedProjects.length;

  function handleStatusAction(
    project: Project,
    targetStatus: "CHECKED_OUT" | "RETURNED" | "COMPLETED"
  ) {
    const lineItems = (project.lineItems || []).filter(
      (li) => li.type === "EQUIPMENT" && !li.isKitChild
    );

    if (lineItems.length === 0) {
      setPendingAction({
        project,
        targetStatus,
        warningMessage: `Are you sure you want to mark this project as ${targetStatus === "CHECKED_OUT" ? "Deployed" : targetStatus === "RETURNED" ? "Returned" : "Completed"}?`,
      });
      return;
    }

    if (targetStatus === "CHECKED_OUT") {
      const notCheckedOut = lineItems.filter(
        (li) => li.status !== "CHECKED_OUT"
      ).length;
      if (notCheckedOut > 0) {
        setPendingAction({
          project,
          targetStatus,
          warningMessage: `${notCheckedOut} item${notCheckedOut !== 1 ? "s are" : " is"} not yet deployed. Are you sure you want to mark this project as Deployed?`,
        });
        return;
      }
    }

    if (targetStatus === "RETURNED" || targetStatus === "COMPLETED") {
      const notReturned = lineItems.filter(
        (li) => li.status === "CHECKED_OUT"
      ).length;
      if (notReturned > 0) {
        setPendingAction({
          project,
          targetStatus,
          warningMessage: `${notReturned} item${notReturned !== 1 ? "s have" : " has"} not been returned yet. Are you sure you want to mark this project as ${targetStatus === "RETURNED" ? "Returned" : "Completed"}?`,
        });
        return;
      }
    }

    setPendingAction({
      project,
      targetStatus,
      warningMessage: `Mark this project as ${targetStatus === "CHECKED_OUT" ? "Deployed" : targetStatus === "RETURNED" ? "Returned" : "Completed"}?`,
    });
  }

  const todayFormatted = format(new Date(), "EEEE, d MMMM");
  const allSelected =
    returnedProjects.length > 0 &&
    selectedForClose.size === returnedProjects.length;

  return (
    <RequirePermission resource="warehouse" action="read">
      <div className="space-y-6">
        {/* ── Hero: identity + the room at a glance ───────────────── */}
        <FadeIn>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lime/15 px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] text-lime">
                <Boxes className="h-3.5 w-3.5" />
                Warehouse
              </span>
              {grouped.overdue.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-out-soft px-2.5 py-1 text-[11px] font-semibold text-t-out">
                  <AlertTriangle className="h-3 w-3" />
                  {grouped.overdue.length} overdue
                </span>
              )}
            </div>
            <h1 className="t-title text-ink">The floor</h1>
            <p className="t-body text-muted">
              {todayFormatted} — what to prep, deploy, and bring home.
            </p>
          </div>
        </FadeIn>

        {/* ── Scanner hero: the primary lookup ────────────────────── */}
        <FadeIn delay={0.04}>
          <div className="rounded-[var(--r-lg)] border border-line bg-card p-3 shadow-[var(--sh-card)] sm:p-4">
            <div className="relative">
              <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-lime" />
              <AssetTagInput
                placeholder="Scan a barcode or search project name / number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onScan={(scanned) => setSearch(scanned)}
                className="h-12 rounded-[var(--r)] border-line-2 bg-paper-2 pl-12 pr-20 text-[14px] text-ink placeholder:text-faint"
                autoFocus
              />
              {search ? (
                <button
                  onClick={() => setSearch("")}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-[var(--r)] px-2 py-1 text-caption text-faint transition-colors hover:text-ink-2 ${focusRing}`}
                >
                  Clear
                </button>
              ) : (
                <span className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-[11px] text-faint sm:flex">
                  <kbd className="rounded-[6px] border border-line-2 bg-paper px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted">
                    scan
                  </kbd>
                  to look up
                </span>
              )}
            </div>
          </div>
        </FadeIn>

        {/* ── Stat strip: the pipeline at a glance ────────────────── */}
        {!isLoading && projects.length > 0 && (
          <FadeIn delay={0.06}>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-line bg-line shadow-[var(--sh-card)] sm:grid-cols-4">
              <StatCell
                icon={<Boxes className="h-4 w-4" />}
                value={readyToPrep + prepping}
                label="To prep"
                accent="text-lime"
              />
              <StatCell
                icon={<Truck className="h-4 w-4" />}
                value={deployedCount}
                label="Deployed"
                accent="text-red"
              />
              <StatCell
                icon={<Undo2 className="h-4 w-4" />}
                value={returnedCount}
                label="To close out"
                accent="text-rep"
              />
              <StatCell
                icon={<AlertTriangle className="h-4 w-4" />}
                value={grouped.overdue.length}
                label="Overdue"
                accent="text-t-out"
              />
            </div>
          </FadeIn>
        )}

        {/* ── Batch close-out bar ─────────────────────────────────── */}
        {returnedProjects.length > 0 && (
          <FadeIn delay={0.08}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <label className="flex items-center gap-2.5 text-ui-text text-ink-2 cursor-pointer select-none">
                <Checkbox
                  checked={
                    selectedForClose.size === 0
                      ? false
                      : allSelected
                        ? true
                        : "indeterminate"
                  }
                  onCheckedChange={toggleAllReturned}
                />
                <span className="inline-flex items-center gap-1.5">
                  <Undo2 className="h-4 w-4 text-rep" />
                  {selectedForClose.size > 0
                    ? `${selectedForClose.size} of ${returnedProjects.length} returned project${returnedProjects.length !== 1 ? "s" : ""} selected`
                    : `${returnedProjects.length} returned project${returnedProjects.length !== 1 ? "s" : ""} ready to close out`}
                </span>
              </label>
              {selectedForClose.size > 0 && (
                <Button
                  size="sm"
                  variant="line"
                  className="border-red/60 text-t-out hover:bg-red hover:text-white hover:border-red"
                  onClick={() => batchCloseMutation.mutate(Array.from(selectedForClose))}
                  disabled={batchCloseMutation.isPending}
                  loading={batchCloseMutation.isPending}
                >
                  Close out {selectedForClose.size} project{selectedForClose.size !== 1 ? "s" : ""}
                </Button>
              )}
            </div>
          </FadeIn>
        )}

        {/* ── Project lists grouped by urgency ────────────────────── */}
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-[var(--r)]" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <FadeIn>
            <EmptyState
              title="The floor is clear"
              description={
                search
                  ? "No projects match that scan or search. Clear it to see the full pipeline."
                  : "Projects land here the moment they're confirmed and ready to prep."
              }
            />
          </FadeIn>
        ) : (
          <div className="space-y-9">
            {(["overdue", "today", "out", "returned", "upcoming"] as const).map((key, idx) => {
              const list = grouped[key];
              if (list.length === 0) return null;
              const meta = urgencyMeta[key];
              return (
                <section key={key}>
                  <FadeIn delay={idx * 0.05}>
                    <UrgencyGroupHeader
                      meta={meta}
                      count={list.length}
                    />
                  </FadeIn>
                  <StaggerList
                    className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    delay={idx * 0.05}
                  >
                    {list.map((project) => (
                      <StaggerItem key={project.id}>
                        <ProjectCard
                          project={project}
                          urgency={key}
                          onStatusAction={handleStatusAction}
                          isSelected={selectedForClose.has(project.id)}
                          onToggleSelect={() => toggleCloseSelection(project.id)}
                        />
                      </StaggerItem>
                    ))}
                  </StaggerList>
                </section>
              );
            })}
          </div>
        )}

        {/* Confirmation dialog */}
        <Dialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {pendingAction?.targetStatus === "CHECKED_OUT"
                  ? "Mark as deployed?"
                  : pendingAction?.targetStatus === "RETURNED"
                  ? "Mark as returned?"
                  : "Mark as completed?"}
              </DialogTitle>
              <DialogDescription>
                {pendingAction?.warningMessage}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="line" onClick={() => setPendingAction(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (pendingAction) {
                    statusMutation.mutate({
                      id: pendingAction.project.id,
                      status: pendingAction.targetStatus,
                    });
                  }
                }}
                disabled={statusMutation.isPending}
                loading={statusMutation.isPending}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}

// ─── Stat cell ─────────────────────────────────────────────────

function StatCell({
  icon,
  value,
  label,
  accent,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  accent: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className={`flex items-center gap-1.5 ${value > 0 ? accent : "text-faint"}`}>
        {icon}
        <span className="t-data text-[24px] font-bold leading-none tracking-[-0.02em] text-ink">
          <AnimatedNumber value={value} />
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-muted">{label}</p>
    </div>
  );
}

// ─── Urgency group header ──────────────────────────────────────

function UrgencyGroupHeader({
  meta,
  count,
}: {
  meta: { label: string; dot: string; chip: string };
  count: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <span className="t-heading text-ink">{meta.label}</span>
      <span
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${meta.chip}`}
      >
        {count}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

// ─── Prep progress bar ─────────────────────────────────────────
//
// Slim segmented bar (Gopuff "Packing your order" pattern) showing how far the
// project's items have advanced through prep → deployed → returned.

function PrepProgress({ summary }: { summary: PrepSummary }) {
  const { total, packed, counts } = summary;
  if (total === 0) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-paper-2" />
        <span className="t-mono shrink-0 text-faint">No items</span>
      </div>
    );
  }

  const pct = (n: number) => `${(n / total) * 100}%`;
  const allReturned = counts.returned === total;
  const allDeployed = counts.deployed + counts.returned === total;
  const allPacked = packed === total;

  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-paper-2">
        {counts.prepped > 0 && (
          <span className="bg-warn" style={{ width: pct(counts.prepped) }} />
        )}
        {counts.deployed > 0 && (
          <span className="bg-red" style={{ width: pct(counts.deployed) }} />
        )}
        {counts.returned > 0 && (
          <span className="bg-ok" style={{ width: pct(counts.returned) }} />
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="t-mono text-muted">
          {packed}/{total} packed
        </span>
        <span
          className={`t-mono ${
            allReturned
              ? "text-ok"
              : allDeployed
                ? "text-red"
                : allPacked
                  ? "text-warn"
                  : "text-faint"
          }`}
        >
          {allReturned
            ? "All back"
            : allDeployed
              ? "All out"
              : allPacked
                ? "Prepped"
                : `${counts.topack} to pack`}
        </span>
      </div>
    </div>
  );
}

// ─── Lifecycle stepper ─────────────────────────────────────────
//
// Five labelled dots (Walmart-style stage tracker) so the operator sees WHERE
// the project sits in the pipeline independent of item-level prep counts.

function LifecycleStepper({ status }: { status: string }) {
  const current = currentStageIndex(status);
  return (
    <div className="flex items-center gap-1">
      {LIFECYCLE_STAGES.map((stage, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={stage.key} className="flex items-center gap-1">
            <span
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                active
                  ? "bg-lime ring-2 ring-lime/25"
                  : done
                    ? "bg-lime/60"
                    : "bg-line-2"
              }`}
              title={stage.label}
            />
            {i < LIFECYCLE_STAGES.length - 1 && (
              <span
                className={`h-px w-3 ${done ? "bg-lime/40" : "bg-line-2"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Project Card ──────────────────────────────────────────────

const urgencyCardClass: Record<UrgencyGroup, string> = {
  // Overdue is heaviest: warmer t-out edge + faint tint + bolder ring.
  overdue:
    "border-l-[3px] border-l-t-out bg-out-soft/30 ring-1 ring-t-out/20",
  today: "border-l-[3px] border-l-warn ring-1 ring-line",
  out: "border-l-[3px] border-l-red ring-1 ring-line",
  upcoming: "border-l-[3px] border-l-lime ring-1 ring-line",
  returned: "border-l-[3px] border-l-rep ring-1 ring-line",
};

function ProjectCard({
  project,
  urgency,
  onStatusAction,
  isSelected,
  onToggleSelect,
}: {
  project: Project;
  urgency: UrgencyGroup;
  onStatusAction: (
    project: Project,
    targetStatus: "CHECKED_OUT" | "RETURNED" | "COMPLETED"
  ) => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const summary = getPrepSummary(project);
  const isReturned = project.status === "RETURNED";

  return (
    <div
      className={`group flex h-full flex-col rounded-[var(--r)] bg-card p-4 shadow-[var(--sh-card)] transition-[transform,box-shadow] motion-safe:hover:-translate-y-px hover:shadow-[var(--sh-hover)] ${urgencyCardClass[urgency]} ${
        isSelected ? "ring-2 ring-red/50" : ""
      }`}
    >
      {/* Header: number + select + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isReturned && onToggleSelect && (
            <Checkbox
              checked={!!isSelected}
              onCheckedChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Select ${project.projectNumber} for close-out`}
            />
          )}
          <span className="t-mono text-muted">{project.projectNumber}</span>
        </div>
        <StatusIndicator
          category="project"
          value={project.status}
          label={statusLabels[project.status] || project.status}
          variant="pill"
        />
      </div>

      {/* Identity */}
      <div className="mt-1.5">
        <h3 className="text-card-title font-semibold leading-tight text-ink">
          <Link
            href={`/warehouse/${project.id}`}
            className={`rounded-[var(--r)] transition-colors hover:text-lime hover:underline ${focusRing}`}
          >
            {project.name}
          </Link>
        </h3>
        {project.client && (
          <p className="mt-0.5 truncate text-ui-text text-muted">
            {project.client.name}
          </p>
        )}
      </div>

      {/* Dates + lifecycle stepper */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-caption text-ink-2">
          <CalendarDays className="h-3.5 w-3.5 text-muted" />
          <span className="tabular-nums">
            {formatDateRange(
              project.rentalStartDate as string | null,
              project.rentalEndDate as string | null
            )}
          </span>
        </div>
        <LifecycleStepper status={project.status} />
      </div>

      {/* Prep progress */}
      <div className="mt-3">
        <PrepProgress summary={summary} />
      </div>

      {/* Actions — pinned to the bottom for an even card grid */}
      <div className="mt-auto flex gap-2 pt-4">
        <Button
          variant="line"
          size="sm"
          className="flex-1 border-line-2"
          asChild
        >
          <Link href={`/warehouse/${project.id}`}>
            Open
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <CanDo resource="warehouse" action="check_out">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="line" size="sm" className="border-line-2">
                Actions
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {project.status !== "CHECKED_OUT" && project.status !== "ON_SITE" && project.status !== "RETURNED" && project.status !== "COMPLETED" && (
                <DropdownMenuItem
                  onClick={() => onStatusAction(project, "CHECKED_OUT")}
                >
                  <PackageOpen className="mr-2 h-4 w-4" />
                  Mark deployed
                </DropdownMenuItem>
              )}
              {(project.status === "CHECKED_OUT" || project.status === "ON_SITE") && (
                <DropdownMenuItem
                  onClick={() => onStatusAction(project, "RETURNED")}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Mark returned
                </DropdownMenuItem>
              )}
              {(project.status === "RETURNED" || project.status === "CHECKED_OUT" || project.status === "ON_SITE") && (
                <DropdownMenuItem
                  onClick={() => onStatusAction(project, "COMPLETED")}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Mark completed
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CanDo>
      </div>
    </div>
  );
}
