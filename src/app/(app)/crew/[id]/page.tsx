"use client";

import { use, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Pencil,
  Mail,
  Phone,
  Trash2,
  Plus,
  Briefcase,
  CalendarOff,
  CalendarSync,
  CalendarDays,
  DollarSign,
  Copy,
  RefreshCw,
  Clock,
  MoreHorizontal,
  Send,
  CheckCircle,
  AlertTriangle,
  Download,
  Camera,
  X,
  LinkIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useCrewWrites } from "@/hooks/use-crew-writes";
import { useCrewAssignmentWrites } from "@/hooks/use-crew-assignment-writes";
import { sendCrewOffer } from "@/server/crew-communication";
import { useConvex, useConvexAuth } from "convex/react";
import { useCrewAvailabilityWrites } from "@/hooks/use-crew-availability-writes";
import { api as crewAvailApi } from "../../../../../convex/_generated/api";
import {
  getIcalSettings,
  enableIcalFeed,
  disableIcalFeed,
  regenerateIcalToken,
} from "@/server/crew-calendar";
import {
  getTimeEntriesForMember,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  submitTimeEntries,
  approveTimeEntries,
  disputeTimeEntry,
} from "@/server/crew-time";
import {
  crewMemberStatusLabels,
  crewMemberTypeLabels,
  assignmentStatusLabels,
  phaseLabels,
  availabilityTypeLabels,
  timeEntryStatusLabels,
  projectStatusLabels,
  formatLabel,
} from "@/lib/status-labels";
import {
  crewAvailabilitySchema,
  type CrewAvailabilityFormValues,
  crewTimeEntrySchema,
  type CrewTimeEntryFormValues,
} from "@/lib/validations/crew";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { useCanDo } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ConfirmActionMenuItem } from "@/components/ui/confirm-action-menu-item";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { getStatusColor } from "@/lib/status-colors";
import { focusRing } from "@/lib/utils";
import { formatDate, formatCurrency } from "@/lib/formatters";

// Availability-block pill styling via status-colors (§3): UNAVAILABLE = error,
// TENTATIVE = warn, PREFERRED = ok.
function availabilityPill(type: string): string {
  return getStatusColor("availabilityType", type).pill;
}

// ─── At-a-glance tile ────────────────────────────────────────────────────────

/**
 * One tile in the crew profile's at-a-glance strip — mirrors the project
 * detail summary strip (single surface, vertical dividers; DESIGN dashboard
 * rule). Calm by default: callers pass a muted node for empty/zero values
 * rather than a bare "—".
 */
function GlanceTile({
  label,
  icon: Icon,
  value,
  sub,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="bg-card px-4 py-3 sm:first:rounded-l-[var(--r)] sm:last:rounded-r-[var(--r)]">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon className="size-3.5" />
        <span className="t-overline">{label}</span>
      </div>
      <div className="mt-0.5 text-card-title font-bold tabular-nums tracking-tight text-ink">
        {value}
      </div>
      {sub && <p className="truncate text-caption text-muted">{sub}</p>}
    </div>
  );
}


export default function CrewMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const caConvex = useConvex();
  const { isAuthenticated: caAuthed } = useConvexAuth();
  const availWrites = useCrewAvailabilityWrites();
  const { data: session } = useSession();
  const canReadCrew = useCanDo("crew", "read");

  const [tabValue, setTabValue] = useState("assignments");
  const [addAvailOpen, setAddAvailOpen] = useState(false);
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [editingTimeEntry, setEditingTimeEntry] = useState<string | null>(null);
  const [deleteCrewOpen, setDeleteCrewOpen] = useState(false);
  const [regenerateTokenOpen, setRegenerateTokenOpen] = useState(false);
  const [removeAvailId, setRemoveAvailId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Slash command listener
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const { event, dialog } = ce.detail || {};

      // Tab switching
      if (event?.startsWith("switch-tab:")) {
        const tab = event.replace("switch-tab:", "");
        setTabValue(tab);
      }

      // Dialog opening
      if (dialog === "add-availability") setAddAvailOpen(true);
      if (dialog === "add-time-entry") setAddTimeOpen(true);
    };

    window.addEventListener("slash-command", handler);
    return () => window.removeEventListener("slash-command", handler);
  }, []);

  const crewWrites = useCrewWrites();
  const { data: member, isLoading, refetch: refetchMember } = useServerQuery({
    queryKey: ["crew-member", orgId, id, caAuthed],
    queryFn: () => caConvex.query(crewAvailApi.crew.memberDetail, { id, orgId: orgId as string }),
    enabled: !!orgId && caAuthed,
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => crewWrites.remove(id),
    onSuccess: () => {
      toast.success("Crew member deleted");
      // The crew roster (/crew) is Convex-reactive (useCrewMembers); the old
      // ["crew-members"] invalidation had no React Query reader left. Navigate.
      router.push("/crew");
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: availabilityRecords, refetch: refetchAvailability } = useServerQuery({
    queryKey: ["crew-availability", orgId, id],
    queryFn: () => caConvex.query(crewAvailApi.crewAvailability.memberAvailability, { orgId: orgId as string, crewMemberId: id }),
    enabled: !!orgId && caAuthed,
  });

  const { data: icalSettings, refetch: refetchIcal } = useServerQuery({
    queryKey: ["crew-ical", orgId, id],
    queryFn: () => getIcalSettings(id),
  });

  const { data: timeEntries, refetch: refetchTimeEntries } = useServerQuery({
    queryKey: ["crew-time-entries", orgId, id],
    queryFn: () => getTimeEntriesForMember(id),
  });

  const enableIcalMutation = useServerMutation({
    mutationFn: () => enableIcalFeed(id),
    onSuccess: () => {
      toast.success("iCal feed enabled");
      refetchIcal();
    },
    onError: (e) => toast.error(e.message),
  });

  const disableIcalMutation = useServerMutation({
    mutationFn: () => disableIcalFeed(id),
    onSuccess: () => {
      toast.success("iCal feed disabled");
      refetchIcal();
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateTokenMutation = useServerMutation({
    mutationFn: () => regenerateIcalToken(id),
    onSuccess: () => {
      toast.success("iCal token regenerated — old URL is now invalid");
      refetchIcal();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeAvailMutation = useServerMutation({
    mutationFn: (availId: string) => availWrites.remove(availId),
    onSuccess: () => {
      toast.success("Availability block removed");
      refetchAvailability();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteTimeMutation = useServerMutation({
    mutationFn: (entryId: string) => deleteTimeEntry(entryId),
    onSuccess: () => {
      toast.success("Time entry deleted");
      refetchTimeEntries();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitTimeMutation = useServerMutation({
    mutationFn: (ids: string[]) => submitTimeEntries(ids),
    onSuccess: (result) => {
      toast.success(`${result.count} entries submitted for approval`);
      refetchTimeEntries();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveTimeMutation = useServerMutation({
    mutationFn: (ids: string[]) => approveTimeEntries(ids),
    onSuccess: (result) => {
      toast.success(`${result.count} entries approved`);
      refetchTimeEntries();
    },
    onError: (e) => toast.error(e.message),
  });

  const disputeTimeMutation = useServerMutation({
    mutationFn: (entryId: string) => disputeTimeEntry(entryId),
    onSuccess: () => {
      toast.success("Time entry disputed");
      refetchTimeEntries();
    },
    onError: (e) => toast.error(e.message),
  });

  const asgWrites = useCrewAssignmentWrites();
  const updateAssignmentStatusMutation = useServerMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: string }) =>
      asgWrites.updateStatus(assignmentId, status),
    onSuccess: () => {
      toast.success("Assignment status updated");
      refetchMember();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAssignmentMutation = useServerMutation({
    mutationFn: (assignmentId: string) => asgWrites.remove(assignmentId),
    onSuccess: () => {
      toast.success("Assignment removed");
      refetchMember();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendOfferMutation = useServerMutation({
    mutationFn: (assignmentId: string) => sendCrewOffer(assignmentId),
    onSuccess: () => {
      toast.success("Offer sent");
      refetchMember();
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadAvatarMutation = useServerMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("crewMemberId", id);
      const res = await fetch("/api/crew/avatar", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchMember();
      toast.success("Profile picture updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeAvatarMutation = useServerMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crew/avatar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewMemberId: id }),
      });
      if (!res.ok) throw new Error("Failed to remove image");
    },
    onSuccess: () => {
      refetchMember();
      toast.success("Profile picture removed");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading)
    return <DetailPageSkeleton />;
  if (!member)
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Crew member not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      </div>
    );

  const isOwnProfile = !!(member as { isOwnProfile?: boolean }).isOwnProfile;

  // Allow access if user has crew.read permission OR is viewing their own profile
  if (!canReadCrew && !isOwnProfile) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-page-title font-display font-extrabold text-ink">Access denied</h2>
        <p className="mt-2 text-ui-text text-muted">
          You don&apos;t have permission to access this page.
        </p>
      </div>
    );
  }

  // Resolve display values — linked users inherit name/email/image from their user account
  const displayImage = member.user?.image || member.image;
  const displayName = member.user
    ? member.user.name || `${member.firstName} ${member.lastName}`
    : `${member.firstName} ${member.lastName}`;
  const displayEmail = member.user?.email || member.email;

  const fullName = displayName;
  const skills = member.skills || [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const assignments = (member as any).assignments || [];

  // Compute availability status
  const now = new Date();
  const activeUnavailable = availabilityRecords?.find(
    (av: { type: string; startDate: string | Date; endDate: string | Date }) =>
      av.type === "UNAVAILABLE" &&
      new Date(av.startDate) <= now &&
      new Date(av.endDate) >= now
  );

  // ── At-a-glance metrics (calm-by-default — computed, not "—" noise) ────────
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Upcoming shifts: assignments that haven't ended yet, in a live state.
  const upcomingAssignments = (assignments as any[]).filter((a) => {
    if (["CANCELLED", "DECLINED", "COMPLETED"].includes(a.status)) return false;
    const end = a.endDate ? new Date(a.endDate) : a.startDate ? new Date(a.startDate) : null;
    return end ? end >= todayStart : true;
  });
  const nextAssignment = [...upcomingAssignments]
    .filter((a) => a.startDate)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];

  // Active assignments = currently live (not cancelled/declined/completed).
  const activeAssignmentCount = (assignments as any[]).filter(
    (a) => !["CANCELLED", "DECLINED", "COMPLETED"].includes(a.status)
  ).length;

  // Approved hours logged this calendar month.
  const hoursThisMonth = (timeEntries ?? [])
    .filter(
      (e: { status: string; date: string | Date; totalHours: unknown }) =>
        e.status === "APPROVED" &&
        e.totalHours != null &&
        new Date(e.date) >= monthStart
    )
    .reduce(
      (sum: number, e: { totalHours: unknown }) => sum + Number(e.totalHours),
      0
    );
  const hasApprovedHours = (timeEntries ?? []).some(
    (e: { status: string }) => e.status === "APPROVED"
  );

  // Headline rate: prefer day rate, fall back to hourly.
  const rate =
    member.defaultDayRate != null
      ? { value: Number(member.defaultDayRate), unit: "/day" }
      : member.defaultHourlyRate != null
        ? { value: Number(member.defaultHourlyRate), unit: "/hr" }
        : null;

  // ── Mobile card column layouts for the sub-tables (rendered below `md`) ────
  const assignmentColumns: ColumnDef<any>[] = [
    {
      id: "project",
      header: "Project",
      mobile: "title",
      cell: (a) => (
        <Link
          href={`/projects/${a.project.id}`}
          className={`font-medium text-ink hover:text-red rounded-[var(--r)] ${focusRing}`}
        >
          <div className="flex items-center gap-2">
            <Briefcase className="h-3.5 w-3.5 text-muted" />
            <div>
              <div>{a.project.name}</div>
              <div className="text-caption text-muted font-mono">
                {a.project.projectNumber}
              </div>
            </div>
          </div>
        </Link>
      ),
    },
    {
      id: "role",
      header: "Role",
      mobile: "badge",
      cell: (a) =>
        a.crewRole ? (
          <Badge
            status="neutral"
            style={
              a.crewRole.color
                ? {
                    color: a.crewRole.color,
                    backgroundColor: `${a.crewRole.color}26`,
                  }
                : undefined
            }
          >
            {a.crewRole.name}
          </Badge>
        ) : (
          <span className="text-muted">{"—"}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (a) => (
        <StatusIndicator
          category="assignment"
          value={a.status}
          variant="pill"
          label={assignmentStatusLabels[a.status] || formatLabel(a.status)}
        />
      ),
    },
    {
      id: "phase",
      header: "Phase",
      mobile: "meta",
      cell: (a) => (a.phase ? phaseLabels[a.phase] || a.phase : "—"),
    },
    {
      id: "dates",
      header: "Dates",
      mobile: "meta",
      cell: (a) => (
        <span className="tabular-nums">
          {formatDate(a.startDate)}
          {a.endDate && a.endDate !== a.startDate
            ? ` – ${formatDate(a.endDate)}`
            : ""}
        </span>
      ),
    },
    {
      id: "projectStatus",
      header: "Project status",
      mobile: "meta",
      cell: (a) => (
        <StatusIndicator
          category="project"
          value={a.project.status}
          label={projectStatusLabels[a.project.status] || a.project.status}
          variant="pill"
        />
      ),
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (a) => {
        const statusTransitions: Record<string, string[]> = {
          PENDING: ["OFFERED", "CONFIRMED", "CANCELLED"],
          OFFERED: ["CONFIRMED", "CANCELLED"],
          ACCEPTED: ["CONFIRMED", "CANCELLED"],
          DECLINED: ["PENDING"],
          CONFIRMED: ["COMPLETED", "CANCELLED"],
          CANCELLED: ["PENDING"],
          COMPLETED: [],
        };
        const availableStatuses = statusTransitions[a.status] || [];
        return (
          <CanDo resource="crew" action="update">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="touch-target size-9" aria-label="Assignment actions">
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {a.status === "PENDING" && member.email && (
                    <DropdownMenuItem
                      onClick={() => sendOfferMutation.mutate(a.id)}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Send offer
                    </DropdownMenuItem>
                  )}
                  {availableStatuses.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() =>
                        updateAssignmentStatusMutation.mutate({
                          assignmentId: a.id,
                          status: s,
                        })
                      }
                    >
                      {s === "CONFIRMED" && <CheckCircle className="mr-2 h-4 w-4" />}
                      {s === "CANCELLED" && <AlertTriangle className="mr-2 h-4 w-4" />}
                      {!["CONFIRMED", "CANCELLED"].includes(s) && <Briefcase className="mr-2 h-4 w-4" />}
                      {assignmentStatusLabels[s] || formatLabel(s)}
                    </DropdownMenuItem>
                  ))}
                  <CanDo resource="crew" action="delete">
                    <ConfirmActionMenuItem
                      icon={<Trash2 className="mr-2 h-4 w-4" />}
                      onConfirm={() => deleteAssignmentMutation.mutate(a.id)}
                    >
                      Remove assignment
                    </ConfirmActionMenuItem>
                  </CanDo>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CanDo>
        );
      },
    },
  ];

  const availabilityColumns: ColumnDef<any>[] = [
    {
      id: "dates",
      header: "Dates",
      mobile: "title",
      cell: (av) => (
        <span className="tabular-nums">
          {formatDate(av.startDate)}
          {av.endDate !== av.startDate
            ? ` – ${formatDate(av.endDate)}`
            : ""}
        </span>
      ),
    },
    {
      id: "type",
      header: "Type",
      mobile: "badge",
      cell: (av) => (
        <Badge status="neutral" className={availabilityPill(av.type)}>
          <CalendarOff className="mr-1 h-3 w-3" />
          {availabilityTypeLabels[av.type] || formatLabel(av.type)}
        </Badge>
      ),
    },
    {
      id: "time",
      header: "Time",
      mobile: "meta",
      cell: (av) =>
        av.isAllDay
          ? "All day"
          : `${av.startTime || ""} – ${av.endTime || ""}`,
    },
    {
      id: "reason",
      header: "Reason",
      mobile: "meta",
      cell: (av) => av.reason || "—",
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (av) => (
        <CanDo resource="crew" action="update">
          <Button
            variant="ghost"
            size="icon"
            className="touch-target size-9 text-t-out hover:bg-out-soft"
            aria-label="Remove availability block"
            onClick={() => setRemoveAvailId(av.id)}
          >
            <Trash2 className="size-5" />
          </Button>
        </CanDo>
      ),
    },
  ];

  const timeEntryColumns: ColumnDef<any>[] = [
    {
      id: "date",
      header: "Date",
      mobile: "title",
      cell: (entry) => (
        <span className="tabular-nums">{formatDate(entry.date)}</span>
      ),
    },
    {
      id: "project",
      header: "Project",
      mobile: "subtitle",
      cell: (entry) =>
        entry.assignment ? (
          <>
            {entry.assignment.project?.projectNumber} —{" "}
            {entry.assignment.project?.name}
          </>
        ) : (
          <span className="text-muted italic">
            {entry.description || "General"}
          </span>
        ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (entry) => (
        <StatusIndicator
          category="timeEntry"
          value={entry.status}
          label={timeEntryStatusLabels[entry.status] || formatLabel(entry.status)}
          variant="pill"
        />
      ),
    },
    {
      id: "role",
      header: "Role",
      mobile: "meta",
      cell: (entry) => entry.assignment?.crewRole?.name || "—",
    },
    {
      id: "start",
      header: "Start",
      mobile: "meta",
      cell: (entry) => (
        <span className="font-mono tabular-nums">{entry.startTime}</span>
      ),
    },
    {
      id: "end",
      header: "End",
      mobile: "meta",
      cell: (entry) => (
        <span className="font-mono tabular-nums">{entry.endTime}</span>
      ),
    },
    {
      id: "break",
      header: "Break",
      mobile: "meta",
      cell: (entry) =>
        entry.breakMinutes > 0 ? `${entry.breakMinutes}m` : "—",
    },
    {
      id: "hours",
      header: "Hours",
      mobile: "meta",
      cell: (entry) => (
        <span className="font-mono tabular-nums">
          {entry.totalHours != null
            ? `${Number(entry.totalHours).toFixed(1)}h`
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (entry) =>
        entry.status !== "EXPORTED" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="touch-target size-9" aria-label="Time entry actions">
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setEditingTimeEntry(entry.id);
                    setAddTimeOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {["DRAFT", "DISPUTED"].includes(entry.status) && (
                  <DropdownMenuItem
                    onClick={() => submitTimeMutation.mutate([entry.id])}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Submit
                  </DropdownMenuItem>
                )}
                {["SUBMITTED", "DISPUTED"].includes(entry.status) && (
                  <DropdownMenuItem
                    onClick={() => approveTimeMutation.mutate([entry.id])}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve
                  </DropdownMenuItem>
                )}
                {["SUBMITTED", "APPROVED"].includes(entry.status) && (
                  <DropdownMenuItem
                    onClick={() => disputeTimeMutation.mutate(entry.id)}
                  >
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Dispute
                  </DropdownMenuItem>
                )}
                <ConfirmActionMenuItem
                  icon={<Trash2 className="mr-2 h-4 w-4" />}
                  onConfirm={() => deleteTimeMutation.mutate(entry.id)}
                >
                  Delete
                </ConfirmActionMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <>
      <PageMeta title={fullName} />
      <FadeIn>
        <div className="space-y-6">
          {/* Own profile banner */}
          {isOwnProfile && (
            <div className="rounded-[var(--r)] border border-line border-l-2 border-l-blue bg-card px-4 py-3 text-ui-text text-ink-2 flex items-center gap-2">
              <CheckCircle className="size-4 shrink-0 text-blue" />
              You are viewing your own crew profile.
            </div>
          )}

          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <Breadcrumb className="mb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link href="/crew" />}>Crew</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{fullName}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                {/* Profile Picture */}
                <div className="relative group shrink-0">
                  <PersonAvatar
                    name={fullName}
                    src={displayImage || undefined}
                    className="size-16 text-lg"
                  />
                  {/* Only show upload controls for crew without a linked user (linked users sync from account) */}
                  {!member.user && (
                    <CanDo resource="crew" action="update">
                      {/* Pointer devices get a hover overlay. Touch has no hover, and a
                          permanent full-bleed overlay would bury the avatar — so coarse
                          pointers get a 44px camera badge in the corner instead. */}
                      <button
                        type="button"
                        aria-label="Change profile picture"
                        className={`absolute inset-0 flex items-center justify-center rounded-full bg-paper/70 opacity-0 transition-opacity cursor-pointer group-hover:opacity-100 pointer-coarse:inset-auto pointer-coarse:-bottom-1 pointer-coarse:-right-1 pointer-coarse:size-11 pointer-coarse:border-2 pointer-coarse:border-border pointer-coarse:bg-paper pointer-coarse:opacity-100 ${focusRing}`}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <Camera className="size-5 text-ink" />
                      </button>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadAvatarMutation.mutate(file);
                          e.target.value = "";
                        }}
                      />
                      {member.image && (
                        <button
                          type="button"
                          aria-label="Remove profile picture"
                          className={`absolute -top-1 -right-1 rounded-full bg-red text-white p-0.5 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:p-2.5 pointer-coarse:opacity-100 ${focusRing}`}
                          onClick={() => removeAvatarMutation.mutate()}
                          title="Remove photo"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </CanDo>
                  )}
                  {uploadAvatarMutation.isPending && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-paper/70">
                      <span className="size-5 motion-safe:animate-spin rounded-full border-2 border-ink border-t-transparent" />
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-page-title font-display font-extrabold tracking-tight text-ink">{fullName}</h1>
                    <StatusIndicator
                      category="crewMember"
                      value={member.status}
                      label={crewMemberStatusLabels[member.status] || formatLabel(member.status)}
                    />
                    <Badge status="neutral">
                      {crewMemberTypeLabels[member.type] || formatLabel(member.type)}
                    </Badge>
                    {activeUnavailable ? (
                      <Badge status="overbooked" className="gap-1">
                        <CalendarOff className="h-3 w-3" />
                        Unavailable
                      </Badge>
                    ) : (
                      <Badge status="ok" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Available
                      </Badge>
                    )}
                  </div>
                  <p className="text-ui-text text-muted mt-0.5">
                    {member.crewRole?.name || "No role assigned"}
                    {member.department && <> &middot; {member.department}</>}
                  </p>
                  {/* Contact quick-actions — only render what exists (no "—" noise) */}
                  {(displayEmail || member.phone || (member.user && !isOwnProfile)) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption">
                      {displayEmail && (
                        <a
                          href={`mailto:${displayEmail}`}
                          className={`flex items-center gap-1.5 text-link hover:underline rounded-[var(--r)] ${focusRing}`}
                        >
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{displayEmail}</span>
                        </a>
                      )}
                      {member.phone && (
                        <a
                          href={`tel:${member.phone}`}
                          className={`flex items-center gap-1.5 text-link hover:underline rounded-[var(--r)] ${focusRing}`}
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {member.phone}
                        </a>
                      )}
                      {member.user && !isOwnProfile && (
                        <span className="flex items-center gap-1 text-muted">
                          <LinkIcon className="h-3 w-3" />
                          Linked to {member.user.name || member.user.email}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <CanDo resource="crew" action="update">
                <div className="flex gap-2">
                  <Button variant="line" asChild>
                    <Link href={`/crew/${id}/edit`}>
                      <Pencil className="size-5" />
                      Edit
                    </Link>
                  </Button>
                  <CanDo resource="crew" action="delete">
                    <Button
                      variant="line"
                      className="border-t-out/40 text-t-out hover:bg-red hover:text-white hover:border-red"
                      onClick={() => setDeleteCrewOpen(true)}
                    >
                      <Trash2 className="size-5" />
                      Delete
                    </Button>
                  </CanDo>
                </div>
              </CanDo>
            </div>
          </div>

          {/* ── At-a-glance strip ──────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-line bg-line shadow-[var(--sh-card)] sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-line sm:bg-card">
            <GlanceTile
              label="Next shift"
              icon={CalendarDays}
              value={
                nextAssignment?.startDate ? (
                  formatDate(nextAssignment.startDate)
                ) : (
                  <span className="text-muted">None booked</span>
                )
              }
              sub={
                nextAssignment
                  ? `${nextAssignment.project?.projectNumber ?? ""} ${nextAssignment.project?.name ?? ""}`.trim()
                  : undefined
              }
            />
            <GlanceTile
              label="Hours this month"
              icon={Clock}
              value={
                hasApprovedHours ? (
                  `${hoursThisMonth.toFixed(1)}h`
                ) : (
                  <span className="text-muted">0h</span>
                )
              }
              sub="Approved"
            />
            <GlanceTile
              label="Active assignments"
              icon={Briefcase}
              value={
                activeAssignmentCount > 0 ? (
                  activeAssignmentCount
                ) : (
                  <span className="text-muted">0</span>
                )
              }
              sub={`${assignments.length} total`}
            />
            <GlanceTile
              label="Rate"
              icon={DollarSign}
              value={
                rate ? (
                  <span>
                    {formatCurrency(rate.value)}
                    <span className="text-caption font-normal text-muted">{rate.unit}</span>
                  </span>
                ) : (
                  <span className="text-muted">Not set</span>
                )
              }
              sub={
                member.overtimeMultiplier != null
                  ? `${Number(member.overtimeMultiplier)}× OT`
                  : undefined
              }
            />
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* Main content */}
            <DetailMain>
              <Tabs value={tabValue} onValueChange={setTabValue}>
                <TabsList>
                  <TabsTrigger value="assignments">
                    Assignments ({assignments.length})
                  </TabsTrigger>
                  <TabsTrigger value="availability">
                    Availability ({availabilityRecords?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="time-entries">
                    Time ({timeEntries?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                </TabsList>

                {/* Assignments Tab */}
                <TabsContent value="assignments" className="mt-4">
                  <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
                    <h3 className="text-card-title font-bold text-ink mb-4">Project assignments</h3>
                      {assignments.length === 0 ? (
                        <EmptyState
                          title="No project assignments yet"
                          description="Assign this crew member to a project from the planner or a project's crew tab."
                        />
                      ) : (
                        <>
                        <div className="hidden rounded-[var(--r)] border border-line md:block">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Project</TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Role
                                </TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Phase
                                </TableHead>
                                <TableHead>Dates</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Project status
                                </TableHead>
                                <TableHead className="w-[50px]" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {assignments.map(
                                (a: {
                                  id: string;
                                  status: string;
                                  phase: string | null;
                                  startDate: string | null;
                                  endDate: string | null;
                                  project: {
                                    id: string;
                                    name: string;
                                    projectNumber: string;
                                    status: string;
                                  };
                                  crewRole: {
                                    name: string;
                                    color: string | null;
                                  } | null;
                                }) => {
                                  const statusTransitions: Record<string, string[]> = {
                                    PENDING: ["OFFERED", "CONFIRMED", "CANCELLED"],
                                    OFFERED: ["CONFIRMED", "CANCELLED"],
                                    ACCEPTED: ["CONFIRMED", "CANCELLED"],
                                    DECLINED: ["PENDING"],
                                    CONFIRMED: ["COMPLETED", "CANCELLED"],
                                    CANCELLED: ["PENDING"],
                                    COMPLETED: [],
                                  };
                                  const availableStatuses = statusTransitions[a.status] || [];
                                  return (
                                  <TableRow key={a.id}>
                                    <TableCell>
                                      <Link
                                        href={`/projects/${a.project.id}`}
                                        className={`font-medium text-ink hover:text-red rounded-[var(--r)] ${focusRing}`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <Briefcase className="h-3.5 w-3.5 text-muted" />
                                          <div>
                                            <div>{a.project.name}</div>
                                            <div className="text-caption text-muted font-mono">
                                              {a.project.projectNumber}
                                            </div>
                                          </div>
                                        </div>
                                      </Link>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                      {a.crewRole ? (
                                        <Badge
                                          status="neutral"
                                          style={
                                            a.crewRole.color
                                              ? {
                                                  color: a.crewRole.color,
                                                  backgroundColor: `${a.crewRole.color}26`,
                                                }
                                              : undefined
                                          }
                                        >
                                          {a.crewRole.name}
                                        </Badge>
                                      ) : (
                                        <span className="text-muted">
                                          {"\u2014"}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-table-cell text-ink-2">
                                      {a.phase
                                        ? phaseLabels[a.phase] || a.phase
                                        : "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-table-cell tabular-nums text-ink-2">
                                      {formatDate(a.startDate)}
                                      {a.endDate && a.endDate !== a.startDate
                                        ? ` \u2013 ${formatDate(a.endDate)}`
                                        : ""}
                                    </TableCell>
                                    <TableCell>
                                      <StatusIndicator
                                        category="assignment"
                                        value={a.status}
                                        variant="pill"
                                        label={assignmentStatusLabels[a.status] || formatLabel(a.status)}
                                      />
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                      <StatusIndicator category="project" value={a.project.status} label={projectStatusLabels[a.project.status] || a.project.status} variant="pill" />
                                    </TableCell>
                                    <TableCell>
                                      <CanDo resource="crew" action="update">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="touch-target size-9" aria-label="Assignment actions">
                                              <MoreHorizontal className="size-5" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuGroup>
                                              {a.status === "PENDING" && member.email && (
                                                <DropdownMenuItem
                                                  onClick={() => sendOfferMutation.mutate(a.id)}
                                                >
                                                  <Send className="mr-2 h-4 w-4" />
                                                  Send offer
                                                </DropdownMenuItem>
                                              )}
                                              {availableStatuses.map((s) => (
                                                <DropdownMenuItem
                                                  key={s}
                                                  onClick={() =>
                                                    updateAssignmentStatusMutation.mutate({
                                                      assignmentId: a.id,
                                                      status: s,
                                                    })
                                                  }
                                                >
                                                  {s === "CONFIRMED" && <CheckCircle className="mr-2 h-4 w-4" />}
                                                  {s === "CANCELLED" && <AlertTriangle className="mr-2 h-4 w-4" />}
                                                  {!["CONFIRMED", "CANCELLED"].includes(s) && <Briefcase className="mr-2 h-4 w-4" />}
                                                  {assignmentStatusLabels[s] || formatLabel(s)}
                                                </DropdownMenuItem>
                                              ))}
                                              <CanDo resource="crew" action="delete">
                                                <ConfirmActionMenuItem
                                                  icon={<Trash2 className="mr-2 h-4 w-4" />}
                                                  onConfirm={() => deleteAssignmentMutation.mutate(a.id)}
                                                >
                                                  Remove assignment
                                                </ConfirmActionMenuItem>
                                              </CanDo>
                                            </DropdownMenuGroup>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </CanDo>
                                    </TableCell>
                                  </TableRow>
                                  );
                                }
                              )}
                            </TableBody>
                          </Table>
                        </div>
                        <MobileCardList
                          className="md:hidden"
                          data={assignments}
                          columns={assignmentColumns}
                          getRowId={(a) => a.id}
                        />
                        </>
                      )}
                  </div>
                </TabsContent>

                {/* Availability Tab */}
                <TabsContent value="availability" className="mt-4">
                  <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-card-title font-bold text-ink">Availability blocks</h3>
                      <CanDo resource="crew" action="update">
                        <Button
                          size="sm"
                          variant="line"
                          onClick={() => setAddAvailOpen(true)}
                        >
                          <Plus className="size-5" />
                          Add block
                        </Button>
                      </CanDo>
                    </div>
                      {!availabilityRecords || availabilityRecords.length === 0 ? (
                        <EmptyState
                          title="No availability blocks set"
                          description="Add blocks to indicate when this crew member is unavailable, tentative, or preferred."
                        />
                      ) : (
                        <>
                        <div className="hidden rounded-[var(--r)] border border-line md:block">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Type</TableHead>
                                <TableHead>Dates</TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Time
                                </TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Reason
                                </TableHead>
                                <TableHead className="w-10" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {availabilityRecords.map(
                                (av: {
                                  id: string;
                                  type: string;
                                  startDate: string | Date;
                                  endDate: string | Date;
                                  isAllDay: boolean;
                                  startTime: string | null;
                                  endTime: string | null;
                                  reason: string | null;
                                }) => (
                                  <TableRow key={av.id}>
                                    <TableCell>
                                      <Badge
                                        status="neutral"
                                        className={availabilityPill(av.type)}
                                      >
                                        <CalendarOff className="mr-1 h-3 w-3" />
                                        {availabilityTypeLabels[av.type] ||
                                          formatLabel(av.type)}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-table-cell tabular-nums text-ink-2">
                                      {formatDate(av.startDate)}
                                      {av.endDate !== av.startDate
                                        ? ` \u2013 ${formatDate(av.endDate)}`
                                        : ""}
                                    </TableCell>
                                    <TableCell className="text-table-cell text-muted hidden md:table-cell">
                                      {av.isAllDay
                                        ? "All day"
                                        : `${av.startTime || ""} \u2013 ${av.endTime || ""}`}
                                    </TableCell>
                                    <TableCell className="text-table-cell text-muted hidden md:table-cell">
                                      {av.reason || "\u2014"}
                                    </TableCell>
                                    <TableCell>
                                      <CanDo resource="crew" action="update">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="touch-target size-9 text-t-out hover:bg-out-soft"
                                          aria-label="Remove availability block"
                                          onClick={() => setRemoveAvailId(av.id)}
                                        >
                                          <Trash2 className="size-5" />
                                        </Button>
                                      </CanDo>
                                    </TableCell>
                                  </TableRow>
                                )
                              )}
                            </TableBody>
                          </Table>
                        </div>
                        <MobileCardList
                          className="md:hidden"
                          data={availabilityRecords}
                          columns={availabilityColumns}
                          getRowId={(av) => av.id}
                        />
                        </>
                      )}
                  </div>
                </TabsContent>

                {/* Time Entries Tab */}
                <TabsContent value="time-entries" className="mt-4">
                  <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-card-title font-bold text-ink flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Time entries
                      </h3>
                      <div className="flex gap-2">
                        {timeEntries && timeEntries.length > 0 && (
                          <Button variant="line" size="sm" asChild>
                            <a
                              href={`/api/crew/timesheet?crewMemberId=${id}`}
                              download
                            >
                              <Download className="size-5" />
                              Export CSV
                            </a>
                          </Button>
                        )}
                        {/* Bulk submit all drafts */}
                        {timeEntries &&
                          timeEntries.filter(
                            (e: { status: string }) => e.status === "DRAFT"
                          ).length > 0 && (
                            <CanDo resource="crew" action="update">
                              <Button
                                variant="line"
                                size="sm"
                                onClick={() => {
                                  const draftIds = timeEntries
                                    .filter(
                                      (e: { status: string }) =>
                                        e.status === "DRAFT"
                                    )
                                    .map((e: { id: string }) => e.id);
                                  submitTimeMutation.mutate(draftIds);
                                }}
                                loading={submitTimeMutation.isPending}
                              >
                                <Send className="size-5" />
                                Submit all drafts
                              </Button>
                            </CanDo>
                          )}
                        {/* Bulk approve all submitted */}
                        {timeEntries &&
                          timeEntries.filter(
                            (e: { status: string }) => e.status === "SUBMITTED"
                          ).length > 0 && (
                            <CanDo resource="crew" action="update">
                              <Button
                                variant="line"
                                size="sm"
                                onClick={() => {
                                  const submittedIds = timeEntries
                                    .filter(
                                      (e: { status: string }) =>
                                        e.status === "SUBMITTED"
                                    )
                                    .map((e: { id: string }) => e.id);
                                  approveTimeMutation.mutate(submittedIds);
                                }}
                                loading={approveTimeMutation.isPending}
                              >
                                <CheckCircle className="size-5" />
                                Approve all
                              </Button>
                            </CanDo>
                          )}
                        <CanDo resource="crew" action="create">
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditingTimeEntry(null);
                              setAddTimeOpen(true);
                            }}
                          >
                            <Plus className="size-5" />
                            Log time
                          </Button>
                        </CanDo>
                      </div>
                    </div>
                      {!timeEntries || timeEntries.length === 0 ? (
                        <EmptyState
                          title="No time entries recorded yet"
                          description="Log time against a project assignment or a general shift."
                        />
                      ) : (
                        <>
                        <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Project</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Start</TableHead>
                              <TableHead>End</TableHead>
                              <TableHead>Break</TableHead>
                              <TableHead>Hours</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="w-10"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {/* eslint-disable @typescript-eslint/no-explicit-any */}
                            {timeEntries.map((entry: any) => (
                              <TableRow key={entry.id}>
                                <TableCell className="text-table-cell tabular-nums text-ink-2">
                                  {formatDate(entry.date)}
                                </TableCell>
                                <TableCell className="text-table-cell text-ink-2">
                                  {entry.assignment ? (
                                    <>
                                      {entry.assignment.project?.projectNumber} —{" "}
                                      {entry.assignment.project?.name}
                                    </>
                                  ) : (
                                    <span className="text-muted italic">
                                      {entry.description || "General"}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-table-cell text-muted">
                                  {entry.assignment?.crewRole?.name || "—"}
                                </TableCell>
                                <TableCell className="text-table-cell font-mono tabular-nums text-ink-2">
                                  {entry.startTime}
                                </TableCell>
                                <TableCell className="text-table-cell font-mono tabular-nums text-ink-2">
                                  {entry.endTime}
                                </TableCell>
                                <TableCell className="text-table-cell tabular-nums text-ink-2">
                                  {entry.breakMinutes > 0
                                    ? `${entry.breakMinutes}m`
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-table-cell font-mono tabular-nums text-ink">
                                  {entry.totalHours != null
                                    ? `${Number(entry.totalHours).toFixed(1)}h`
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  <StatusIndicator
                                    category="timeEntry"
                                    value={entry.status}
                                    label={timeEntryStatusLabels[entry.status] ||
                                      formatLabel(entry.status)}
                                    variant="pill"
                                  />
                                </TableCell>
                                <TableCell>
                                  {entry.status !== "EXPORTED" && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="touch-target size-9" aria-label="Time entry actions">
                                          <MoreHorizontal className="size-5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuGroup>
                                          <DropdownMenuItem
                                            onClick={() => {
                                              setEditingTimeEntry(entry.id);
                                              setAddTimeOpen(true);
                                            }}
                                          >
                                            <Pencil className="mr-2 h-4 w-4" />
                                            Edit
                                          </DropdownMenuItem>
                                          {["DRAFT", "DISPUTED"].includes(entry.status) && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                submitTimeMutation.mutate([entry.id])
                                              }
                                            >
                                              <Send className="mr-2 h-4 w-4" />
                                              Submit
                                            </DropdownMenuItem>
                                          )}
                                          {["SUBMITTED", "DISPUTED"].includes(entry.status) && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                approveTimeMutation.mutate([
                                                  entry.id,
                                                ])
                                              }
                                            >
                                              <CheckCircle className="mr-2 h-4 w-4" />
                                              Approve
                                            </DropdownMenuItem>
                                          )}
                                          {["SUBMITTED", "APPROVED"].includes(entry.status) && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                disputeTimeMutation.mutate(
                                                  entry.id
                                                )
                                              }
                                            >
                                              <AlertTriangle className="mr-2 h-4 w-4" />
                                              Dispute
                                            </DropdownMenuItem>
                                          )}
                                          <ConfirmActionMenuItem
                                            icon={<Trash2 className="mr-2 h-4 w-4" />}
                                            onConfirm={() =>
                                              deleteTimeMutation.mutate(entry.id)
                                            }
                                          >
                                            Delete
                                          </ConfirmActionMenuItem>
                                        </DropdownMenuGroup>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        </div>
                        <MobileCardList
                          className="md:hidden"
                          data={timeEntries}
                          columns={timeEntryColumns}
                          getRowId={(entry) => entry.id}
                        />
                        </>
                      )}
                  </div>
                </TabsContent>

                {/* Calendar Tab */}
                <TabsContent value="calendar" className="mt-4">
                  <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
                    <h3 className="text-card-title font-bold text-ink flex items-center gap-2 mb-4">
                      <CalendarSync className="h-4 w-4" />
                      iCal feed
                    </h3>
                    <div className="space-y-4">
                      <p className="text-ui-text text-muted">
                        Enable an iCal feed URL that can be subscribed to from Google
                        Calendar, Apple Calendar, Outlook, or any calendar app. The
                        feed includes all confirmed assignments.
                      </p>

                      {icalSettings?.icalEnabled && icalSettings?.icalToken ? (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-caption text-muted">
                              Feed URL
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                readOnly
                                value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/crew/calendar/${icalSettings.icalToken}`}
                                className="font-mono text-caption"
                              />
                              <Button
                                variant="line"
                                size="icon"
                                aria-label="Copy feed URL"
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/api/crew/calendar/${icalSettings.icalToken}`
                                  );
                                  toast.success("Feed URL copied to clipboard");
                                }}
                              >
                                <Copy className="size-5" />
                              </Button>
                            </div>
                          </div>

                          <CanDo resource="crew" action="update">
                            <div className="flex gap-2">
                              <Button
                                variant="line"
                                size="sm"
                                onClick={() => setRegenerateTokenOpen(true)}
                                loading={regenerateTokenMutation.isPending}
                              >
                                <RefreshCw className="size-5" />
                                Regenerate URL
                              </Button>
                              <Button
                                variant="line"
                                size="sm"
                                className="text-warn hover:bg-warn-soft"
                                onClick={() => disableIcalMutation.mutate()}
                                loading={disableIcalMutation.isPending}
                              >
                                Disable feed
                              </Button>
                            </div>
                          </CanDo>
                        </div>
                      ) : (
                        <CanDo resource="crew" action="update">
                          <Button
                            variant="line"
                            onClick={() => enableIcalMutation.mutate()}
                            loading={enableIcalMutation.isPending}
                          >
                            <CalendarSync className="size-5" />
                            Enable iCal feed
                          </Button>
                        </CanDo>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <DetailSidebar>
                {/* Contact */}
                <SidebarSection title="Contact">
                  <div className="space-y-2 text-ui-text">
                    {displayEmail && (
                      <div className="flex items-center gap-2 text-muted">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={`mailto:${displayEmail}`}
                          className={`text-link hover:underline truncate rounded-[var(--r)] ${focusRing}`}
                        >
                          {displayEmail}
                        </a>
                      </div>
                    )}
                    {member.phone && (
                      <div className="flex items-center gap-2 text-muted">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a href={`tel:${member.phone}`} className={`text-link hover:underline rounded-[var(--r)] ${focusRing}`}>
                          {member.phone}
                        </a>
                      </div>
                    )}
                    {member.address && (
                      <p className="text-ui-text text-muted whitespace-pre-wrap">
                        {member.address}
                      </p>
                    )}
                    {!displayEmail && !member.phone && !member.address && (
                      <p className="text-muted">No contact info</p>
                    )}
                  </div>
                </SidebarSection>

                {/* Role & Department */}
                <SidebarSection title="Role & department">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <span className="text-muted">Role</span>
                      {member.crewRole?.name ? (
                        <span className="font-medium text-ink">{member.crewRole.name}</span>
                      ) : (
                        <span className="text-faint">{"\u2014"}</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Department</span>
                      {member.department ? (
                        <span className="font-medium text-ink">{member.department}</span>
                      ) : (
                        <span className="text-faint">{"\u2014"}</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Type</span>
                      <span className="font-medium text-ink">
                        {crewMemberTypeLabels[member.type] || formatLabel(member.type)}
                      </span>
                    </div>
                    {member.emergencyContactName && (
                      <>
                        <div className="mt-2 pt-2 border-t border-line">
                          <p className="text-caption text-muted mb-1">Emergency contact</p>
                          <p className="font-medium text-ink">{member.emergencyContactName}</p>
                          {member.emergencyContactPhone && (
                            <div className="flex items-center gap-2 text-muted mt-0.5">
                              <Phone className="h-3 w-3" />
                              <a
                                href={`tel:${member.emergencyContactPhone}`}
                                className={`text-link hover:underline text-caption rounded-[var(--r)] ${focusRing}`}
                              >
                                {member.emergencyContactPhone}
                              </a>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </SidebarSection>

                {/* Rates */}
                <SidebarSection title="Rates">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <span className="text-muted">Day rate</span>
                      {member.defaultDayRate != null ? (
                        <span className="font-medium font-mono tabular-nums text-ink">
                          {`$${Number(member.defaultDayRate).toFixed(2)}`}
                        </span>
                      ) : (
                        <span className="text-faint">{"\u2014"}</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Hourly rate</span>
                      {member.defaultHourlyRate != null ? (
                        <span className="font-medium font-mono tabular-nums text-ink">
                          {`$${Number(member.defaultHourlyRate).toFixed(2)}`}
                        </span>
                      ) : (
                        <span className="text-faint">{"\u2014"}</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">OT multiplier</span>
                      {member.overtimeMultiplier != null ? (
                        <span className="font-medium font-mono tabular-nums text-ink">
                          {`${Number(member.overtimeMultiplier)}x`}
                        </span>
                      ) : (
                        <span className="text-faint">{"\u2014"}</span>
                      )}
                    </div>
                  </div>
                </SidebarSection>
                {/* Skills */}
                {skills.length > 0 && (
                  <SidebarSection title="Skills">
                    <div className="flex flex-wrap gap-1">
                      {skills.map(
                        (skill: {
                          id: string;
                          name: string;
                          category: string | null;
                        }) => (
                          <Badge key={skill.id} status="neutral">
                            {skill.name}
                          </Badge>
                        )
                      )}
                    </div>
                  </SidebarSection>
                )}

                {/* Tags */}
                {member.tags?.length > 0 && (
                  <SidebarSection title="Tags">
                    <div className="flex flex-wrap gap-1">
                      {member.tags.map((tag: string) => (
                        <Badge key={tag} status="neutral">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Availability Status */}
                <SidebarSection title="Availability">
                  <div className="text-ui-text">
                    {activeUnavailable ? (
                      <div className="flex items-center gap-2 text-t-out">
                        <CalendarOff className="h-3.5 w-3.5" />
                        <span>Currently unavailable</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-ok">
                        <CheckCircle className="h-3.5 w-3.5" />
                        <span>Available</span>
                      </div>
                    )}
                    {availabilityRecords && availabilityRecords.length > 0 && (
                      <p className="text-caption text-muted mt-1">
                        {availabilityRecords.length} block{availabilityRecords.length !== 1 ? "s" : ""} scheduled
                      </p>
                    )}
                  </div>
                </SidebarSection>

                {/* Notes */}
                {member.notes && (
                  <SidebarSection title="Notes">
                    <p className="text-ui-text whitespace-pre-wrap text-muted">{member.notes}</p>
                  </SidebarSection>
                )}

                {/* Activity Timeline */}
                <SidebarSection title="Activity" divider={false}>
                  <ActivityTimeline entityType="crew" entityId={id} />
                </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>

      <DeleteDialog
        open={deleteCrewOpen}
        onOpenChange={setDeleteCrewOpen}
        title="Delete this crew member?"
        description="Removes the crew member from your roster. Past assignments and timesheets are preserved but unlinked. This cannot be undone."
        confirmLabel="Delete crew member"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteCrewOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
      <DeleteDialog
        open={regenerateTokenOpen}
        onOpenChange={setRegenerateTokenOpen}
        title="Regenerate self-service token?"
        description="The current self-service URL stops working immediately. You'll need to send the new URL to this crew member."
        confirmLabel="Regenerate token"
        onConfirm={() => {
          regenerateTokenMutation.mutate();
          setRegenerateTokenOpen(false);
        }}
        pending={regenerateTokenMutation.isPending}
      />
      <DeleteDialog
        open={!!removeAvailId}
        onOpenChange={(open) => !open && setRemoveAvailId(null)}
        title="Remove this availability block?"
        description="The block is removed from the planner. This does not affect existing assignments."
        confirmLabel="Remove block"
        onConfirm={() => {
          if (removeAvailId) {
            removeAvailMutation.mutate(removeAvailId);
            setRemoveAvailId(null);
          }
        }}
        pending={removeAvailMutation.isPending}
      />
      {/* Add Availability Dialog */}
      <AddAvailabilityDialog
        crewMemberId={id}
        open={addAvailOpen}
        onOpenChange={setAddAvailOpen}
        onSaved={refetchAvailability}
      />

      {/* Add/Edit Time Entry Dialog */}
      <AddTimeEntryDialog
        crewMemberId={id}
        assignments={assignments}
        onSaved={refetchTimeEntries}
        open={addTimeOpen}
        onOpenChange={(open) => {
          setAddTimeOpen(open);
          if (!open) setEditingTimeEntry(null);
        }}
        editingEntry={
          editingTimeEntry
            ? timeEntries?.find(
                (e: { id: string }) => e.id === editingTimeEntry
              )
            : null
        }
      />
    </>
  );
}

function AddAvailabilityDialog({
  crewMemberId,
  open,
  onOpenChange,
  onSaved,
}: {
  crewMemberId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const form = useForm<CrewAvailabilityFormValues>({
    resolver: zodResolver(crewAvailabilitySchema),
    defaultValues: {
      crewMemberId,
      type: "UNAVAILABLE",
      isAllDay: true,
      reason: "",
      startTime: "",
      endTime: "",
    },
  });

  const isAllDay = form.watch("isAllDay");
  const availWrites = useCrewAvailabilityWrites();

  const mutation = useServerMutation({
    mutationFn: (data: CrewAvailabilityFormValues) => availWrites.add(data),
    onSuccess: () => {
      toast.success("Availability block added");
      onSaved();
      onOpenChange(false);
      form.reset({ crewMemberId, type: "UNAVAILABLE", isAllDay: true, reason: "", startTime: "", endTime: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add availability block</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={form.watch("type")}
              onValueChange={(v) =>
                form.setValue("type", v as CrewAvailabilityFormValues["type"])
              }
            >
              <SelectTrigger>
                <SelectValue>{({"UNAVAILABLE": "Unavailable", "TENTATIVE": "Tentative", "PREFERRED": "Preferred"} as Record<string, string>)[form.watch("type") ?? ""] ?? form.watch("type")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UNAVAILABLE">Unavailable</SelectItem>
                <SelectItem value="TENTATIVE">Tentative</SelectItem>
                <SelectItem value="PREFERRED">Preferred</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date *</Label>
              <Input type="date" {...form.register("startDate")} aria-invalid={!!form.formState.errors.startDate} />
              {form.formState.errors.startDate && (
                <p className="text-caption text-t-out">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>End date *</Label>
              <Input type="date" {...form.register("endDate")} aria-invalid={!!form.formState.errors.endDate} />
              {form.formState.errors.endDate && (
                <p className="text-caption text-t-out">
                  {form.formState.errors.endDate.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="isAllDay"
              checked={isAllDay}
              onCheckedChange={(v) => form.setValue("isAllDay", v === true)}
            />
            <Label htmlFor="isAllDay" className="cursor-pointer">
              All day
            </Label>
          </div>

          {!isAllDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" {...form.register("startTime")} />
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <Input type="time" {...form.register("endTime")} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input
              placeholder="e.g. Holiday, Another gig, Personal"
              {...form.register("reason")}
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
            <Button type="submit" loading={mutation.isPending}>
              Add block
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add/Edit Time Entry Dialog ─────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function AddTimeEntryDialog({
  crewMemberId,
  assignments,
  open,
  onOpenChange,
  editingEntry,
  onSaved,
}: {
  crewMemberId: string;
  assignments: any[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingEntry?: any;
  onSaved: () => void;
}) {
  const isEditing = !!editingEntry;
  const [isGeneral, setIsGeneral] = useState(false);

  const form = useForm<CrewTimeEntryFormValues>({
    resolver: zodResolver(crewTimeEntrySchema),
    defaultValues: {
      assignmentId: "",
      crewMemberId,
      description: "",
      date: "",
      startTime: "",
      endTime: "",
      breakMinutes: "",
      notes: "",
    },
  });

  // Reset form when editing entry changes
  const resetKey = `${open}-${editingEntry?.id}`;
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    if (open && editingEntry) {
      const isGen = !editingEntry.assignmentId;
      setIsGeneral(isGen);
      form.reset({
        assignmentId: editingEntry.assignmentId || "",
        crewMemberId,
        description: editingEntry.description || "",
        date: editingEntry.date
          ? new Date(editingEntry.date).toISOString().split("T")[0]
          : "",
        startTime: editingEntry.startTime || "",
        endTime: editingEntry.endTime || "",
        breakMinutes: editingEntry.breakMinutes || "",
        notes: editingEntry.notes || "",
      });
    } else if (open) {
      setIsGeneral(false);
      form.reset({
        assignmentId: assignments.length === 1 ? assignments[0].id : "",
        crewMemberId,
        description: "",
        date: new Date().toISOString().split("T")[0],
        startTime: "",
        endTime: "",
        breakMinutes: "",
        notes: "",
      });
    }
  }

  const createMutation = useServerMutation({
    mutationFn: (data: CrewTimeEntryFormValues) => createTimeEntry(data),
    onSuccess: () => {
      toast.success("Time entry added");
      onSaved();
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: CrewTimeEntryFormValues) =>
      updateTimeEntry(editingEntry?.id, data),
    onSuccess: () => {
      toast.success("Time entry updated");
      onSaved();
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const mutation = isEditing ? updateMutation : createMutation;

  // Active (non-cancelled/declined) assignments for the picker
  const activeAssignments = assignments.filter(
    (a: any) => !["CANCELLED", "DECLINED"].includes(a.status)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit time entry" : "Log time"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((data) => {
            // Clear assignmentId if general shift
            if (isGeneral) data.assignmentId = "";
            mutation.mutate(data);
          })}
          className="space-y-4"
        >
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
            <div className="space-y-1.5">
              <Label>Assignment</Label>
              <Select
                value={form.watch("assignmentId") || ""}
                onValueChange={(v) =>
                  form.setValue("assignmentId", v || "")
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {(() => {
                      const selected = activeAssignments.find(
                        (a: any) => a.id === form.watch("assignmentId")
                      );
                      if (!selected) return "Select assignment";
                      return `${selected.project?.projectNumber} — ${selected.project?.name}${selected.crewRole?.name ? ` (${selected.crewRole.name})` : ""}`;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeAssignments.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.project?.projectNumber} — {a.project?.name}
                      {a.crewRole?.name ? ` (${a.crewRole.name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <Button type="submit" loading={mutation.isPending}>
              {isEditing ? "Update" : "Log time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
