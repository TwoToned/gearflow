"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Loader2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  createTimeEntry,
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

const assignmentStatusColors: Record<string, string> = {
  PENDING: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  OFFERED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  ACCEPTED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
};

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "d MMM");
}

export default function CrewPage() {
  const canManage = useCanDo("crew", "update");

  return (
    <RequirePermission resource="crew" action="read">
      {canManage ? <CrewDashboard /> : <CrewListView />}
    </RequirePermission>
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
  const queryClient = useQueryClient();
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

  const { data: stats } = useQuery({
    queryKey: ["crew-dashboard-stats", orgId],
    queryFn: getCrewDashboardStats,
  });

  const { data: pendingTime } = useQuery({
    queryKey: ["crew-pending-time", orgId],
    queryFn: getPendingTimeEntries,
  });

  const { data: activeAssignments } = useQuery({
    queryKey: ["crew-active-assignments", orgId],
    queryFn: getActiveAssignmentsSummary,
  });

  const { data: pendingOffers } = useQuery({
    queryKey: ["crew-pending-offers", orgId],
    queryFn: getPendingOffers,
  });

  const { data: upcomingShifts } = useQuery({
    queryKey: ["crew-upcoming-shifts", orgId],
    queryFn: getUpcomingShifts,
  });

  const approveMutation = useMutation({
    mutationFn: (ids: string[]) => approveTimeEntries(ids),
    onSuccess: (result) => {
      toast.success(`${result.count} entries approved`);
      queryClient.invalidateQueries({ queryKey: ["crew-pending-time"] });
      queryClient.invalidateQueries({ queryKey: ["crew-dashboard-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const disputeMutation = useMutation({
    mutationFn: (id: string) => disputeTimeEntry(id),
    onSuccess: () => {
      toast.success("Time entry disputed");
      queryClient.invalidateQueries({ queryKey: ["crew-pending-time"] });
      queryClient.invalidateQueries({ queryKey: ["crew-dashboard-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const sendOfferMutation = useMutation({
    mutationFn: (id: string) => sendCrewOffer(id),
    onSuccess: () => {
      toast.success("Offer sent");
      queryClient.invalidateQueries({ queryKey: ["crew-pending-offers"] });
      queryClient.invalidateQueries({ queryKey: ["crew-dashboard-stats"] });
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
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Timesheets
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLogTimeOpen(true)}>
              <Clock className="mr-2 h-3.5 w-3.5" />
              Log Time
            </Button>
            <Button size="sm" render={<Link href="/crew/new" />}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add Crew
            </Button>
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          title="Active Crew"
          value={stats?.totalActive ?? "—"}
          icon={Users}
          href="/crew"
        />
        <StatCard
          title="Assignments"
          value={stats?.activeAssignments ?? "—"}
          description="Active"
          icon={Briefcase}
          href="/crew/planner"
        />
        <StatCard
          title="Pending Offers"
          value={stats?.pendingOffers ?? "—"}
          description="Awaiting response"
          icon={Send}
          alert={!!stats?.pendingOffers}
        />
        <StatCard
          title="Timesheets"
          value={stats?.submittedTime ?? "—"}
          description="Need approval"
          icon={Clock}
          alert={!!stats?.submittedTime}
        />
        <StatCard
          title="Hours (7d)"
          value={stats?.hoursThisWeek != null ? `${stats.hoursThisWeek.toFixed(1)}h` : "—"}
          description="Approved"
          icon={Timer}
        />
        <StatCard
          title="Expiring Certs"
          value={stats?.expiringCerts ?? "—"}
          icon={AlertTriangle}
          alert={!!stats?.expiringCerts}
        />
      </div>

      {/* Two-column grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pending Timesheets */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="t-heading text-fg">Pending Timesheets</h3>
            {pendingTime && pendingTime.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const ids = pendingTime.map((e: any) => e.id);
                  approveMutation.mutate(ids);
                }}
                disabled={approveMutation.isPending}
              >
                <CheckCircle className="mr-2 h-3.5 w-3.5" />
                Approve All
              </Button>
            )}
          </div>
          {!pendingTime || pendingTime.length === 0 ? (
            <p className="text-sm text-fg-3">
              No timesheets awaiting approval.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingTime.map((entry: any) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {entry.crewMember?.firstName}{" "}
                      {entry.crewMember?.lastName}
                    </p>
                    <p className="text-xs text-fg-3">
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
                      size="sm"
                      className="h-7 text-green-500 hover:text-green-600"
                      onClick={() => approveMutation.mutate([entry.id])}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-amber-500 hover:text-amber-600"
                      onClick={() => disputeMutation.mutate(entry.id)}
                      disabled={disputeMutation.isPending}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Assignments */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="t-heading text-fg">Active Assignments</h3>
            <Link
              href="/crew/planner"
              className="text-xs text-fg-3 hover:text-fg flex items-center gap-1"
            >
              Planner <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {!activeAssignments || activeAssignments.length === 0 ? (
            <p className="text-sm text-fg-3">
              No active assignments.
            </p>
          ) : (
            <div className="space-y-2">
              {activeAssignments.map((a: any) => (
                <Link
                  key={a.id}
                  href={`/projects/${a.project?.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-bg-elevated/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {a.crewMember?.firstName} {a.crewMember?.lastName}
                      {a.crewRole && (
                        <span className="text-fg-3 font-normal">
                          {" "}
                          — {a.crewRole.name}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-fg-3">
                      {a.project?.projectNumber} — {a.project?.name}
                      {a.phase && ` · ${phaseLabels[a.phase] || formatLabel(a.phase)}`}
                      {a.startDate && ` · ${formatDate(a.startDate)}`}
                      {a.endDate && `–${formatDate(a.endDate)}`}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={assignmentStatusColors[a.status] || ""}
                  >
                    {assignmentStatusLabels[a.status] || formatLabel(a.status)}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Second row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Upcoming Shifts */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="t-heading text-fg">Upcoming Shifts</h3>
            <Link
              href="/crew/planner"
              className="text-xs text-fg-3 hover:text-fg flex items-center gap-1"
            >
              Planner <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {!upcomingShifts || upcomingShifts.length === 0 ? (
            <p className="text-sm text-fg-3">
              No upcoming shifts scheduled.
            </p>
          ) : (
            <div className="space-y-2">
              {groupShiftsByAssignment(upcomingShifts).map((group: any) => (
                <div
                  key={group.key}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {group.crewMember}
                      {group.crewRole && (
                        <span className="text-fg-3 font-normal">
                          {" "}
                          — {group.crewRole}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-fg-3">
                      {group.projectNumber} — {group.projectName}
                    </p>
                  </div>
                  <div className="text-right text-sm shrink-0 ml-2">
                    <p className="font-mono text-xs">
                      {group.startDate === group.endDate
                        ? formatDate(group.startDate)
                        : `${formatDate(group.startDate)} – ${formatDate(group.endDate)}`}
                    </p>
                    <p className="text-xs text-fg-3 font-mono">
                      {group.callTime || "—"}–{group.endTime || "—"}
                      {group.shiftCount > 1 && ` · ${group.shiftCount} days`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Offers */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">Pending Offers</h3>
          {!pendingOffers || pendingOffers.length === 0 ? (
            <p className="text-sm text-fg-3">
              No pending offers.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingOffers.map((a: any) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {a.crewMember?.firstName} {a.crewMember?.lastName}
                      {a.crewRole && (
                        <span className="text-fg-3 font-normal">
                          {" "}
                          — {a.crewRole.name}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-fg-3">
                      {a.project?.projectNumber} — {a.project?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge
                      variant="outline"
                      className={assignmentStatusColors[a.status] || ""}
                    >
                      {assignmentStatusLabels[a.status] || formatLabel(a.status)}
                    </Badge>
                    {a.status === "PENDING" && a.crewMember?.email && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => sendOfferMutation.mutate(a.id)}
                        disabled={sendOfferMutation.isPending}
                      >
                        <Send className="mr-1 h-3 w-3" />
                        Send
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Crew List */}
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="t-heading text-fg">All Crew Members</h3>
          <Link
            href="/crew/settings"
            className="text-xs text-fg-3 hover:text-fg flex items-center gap-1"
          >
            Roles & Skills <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <CrewTable />
      </div>

      {/* Log Time Dialog */}
      <LogTimeDialog
        open={logTimeOpen}
        onOpenChange={setLogTimeOpen}
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
          <DialogTitle>Export Timesheets</DialogTitle>
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
          <p className="text-xs text-fg-3">
            Leave empty to export all time entries.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport}>
            <Download className="mr-2 h-3.5 w-3.5" />
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();

  const [selectedCrewIds, setSelectedCrewIds] = useState<string[]>([]);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [isGeneral, setIsGeneral] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: crewList } = useQuery({
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
      let successCount = 0;
      const errors: string[] = [];
      for (const crewId of selectedCrewIds) {
        try {
          await createTimeEntry({ ...data, crewMemberId: crewId });
          successCount++;
        } catch (e: any) {
          const crew = crewList?.find((c: any) => c.id === crewId);
          errors.push(`${crew?.firstName || ""} ${crew?.lastName || ""}: ${e.message}`);
        }
      }
      if (successCount > 0) {
        toast.success(`${successCount} time ${successCount === 1 ? "entry" : "entries"} added`);
        queryClient.invalidateQueries({ queryKey: ["crew-pending-time"] });
        queryClient.invalidateQueries({ queryKey: ["crew-dashboard-stats"] });
        queryClient.invalidateQueries({ queryKey: ["crew-time-entries"] });
      }
      if (errors.length > 0) {
        toast.error(`${errors.length} failed: ${errors[0]}`);
      }
      if (successCount > 0) {
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Time</DialogTitle>
        </DialogHeader>

        {/* Step 1: Pick crew members */}
        {step === "pick" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Select Crew Members</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={selectedCrewIds.length === (filteredCrew?.length || 0) ? deselectAll : selectAll}
                >
                  {selectedCrewIds.length === (filteredCrew?.length || 0) && filteredCrew?.length
                    ? "Deselect All"
                    : "Select All"}
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
                    className={`w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-primary/30"
                        : "hover:bg-accent/50"
                    }`}
                    onClick={() => toggleCrewMember(c.id)}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {isSelected && <CheckCircle className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {c.firstName} {c.lastName}
                      </p>
                      <p className="text-xs text-fg-3">
                        {c.crewRole?.name || c.department || "No role"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {(!filteredCrew || filteredCrew.length === 0) && (
                <p className="text-sm text-fg-3 py-4 text-center">
                  No crew members found.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
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
              <p className="text-sm font-medium">
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
                variant={!isGeneral ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setIsGeneral(false);
                  form.setValue("description", "");
                }}
              >
                <Briefcase className="mr-2 h-3.5 w-3.5" />
                Project
              </Button>
              <Button
                type="button"
                variant={isGeneral ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setIsGeneral(true);
                  form.setValue("assignmentId", "");
                }}
              >
                <Clock className="mr-2 h-3.5 w-3.5" />
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
                <p className="text-xs text-fg-3 rounded-md border p-3">
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
              <Input type="date" {...form.register("date")} />
              {form.formState.errors.date && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.date.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" {...form.register("startTime")} />
                {form.formState.errors.startTime && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.startTime.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" {...form.register("endTime")} />
                {form.formState.errors.endTime && (
                  <p className="text-xs text-destructive">
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
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Log Time{selectedCrewIds.length > 1 ? ` (${selectedCrewIds.length})` : ""}
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
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  alert?: boolean;
}) {
  const content = (
    <div
      className={`rounded-lg bg-bg-surface p-4 surface-ring ${href ? "hover:bg-bg-elevated transition-colors" : ""} ${alert ? "ring-destructive/50" : ""}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{title}</span>
        <Icon
          className={`h-4 w-4 ${alert ? "text-destructive" : "text-fg-3"}`}
        />
      </div>
      <div
        className={`text-2xl font-bold ${alert ? "text-destructive" : ""}`}
      >
        {value}
      </div>
      {description && (
        <p className="text-xs text-fg-3">{description}</p>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
