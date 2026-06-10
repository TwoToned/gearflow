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
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { getProjects, updateProjectStatus } from "@/server/projects";
import { batchCloseOut } from "@/server/warehouse-close";
import { ScanInput } from "@/components/ui/scan-input";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Button } from "@/components/ui/button";
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
  ON_SITE: "On Site",
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
  overdue: "border-l-[3px] border-l-error",
  today: "border-l-[3px] border-l-warning",
  upcoming: "border-l-[3px] border-l-primary",
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
            <h1 className="t-title text-fg">Warehouse</h1>
            {grouped.overdue.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-error-subtle px-2 py-0.5 text-[11px] font-semibold text-error">
                <AlertTriangle className="h-3 w-3" />
                {grouped.overdue.length} overdue
              </span>
            )}
          </div>
          <p className="t-body text-fg-3">
            {todayFormatted}
            {!isLoading && (
              <>
                {" — "}
                {readyToPrep > 0 ? (
                  <>
                    <span className="font-medium text-fg-2">
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
                    <span className="font-medium text-fg-2">
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
          <ScanBarcode className="pointer-events-none absolute left-3 top-2.5 z-10 h-4.5 w-4.5 text-fg-3" />
          <ScanInput
            placeholder="Scan barcode or search by project name / number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onScan={(scanned) => setSearch(scanned)}
            className="h-10 pl-10 text-[13.5px]"
            autoFocus
            scannerTitle="Scan project barcode"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-10 top-2.5 text-fg-4 hover:text-fg-2 transition-colors"
            >
              <span className="text-xs">Clear</span>
            </button>
          )}
        </div>
      </FadeIn>

      {/* Batch close-out bar */}
      {returnedProjects.length > 0 && (
        <FadeIn delay={0.08}>
          <div className="flex items-center gap-3 rounded-lg bg-bg-surface p-3 surface-ring">
            <label className="flex items-center gap-2 text-sm text-fg-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedForClose.size > 0 && selectedForClose.size === returnedProjects.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedForClose.size > 0 && selectedForClose.size < returnedProjects.length;
                }}
                onChange={toggleAllReturned}
                className="rounded border-border"
              />
              {selectedForClose.size > 0
                ? `${selectedForClose.size} of ${returnedProjects.length} returned project${returnedProjects.length !== 1 ? "s" : ""} selected`
                : `${returnedProjects.length} returned project${returnedProjects.length !== 1 ? "s" : ""} ready to close out`}
            </label>
            {selectedForClose.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => batchCloseMutation.mutate(Array.from(selectedForClose))}
                disabled={batchCloseMutation.isPending}
              >
                {batchCloseMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Close Out {selectedForClose.size} Project{selectedForClose.size !== 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </FadeIn>
      )}

      {/* Project lists grouped by urgency */}
      {isLoading ? (
        <div className="text-fg-3 text-sm py-8">Loading projects...</div>
      ) : projects.length === 0 ? (
        <FadeIn>
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <div className="py-8 text-center text-fg-3">
              <WarehouseIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No projects ready for warehouse operations.</p>
              <p className="text-xs mt-1">
                Projects will appear here when they reach Confirmed status.
              </p>
            </div>
          </div>
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
                ? "Mark as Deployed?"
                : pendingAction?.targetStatus === "RETURNED"
                ? "Mark as Returned?"
                : "Mark as Completed?"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.warningMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
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
            >
              {statusMutation.isPending ? "Updating..." : "Confirm"}
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
      className={`rounded-lg bg-bg-surface p-4 surface-ring hover:bg-bg-elevated transition-colors ${urgencyBorder[urgency]}`}
    >
      <div className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {project.status === "RETURNED" && onToggleSelect && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                className="rounded border-border"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span className="font-mono text-xs text-fg-3">
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
        <h3 className="text-base font-semibold">
          <Link
            href={`/warehouse/${project.id}`}
            className="hover:underline"
          >
            {project.name}
          </Link>
        </h3>
        {project.client && (
          <p className="text-sm text-fg-3">
            {project.client.name}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-fg-3">
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
            variant="outline"
            size="sm"
            className="flex-1"
            render={<Link href={`/warehouse/${project.id}`} />}
          >
            <WarehouseIcon className="mr-2 h-4 w-4" />
            Open
          </Button>
          <CanDo resource="warehouse" action="check_out">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                Actions
                <ChevronDown className="ml-1 h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {project.status !== "CHECKED_OUT" && project.status !== "ON_SITE" && project.status !== "RETURNED" && project.status !== "COMPLETED" && (
                  <DropdownMenuItem
                    onClick={() => onStatusAction(project, "CHECKED_OUT")}
                  >
                    <PackageOpen className="mr-2 h-4 w-4" />
                    Mark Deployed
                  </DropdownMenuItem>
                )}
                {(project.status === "CHECKED_OUT" || project.status === "ON_SITE") && (
                  <DropdownMenuItem
                    onClick={() => onStatusAction(project, "RETURNED")}
                  >
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Mark Returned
                  </DropdownMenuItem>
                )}
                {(project.status === "RETURNED" || project.status === "CHECKED_OUT" || project.status === "ON_SITE") && (
                  <DropdownMenuItem
                    onClick={() => onStatusAction(project, "COMPLETED")}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Mark Completed
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
