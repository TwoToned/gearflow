"use client";

import { use, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
// useQueryClient retained only for the cross-domain ["crew-members"] list key
// (SSE-mapped) in deleteMutation. The per-id crew-member/availability/ical/
// time-entries datums are non-SSE same-view islands on useServerQuery.
import { useQueryClient } from "@tanstack/react-query";
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
  Loader2,
  Briefcase,
  CalendarOff,
  CalendarSync,
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
  ChevronRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  getCrewMemberById,
  deleteCrewMember,
  addCertification,
  removeCertification,
} from "@/server/crew";
import {
  updateAssignmentStatus,
  deleteAssignment,
} from "@/server/crew-assignments";
import { sendCrewOffer } from "@/server/crew-communication";
import {
  getCrewAvailability,
  addAvailability,
  removeAvailability,
} from "@/server/crew-availability";
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
  crewCertStatusLabels,
  assignmentStatusLabels,
  phaseLabels,
  availabilityTypeLabels,
  timeEntryStatusLabels,
  formatLabel,
} from "@/lib/status-labels";
import {
  crewCertificationSchema,
  type CrewCertificationFormValues,
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { formatDate } from "@/lib/formatters";

const certStatusColors: Record<string, string> = {
  CURRENT: "bg-green-500/10 text-green-500 border-green-500/20",
  EXPIRING_SOON: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  EXPIRED: "bg-red-500/10 text-red-500 border-red-500/20",
  NOT_VERIFIED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};


const availabilityTypeColors: Record<string, string> = {
  UNAVAILABLE: "bg-red-500/10 text-red-500 border-red-500/20",
  TENTATIVE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  PREFERRED: "bg-green-500/10 text-green-500 border-green-500/20",
};


const projectStatusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

export default function CrewMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: session } = useSession();
  const canReadCrew = useCanDo("crew", "read");

  const [tabValue, setTabValue] = useState("assignments");
  const [addCertOpen, setAddCertOpen] = useState(false);
  const [addAvailOpen, setAddAvailOpen] = useState(false);
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [editingTimeEntry, setEditingTimeEntry] = useState<string | null>(null);
  const [deleteCrewOpen, setDeleteCrewOpen] = useState(false);
  const [regenerateTokenOpen, setRegenerateTokenOpen] = useState(false);
  const [removeAvailId, setRemoveAvailId] = useState<string | null>(null);
  const [removeCertTarget, setRemoveCertTarget] = useState<{ id: string; name: string } | null>(null);
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
      if (dialog === "add-certification") setAddCertOpen(true);
      if (dialog === "add-time-entry") setAddTimeOpen(true);
    };

    window.addEventListener("slash-command", handler);
    return () => window.removeEventListener("slash-command", handler);
  }, []);

  const { data: member, isLoading, refetch: refetchMember } = useServerQuery({
    queryKey: ["crew-member", orgId, id],
    queryFn: () => getCrewMemberById(id),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => deleteCrewMember(id),
    onSuccess: () => {
      toast.success("Crew member deleted");
      queryClient.invalidateQueries({ queryKey: ["crew-members"] });
      router.push("/crew");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeCertMutation = useServerMutation({
    mutationFn: (certId: string) => removeCertification(certId),
    onSuccess: () => {
      toast.success("Certification removed");
      refetchMember();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: availabilityRecords, refetch: refetchAvailability } = useServerQuery({
    queryKey: ["crew-availability", orgId, id],
    queryFn: () => getCrewAvailability(id),
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
    mutationFn: (availId: string) => removeAvailability(availId),
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

  const updateAssignmentStatusMutation = useServerMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: string }) =>
      updateAssignmentStatus(assignmentId, status),
    onSuccess: () => {
      toast.success("Assignment status updated");
      refetchMember();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAssignmentMutation = useServerMutation({
    mutationFn: (assignmentId: string) => deleteAssignment(assignmentId),
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
    return <div className="py-20 text-center text-fg-3">Crew member not found.</div>;

  const isOwnProfile = !!(member as { isOwnProfile?: boolean }).isOwnProfile;

  // Allow access if user has crew.read permission OR is viewing their own profile
  if (!canReadCrew && !isOwnProfile) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="t-title">Access Denied</h2>
        <p className="mt-2 text-sm text-fg-3">
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
  const certifications = member.certifications || [];
  const skills = member.skills || [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const assignments = (member as any).assignments || [];

  // Compute certification summary
  const currentCerts = certifications.filter((c: { status: string }) => c.status === "CURRENT").length;
  const expiringCerts = certifications.filter((c: { status: string }) => c.status === "EXPIRING_SOON").length;
  const expiredCerts = certifications.filter((c: { status: string }) => c.status === "EXPIRED").length;

  // Compute availability status
  const now = new Date();
  const activeUnavailable = availabilityRecords?.find(
    (av: { type: string; startDate: string | Date; endDate: string | Date }) =>
      av.type === "UNAVAILABLE" &&
      new Date(av.startDate) <= now &&
      new Date(av.endDate) >= now
  );

  return (
    <>
      <PageMeta title={fullName} />
      <FadeIn>
        <div className="space-y-6">
          {/* Own profile banner */}
          {isOwnProfile && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0" />
              You are viewing your own crew profile.
            </div>
          )}

          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/crew" className="hover:text-fg transition-colors">
                Crew
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-fg font-medium truncate">{fullName}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                {/* Profile Picture */}
                <div className="relative group shrink-0">
                  <Avatar className="size-16 text-lg">
                    {displayImage ? (
                      <AvatarImage src={displayImage} alt={fullName} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                      {member.firstName[0]}{member.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  {/* Only show upload controls for crew without a linked user (linked users sync from account) */}
                  {!member.user && (
                    <CanDo resource="crew" action="update">
                      <button
                        type="button"
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <Camera className="h-5 w-5 text-white" />
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
                          className="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeAvatarMutation.mutate()}
                          title="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </CanDo>
                  )}
                  {uploadAvatarMutation.isPending && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="t-title text-fg">{fullName}</h1>
                    <StatusIndicator
                      category="crewMember"
                      value={member.status}
                      label={crewMemberStatusLabels[member.status] || formatLabel(member.status)}
                    />
                    <Badge variant="outline">
                      {crewMemberTypeLabels[member.type] || formatLabel(member.type)}
                    </Badge>
                  </div>
                  <p className="text-fg-3">
                    {member.crewRole?.name || "No role assigned"}
                    {member.department && <> &middot; {member.department}</>}
                  </p>
                  {member.user && !isOwnProfile && (
                    <p className="text-xs text-fg-3 mt-1 flex items-center gap-1">
                      <LinkIcon className="h-3 w-3" />
                      Linked to {member.user.name || member.user.email}
                    </p>
                  )}
                </div>
              </div>
              <CanDo resource="crew" action="update">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    render={<Link href={`/crew/${id}/edit`} />}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <CanDo resource="crew" action="delete">
                    <Button
                      variant="outline"
                      className="text-destructive"
                      onClick={() => setDeleteCrewOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </CanDo>
                </div>
              </CanDo>
            </div>
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
                  <TabsTrigger value="certifications">
                    Certifications ({certifications.length})
                  </TabsTrigger>
                  <TabsTrigger value="time-entries">
                    Time ({timeEntries?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                </TabsList>

                {/* Assignments Tab */}
                <TabsContent value="assignments" className="mt-4">
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <h3 className="t-heading text-fg mb-4">Project Assignments</h3>
                      {assignments.length === 0 ? (
                        <p className="text-sm text-fg-3 text-center py-4">
                          No project assignments yet.
                        </p>
                      ) : (
                        <div className="rounded-md border">
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
                                  Project Status
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
                                        className="font-medium hover:underline"
                                      >
                                        <div className="flex items-center gap-2">
                                          <Briefcase className="h-3.5 w-3.5 text-fg-3" />
                                          <div>
                                            <div>{a.project.name}</div>
                                            <div className="text-xs text-fg-3 font-mono">
                                              {a.project.projectNumber}
                                            </div>
                                          </div>
                                        </div>
                                      </Link>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                      {a.crewRole ? (
                                        <Badge
                                          variant="outline"
                                          style={
                                            a.crewRole.color
                                              ? {
                                                  borderColor: a.crewRole.color,
                                                  color: a.crewRole.color,
                                                  backgroundColor: `${a.crewRole.color}15`,
                                                }
                                              : undefined
                                          }
                                        >
                                          {a.crewRole.name}
                                        </Badge>
                                      ) : (
                                        <span className="text-fg-3">
                                          {"\u2014"}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-sm">
                                      {a.phase
                                        ? phaseLabels[a.phase] || a.phase
                                        : "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-sm">
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
                                          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}>
                                            <MoreHorizontal className="h-4 w-4" />
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuGroup>
                                              {a.status === "PENDING" && member.email && (
                                                <DropdownMenuItem
                                                  onClick={() => sendOfferMutation.mutate(a.id)}
                                                >
                                                  <Send className="mr-2 h-4 w-4" />
                                                  Send Offer
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
                      )}
                  </div>
                </TabsContent>

                {/* Availability Tab */}
                <TabsContent value="availability" className="mt-4">
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="t-heading text-fg">Availability Blocks</h3>
                      <CanDo resource="crew" action="update">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddAvailOpen(true)}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Block
                        </Button>
                      </CanDo>
                    </div>
                      {!availabilityRecords || availabilityRecords.length === 0 ? (
                        <p className="text-sm text-fg-3 text-center py-4">
                          No availability blocks set. Add blocks to indicate when this
                          crew member is unavailable, tentative, or preferred.
                        </p>
                      ) : (
                        <div className="rounded-md border">
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
                                        variant="outline"
                                        className={
                                          availabilityTypeColors[av.type] || ""
                                        }
                                      >
                                        <CalendarOff className="mr-1 h-3 w-3" />
                                        {availabilityTypeLabels[av.type] ||
                                          formatLabel(av.type)}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {formatDate(av.startDate)}
                                      {av.endDate !== av.startDate
                                        ? ` \u2013 ${formatDate(av.endDate)}`
                                        : ""}
                                    </TableCell>
                                    <TableCell className="text-sm text-fg-3 hidden md:table-cell">
                                      {av.isAllDay
                                        ? "All Day"
                                        : `${av.startTime || ""} \u2013 ${av.endTime || ""}`}
                                    </TableCell>
                                    <TableCell className="text-sm text-fg-3 hidden md:table-cell">
                                      {av.reason || "\u2014"}
                                    </TableCell>
                                    <TableCell>
                                      <CanDo resource="crew" action="update">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive"
                                          onClick={() => setRemoveAvailId(av.id)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </CanDo>
                                    </TableCell>
                                  </TableRow>
                                )
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                  </div>
                </TabsContent>

                {/* Certifications Tab */}
                <TabsContent value="certifications" className="mt-4">
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="t-heading text-fg">Certifications & Qualifications</h3>
                      <CanDo resource="crew" action="update">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddCertOpen(true)}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Certification
                        </Button>
                      </CanDo>
                    </div>
                      {certifications.length === 0 ? (
                        <p className="text-sm text-fg-3 text-center py-4">
                          No certifications recorded.
                        </p>
                      ) : (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Issued By
                                </TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Certificate #
                                </TableHead>
                                <TableHead className="hidden md:table-cell">
                                  Issued
                                </TableHead>
                                <TableHead>Expiry</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-10" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {certifications.map(
                                (cert: {
                                  id: string;
                                  name: string;
                                  issuedBy: string | null;
                                  certificateNumber: string | null;
                                  issuedDate: Date | string | null;
                                  expiryDate: Date | string | null;
                                  status: string;
                                }) => (
                                  <TableRow key={cert.id}>
                                    <TableCell className="font-medium">
                                      {cert.name}
                                    </TableCell>
                                    <TableCell className="text-fg-3 hidden md:table-cell">
                                      {cert.issuedBy || "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-fg-3 hidden md:table-cell font-mono text-sm">
                                      {cert.certificateNumber || "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-fg-3 hidden md:table-cell">
                                      {cert.issuedDate
                                        ? new Date(
                                            cert.issuedDate
                                          ).toLocaleDateString()
                                        : "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-fg-3">
                                      {cert.expiryDate
                                        ? new Date(
                                            cert.expiryDate
                                          ).toLocaleDateString()
                                        : "\u2014"}
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={
                                          certStatusColors[cert.status] || ""
                                        }
                                      >
                                        {crewCertStatusLabels[cert.status] ||
                                          formatLabel(cert.status)}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      <CanDo resource="crew" action="update">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive"
                                          onClick={() =>
                                            setRemoveCertTarget({
                                              id: cert.id,
                                              name: cert.name,
                                            })
                                          }
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </CanDo>
                                    </TableCell>
                                  </TableRow>
                                )
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                  </div>
                </TabsContent>

                {/* Time Entries Tab */}
                <TabsContent value="time-entries" className="mt-4">
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="t-heading text-fg flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Time Entries
                      </h3>
                      <div className="flex gap-2">
                        {timeEntries && timeEntries.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            render={
                              <a
                                href={`/api/crew/timesheet?crewMemberId=${id}`}
                                download
                              />
                            }
                          >
                            <Download className="mr-2 h-3.5 w-3.5" />
                            Export CSV
                          </Button>
                        )}
                        {/* Bulk submit all drafts */}
                        {timeEntries &&
                          timeEntries.filter(
                            (e: { status: string }) => e.status === "DRAFT"
                          ).length > 0 && (
                            <CanDo resource="crew" action="update">
                              <Button
                                variant="outline"
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
                                disabled={submitTimeMutation.isPending}
                              >
                                <Send className="mr-2 h-3.5 w-3.5" />
                                Submit All Drafts
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
                                variant="outline"
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
                                disabled={approveTimeMutation.isPending}
                              >
                                <CheckCircle className="mr-2 h-3.5 w-3.5" />
                                Approve All
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
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            Log Time
                          </Button>
                        </CanDo>
                      </div>
                    </div>
                      {!timeEntries || timeEntries.length === 0 ? (
                        <p className="text-sm text-fg-3 py-4 text-center">
                          No time entries recorded yet.
                        </p>
                      ) : (
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
                                <TableCell className="text-sm">
                                  {formatDate(entry.date)}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {entry.assignment ? (
                                    <>
                                      {entry.assignment.project?.projectNumber} —{" "}
                                      {entry.assignment.project?.name}
                                    </>
                                  ) : (
                                    <span className="text-fg-3 italic">
                                      {entry.description || "General"}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {entry.assignment?.crewRole?.name || "—"}
                                </TableCell>
                                <TableCell className="text-sm font-mono">
                                  {entry.startTime}
                                </TableCell>
                                <TableCell className="text-sm font-mono">
                                  {entry.endTime}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {entry.breakMinutes > 0
                                    ? `${entry.breakMinutes}m`
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-sm font-mono t-data">
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
                                      <DropdownMenuTrigger
                                        render={
                                          <Button variant="ghost" size="icon" />
                                        }
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
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
                                          <DropdownMenuItem
                                            className="text-destructive"
                                            onClick={() =>
                                              deleteTimeMutation.mutate(entry.id)
                                            }
                                          >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete
                                          </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                  </div>
                </TabsContent>

                {/* Calendar Tab */}
                <TabsContent value="calendar" className="mt-4">
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <h3 className="t-heading text-fg flex items-center gap-2 mb-4">
                      <CalendarSync className="h-4 w-4" />
                      iCal Feed
                    </h3>
                    <div className="space-y-4">
                      <p className="text-sm text-fg-3">
                        Enable an iCal feed URL that can be subscribed to from Google
                        Calendar, Apple Calendar, Outlook, or any calendar app. The
                        feed includes all confirmed assignments.
                      </p>

                      {icalSettings?.icalEnabled && icalSettings?.icalToken ? (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-fg-3">
                              Feed URL
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                readOnly
                                value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/crew/calendar/${icalSettings.icalToken}`}
                                className="font-mono text-xs"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/api/crew/calendar/${icalSettings.icalToken}`
                                  );
                                  toast.success("Feed URL copied to clipboard");
                                }}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <CanDo resource="crew" action="update">
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRegenerateTokenOpen(true)}
                                disabled={regenerateTokenMutation.isPending}
                              >
                                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                Regenerate URL
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                onClick={() => disableIcalMutation.mutate()}
                                disabled={disableIcalMutation.isPending}
                              >
                                Disable Feed
                              </Button>
                            </div>
                          </CanDo>
                        </div>
                      ) : (
                        <CanDo resource="crew" action="update">
                          <Button
                            variant="outline"
                            onClick={() => enableIcalMutation.mutate()}
                            disabled={enableIcalMutation.isPending}
                          >
                            {enableIcalMutation.isPending && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            <CalendarSync className="mr-2 h-4 w-4" />
                            Enable iCal Feed
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
                  <div className="space-y-2 text-sm">
                    {displayEmail && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={`mailto:${displayEmail}`}
                          className="hover:underline truncate"
                        >
                          {displayEmail}
                        </a>
                      </div>
                    )}
                    {member.phone && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a href={`tel:${member.phone}`} className="hover:underline">
                          {member.phone}
                        </a>
                      </div>
                    )}
                    {member.address && (
                      <p className="text-sm text-fg-3 whitespace-pre-wrap">
                        {member.address}
                      </p>
                    )}
                    {!displayEmail && !member.phone && !member.address && (
                      <p className="text-fg-3">No contact info</p>
                    )}
                  </div>
                </SidebarSection>

                {/* Role & Department */}
                <SidebarSection title="Role & Department">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Role</span>
                      <span className="font-medium">{member.crewRole?.name || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Department</span>
                      <span className="font-medium">{member.department || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Type</span>
                      <span className="font-medium">
                        {crewMemberTypeLabels[member.type] || formatLabel(member.type)}
                      </span>
                    </div>
                    {member.emergencyContactName && (
                      <>
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <p className="text-xs text-fg-3 mb-1">Emergency Contact</p>
                          <p className="font-medium">{member.emergencyContactName}</p>
                          {member.emergencyContactPhone && (
                            <div className="flex items-center gap-2 text-fg-3 mt-0.5">
                              <Phone className="h-3 w-3" />
                              <a
                                href={`tel:${member.emergencyContactPhone}`}
                                className="hover:underline text-xs"
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
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Day Rate</span>
                      <span className="font-medium t-data">
                        {member.defaultDayRate != null
                          ? `$${Number(member.defaultDayRate).toFixed(2)}`
                          : "\u2014"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Hourly Rate</span>
                      <span className="font-medium t-data">
                        {member.defaultHourlyRate != null
                          ? `$${Number(member.defaultHourlyRate).toFixed(2)}`
                          : "\u2014"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">OT Multiplier</span>
                      <span className="font-medium">
                        {member.overtimeMultiplier != null
                          ? `${Number(member.overtimeMultiplier)}x`
                          : "\u2014"}
                      </span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Certifications Summary */}
                <SidebarSection title="Certifications">
                  {certifications.length === 0 ? (
                    <p className="text-sm text-fg-3">No certifications</p>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-fg-3">Current</span>
                        <span className="font-medium text-green-500">{currentCerts}</span>
                      </div>
                      {expiringCerts > 0 && (
                        <div className="flex justify-between">
                          <span className="text-fg-3">Expiring Soon</span>
                          <span className="font-medium text-amber-500">{expiringCerts}</span>
                        </div>
                      )}
                      {expiredCerts > 0 && (
                        <div className="flex justify-between">
                          <span className="text-fg-3">Expired</span>
                          <span className="font-medium text-red-500">{expiredCerts}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-fg-3">Total</span>
                        <span className="font-medium">{certifications.length}</span>
                      </div>
                    </div>
                  )}
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
                          <Badge key={skill.id} variant="secondary">
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
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Availability Status */}
                <SidebarSection title="Availability">
                  <div className="text-sm">
                    {activeUnavailable ? (
                      <div className="flex items-center gap-2 text-red-500">
                        <CalendarOff className="h-3.5 w-3.5" />
                        <span>Currently unavailable</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-green-500">
                        <CheckCircle className="h-3.5 w-3.5" />
                        <span>Available</span>
                      </div>
                    )}
                    {availabilityRecords && availabilityRecords.length > 0 && (
                      <p className="text-xs text-fg-3 mt-1">
                        {availabilityRecords.length} block{availabilityRecords.length !== 1 ? "s" : ""} scheduled
                      </p>
                    )}
                  </div>
                </SidebarSection>

                {/* Notes */}
                {member.notes && (
                  <SidebarSection title="Notes">
                    <p className="text-sm whitespace-pre-wrap text-fg-3">{member.notes}</p>
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
        description="Removes the crew member from your roster. Past assignments, timesheets, and certifications are preserved but unlinked. This cannot be undone."
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
      <DeleteDialog
        open={!!removeCertTarget}
        onOpenChange={(open) => !open && setRemoveCertTarget(null)}
        title={`Remove certification "${removeCertTarget?.name ?? ""}"?`}
        description="The certification is removed from this crew member's profile."
        confirmLabel="Remove certification"
        onConfirm={() => {
          if (removeCertTarget) {
            removeCertMutation.mutate(removeCertTarget.id);
            setRemoveCertTarget(null);
          }
        }}
        pending={removeCertMutation.isPending}
      />

      {/* Add Certification Dialog */}
      <AddCertificationDialog
        crewMemberId={id}
        open={addCertOpen}
        onOpenChange={setAddCertOpen}
        onSaved={refetchMember}
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

// ─── Add Certification Dialog ──────────────────────────────────────────────────

function AddCertificationDialog({
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
  const form = useForm<CrewCertificationFormValues>({
    resolver: zodResolver(crewCertificationSchema),
    defaultValues: {
      name: "",
      issuedBy: "",
      certificateNumber: "",
      status: "NOT_VERIFIED",
    },
  });

  const mutation = useServerMutation({
    mutationFn: (data: CrewCertificationFormValues) =>
      addCertification(crewMemberId, data),
    onSuccess: () => {
      toast.success("Certification added");
      onSaved();
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Certification</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              placeholder="e.g. White Card, Working at Heights"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Issued By</Label>
            <Input
              placeholder="Issuing authority"
              {...form.register("issuedBy")}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Certificate Number</Label>
            <Input
              placeholder="Certificate #"
              {...form.register("certificateNumber")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Issued Date</Label>
              <Input type="date" {...form.register("issuedDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>Expiry Date</Label>
              <Input type="date" {...form.register("expiryDate")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.watch("status")}
              onValueChange={(v) =>
                form.setValue(
                  "status",
                  v as CrewCertificationFormValues["status"]
                )
              }
            >
              <SelectTrigger>
                <SelectValue>{({"CURRENT": "Current", "EXPIRING_SOON": "Expiring Soon", "EXPIRED": "Expired", "NOT_VERIFIED": "Not Verified"} as Record<string, string>)[form.watch("status") ?? ""] ?? form.watch("status")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CURRENT">Current</SelectItem>
                <SelectItem value="EXPIRING_SOON">Expiring Soon</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="NOT_VERIFIED">Not Verified</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add Certification
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Availability Dialog ──────────────────────────────────────────────────

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

  const mutation = useServerMutation({
    mutationFn: (data: CrewAvailabilityFormValues) => addAvailability(data),
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
          <DialogTitle>Add Availability Block</DialogTitle>
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
              <Label>Start Date *</Label>
              <Input type="date" {...form.register("startDate")} />
              {form.formState.errors.startDate && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>End Date *</Label>
              <Input type="date" {...form.register("endDate")} />
              {form.formState.errors.endDate && (
                <p className="text-xs text-destructive">
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
              All Day
            </Label>
          </div>

          {!isAllDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" {...form.register("startTime")} />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
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
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add Block
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
            {isEditing ? "Edit Time Entry" : "Log Time"}
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
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isEditing ? "Update" : "Log Time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
