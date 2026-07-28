"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
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

import { CallSheetDialog } from "@/components/projects/call-sheet-dialog";
import { useCrewAssignmentWrites } from "@/hooks/use-crew-assignment-writes";
import { useSelection } from "./use-selection";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import { useConvex, useConvexAuth } from "convex/react";
import { api as crewApi } from "../../../convex/_generated/api";
import type { CrewConflict } from "@/lib/crew-availability-types";
import { getStatusIntent, intentBorderClass, intentStyles } from "@/lib/status-colors";
import {
  sendCrewOffer,
  sendCrewOfferAll,
  sendBulkMessage,
} from "@/server/crew-communication";
import { useCrewRoles } from "@/hooks/use-crew";
import { useProjectServices, refreshProjectServices } from "@/hooks/use-project-services";
import { useProjectCrew, refreshProjectCrew, useProjectLabourCost, refreshProjectLabourCost, useProjectCrewLiveSync } from "@/hooks/use-project-crew";
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
import { formatCurrency } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import { useProjectLockStatus } from "@/hooks/use-project-lock";
import { resolveLockCopy, scrollToLockStrip } from "@/lib/lock-copy";
import { useJustifiedMutation } from "@/hooks/use-justified-mutation";
import { JustificationDialog } from "./justification-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { CategoryCardHeading } from "./equipment-cards";
import { CanDo } from "@/components/auth/permission-gate";

import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockedField } from "@/components/ui/locked-field";
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

export function CrewPanel({ projectId }: CrewPanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isMobile = useIsMobile();

  // Cross-tab live sync: re-fetch crew + labour cost when another tab changes
  // a crew booking on this project.
  useProjectCrewLiveSync(projectId, orgId);

  // #990 — rate/rateType/estimatedHours are LOCKED_CREW_ASSIGNMENT_FIELDS
  // (convex/lib/projectLocks.ts); locked whenever the tier is anything but
  // OPEN and no unlock session is open (the same `defaultToZero` condition).
  const [lockNow] = useState(() => Date.now());
  const lockStatus = useProjectLockStatus(projectId, orgId, lockNow);
  const rateLocked = !lockStatus.loading && lockStatus.tier !== "OPEN" && !lockStatus.hasOpenSession;
  const rateLockReason = resolveLockCopy(lockStatus, lockNow).oneLiner;

  const [editId, setEditId] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [offerAllOpen, setOfferAllOpen] = useState(false);
  const [removeAssignmentId, setRemoveAssignmentId] = useState<string | null>(null);

  const asgWrites = useCrewAssignmentWrites();
  const { data: assignments, isLoading } = useProjectCrew(projectId, orgId);

  const { data: labourCost } = useProjectLabourCost(projectId, orgId);

  // ─── Conflict flags — sibling batched query (WS8 #947, don't fatten
  // projectCrew, which already collects shifts per row). One call covers
  // every dated assignment on the project; keyed by assignment id. Bounded to
  // the full span of the project's OWN dated assignments (each row's conflict
  // is still classified against its OWN [startDate,endDate] server-side).
  const cpTopConvex = useConvex();
  const { isAuthenticated: cpTopAuthed } = useConvexAuth();
  const datedAssignments = (assignments ?? []).filter((a: Assignment) => a.startDate && a.endDate);
  const conflictRangeStartMs = datedAssignments.length > 0
    ? Math.min(...datedAssignments.map((a: Assignment) => new Date(a.startDate as string).getTime()))
    : null;
  const conflictRangeEndMs = datedAssignments.length > 0
    ? Math.max(...datedAssignments.map((a: Assignment) => new Date(a.endDate as string).getTime()))
    : null;
  const { data: conflictsByAssignmentId } = useServerQuery({
    queryKey: ["crew-table-conflicts", projectId, orgId, conflictRangeStartMs, conflictRangeEndMs, cpTopAuthed],
    queryFn: () =>
      cpTopConvex.query(crewApi.crewAssignments.conflictsForProject, {
        projectId, orgId: orgId as string, rangeStartMs: conflictRangeStartMs as number, rangeEndMs: conflictRangeEndMs as number,
      }),
    enabled: !!orgId && cpTopAuthed && conflictRangeStartMs != null && conflictRangeEndMs != null,
  });

  // #990 — prompts for a reason at ON_SITE+ with no open unlock session.
  const justifiedRemoveAssignment = useJustifiedMutation(
    (args: { id: string; justification?: string }) => asgWrites.remove(args.id, args.justification),
    lockStatus,
  );
  const justifiedBulkRemoveAssignments = useJustifiedMutation(
    (args: { ids: string[]; justification?: string }) => asgWrites.bulkDelete(args.ids, args.justification),
    lockStatus,
  );

  const deleteMutation = useServerMutation({
    mutationFn: (id: string) => justifiedRemoveAssignment.run({ id }),
    onSuccess: () => {
      toast.success("Crew member removed");
      refreshProjectCrew(projectId);
      refreshProjectLabourCost(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const statusMutation = useServerMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      asgWrites.updateStatus(id, status),
    onSuccess: () => {
      toast.success("Status updated");
      refreshProjectCrew(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const offerMutation = useServerMutation({
    mutationFn: (id: string) => sendCrewOffer(id),
    onSuccess: () => {
      toast.success("Offer sent");
      refreshProjectCrew(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const offerAllMutation = useServerMutation({
    mutationFn: () => sendCrewOfferAll(projectId),
    onSuccess: (result) => {
      toast.success(`${result.sent} offer(s) sent`);
      refreshProjectCrew(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Bulk selection ────────────────────────────────────────────────────────
  const selection = useSelection();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const allAssignmentIds: string[] = (assignments ?? []).map((a: Assignment) => a.id as string);
  const selectedAssignmentIds = allAssignmentIds.filter((id) => selection.isSelected(id));
  const allSelected =
    allAssignmentIds.length > 0 && selectedAssignmentIds.length === allAssignmentIds.length;

  const bulkDeleteMut = useServerMutation({
    mutationFn: (ids: string[]) => justifiedBulkRemoveAssignments.run({ ids }),
    onSuccess: (r: { deleted: number; skipped: number }) => {
      toast.success(`Removed ${r.deleted} assignment${r.deleted === 1 ? "" : "s"}`);
      selection.clearSelection();
      setBulkDeleteOpen(false);
      refreshProjectCrew(projectId);
      refreshProjectLabourCost(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkStatusMut = useServerMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      asgWrites.bulkStatus(ids, status),
    onSuccess: (_r, { ids }) => {
      toast.success(`Updated ${ids.length} assignment${ids.length === 1 ? "" : "s"}`);
      selection.clearSelection();
      refreshProjectCrew(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const pendingCount = assignments?.filter(
    (a: Assignment) => a.status === "PENDING"
  ).length || 0;

  // Pre-flight conflict count for the "Offer all" confirm dialog — advisory
  // only, never gates the send (FEATUREDOCS/31, WS8 #947).
  const pendingConflictCount = (assignments ?? []).filter(
    (a: Assignment) => a.status === "PENDING" && conflictsByAssignmentId?.[a.id as string],
  ).length;

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
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-48" />
        <TableSkeleton rows={4} cols={6} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-ui-text text-muted">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            {assignments?.length || 0} crew
          </span>
          {labourCost && (
            <span className="flex items-center gap-1 tabular-nums">
              <DollarSign className="h-4 w-4" />
              Est. labour: {formatCurrency(Number(labourCost.totalLabourCost))}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CanDo resource="crew" action="update">
            {pendingCount > 0 && (
              <Button
                variant="line"
                size="sm"
                onClick={() => setOfferAllOpen(true)}
                disabled={offerAllMutation.isPending}
              >
                <Send className="h-4 w-4" />
                Offer all ({pendingCount})
              </Button>
            )}
            <Button
              variant="line"
              size="sm"
              onClick={() => setMessageOpen(true)}
              disabled={!assignments || assignments.length === 0}
            >
              <MessageSquare className="h-4 w-4" />
              Message
            </Button>
          </CanDo>
          <Button
            variant="line"
            size="sm"
            onClick={() => setCallSheetOpen(true)}
          >
            <FileText className="h-4 w-4" />
            Call sheet
          </Button>
          <CallSheetDialog
            projectId={projectId}
            open={callSheetOpen}
            onOpenChange={setCallSheetOpen}
          />
        </div>
      </div>

      {/* Bulk action bar — appears once one or more assignments are selected. */}
      <BulkActionBar
        count={selectedAssignmentIds.length}
        onClear={selection.clearSelection}
        itemLabel="assignment"
      >
        <CanDo resource="crew" action="update">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="line">
                Set status
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(Object.keys(assignmentStatusLabels)).map((status) => (
                <DropdownMenuItem
                  key={status}
                  onClick={() =>
                    bulkStatusMut.mutate({ ids: selectedAssignmentIds, status })
                  }
                >
                  {assignmentStatusLabels[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CanDo>
        <CanDo resource="crew" action="delete">
          <Button
            size="sm"
            variant="line"
            className="text-destructive"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-3 w-3" />
            Remove
          </Button>
        </CanDo>
      </BulkActionBar>

      {/* Bulk delete confirmation */}
      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Remove selected crew"
        description="This removes the selected crew assignments (and their shifts + linked time entries) from the project."
        count={selectedAssignmentIds.length}
        itemLabel="assignment"
        confirmLabel={`Remove ${selectedAssignmentIds.length} assignment${
          selectedAssignmentIds.length === 1 ? "" : "s"
        }`}
        pending={bulkDeleteMut.isPending}
        onConfirm={() => bulkDeleteMut.mutate(selectedAssignmentIds)}
      />

      {/* #990 — justification prompts backing deleteMutation/bulkDeleteMut above. */}
      <JustificationDialog {...justifiedRemoveAssignment.dialogProps} />
      <JustificationDialog {...justifiedBulkRemoveAssignments.dialogProps} />

      {/* Assignments table */}
      {(!assignments || assignments.length === 0) ? (
        <div className="rounded-[var(--r-lg)] border-2 border-dashed border-line-2 p-7">
          <div className="flex flex-col items-center gap-3 text-center">
            <Users className="h-8 w-8 text-muted" />
            <div className="space-y-1">
              <p className="text-ui-text font-medium text-ink-2">No crew booked yet</p>
              <p className="text-caption text-muted">
                Assign crew from a service above (Add service, or edit an existing one) —
                that&apos;s also where their rate gets set.
              </p>
            </div>
          </div>
        </div>
      ) : (
        // Build the three row sections ONCE, then render them into either the
        // desktop <Table> or a mobile card stack (rows self-branch to <tr> vs
        // card <div> via useIsMobile — see AssignmentRow / PhaseGroup).
        (() => {
          const rows = (
            <>
              {/* Project managers first */}
              {assignments
                .filter((a: Assignment) => a.isProjectManager)
                .map((a: Assignment) => (
                  <AssignmentRow
                    key={a.id as string}
                    assignment={a}
                    conflict={conflictsByAssignmentId?.[a.id as string]}
                    selected={selection.isSelected(a.id as string)}
                    selectionActive={selectedAssignmentIds.length > 0}
                    onSelectChange={() => selection.toggle(a.id as string, true)}
                    onEdit={() => setEditId(a.id as string)}
                    onDelete={() => setRemoveAssignmentId(a.id as string)}
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
                  conflictsByAssignmentId={conflictsByAssignmentId}
                  isSelected={(id) => selection.isSelected(id)}
                  selectionActive={selectedAssignmentIds.length > 0}
                  onSelectChange={(id) => selection.toggle(id, true)}
                  onEdit={(id) => setEditId(id)}
                  onDelete={(id) => setRemoveAssignmentId(id)}
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
                    conflict={conflictsByAssignmentId?.[a.id as string]}
                    selected={selection.isSelected(a.id as string)}
                    selectionActive={selectedAssignmentIds.length > 0}
                    onSelectChange={() => selection.toggle(a.id as string, true)}
                    onEdit={() => setEditId(a.id as string)}
                    onDelete={() => setRemoveAssignmentId(a.id as string)}
                    onStatusChange={(status) =>
                      statusMutation.mutate({ id: a.id as string, status })
                    }
                    onSendOffer={() => offerMutation.mutate(a.id as string)}
                  />
                ))}
            </>
          );

          if (isMobile) {
            return <div className="space-y-1.5">{rows}</div>;
          }

          return (
            <div className="rounded-[var(--r)] border border-line overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <CanDo resource="crew" action="delete">
                        <Checkbox
                          aria-label="Select all crew"
                          checked={allSelected}
                          onCheckedChange={(v: boolean | "indeterminate") =>
                            v === true
                              ? selection.selectAll(allAssignmentIds)
                              : selection.clearSelection()
                          }
                        />
                      </CanDo>
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Conflicts</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>{rows}</TableBody>
              </Table>
            </div>
          );
        })()
      )}

      {/* Edit dialog — crew are only ever CREATED via a service (issue #796); this
          edits an existing assignment's rate/dates/role/status/notes. */}
      {editingAssignment && (
        <AssignmentDialog
          projectId={projectId}
          open={!!editId}
          onOpenChange={(open) => !open && setEditId(null)}
          assignment={editingAssignment}
          locked={rateLocked}
          lockReason={rateLockReason}
        />
      )}

      {/* Bulk message dialog */}
      <BulkMessageDialog
        projectId={projectId}
        open={messageOpen}
        onOpenChange={setMessageOpen}
      />

      <DeleteDialog
        open={offerAllOpen}
        onOpenChange={setOfferAllOpen}
        title={`Send offers to ${pendingCount} crew member${pendingCount === 1 ? "" : "s"}?`}
        description={
          <>
            Each pending crew member receives their offer email or SMS now. They&apos;ll be able
            to accept or decline through their self-service link.
            {pendingConflictCount > 0 && (
              <span className="mt-1.5 block font-medium text-warn">
                {pendingConflictCount} of {pendingCount} have scheduling clashes — this doesn&apos;t block sending.
              </span>
            )}
          </>
        }
        confirmLabel="Send offers"
        cancelLabel="Not yet"
        onConfirm={() => {
          offerAllMutation.mutate();
          setOfferAllOpen(false);
        }}
        pending={offerAllMutation.isPending}
      />
      <DeleteDialog
        open={!!removeAssignmentId}
        onOpenChange={(open) => !open && setRemoveAssignmentId(null)}
        title="Remove crew member from this project?"
        description="The assignment is removed and the crew member is notified if they had accepted. Past timesheets and call sheets are preserved."
        confirmLabel="Remove from project"
        onConfirm={() => {
          if (removeAssignmentId) {
            deleteMutation.mutate(removeAssignmentId);
            setRemoveAssignmentId(null);
          }
        }}
        pending={deleteMutation.isPending}
      />
    </div>
  );
}

// ─── Phase Group ───────────────────────────────────────────────────────────────

function PhaseGroup({
  phase,
  assignments,
  conflictsByAssignmentId,
  isSelected,
  selectionActive,
  onSelectChange,
  onEdit,
  onDelete,
  onStatusChange,
  onSendOffer,
}: {
  phase: string;
  assignments: Assignment[];
  /** WS8 #947 — batched crew-table conflict flags, keyed by assignment id. */
  conflictsByAssignmentId?: Record<string, { severity: "hard" | "soft"; label: string }>;
  isSelected?: (id: string) => boolean;
  selectionActive?: boolean;
  onSelectChange?: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onSendOffer?: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  if (assignments.length === 0) return null;
  return (
    <>
      {isMobile ? (
        <CategoryCardHeading name={phaseLabels[phase] || phase} />
      ) : (
        <TableRow className="bg-paper-2/40 hover:bg-paper-2/40">
          {/* Bumped from 9 → 10 (WS8 #947 — new "Conflicts" column). */}
          <TableCell colSpan={10} className="py-1.5">
            <span className="t-overline text-muted">
              {phaseLabels[phase] || phase}
            </span>
          </TableCell>
        </TableRow>
      )}
      {assignments.map((a) => (
        <AssignmentRow
          key={a.id as string}
          assignment={a}
          conflict={conflictsByAssignmentId?.[a.id as string]}
          selected={isSelected?.(a.id as string)}
          selectionActive={selectionActive}
          onSelectChange={
            onSelectChange ? () => onSelectChange(a.id as string) : undefined
          }
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
  conflict,
  selected,
  selectionActive,
  onSelectChange,
  onEdit,
  onDelete,
  onStatusChange,
  onSendOffer,
}: {
  assignment: Assignment;
  /** WS8 #947 — this row's conflict flag from the batched `conflictsForProject`
   *  sibling query (undefined = no conflict data / no clash). Advisory only. */
  conflict?: { severity: "hard" | "soft"; label: string };
  selected?: boolean;
  selectionActive?: boolean;
  onSelectChange?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
  onSendOffer?: () => void;
}) {
  const isMobile = useIsMobile();

  const member = a.crewMember as {
    id: string;
    firstName: string;
    lastName: string;
    image?: string;
  };
  const role = a.crewRole as { name: string; color?: string } | null;

  // Role pill — reused verbatim between the desktop cell and the mobile card.
  const roleBadge = role ? (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-badge font-medium"
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
    </span>
  ) : null;

  // Conflict badge (WS8 #947) — shared by desktop cell + mobile card.
  const conflictBadge = conflict ? (
    <StatusIndicator category="conflictSeverity" value={conflict.severity} label={conflict.label} variant="pill" />
  ) : null;

  // Inline status control (dropdown pill) — shared by both layouts.
  const statusControl = (
    <CanDo
      resource="crew"
      action="update"
      fallback={
        <StatusIndicator category="assignment" value={a.status as string} label={assignmentStatusLabels[a.status as string] || (a.status as string)} variant="pill" />
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn("inline-flex items-center gap-1 rounded-full px-1 py-0.5", focusRing)}
          >
            <StatusIndicator category="assignment" value={a.status as string} label={assignmentStatusLabels[a.status as string] || (a.status as string)} variant="pill" />
            <ChevronDown className="h-3 w-3 text-muted" />
          </button>
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
  );

  // ⋯ actions menu (edit / send-offer / .ics / remove) — shared by both layouts.
  const actionsMenu = (
    <CanDo resource="crew" action="update">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="touch-target size-8">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit assignment
          </DropdownMenuItem>
          {onSendOffer && a.status === "PENDING" && (
            <DropdownMenuItem onClick={onSendOffer}>
              <Send className="mr-2 h-3.5 w-3.5" />
              Send offer
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
            className="text-t-out"
            onClick={onDelete}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </CanDo>
  );

  // ── Mobile: assignment card. Tapping the body toggles selection; the status
  // pill + ⋯ actions cluster stay live to the right (like the equipment card). ──
  if (isMobile) {
    return (
      <div
        className={cn(
          "flex min-h-11 items-start gap-2 rounded-[var(--r)] bg-card px-3 py-2 ring-1 ring-line transition-colors",
          selected && "ring-2 ring-red",
        )}
      >
        {onSelectChange && (
          <CanDo resource="crew" action="delete">
            <span
              onClick={(e) => e.stopPropagation()}
              className="inline-flex min-h-11 min-w-8 shrink-0 items-center justify-center"
            >
              <Checkbox
                aria-label="Select crew assignment"
                checked={!!selected}
                onCheckedChange={() => onSelectChange()}
              />
            </span>
          </CanDo>
        )}
        <button
          type="button"
          aria-pressed={!!selected}
          onClick={() => onSelectChange?.()}
          className={cn("min-w-0 flex-1 text-left", focusRing)}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {a.isProjectManager && (
              <Star className="h-3.5 w-3.5 shrink-0 text-amber fill-amber" />
            )}
            <span className="break-words font-medium text-ink text-table-cell">
              {member.firstName} {member.lastName}
            </span>
            {roleBadge}
            {a.phase && (
              <span className="text-caption text-muted">
                {phaseLabels[a.phase as string] || (a.phase as string)}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted">
            <span className="flex items-center gap-1 tabular-nums text-ink-2">
              <Calendar className="h-3 w-3 text-muted" />
              {formatDate(a.startDate as string | null)}
              {a.endDate && a.endDate !== a.startDate
                ? ` – ${formatDate(a.endDate as string | null)}`
                : ""}
            </span>
            {a.startTime && (
              <span className="flex items-center gap-1 tabular-nums">
                <Clock className="h-3 w-3" />
                {a.startTime as string}
                {a.endTime ? ` – ${a.endTime as string}` : ""}
              </span>
            )}
            <span className="tabular-nums">
              {a.rateOverride != null && Number(a.rateOverride) > 0 ? (
                <>
                  <span className="text-ink-2">{formatCurrency(a.rateOverride as number)}</span>{" "}
                  {crewRateTypeLabels[(a.rateType as string) || "DAILY"] || ""}
                </>
              ) : (
                "Default rate"
              )}
            </span>
            <span className="tabular-nums font-medium text-ink">
              Est. {formatCurrency(a.estimatedCost as number | null)}
            </span>
          </div>
          {conflictBadge && <div className="mt-1">{conflictBadge}</div>}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {statusControl}
          {actionsMenu}
        </div>
      </div>
    );
  }

  return (
    <TableRow className={cn("group/row", selected && "bg-select")}>
      <TableCell className="w-10">
        {onSelectChange && (
          <span
            className={cn(
              "inline-flex transition-opacity",
              selected || selectionActive
                ? "opacity-100"
                : "opacity-0 pointer-coarse:opacity-100 group-hover/row:opacity-100",
            )}
          >
            <Checkbox
              aria-label="Select crew assignment"
              checked={!!selected}
              onCheckedChange={() => onSelectChange()}
            />
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {a.isProjectManager && (
            <Star className="h-3.5 w-3.5 text-amber fill-amber" />
          )}
          <Link
            href={`/crew/${member.id}`}
            className={cn("font-medium text-ink-2 hover:text-link hover:underline rounded-sm", focusRing)}
          >
            {member.firstName} {member.lastName}
          </Link>
        </div>
      </TableCell>
      <TableCell>
        {roleBadge ?? <span className="text-muted">—</span>}
      </TableCell>
      <TableCell className="text-table-cell text-ink-2">
        {a.phase
          ? phaseLabels[a.phase as string] || (a.phase as string)
          : "—"}
      </TableCell>
      <TableCell className="text-table-cell">
        <div className="flex items-center gap-1 text-ink-2 tabular-nums">
          <Calendar className="h-3 w-3 text-muted" />
          {formatDate(a.startDate as string | null)}
          {a.endDate && a.endDate !== a.startDate
            ? ` – ${formatDate(a.endDate as string | null)}`
            : ""}
        </div>
        {a.startTime && (
          <div className="flex items-center gap-1 text-caption text-muted tabular-nums">
            <Clock className="h-3 w-3" />
            {a.startTime as string}
            {a.endTime ? ` – ${a.endTime as string}` : ""}
          </div>
        )}
      </TableCell>
      <TableCell className="text-table-cell">
        {conflictBadge ?? <span className="text-muted">—</span>}
      </TableCell>
      <TableCell className="text-table-cell tabular-nums">
        {a.rateOverride != null && Number(a.rateOverride) > 0 ? (
          <>
            <span className="text-ink-2">{formatCurrency(a.rateOverride as number)}</span>{" "}
            <span className="text-muted text-caption">
              {crewRateTypeLabels[(a.rateType as string) || "DAILY"] || ""}
            </span>
          </>
        ) : (
          <span className="text-muted">Default</span>
        )}
      </TableCell>
      <TableCell className="text-right text-table-cell font-medium tabular-nums text-ink">
        {formatCurrency(a.estimatedCost as number | null)}
      </TableCell>
      <TableCell>{statusControl}</TableCell>
      <TableCell>{actionsMenu}</TableCell>
    </TableRow>
  );
}

// ─── Assignment Dialog ─────────────────────────────────────────────────────────

interface AssignmentDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: Assignment;
  /** #990 — rate/rateType/estimatedHours render read-only via `<LockedField>`. */
  locked?: boolean;
  lockReason?: string;
}

/** Edits an EXISTING crew assignment (rate, dates, role, phase, status, notes). Crew
 *  are only ever created via a service's rate table now (services-panel.tsx,
 *  issue #796) — there is no "add" mode here anymore. */
function AssignmentDialog({
  projectId,
  open,
  onOpenChange,
  assignment,
  locked,
  lockReason,
}: AssignmentDialogProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const cpConvex = useConvex();
  const { isAuthenticated: cpAuthed } = useConvexAuth();
  const dlgWrites = useCrewAssignmentWrites();

  // Reactive crew roles (Convex), skipped while the dialog is closed (mirrors the
  // old enabled:open). Re-apply getCrewRoleOptions's active filter + sortOrder/
  // name sort and project to the {id,name,department} shape roleOptions expects.
  const roleDocs = useCrewRoles(open ? orgId : undefined);
  const roles = useMemo(
    () =>
      [...(roleDocs ?? [])]
        .filter((r) => r.isActive === true)
        .sort((a, b) => {
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          return so !== 0 ? so : a.name.localeCompare(b.name);
        })
        .map((r) => ({ id: r.id, name: r.name, department: r.department ?? null })),
    [roleDocs],
  );

  const { data: projectServices = [] } = useProjectServices(open ? projectId : undefined);

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
    defaultValues: {
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

  const { data: conflicts } = useServerQuery({
    queryKey: [
      "crew-conflicts",
      watchCrewMemberId,
      startDateStr,
      endDateStr,
      assignment.id,
    ],
    queryFn: () =>
      cpConvex.query(crewApi.crewAvailability.conflicts, {
        orgId: orgId as string,
        crewMemberId: watchCrewMemberId,
        startMs: new Date(startDateStr).getTime(),
        endMs: new Date(endDateStr).getTime(),
        excludeAssignmentId: assignment.id as string,
      }),
    enabled: !!watchCrewMemberId && !!startDateStr && !!endDateStr && !!orgId && cpAuthed,
  });

  const hardConflicts = (conflicts || []).filter(
    (c: CrewConflict) => c.severity === "hard"
  );
  const softConflicts = (conflicts || []).filter(
    (c: CrewConflict) => c.severity === "soft"
  );

  const updateMut = useServerMutation({
    mutationFn: (data: CrewAssignmentFormValues) =>
      dlgWrites.update(assignment.id as string, data),
    onSuccess: () => {
      toast.success("Assignment updated");
      refreshProjectCrew(projectId);
      refreshProjectLabourCost(projectId);
      refreshProjectServices(projectId);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = (data: CrewAssignmentFormValues) => {
    updateMut.mutate(data);
  };

  const isPending = updateMut.isPending;

  const roleOptions = (roles || []).map(
    (r: { id: string; name: string; department: string | null }) => ({
      value: r.id,
      label: r.name,
      description: r.department || undefined,
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
          <DialogTitle>Edit assignment</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Service */}
          {serviceOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Linked service</Label>
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
              onChange={(v) => form.setValue("crewRoleId", v)}
              placeholder="Select role..."
              allowClear
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
                <SelectValue placeholder="Select phase...">{phaseLabels[(form.watch("phase") ?? "")] ?? form.watch("phase")}</SelectValue>
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
              <Label>Start date</Label>
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
              <Label>End date</Label>
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
              <Label>Start time</Label>
              <Input
                type="time"
                {...form.register("startTime")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End time</Label>
              <Input
                type="time"
                {...form.register("endTime")}
              />
            </div>
          </div>

          {/* Rate override + rate type + estimated hours — the full
              LOCKED_CREW_ASSIGNMENT_FIELDS set, wrapped together (#990). */}
          <LockedField
            locked={!!locked}
            reason={lockReason ?? "Pricing is locked."}
            exitLabel="Unlock financials"
            onExit={scrollToLockStrip}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Rate override</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Use default"
                  {...form.register("rateOverride")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rate type</Label>
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
                    <SelectValue placeholder="Default">{form.watch("rateType") === "DAILY" ? "Daily" : form.watch("rateType") === "HOURLY" ? "Hourly" : form.watch("rateType") === "FLAT" ? "Flat" : form.watch("rateType")}</SelectValue>
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
            <div className="space-y-1.5 pt-3">
              <Label>Estimated hours</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                placeholder="For hourly rate calculation"
                {...form.register("estimatedHours")}
              />
            </div>
          </LockedField>

          {/* Status */}
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
                <SelectValue>{assignmentStatusLabels[form.watch("status") ?? ""] ?? form.watch("status")}</SelectValue>
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
              Project manager
            </Label>
          </div>

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
            <Label>Internal notes</Label>
            <Textarea
              rows={2}
              placeholder="Internal only..."
              {...form.register("internalNotes")}
            />
          </div>

          {/* Conflict Warnings — colors sourced from the shared "conflictSeverity"
              intent (status-colors.ts, WS8 #947) instead of hardcoded
              border-l-t-out/border-l-warn strings, so this stays visually
              consistent with the picker badges + crew-table conflict column. */}
          {(hardConflicts.length > 0 || softConflicts.length > 0) && (
            <div className="space-y-2">
              {hardConflicts.length > 0 && (() => {
                const hardIntent = getStatusIntent("conflictSeverity", "hard");
                return (
                  <div className={cn("rounded-[var(--r)] border border-line border-l-[3px] bg-card p-3", intentBorderClass(hardIntent))}>
                    <div className={cn("flex items-center gap-2 text-ui-text font-semibold mb-1", intentStyles[hardIntent].text)}>
                      <AlertTriangle className="h-4 w-4" />
                      Conflicts
                    </div>
                    {hardConflicts.map((c: CrewConflict, i: number) => (
                      <p key={i} className={cn("text-caption", intentStyles[hardIntent].text)}>
                        {c.label}
                      </p>
                    ))}
                  </div>
                );
              })()}
              {softConflicts.length > 0 && (() => {
                const softIntent = getStatusIntent("conflictSeverity", "soft");
                return (
                  <div className={cn("rounded-[var(--r)] border border-line border-l-[3px] bg-card p-3", intentBorderClass(softIntent))}>
                    <div className={cn("flex items-center gap-2 text-ui-text font-semibold mb-1", intentStyles[softIntent].text)}>
                      <AlertTriangle className="h-4 w-4" />
                      Warnings
                    </div>
                    {softConflicts.map((c: CrewConflict, i: number) => (
                      <p key={i} className={cn("text-caption", intentStyles[softIntent].text)}>
                        {c.label}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="line"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
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

  const mutation = useServerMutation({
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
          <DialogTitle>Message project crew</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-ui-text text-muted">
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
              variant="line"
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
              Send message
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
