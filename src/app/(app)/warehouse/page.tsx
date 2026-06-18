"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useReactiveServerQuery } from "@/hooks/use-reactive-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useWarehouseListVersion } from "@/hooks/use-warehouse";
import {
  Warehouse as WarehouseIcon,
  CalendarDays,
  ChevronDown,
  PackageCheck,
  PackageOpen,
  CheckCircle,
  AlertTriangle,
  ScanBarcode,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { getProjects, updateProjectStatus } from "@/server/projects";
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
import { SectionHeader } from "@/components/layout/page-layouts";
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
  if (!start && !end) return "—";
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

type UrgencyGroup = "overdue" | "today" | "upcoming";

function getProjectUrgency(project: Project): UrgencyGroup {
  const startDate = project.rentalStartDate
    ? new Date(project.rentalStartDate)
    : null;
  if (!startDate) return "upcoming";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // The "today" group is a 2-day prep window — it covers today AND
  // tomorrow (the section header reads "Today / Tomorrow"). The cutoff is
  // therefore the start of the day after tomorrow.
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(today.getDate() + 2);
  const projectDay = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate()
  );

  if (projectDay < today) return "overdue";
  if (projectDay < dayAfterTomorrow) return "today";
  return "upcoming";
}

const urgencyBorder: Record<UrgencyGroup, string> = {
  overdue: "border-l-[3px] border-l-t-out",
  today: "border-l-[3px] border-l-warn",
  upcoming: "border-l-[3px] border-l-red",
};

export default function WarehousePage() {
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [selectedForClose, setSelectedForClose] = useState<Set<string>>(new Set());
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive composite: subscribe to the cheap Convex version vector (a signature
  // over the org's warehouse-pipeline projects) and re-run the unchanged
  // getProjects server action whenever any of them changes status/dates/client —
  // cross-user over the WebSocket. See convex/warehouseDetail.ts.
  const listVersion = useWarehouseListVersion(orgId);
  const { data, isLoading, refetch } = useReactiveServerQuery({
    watch: listVersion,
    queryKey: ["warehouse-projects", orgId, { search }],
    queryFn: () =>
      getProjects({
        search: search || undefined,
        pageSize: 100,
        includeLineItems: true,
        sortBy: "rentalStartDate",
        sortOrder: "asc",
      }),
  });

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

  const projects = (data?.projects || []).filter((p) =>
    WAREHOUSE_STATUSES.includes(p.status)
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
      upcoming: [],
    };
    for (const p of projects) {
      groups[getProjectUrgency(p)].push(p);
    }
    return groups;
  }, [projects]);

  // Count "ready to prep" — CONFIRMED status projects
  const readyToPrep = projects.filter((p) => p.status === "CONFIRMED").length;
  const deployedCount = projects.filter(
    (p) => p.status === "CHECKED_OUT" || p.status === "ON_SITE"
  ).length;

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

  return (
    <RequirePermission resource="warehouse" action="read">
    <div className="space-y-6">
      {/* Dynamic contextual header */}
      <FadeIn>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="t-title text-ink">Warehouse</h1>
            {grouped.overdue.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[var(--r)] bg-out-soft px-2 py-0.5 text-[11px] font-semibold text-t-out">
                <AlertTriangle className="h-3 w-3" />
                {grouped.overdue.length} overdue
              </span>
            )}
          </div>
          <p className="t-body text-muted">
            {todayFormatted}
            {!isLoading && (
              <>
                {" — "}
                {readyToPrep > 0 ? (
                  <>
                    <span className="font-medium text-ink-2 tabular-nums">
                      <AnimatedNumber value={readyToPrep} />
                    </span>
                    {" "}
                    {readyToPrep === 1 ? "project" : "projects"} ready to prep
                  </>
                ) : (
                  "no projects waiting"
                )}
                {deployedCount > 0 && (
                  <>
                    {", "}
                    <span className="font-medium text-ink-2 tabular-nums">
                      <AnimatedNumber value={deployedCount} />
                    </span>
                    {" "}currently deployed
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </FadeIn>

      {/* Prominent scanner input — text + camera scan for project lookup. */}
      <FadeIn delay={0.05}>
        <div className="relative max-w-lg">
          <ScanBarcode className="pointer-events-none absolute left-3 top-2.5 z-10 h-4.5 w-4.5 text-muted" />
          <AssetTagInput
            placeholder="Scan barcode or search by project name / number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onScan={(scanned) => setSearch(scanned)}
            className="h-11 pl-10 text-[13.5px]"
            autoFocus
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-[var(--r)] px-1 text-caption text-faint transition-colors hover:text-ink-2 ${focusRing}`}
            >
              Clear
            </button>
          )}
        </div>
      </FadeIn>

      {/* Batch close-out bar */}
      {returnedProjects.length > 0 && (
        <FadeIn delay={0.08}>
          <div className="flex items-center gap-3 rounded-[var(--r)] bg-card p-3 ring-1 ring-line shadow-[var(--sh-card)]">
            <label className="flex items-center gap-2 text-ui-text text-muted cursor-pointer select-none">
              <Checkbox
                checked={
                  selectedForClose.size === 0
                    ? false
                    : selectedForClose.size === returnedProjects.length
                      ? true
                      : "indeterminate"
                }
                onCheckedChange={toggleAllReturned}
              />
              {selectedForClose.size > 0
                ? `${selectedForClose.size} of ${returnedProjects.length} returned project${returnedProjects.length !== 1 ? "s" : ""} selected`
                : `${returnedProjects.length} returned project${returnedProjects.length !== 1 ? "s" : ""} ready to close out`}
            </label>
            {selectedForClose.size > 0 && (
              <Button
                size="sm"
                variant="line"
                className="text-t-out hover:bg-red hover:text-white hover:border-red"
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

      {/* Project lists grouped by urgency */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-[var(--r)]" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <FadeIn>
          <EmptyState
            title="No projects waiting"
            description="Projects show up here once they're confirmed and ready to prep."
          />
        </FadeIn>
      ) : (
        <div className="space-y-8">
          {/* Overdue */}
          {grouped.overdue.length > 0 && (
            <section>
              <FadeIn>
                <SectionHeader label={`Overdue — ${grouped.overdue.length}`} />
              </FadeIn>
              <StaggerList className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.overdue.map((project) => (
                  <StaggerItem key={project.id}>
                    <ProjectCard
                      project={project}
                      urgency="overdue"
                      onStatusAction={handleStatusAction}
                      isSelected={selectedForClose.has(project.id)}
                      onToggleSelect={() => toggleCloseSelection(project.id)}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          )}

          {/* Today / Tomorrow */}
          {grouped.today.length > 0 && (
            <section>
              <FadeIn delay={0.05}>
                <SectionHeader label={`Today / Tomorrow — ${grouped.today.length}`} />
              </FadeIn>
              <StaggerList className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" delay={0.05}>
                {grouped.today.map((project) => (
                  <StaggerItem key={project.id}>
                    <ProjectCard
                      project={project}
                      urgency="today"
                      onStatusAction={handleStatusAction}
                      isSelected={selectedForClose.has(project.id)}
                      onToggleSelect={() => toggleCloseSelection(project.id)}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          )}

          {/* Upcoming */}
          {grouped.upcoming.length > 0 && (
            <section>
              <FadeIn delay={0.1}>
                <SectionHeader label={`Upcoming — ${grouped.upcoming.length}`} />
              </FadeIn>
              <StaggerList className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" delay={0.1}>
                {grouped.upcoming.map((project) => (
                  <StaggerItem key={project.id}>
                    <ProjectCard
                      project={project}
                      urgency="upcoming"
                      onStatusAction={handleStatusAction}
                      isSelected={selectedForClose.has(project.id)}
                      onToggleSelect={() => toggleCloseSelection(project.id)}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          )}
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

// ─── Project Card ──────────────────────────────────────────────

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
  return (
    <div
      className={`rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)] transition-[transform,box-shadow] motion-safe:hover:-translate-y-px hover:shadow-[var(--sh-hover)] ${urgencyBorder[urgency]}`}
    >
      <div className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {project.status === "RETURNED" && onToggleSelect && (
              <Checkbox
                checked={!!isSelected}
                onCheckedChange={onToggleSelect}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span className="t-mono text-muted">
              {project.projectNumber}
            </span>
          </div>
          <StatusIndicator
            category="project"
            value={project.status}
            label={statusLabels[project.status] || project.status}
            variant="pill"
          />
        </div>
        <h3 className="text-card-title font-semibold text-ink">
          <Link
            href={`/warehouse/${project.id}`}
            className={`rounded-[var(--r)] hover:text-red hover:underline ${focusRing}`}
          >
            {project.name}
          </Link>
        </h3>
        {project.client && (
          <p className="text-ui-text text-muted">
            {project.client.name}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-ui-text text-muted">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>
            {formatDateRange(
              project.rentalStartDate as string | null,
              project.rentalEndDate as string | null
            )}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="line"
            size="sm"
            className="flex-1"
            asChild
          >
            <Link href={`/warehouse/${project.id}`}>
              <WarehouseIcon className="mr-2 h-4 w-4" />
              Open
            </Link>
          </Button>
          <CanDo resource="warehouse" action="check_out">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="line" size="sm">
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
    </div>
  );
}
