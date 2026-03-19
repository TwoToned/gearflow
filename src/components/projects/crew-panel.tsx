"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  DollarSign,
  Calendar,
  CalendarPlus,
  Clock,
  ChevronDown,
  FileText,
  Star,
  Loader2,
  AlertTriangle,
  Send,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

import {
  getProjectCrew,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  updateAssignmentStatus,
  getProjectLabourCost,
  getCrewMembersForAssignment,
} from "@/server/crew-assignments";
import { checkCrewConflicts, type CrewConflict } from "@/server/crew-availability";
import {
  sendCrewOffer,
  sendCrewOfferAll,
  sendBulkMessage,
} from "@/server/crew-communication";
import { getCrewRoleOptions, createCrewRole } from "@/server/crew";
import { getProjectServices } from "@/server/project-services";
import {
  crewAssignmentSchema,
  type CrewAssignmentFormValues,
} from "@/lib/validations/crew";
import {
  assignmentStatusLabels,
  phaseLabels,
  crewRateTypeLabels,
} from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statusColors: Record<string, string> = {
  PENDING: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  OFFERED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  ACCEPTED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  DECLINED: "bg-red-500/10 text-red-500 border-red-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
  COMPLETED: "bg-green-500/10 text-green-500 border-green-500/20",
};

const allStatuses = [
  "PENDING",
  "OFFERED",
  "ACCEPTED",
  "DECLINED",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
];

interface CrewPanelProps {
  projectId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Assignment = Record<string, any>;

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

export function CrewPanel({ projectId }: CrewPanelProps) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["project-crew", orgId, projectId],
    queryFn: () => getProjectCrew(projectId),
  });

  const { data: labourCost } = useQuery({
    queryKey: ["project-labour-cost", orgId, projectId],
    queryFn: () => getProjectLabourCost(projectId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAssignment(id),
    onSuccess: () => {
      toast.success("Crew member removed");
      queryClient.invalidateQueries({ queryKey: ["project-crew", orgId, projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-labour-cost", orgId, projectId] });
      queryClient.invalidateQueries({ queryKey: ["crew-member"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateAssignmentStatus(id, status),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["project-crew", orgId, projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const offerMutation = useMutation({
    mutationFn: (id: string) => sendCrewOffer(id),
    onSuccess: () => {
      toast.success("Offer sent");
      queryClient.invalidateQueries({ queryKey: ["project-crew", orgId, projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const offerAllMutation = useMutation({
    mutationFn: () => sendCrewOfferAll(projectId),
    onSuccess: (result) => {
      toast.success(`${result.sent} offer(s) sent`);
      queryClient.invalidateQueries({ queryKey: ["project-crew", orgId, projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const pendingCount = assignments?.filter(
    (a: Assignment) => a.status === "PENDING"
  ).length || 0;

  // Group assignments by phase
  const grouped = new Map<string, Assignment[]>();
  const ungrouped: Assignment[] = [];

  if (assignments) {
    for (const a of assignments) {
      if (a.phase) {
        const existing = grouped.get(a.phase) || [];
        existing.push(a);
        grouped.set(a.phase, existing);
      } else {
        ungrouped.push(a);
      }
    }
  }

  const editingAssignment = editId
    ? assignments?.find((a: Assignment) => a.id === editId)
    : null;

  if (isLoading) {
    return <div className="text-fg-3 py-8 text-center">Loading crew...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-fg-3">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            {assignments?.length || 0} crew
          </span>
          {labourCost && (
            <span className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Est. Labour: {formatCurrency(Number(labourCost.totalLabourCost))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CanDo resource="crew" action="update">
            {pendingCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      `Send offers to ${pendingCount} pending crew member(s)?`
                    )
                  )
                    offerAllMutation.mutate();
                }}
                disabled={offerAllMutation.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                Offer All ({pendingCount})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessageOpen(true)}
              disabled={!assignments || assignments.length === 0}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Message
            </Button>
          </CanDo>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(`/api/documents/call-sheet/${projectId}`, "_blank")
            }
          >
            <FileText className="mr-2 h-4 w-4" />
            Call Sheet
          </Button>
          <CanDo resource="crew" action="create">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Crew
            </Button>
          </CanDo>
        </div>
      </div>

      {/* Assignments table */}
      {(!assignments || assignments.length === 0) ? (
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="py-12 text-center text-fg-3">
            <Users className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>No crew assigned to this project yet.</p>
            <CanDo resource="crew" action="create">
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Crew Member
              </Button>
            </CanDo>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Est. Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Project managers first */}
              {assignments
                .filter((a: Assignment) => a.isProjectManager)
                .map((a: Assignment) => (
                  <AssignmentRow
                    key={a.id as string}
                    assignment={a}
                    onEdit={() => setEditId(a.id as string)}
                    onDelete={() => {
                      if (confirm("Remove this crew member from the project?"))
                        deleteMutation.mutate(a.id as string);
                    }}
                    onStatusChange={(status) =>
                      statusMutation.mutate({ id: a.id as string, status })
                    }
                    onSendOffer={() => offerMutation.mutate(a.id as string)}
                  />
                ))}
              {/* Then by phase group */}
              {Array.from(grouped.entries()).map(([phase, items]) => (
                <PhaseGroup
                  key={phase}
                  phase={phase}
                  assignments={items!.filter(
                    (a: Assignment) => !a.isProjectManager
                  )}
                  onEdit={(id) => setEditId(id)}
                  onDelete={(id) => {
                    if (confirm("Remove this crew member from the project?"))
                      deleteMutation.mutate(id);
                  }}
                  onStatusChange={(id, status) =>
                    statusMutation.mutate({ id, status })
                  }
                  onSendOffer={(id) => offerMutation.mutate(id)}
                />
              ))}
              {/* Ungrouped */}
              {ungrouped
                .filter((a: Assignment) => !a.isProjectManager)
                .map((a: Assignment) => (
                  <AssignmentRow
                    key={a.id as string}
                    assignment={a}
                    onEdit={() => setEditId(a.id as string)}
                    onDelete={() => {
                      if (confirm("Remove this crew member from the project?"))
                        deleteMutation.mutate(a.id as string);
                    }}
                    onStatusChange={(status) =>
                      statusMutation.mutate({ id: a.id as string, status })
                    }
                    onSendOffer={() => offerMutation.mutate(a.id as string)}
                  />
                ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add dialog */}
      <AssignmentDialog
        projectId={projectId}
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="add"
      />

      {/* Edit dialog */}
      {editingAssignment && (
        <AssignmentDialog
          projectId={projectId}
          open={!!editId}
          onOpenChange={(open) => !open && setEditId(null)}
          mode="edit"
          assignment={editingAssignment}
        />
      )}

      {/* Bulk message dialog */}
      <BulkMessageDialog
        projectId={projectId}
        open={messageOpen}
        onOpenChange={setMessageOpen}
      />
    </div>
  );
}

// ─── Phase Group ───────────────────────────────────────────────────────────────

function PhaseGroup({
  phase,
  assignments,
  onEdit,
  onDelete,
  onStatusChange,
  onSendOffer,
}: {
  phase: string;
  assignments: Assignment[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onSendOffer?: (id: string) => void;
}) {
  if (assignments.length === 0) return null;
  return (
    <>
      <TableRow className="bg-bg-inset/30 hover:bg-bg-inset/30">
        <TableCell colSpan={8} className="py-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-3">
            {phaseLabels[phase] || phase}
          </span>
        </TableCell>
      </TableRow>
      {assignments.map((a) => (
        <AssignmentRow
          key={a.id as string}
          assignment={a}
          onEdit={() => onEdit(a.id as string)}
          onDelete={() => onDelete(a.id as string)}
          onStatusChange={(status) => onStatusChange(a.id as string, status)}
          onSendOffer={
            onSendOffer ? () => onSendOffer(a.id as string) : undefined
          }
        />
      ))}
    </>
  );
}

// ─── Assignment Row ────────────────────────────────────────────────────────────

function AssignmentRow({
  assignment: a,
  onEdit,
  onDelete,
  onStatusChange,
  onSendOffer,
}: {
  assignment: Assignment;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
  onSendOffer?: () => void;
}) {
  const member = a.crewMember as {
    id: string;
    firstName: string;
    lastName: string;
    image?: string;
  };
  const role = a.crewRole as { name: string; color?: string } | null;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          {a.isProjectManager && (
            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
          )}
          <Link
            href={`/crew/${member.id}`}
            className="font-medium hover:underline"
          >
            {member.firstName} {member.lastName}
          </Link>
        </div>
      </TableCell>
      <TableCell>
        {role ? (
          <Badge
            variant="outline"
            style={
              role.color
                ? {
                    borderColor: role.color,
                    color: role.color,
                    backgroundColor: `${role.color}15`,
                  }
                : undefined
            }
          >
            {role.name}
          </Badge>
        ) : (
          <span className="text-fg-3">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {a.phase
          ? phaseLabels[a.phase as string] || (a.phase as string)
          : "—"}
      </TableCell>
      <TableCell className="text-sm">
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3 text-fg-3" />
          {formatDate(a.startDate as string | null)}
          {a.endDate && a.endDate !== a.startDate
            ? ` – ${formatDate(a.endDate as string | null)}`
            : ""}
        </div>
        {a.startTime && (
          <div className="flex items-center gap-1 text-xs text-fg-3">
            <Clock className="h-3 w-3" />
            {a.startTime as string}
            {a.endTime ? ` – ${a.endTime as string}` : ""}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {a.rateOverride != null && Number(a.rateOverride) > 0 ? (
          <>
            {formatCurrency(a.rateOverride as number)}{" "}
            <span className="text-fg-3 text-xs">
              {crewRateTypeLabels[(a.rateType as string) || "DAILY"] || ""}
            </span>
          </>
        ) : (
          <span className="text-fg-3">Default</span>
        )}
      </TableCell>
      <TableCell className="text-sm font-medium">
        {formatCurrency(a.estimatedCost as number | null)}
      </TableCell>
      <TableCell>
        <CanDo
          resource="crew"
          action="update"
          fallback={
            <Badge
              variant="outline"
              className={statusColors[a.status as string] || ""}
            >
              {assignmentStatusLabels[a.status as string] || (a.status as string)}
            </Badge>
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-auto px-2 py-0.5" />}>
              <Badge
                variant="outline"
                className={`pointer-events-none ${statusColors[a.status as string] || ""}`}
              >
                {assignmentStatusLabels[a.status as string] || (a.status as string)}
                <ChevronDown className="ml-1 h-3 w-3" />
              </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {allStatuses.map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={s === (a.status as string)}
                  onClick={() => onStatusChange(s)}
                >
                  {assignmentStatusLabels[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CanDo>
      </TableCell>
      <TableCell>
        <CanDo resource="crew" action="update">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" className="h-8 w-8" />
              }
            >
              <Pencil className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit Assignment
              </DropdownMenuItem>
              {onSendOffer && a.status === "PENDING" && (
                <DropdownMenuItem onClick={onSendOffer}>
                  <Send className="mr-2 h-3.5 w-3.5" />
                  Send Offer
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  window.open(
                    `/api/crew/calendar/assignment/${a.id as string}`,
                    "_blank"
                  )
                }
              >
                <CalendarPlus className="mr-2 h-3.5 w-3.5" />
                Download .ics
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CanDo>
      </TableCell>
    </TableRow>
  );
}

// ─── Assignment Dialog ─────────────────────────────────────────────────────────

interface AssignmentDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  assignment?: Assignment;
}

function AssignmentDialog({
  projectId,
  open,
  onOpenChange,
  mode,
  assignment,
}: AssignmentDialogProps) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: crewMembers } = useQuery({
    queryKey: ["crew-for-assignment", orgId, projectId],
    queryFn: () => getCrewMembersForAssignment(projectId),
    enabled: open && mode === "add",
  });

  const { data: roles } = useQuery({
    queryKey: ["crew-roles", orgId],
    queryFn: () => getCrewRoleOptions(),
    enabled: open,
  });

  const { data: projectServices = [] } = useQuery({
    queryKey: ["project-services", orgId, projectId],
    queryFn: () => getProjectServices(projectId),
    enabled: open,
  });

  const serviceOptions = (projectServices as { id: string; title: string; type: string; crewCountRequired: number | null; crewAssignments: unknown[] }[])
    .filter((s) => (s as { status?: string }).status !== "CANCELLED")
    .map((s) => {
      const assigned = s.crewAssignments?.length ?? 0;
      const needed = s.crewCountRequired ?? 0;
      const crewInfo = needed > 0 ? ` (${assigned}/${needed} crew)` : assigned > 0 ? ` (${assigned} crew)` : "";
      return {
        value: s.id,
        label: `${s.title}${crewInfo}`,
      };
    });

  const form = useForm<CrewAssignmentFormValues>({
    resolver: zodResolver(crewAssignmentSchema),
    defaultValues: assignment
      ? {
          crewMemberId: assignment.crewMemberId as string,
          crewRoleId: (assignment.crewRoleId as string) || "",
          status: assignment.status as CrewAssignmentFormValues["status"],
          phase: (assignment.phase as CrewAssignmentFormValues["phase"]) || "",
          isProjectManager: (assignment.isProjectManager as boolean) || false,
          startDate: assignment.startDate
            ? new Date(assignment.startDate as string)
            : undefined,
          endDate: assignment.endDate
            ? new Date(assignment.endDate as string)
            : undefined,
          startTime: (assignment.startTime as string) || "",
          endTime: (assignment.endTime as string) || "",
          rateOverride:
            assignment.rateOverride != null
              ? Number(assignment.rateOverride)
              : undefined,
          rateType: (assignment.rateType as CrewAssignmentFormValues["rateType"]) || "",
          estimatedHours:
            assignment.estimatedHours != null
              ? Number(assignment.estimatedHours)
              : undefined,
          notes: (assignment.notes as string) || "",
          internalNotes: (assignment.internalNotes as string) || "",
          generateShifts: false,
          serviceId: (assignment.serviceId as string) || "",
        }
      : {
          crewMemberId: "",
          crewRoleId: "",
          status: "PENDING",
          phase: "",
          isProjectManager: false,
          startTime: "",
          endTime: "",
          notes: "",
          internalNotes: "",
          generateShifts: true,
          serviceId: "",
        },
  });

  // Conflict detection
  const watchCrewMemberId = form.watch("crewMemberId");
  const watchStartDate = form.watch("startDate");
  const watchEndDate = form.watch("endDate");

  const startDateStr =
    watchStartDate && watchStartDate !== ""
      ? new Date(watchStartDate as string | Date).toISOString().split("T")[0]
      : "";
  const endDateStr =
    watchEndDate && watchEndDate !== ""
      ? new Date(watchEndDate as string | Date).toISOString().split("T")[0]
      : "";

  const { data: conflicts } = useQuery({
    queryKey: [
      "crew-conflicts",
      watchCrewMemberId,
      startDateStr,
      endDateStr,
      mode === "edit" ? assignment?.id : null,
    ],
    queryFn: () =>
      checkCrewConflicts(
        watchCrewMemberId,
        startDateStr,
        endDateStr,
        mode === "edit" ? (assignment?.id as string) : undefined
      ),
    enabled: !!watchCrewMemberId && !!startDateStr && !!endDateStr,
  });

  const hardConflicts = (conflicts || []).filter(
    (c: CrewConflict) => c.severity === "hard"
  );
  const softConflicts = (conflicts || []).filter(
    (c: CrewConflict) => c.severity === "soft"
  );

  const createMut = useMutation({
    mutationFn: (data: CrewAssignmentFormValues) =>
      createAssignment(projectId, data),
    onSuccess: () => {
      toast.success("Crew member assigned");
      queryClient.invalidateQueries({
        queryKey: ["project-crew", orgId, projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-labour-cost", orgId, projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["crew-member"] });
      queryClient.invalidateQueries({
        queryKey: ["project-services", orgId, projectId],
      });
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (data: CrewAssignmentFormValues) =>
      updateAssignment(assignment!.id as string, data),
    onSuccess: () => {
      toast.success("Assignment updated");
      queryClient.invalidateQueries({
        queryKey: ["project-crew", orgId, projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-labour-cost", orgId, projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["crew-member"] });
      queryClient.invalidateQueries({
        queryKey: ["project-services", orgId, projectId],
      });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = (data: CrewAssignmentFormValues) => {
    if (mode === "add") {
      createMut.mutate(data);
    } else {
      updateMut.mutate(data);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  const roleOptions = (roles || []).map(
    (r: { id: string; name: string; department: string | null }) => ({
      value: r.id,
      label: r.name,
      description: r.department || undefined,
    })
  );

  const crewOptions = (crewMembers || []).map(
    (m: {
      id: string;
      firstName: string;
      lastName: string;
      crewRole?: { name: string } | null;
      assignments?: { id: string }[];
    }) => ({
      value: m.id,
      label: `${m.firstName} ${m.lastName}`,
      description: [
        m.crewRole?.name,
        (m.assignments || []).length > 0 ? "(already assigned)" : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    })
  );

  const allPhases = [
    "BUMP_IN",
    "EVENT",
    "BUMP_OUT",
    "DELIVERY",
    "PICKUP",
    "SETUP",
    "REHEARSAL",
    "FULL_DURATION",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add Crew to Project" : "Edit Assignment"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Crew member picker (add mode only) */}
          {mode === "add" && (
            <div className="space-y-1.5">
              <Label>Crew Member *</Label>
              <ComboboxPicker
                options={crewOptions}
                value={form.watch("crewMemberId")}
                onChange={(v) => form.setValue("crewMemberId", v)}
                placeholder="Search crew..."
                searchPlaceholder="Type to search..."
                emptyMessage="No crew members found"
              />
              {form.formState.errors.crewMemberId && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.crewMemberId.message}
                </p>
              )}
            </div>
          )}

          {/* Service */}
          {serviceOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Linked Service</Label>
              <ComboboxPicker
                options={serviceOptions}
                value={form.watch("serviceId") || ""}
                onChange={(v) => {
                  form.setValue("serviceId", v);
                  // Inherit data from the selected service
                  if (v) {
                    const svc = (projectServices as { id: string; type: string; date: string | null; endDate: string | null; startTime: string | null; endTime: string | null; crewRoleId: string | null }[]).find((s) => s.id === v);
                    if (svc) {
                      // Map service type to phase
                      const phaseMap: Record<string, string> = {
                        DELIVERY: "DELIVERY", PICKUP: "PICKUP",
                        BUMP_IN: "BUMP_IN", BUMP_OUT: "BUMP_OUT",
                        LABOUR: "EVENT", MISC: "FULL_DURATION",
                      };
                      const phase = phaseMap[svc.type];
                      if (phase) form.setValue("phase", phase as CrewAssignmentFormValues["phase"]);
                      if (svc.crewRoleId) form.setValue("crewRoleId", svc.crewRoleId);
                      if (svc.date) {
                        const dateStr = new Date(svc.date).toISOString().split("T")[0];
                        form.setValue("startDate", dateStr as unknown as Date);
                        const endDateStr = svc.endDate
                          ? new Date(svc.endDate).toISOString().split("T")[0]
                          : dateStr;
                        form.setValue("endDate", endDateStr as unknown as Date);
                      }
                      // Only inherit times for single-day services
                      const svcIsMultiDay = svc.date && svc.endDate &&
                        new Date(svc.date).toISOString().slice(0, 10) !== new Date(svc.endDate).toISOString().slice(0, 10);
                      if (!svcIsMultiDay) {
                        if (svc.startTime) form.setValue("startTime", svc.startTime);
                        if (svc.endTime) form.setValue("endTime", svc.endTime);
                      } else {
                        form.setValue("startTime", "");
                        form.setValue("endTime", "");
                      }
                    }
                  }
                }}
                placeholder="Link to a service..."
                emptyMessage="No services found"
                allowClear
              />
            </div>
          )}

          {/* Role */}
          <div className="space-y-1.5">
            <Label>Role</Label>
            <ComboboxPicker
              options={roleOptions}
              value={form.watch("crewRoleId") || ""}
              onChange={(v) => {
                // If the value is a known role ID, use it directly
                const isExisting = roleOptions.some(
                  (r: { value: string }) => r.value === v
                );
                if (isExisting || !v) {
                  form.setValue("crewRoleId", v);
                } else {
                  // Creatable mode — typed a new role name, create it
                  createCrewRole({ name: v })
                    .then((role) => {
                      queryClient.invalidateQueries({
                        queryKey: ["crew-roles", orgId],
                      });
                      form.setValue("crewRoleId", role.id);
                      toast.success(`Role "${role.name}" created`);
                    })
                    .catch((err) =>
                      toast.error((err as Error).message)
                    );
                }
              }}
              placeholder="Select or create role..."
              allowClear
              creatable
            />
          </div>

          {/* Phase */}
          <div className="space-y-1.5">
            <Label>Phase</Label>
            <Select
              value={form.watch("phase") || ""}
              onValueChange={(v) =>
                form.setValue("phase", v as CrewAssignmentFormValues["phase"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select phase..." />
              </SelectTrigger>
              <SelectContent>
                {allPhases.map((p) => (
                  <SelectItem key={p} value={p}>
                    {phaseLabels[p] || p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input
                type="date"
                {...form.register("startDate")}
                defaultValue={
                  assignment?.startDate
                    ? new Date(assignment.startDate as string)
                        .toISOString()
                        .split("T")[0]
                    : ""
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input
                type="date"
                {...form.register("endDate")}
                defaultValue={
                  assignment?.endDate
                    ? new Date(assignment.endDate as string)
                        .toISOString()
                        .split("T")[0]
                    : ""
                }
              />
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Time</Label>
              <Input
                type="time"
                {...form.register("startTime")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End Time</Label>
              <Input
                type="time"
                {...form.register("endTime")}
              />
            </div>
          </div>

          {/* Rate override */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rate Override</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Use default"
                {...form.register("rateOverride")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rate Type</Label>
              <Select
                value={form.watch("rateType") || ""}
                onValueChange={(v) =>
                  form.setValue(
                    "rateType",
                    v as CrewAssignmentFormValues["rateType"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="FLAT">Flat</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Estimated hours (for hourly) */}
          <div className="space-y-1.5">
            <Label>Estimated Hours</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              placeholder="For hourly rate calculation"
              {...form.register("estimatedHours")}
            />
          </div>

          {/* Status (edit mode) */}
          {mode === "edit" && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.watch("status")}
                onValueChange={(v) =>
                  form.setValue(
                    "status",
                    v as CrewAssignmentFormValues["status"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {assignmentStatusLabels[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* PM checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="isProjectManager"
              checked={form.watch("isProjectManager")}
              onCheckedChange={(v) =>
                form.setValue("isProjectManager", v === true)
              }
            />
            <Label htmlFor="isProjectManager" className="cursor-pointer">
              Project Manager
            </Label>
          </div>

          {/* Generate shifts (add mode) */}
          {mode === "add" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="generateShifts"
                checked={form.watch("generateShifts")}
                onCheckedChange={(v) =>
                  form.setValue("generateShifts", v === true)
                }
              />
              <Label htmlFor="generateShifts" className="cursor-pointer">
                Auto-generate daily shifts
              </Label>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              placeholder="Notes visible to crew..."
              {...form.register("notes")}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Internal Notes</Label>
            <Textarea
              rows={2}
              placeholder="Internal only..."
              {...form.register("internalNotes")}
            />
          </div>

          {/* Conflict Warnings */}
          {(hardConflicts.length > 0 || softConflicts.length > 0) && (
            <div className="space-y-2">
              {hardConflicts.length > 0 && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-red-500 mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Conflicts
                  </div>
                  {hardConflicts.map((c: CrewConflict, i: number) => (
                    <p key={i} className="text-xs text-red-400">
                      {c.label}
                    </p>
                  ))}
                </div>
              )}
              {softConflicts.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-500 mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Warnings
                  </div>
                  {softConflicts.map((c: CrewConflict, i: number) => (
                    <p key={i} className="text-xs text-amber-400">
                      {c.label}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "add" ? "Add to Project" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Message Dialog ──────────────────────────────────────────────────────

function BulkMessageDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: () => sendBulkMessage(projectId, message),
    onSuccess: (result) => {
      toast.success(`Message sent to ${result.sent} crew member(s)`);
      if (result.errors?.length > 0) {
        toast.error(`${result.errors.length} failed to send`);
      }
      onOpenChange(false);
      setMessage("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message Project Crew</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-fg-3">
            Send an email to all active crew members on this project.
          </p>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              rows={5}
              placeholder="Type your message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
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
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !message.trim()}
            >
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <Send className="mr-2 h-4 w-4" />
              Send Message
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
