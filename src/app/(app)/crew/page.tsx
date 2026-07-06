"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import {
  Users,
  Briefcase,
  Send,
  Clock,
  Timer,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Plus,
  Download,
} from "lucide-react";

import { focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CrewTable } from "@/components/crew/crew-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { PageHeader } from "@/components/layout/page-header";
import {
  getCrewDashboardStats,
  getPendingTimeEntries,
  getActiveAssignmentsSummary,
  getPendingOffers,
  getUpcomingShifts,
  getCrewPickerList,
} from "@/server/crew-dashboard";
import {
  approveTimeEntries,
  disputeTimeEntry,
  createTimeEntries,
} from "@/server/crew-time";
import { sendCrewOffer } from "@/server/crew-communication";
import {
  crewTimeEntrySchema,
  type CrewTimeEntryFormValues,
} from "@/lib/validations/crew";
import {
  assignmentStatusLabels,
  phaseLabels,
  formatLabel,
} from "@/lib/status-labels";
import { format } from "date-fns";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/motion";


function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "d MMM");
}

export default function CrewPage() {
  const canManage = useCanDo("crew", "update");

  return (
    <FadeIn>
      <RequirePermission resource="crew" action="read">
        {canManage ? <CrewDashboard /> : <CrewListView />}
      </RequirePermission>
    </FadeIn>
  );
}

// ─── Read-only view for non-managers ────────────────────────────────────────

function CrewListView() {
  return (
    <ListPageLayout
      title="Crew"
      description="Freelancers, employees, and contractors on your roster."
    >
      <CrewTable />
    </ListPageLayout>
  );
}

// ─── Manager Dashboard ─────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function CrewDashboard() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Slash command listener
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const { dialog } = ce.detail || {};
      if (dialog === "log-time") setLogTimeOpen(true);
      if (dialog === "export-timesheets") setExportOpen(true);
    };
    window.addEventListener("slash-command", handler);
    return () => window.removeEventListener("slash-command", handler);
  }, []);

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useServerQuery({
    queryKey: ["crew-dashboard-stats", orgId],
    queryFn: getCrewDashboardStats,
  });

  const {
    data: pendingTime,
    isLoading: pendingTimeLoading,
    error: pendingTimeError,
    refetch: refetchPendingTime,
  } = useServerQuery({
    queryKey: ["crew-pending-time", orgId],
    queryFn: getPendingTimeEntries,
  });

  const {
    data: activeAssignments,
    isLoading: activeAssignmentsLoading,
    error: activeAssignmentsError,
    refetch: refetchActiveAssignments,
  } = useServerQuery({
    queryKey: ["crew-active-assignments", orgId],
    queryFn: getActiveAssignmentsSummary,
  });

  const {
    data: pendingOffers,
    isLoading: pendingOffersLoading,
    error: pendingOffersError,
    refetch: refetchPendingOffers,
  } = useServerQuery({
    queryKey: ["crew-pending-offers", orgId],
    queryFn: getPendingOffers,
  });

  const {
    data: upcomingShifts,
    isLoading: upcomingShiftsLoading,
    error: upcomingShiftsError,
    refetch: refetchUpcomingShifts,
  } = useServerQuery({
    queryKey: ["crew-upcoming-shifts", orgId],
    queryFn: getUpcomingShifts,
  });

  const approveMutation = useServerMutation({
    mutationFn: (ids: string[]) => approveTimeEntries(ids),
    onSuccess: (result) => {
      toast.success(`${result.count} entries approved`);
      refetchPendingTime();
      refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });

  const disputeMutation = useServerMutation({
    mutationFn: (id: string) => disputeTimeEntry(id),
    onSuccess: () => {
      toast.success("Time entry disputed");
      refetchPendingTime();
      refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendOfferMutation = useServerMutation({
    mutationFn: (id: string) => sendCrewOffer(id),
    onSuccess: () => {
      toast.success("Offer sent");
      refetchPendingOffers();
      refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crew"
        description="Overview of crew, assignments, and timesheets."
        actions={
          <div className="flex gap-2">
            <Button variant="line" size="sm" onClick={() => setExportOpen(true)}>
              <Download className="size-5" />
              Export timesheets
            </Button>
            <Button variant="line" size="sm" onClick={() => setLogTimeOpen(true)}>
              <Clock className="size-5" />
              Log time
            </Button>
            <Button size="sm" asChild>
              <Link href="/crew/new">
                <Plus className="size-5" />
                Add crew
              </Link>
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      {statsError ? (
        <div className="flex items-center justify-between gap-4 rounded-[var(--r)] border border-line border-l-[3px] border-l-t-out bg-card p-3">
          <p className="text-ui-text text-t-out">Couldn&apos;t load crew stats. Check your connection and try again.</p>
          <Button variant="line" size="sm" onClick={() => refetchStats()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            title="Active crew"
            value={stats?.totalActive ?? "—"}
            icon={Users}
            href="/crew"
            loading={statsLoading}
          />
          <StatCard
            title="Assignments"
            value={stats?.activeAssignments ?? "—"}
            description="Active"
            icon={Briefcase}
            href="/crew/planner"
            loading={statsLoading}
          />
          <StatCard
            title="Pending offers"
            value={stats?.pendingOffers ?? "—"}
            description="Awaiting response"
            icon={Send}
            alert={!!stats?.pendingOffers}
            loading={statsLoading}
          />
          <StatCard
            title="Timesheets"
            value={stats?.submittedTime ?? "—"}
            description="Need approval"
            icon={Clock}
            alert={!!stats?.submittedTime}
            loading={statsLoading}
          />
          <StatCard
            title="Hours (7d)"
            value={stats?.hoursThisWeek != null ? `${stats.hoursThisWeek.toFixed(1)}h` : "—"}
            description="Approved"
            icon={Timer}
            loading={statsLoading}
          />
        </div>
      )}

      {/* Two-column grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pending timesheets */}
        <DashboardListCard
          title="Pending timesheets"
          count={pendingTime?.length}
          action={
            pendingTime && pendingTime.length > 0 ? (
              <Button
                variant="line"
                size="sm"
                onClick={() => {
                  const ids = pendingTime.map((e: any) => e.id);
                  approveMutation.mutate(ids);
                }}
                loading={approveMutation.isPending}
              >
                <CheckCircle className="size-5" />
                Approve all
              </Button>
            ) : null
          }
          error={pendingTimeError}
          onRetry={() => refetchPendingTime()}
          errorMessage="Couldn't load pending timesheets. Check your connection and try again."
          loading={pendingTimeLoading}
          isEmpty={!pendingTime || pendingTime.length === 0}
          emptyText="No timesheets awaiting approval."
        >
          {pendingTime?.map((entry: any) => (
            <div
              key={entry.id}
              className="flex items-center justify-between rounded-[var(--r)] border border-line p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-ui-text font-medium text-ink">
                  {entry.crewMember?.firstName}{" "}
                  {entry.crewMember?.lastName}
                </p>
                <p className="text-caption text-muted">
                  {entry.assignment
                    ? `${entry.assignment.project?.projectNumber} — ${entry.assignment.project?.name}`
                    : entry.description || "General"}
                  {" · "}
                  {formatDate(entry.date)}
                  {" · "}
                  {entry.startTime}–{entry.endTime}
                  {entry.totalHours != null &&
                    ` · ${Number(entry.totalHours).toFixed(1)}h`}
                </p>
              </div>
              <div className="flex gap-1 ml-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-ok hover:bg-ok-soft"
                  aria-label="Approve timesheet"
                  title="Approve"
                  onClick={() => approveMutation.mutate([entry.id])}
                  disabled={approveMutation.isPending}
                >
                  <CheckCircle className="size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-warn hover:bg-warn-soft"
                  aria-label="Dispute timesheet"
                  title="Dispute"
                  onClick={() => disputeMutation.mutate(entry.id)}
                  disabled={disputeMutation.isPending}
                >
                  <AlertTriangle className="size-5" />
                </Button>
              </div>
            </div>
          ))}
        </DashboardListCard>

        {/* Active assignments */}
        <DashboardListCard
          title="Active assignments"
          count={activeAssignments?.length}
          action={
            <Link
              href="/crew/planner"
              className={`text-caption text-muted hover:text-ink flex items-center gap-1 rounded-[var(--r)] ${focusRing}`}
            >
              Planner <ArrowRight className="h-3 w-3" />
            </Link>
          }
          error={activeAssignmentsError}
          onRetry={() => refetchActiveAssignments()}
          errorMessage="Couldn't load active assignments. Check your connection and try again."
          loading={activeAssignmentsLoading}
          loadingAvatar
          isEmpty={!activeAssignments || activeAssignments.length === 0}
          emptyText="No active assignments."
        >
          {activeAssignments?.map((a: any) => (
            <Link
              key={a.id}
              href={`/projects/${a.project?.id}`}
              className={`flex items-center gap-3 rounded-[var(--r)] border border-line p-3 hover:bg-elev transition-colors ${focusRing}`}
            >
              <PersonAvatar name={`${a.crewMember?.firstName ?? ""} ${a.crewMember?.lastName ?? ""}`.trim()} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="text-ui-text font-medium text-ink">
                  {a.crewMember?.firstName} {a.crewMember?.lastName}
                  {a.crewRole && (
                    <span className="text-muted font-normal">
                      {" "}
                      — {a.crewRole.name}
                    </span>
                  )}
                </p>
                <p className="text-caption text-muted">
                  {a.project?.projectNumber} — {a.project?.name}
                  {a.phase && ` · ${phaseLabels[a.phase] || formatLabel(a.phase)}`}
                  {a.startDate && ` · ${formatDate(a.startDate)}`}
                  {a.endDate && `–${formatDate(a.endDate)}`}
                </p>
              </div>
              <StatusIndicator
                category="assignment"
                value={a.status}
                label={assignmentStatusLabels[a.status] || formatLabel(a.status)}
                variant="pill"
              />
            </Link>
          ))}
        </DashboardListCard>
      </div>

      {/* Second row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Upcoming shifts */}
        <DashboardListCard
          title="Upcoming shifts"
          count={upcomingShifts ? groupShiftsByAssignment(upcomingShifts).length : undefined}
          action={
            <Link
              href="/crew/planner"
              className={`text-caption text-muted hover:text-ink flex items-center gap-1 rounded-[var(--r)] ${focusRing}`}
            >
              Planner <ArrowRight className="h-3 w-3" />
            </Link>
          }
          error={upcomingShiftsError}
          onRetry={() => refetchUpcomingShifts()}
          errorMessage="Couldn't load upcoming shifts. Check your connection and try again."
          loading={upcomingShiftsLoading}
          loadingAvatar
          isEmpty={!upcomingShifts || upcomingShifts.length === 0}
          emptyText="No upcoming shifts scheduled."
        >
          {upcomingShifts &&
            groupShiftsByAssignment(upcomingShifts).map((group: any) => (
              <div
                key={group.key}
                className="flex items-center gap-3 rounded-[var(--r)] border border-line p-3"
              >
                <PersonAvatar name={group.crewMember || "?"} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="text-ui-text font-medium text-ink">
                    {group.crewMember}
                    {group.crewRole && (
                      <span className="text-muted font-normal">
                        {" "}
                        — {group.crewRole}
                      </span>
                    )}
                  </p>
                  <p className="text-caption text-muted">
                    {group.projectNumber} — {group.projectName}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="font-mono text-caption tabular-nums text-ink-2">
                    {group.startDate === group.endDate
                      ? formatDate(group.startDate)
                      : `${formatDate(group.startDate)} – ${formatDate(group.endDate)}`}
                  </p>
                  <p className="text-caption text-muted font-mono tabular-nums">
                    {group.callTime || "—"}–{group.endTime || "—"}
                    {group.shiftCount > 1 && ` · ${group.shiftCount} days`}
                  </p>
                </div>
              </div>
            ))}
        </DashboardListCard>

        {/* Pending offers */}
        <DashboardListCard
          title="Pending offers"
          count={pendingOffers?.length}
          error={pendingOffersError}
          onRetry={() => refetchPendingOffers()}
          errorMessage="Couldn't load pending offers. Check your connection and try again."
          loading={pendingOffersLoading}
          loadingAvatar
          isEmpty={!pendingOffers || pendingOffers.length === 0}
          emptyText="No pending offers."
        >
          {pendingOffers?.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-[var(--r)] border border-line p-3"
            >
              <PersonAvatar name={`${a.crewMember?.firstName ?? ""} ${a.crewMember?.lastName ?? ""}`.trim()} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="text-ui-text font-medium text-ink">
                  {a.crewMember?.firstName} {a.crewMember?.lastName}
                  {a.crewRole && (
                    <span className="text-muted font-normal">
                      {" "}
                      — {a.crewRole.name}
                    </span>
                  )}
                </p>
                <p className="text-caption text-muted">
                  {a.project?.projectNumber} — {a.project?.name}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <StatusIndicator
                  category="assignment"
                  value={a.status}
                  label={assignmentStatusLabels[a.status] || formatLabel(a.status)}
                  variant="pill"
                />
                {a.status === "PENDING" && a.crewMember?.email && (
                  <Button
                    variant="line"
                    size="sm"
                    onClick={() => sendOfferMutation.mutate(a.id)}
                    loading={sendOfferMutation.isPending}
                  >
                    <Send className="size-5" />
                    Send
                  </Button>
                )}
              </div>
            </div>
          ))}
        </DashboardListCard>
      </div>

      {/* Crew list */}
      <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title font-bold text-ink">All crew members</h3>
          <Link
            href="/crew/settings"
            className={`text-caption text-muted hover:text-ink flex items-center gap-1 rounded-[var(--r)] ${focusRing}`}
          >
            Roles &amp; skills <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <CrewTable />
      </div>

      {/* Log Time Dialog */}
      <LogTimeDialog
        open={logTimeOpen}
        onOpenChange={setLogTimeOpen}
        onLogged={() => {
          refetchPendingTime();
          refetchStats();
        }}
      />

      {/* Export Dialog */}
      <ExportTimesheetDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function groupShiftsByAssignment(shifts: any[]) {
  const groups: any[] = [];
  let current: any = null;

  for (const shift of shifts) {
    const assignmentId = shift.assignment?.id || shift.assignmentId;
    if (
      current &&
      current.assignmentId === assignmentId &&
      current.callTime === (shift.callTime || null) &&
      current.endTime === (shift.endTime || null)
    ) {
      // Extend the current group
      current.endDate = shift.date;
      current.shiftCount++;
    } else {
      // Start new group
      current = {
        key: shift.id,
        assignmentId,
        crewMember: `${shift.assignment?.crewMember?.firstName || ""} ${shift.assignment?.crewMember?.lastName || ""}`.trim(),
        crewRole: shift.assignment?.crewRole?.name || null,
        projectNumber: shift.assignment?.project?.projectNumber || "",
        projectName: shift.assignment?.project?.name || "",
        startDate: shift.date,
        endDate: shift.date,
        callTime: shift.callTime || null,
        endTime: shift.endTime || null,
        shiftCount: 1,
      };
      groups.push(current);
    }
  }

  return groups;
}

// ─── Dashboard list card ────────────────────────────────────────────────────

/**
 * A dashboard list card with a fixed header (title + count chip + optional
 * action) and a height-capped, internally scrollable body. Caps each of the
 * four crew dashboard boxes so a long list (e.g. lots of pending offers) can't
 * grow to swallow the page and hide its siblings. Handles the §8 error / loading
 * / empty states inline so callers only pass their row markup as children.
 */
function DashboardListCard({
  title,
  count,
  action,
  error,
  onRetry,
  errorMessage,
  loading,
  loadingAvatar,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  error?: unknown;
  onRetry: () => void;
  errorMessage: string;
  loading?: boolean;
  loadingAvatar?: boolean;
  isEmpty: boolean;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-card-title font-bold text-ink truncate">{title}</h3>
          {!loading && !error && count != null && count > 0 && (
            <Badge status="neutral" className="font-mono tabular-nums">
              {count}
            </Badge>
          )}
        </div>
        {action}
      </div>
      {error ? (
        <CardErrorNotice message={errorMessage} onRetry={onRetry} />
      ) : loading ? (
        <CardRowSkeleton count={3} avatar={loadingAvatar} />
      ) : isEmpty ? (
        <p className="text-ui-text text-muted">{emptyText}</p>
      ) : (
        // Cap the list body and scroll internally so the four boxes stay
        // balanced no matter how many rows each holds.
        <div className="max-h-[19rem] space-y-2 overflow-y-auto pr-1 -mr-1 overscroll-contain">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard card states (§8 loading / error) ─────────────────────────────

/** Skeleton rows mirroring the dashboard list-card row layout. */
function CardRowSkeleton({ count = 3, avatar = false }: { count?: number; avatar?: boolean }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-[var(--r)] border border-line p-3"
        >
          {avatar && <Skeleton className="size-8 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Left-edge red error notice with retry, for a single failed dashboard query. */
function CardErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--r)] border border-line border-l-[3px] border-l-t-out bg-card p-3">
      <p className="text-ui-text text-t-out">{message}</p>
      <Button variant="line" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ─── Export Timesheet Dialog ────────────────────────────────────────────────

function ExportTimesheetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handleExport = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const url = `/api/crew/timesheet${params.toString() ? `?${params}` : ""}`;
    window.open(url, "_blank");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export timesheets</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <p className="text-caption text-muted">
            Leave empty to export all time entries.
          </p>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport}>
            <Download className="size-5" />
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Log Time Dialog ────────────────────────────────────────────────────────

function LogTimeDialog({
  open,
  onOpenChange,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after time entries are logged so the parent dashboard refreshes. */
  onLogged?: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [selectedCrewIds, setSelectedCrewIds] = useState<string[]>([]);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [isGeneral, setIsGeneral] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: crewList } = useServerQuery({
    queryKey: ["crew-picker-list", orgId],
    queryFn: getCrewPickerList,
    enabled: open,
  });

  const filteredCrew = crewList?.filter((c: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = `${c.firstName} ${c.lastName}`.toLowerCase();
    const role = (c.crewRole?.name || c.department || "").toLowerCase();
    return name.includes(q) || role.includes(q);
  });

  const form = useForm<CrewTimeEntryFormValues>({
    resolver: zodResolver(crewTimeEntrySchema),
    defaultValues: {
      assignmentId: "",
      crewMemberId: "",
      description: "",
      date: new Date().toISOString().split("T")[0],
      startTime: "",
      endTime: "",
      breakMinutes: "",
      notes: "",
    },
  });

  // Reset when dialog closes
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setSelectedCrewIds([]);
      setStep("pick");
      setIsGeneral(false);
      setSearchQuery("");
      form.reset();
    }
  }

  const toggleCrewMember = (id: string) => {
    setSelectedCrewIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const allIds = filteredCrew?.map((c: any) => c.id) || [];
    setSelectedCrewIds(allIds);
  };

  const deselectAll = () => {
    setSelectedCrewIds([]);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (data: CrewTimeEntryFormValues) => {
    if (isGeneral) data.assignmentId = "";
    setSubmitting(true);
    try {
      // One batch call for all selected crew — the server validates each crew
      // member individually and returns per-crew errors, preserving the old
      // loop's partial-success behaviour.
      const res = await createTimeEntries(data, selectedCrewIds);
      const successCount = res.created.length;
      if (successCount > 0) {
        toast.success(`${successCount} time ${successCount === 1 ? "entry" : "entries"} added`);
        // Refresh the parent dashboard's pending-time + stats. crew-time-entries
        // is read only by crew/[id] (useServerQuery, cross-route → remounts).
        onLogged?.();
      }
      if (res.errors.length > 0) {
        const first = res.errors[0];
        const crew = crewList?.find((c: any) => c.id === first.crewMemberId);
        toast.error(
          `${res.errors.length} failed: ${crew?.firstName || ""} ${crew?.lastName || ""}: ${first.message}`,
        );
      }
      if (successCount > 0) {
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log time</DialogTitle>
        </DialogHeader>

        {/* Step 1: Pick crew members */}
        {step === "pick" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Select crew members</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectedCrewIds.length === (filteredCrew?.length || 0) ? deselectAll : selectAll}
                >
                  {selectedCrewIds.length === (filteredCrew?.length || 0) && filteredCrew?.length
                    ? "Deselect all"
                    : "Select all"}
                </Button>
              </div>
            </div>
            <Input
              placeholder="Search crew..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filteredCrew?.map((c: any) => {
                const isSelected = selectedCrewIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={isSelected}
                    className={`w-full flex items-center gap-3 rounded-[var(--r)] border p-3 text-left transition-colors ${focusRing} ${
                      isSelected
                        ? "bg-red-soft border-red/40"
                        : "border-line hover:bg-elev"
                    }`}
                    onClick={() => toggleCrewMember(c.id)}
                  >
                    <div
                      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
                        isSelected
                          ? "bg-red border-red text-white"
                          : "border-line-2"
                      }`}
                    >
                      {isSelected && <CheckCircle className="size-3" />}
                    </div>
                    <PersonAvatar name={`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()} className="size-8" />
                    <div className="min-w-0 flex-1">
                      <p className="text-ui-text font-medium text-ink">
                        {c.firstName} {c.lastName}
                      </p>
                      <p className="text-caption text-muted">
                        {c.crewRole?.name || c.department || "No role"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {(!filteredCrew || filteredCrew.length === 0) && (
                <p className="text-ui-text text-muted py-4 text-center">
                  No crew members found.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="line"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={selectedCrewIds.length === 0}
                onClick={() => {
                  setStep("form");
                  // Set first crew member as crewMemberId for form validation
                  form.setValue("crewMemberId", selectedCrewIds[0]);
                }}
              >
                Next ({selectedCrewIds.length} selected)
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* Step 2: Time entry form */
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-ui-text font-medium text-ink">
                {selectedCrewIds.length === 1
                  ? `${crewList?.find((c: any) => c.id === selectedCrewIds[0])?.firstName} ${crewList?.find((c: any) => c.id === selectedCrewIds[0])?.lastName}`
                  : `${selectedCrewIds.length} crew members selected`}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("pick")}
              >
                Change
              </Button>
            </div>

            {/* Type toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!isGeneral ? "primary" : "line"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setIsGeneral(false);
                  form.setValue("description", "");
                }}
              >
                <Briefcase className="size-5" />
                Project
              </Button>
              <Button
                type="button"
                variant={isGeneral ? "primary" : "line"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setIsGeneral(true);
                  form.setValue("assignmentId", "");
                }}
              >
                <Clock className="size-5" />
                General
              </Button>
            </div>

            {!isGeneral ? (
              selectedCrewIds.length === 1 ? (
                <div className="space-y-1.5">
                  <Label>Assignment</Label>
                  <Select
                    value={form.watch("assignmentId") || ""}
                    onValueChange={(v) => form.setValue("assignmentId", v || "")}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(() => {
                          const crew = crewList?.find((c: any) => c.id === selectedCrewIds[0]);
                          const assignments = (crew?.assignments || []).filter(
                            (a: any) => !["CANCELLED", "DECLINED"].includes(a.status)
                          );
                          const selected = assignments.find(
                            (a: any) => a.id === form.watch("assignmentId")
                          );
                          if (!selected) return "Select assignment";
                          return `${selected.project?.projectNumber} — ${selected.project?.name}${selected.crewRole?.name ? ` (${selected.crewRole.name})` : ""}`;
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const crew = crewList?.find((c: any) => c.id === selectedCrewIds[0]);
                        const assignments = (crew?.assignments || []).filter(
                          (a: any) => !["CANCELLED", "DECLINED"].includes(a.status)
                        );
                        return assignments.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.project?.projectNumber} — {a.project?.name}
                            {a.crewRole?.name ? ` (${a.crewRole.name})` : ""}
                          </SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-caption text-muted rounded-[var(--r)] border border-line p-3">
                  Project assignment selection is not available for multiple crew members. Each member&apos;s entry will be created without a linked assignment, or switch to General mode.
                </p>
              )
            ) : (
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Warehouse maintenance, Office admin..."
                  {...form.register("description")}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" {...form.register("date")} aria-invalid={!!form.formState.errors.date} />
              {form.formState.errors.date && (
                <p className="text-caption text-t-out">
                  {form.formState.errors.date.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" {...form.register("startTime")} aria-invalid={!!form.formState.errors.startTime} />
                {form.formState.errors.startTime && (
                  <p className="text-caption text-t-out">
                    {form.formState.errors.startTime.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <Input type="time" {...form.register("endTime")} aria-invalid={!!form.formState.errors.endTime} />
                {form.formState.errors.endTime && (
                  <p className="text-caption text-t-out">
                    {form.formState.errors.endTime.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Break (minutes)</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                {...form.register("breakMinutes")}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional notes..."
                {...form.register("notes")}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="line"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Log time{selectedCrewIds.length > 1 ? ` (${selectedCrewIds.length})` : ""}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  href,
  alert,
  loading,
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  alert?: boolean;
  loading?: boolean;
}) {
  const content = (
    <div
      className={`rounded-[var(--r-lg)] bg-card p-4 ring-1 shadow-[var(--sh-card)] ${href ? "hover:bg-elev transition-colors" : ""} ${alert ? "ring-t-out/50" : "ring-line"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-ui-text font-medium text-ink-2">{title}</span>
        <Icon
          className={`size-4 ${alert ? "text-t-out" : "text-muted"}`}
        />
      </div>
      {loading ? (
        <Skeleton className="h-7 w-12" />
      ) : (
        <div
          className={`text-section-header font-display font-extrabold tabular-nums ${alert ? "text-t-out" : "text-ink"}`}
        >
          {value}
        </div>
      )}
      {description && (
        <p className="text-caption text-muted">{description}</p>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={`block rounded-[var(--r-lg)] ${focusRing}`}>
        {content}
      </Link>
    );
  }
  return content;
}
