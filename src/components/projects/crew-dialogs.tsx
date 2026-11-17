"use client";

import { useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Loader2,
  AlertTriangle,
  Send,
  } from "lucide-react";
import { toast } from "sonner";

import { useCrewAssignmentWrites } from "@/hooks/use-crew-assignment-writes";
import { useConvex, useConvexAuth } from "convex/react";
import { api as crewApi } from "../../../convex/_generated/api";
import type { CrewConflict } from "@/lib/crew-availability-types";
import { getStatusIntent, intentBorderClass, intentStyles } from "@/lib/status-colors";
import {
  sendBulkMessage,
  requestCrewAvailability,
} from "@/server/crew-communication";
import { useCrewRoles } from "@/hooks/use-crew";
import { useProjectServices, refreshProjectServices } from "@/hooks/use-project-services";
import { refreshProjectCrew, refreshProjectLabourCost, } from "@/hooks/use-project-crew";
import {
  crewAssignmentSchema,
  type CrewAssignmentFormValues,
} from "@/lib/validations/crew";
import {
  assignmentStatusLabels,
  phaseLabels,
  } from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn, } from "@/lib/utils";
import { scrollToLockStrip } from "@/lib/lock-copy";

import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


// "Any role" sentinel for RequestAvailabilityDialog's role Select (work-layer
// Phase 4, #1246) — not one of the real crewRoleId values.
const ALL = "__all_roles__";

const allStatuses = [
  "PENDING",
  "OFFERED",
  "ACCEPTED",
  "DECLINED",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Assignment = Record<string, any>;

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
export function AssignmentDialog({
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
              Job manager
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

export function BulkMessageDialog({
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
          <DialogTitle>Message job crew</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-ui-text text-muted">
            Send an email to all active crew members on this job.
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

// ─── Request Availability (work-layer Phase 4, #1246, design §8.5) ──────────
// Bulk: pick a service (crewCountRequired lives there), a role and a date
// range; sends the EXISTING offer email to every eligible crew member
// (`requestCrewAvailability`, `src/server/crew-communication.ts`) — first-come
// fill up to the service's required headcount, auto-nudge unanswered after
// 24h (existing notification cron), no SMS.

/** Extracted so the label ternary/`??` chains don't add to the dialog
 *  component's own complexity count (R-3.6). */
function serviceSelectLabel(services: { id: string; title: string }[], serviceId: string): string {
  return services.find((s) => s.id === serviceId)?.title ?? "Select a service…";
}
function roleSelectLabel(roles: { id: string; name: string }[], crewRoleId: string): string {
  if (crewRoleId === ALL) return "Any role";
  return roles.find((r) => r.id === crewRoleId)?.name ?? "Any role";
}
function hasNoCrewCountSet(service: { crewCountRequired: number | null } | undefined): boolean {
  return !!service && !service.crewCountRequired;
}

export function RequestAvailabilityDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const roleDocs = useCrewRoles(open ? orgId : undefined);
  const { data: projectServices = [] } = useProjectServices(open ? projectId : undefined);

  const roles = useMemo(
    () => [...(roleDocs ?? [])].filter((r) => r.isActive === true).sort((a, b) => a.name.localeCompare(b.name)),
    [roleDocs],
  );
  const services = (projectServices as { id: string; title: string; status?: string; crewCountRequired: number | null; crewAssignments: unknown[] }[])
    .filter((s) => s.status !== "CANCELLED");

  const [serviceId, setServiceId] = useState<string>("");
  const [crewRoleId, setCrewRoleId] = useState<string>(ALL);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const selectedService = services.find((s) => s.id === serviceId);

  const mutation = useServerMutation({
    mutationFn: () =>
      requestCrewAvailability({
        projectId,
        serviceId,
        ...(crewRoleId !== ALL ? { crewRoleId } : {}),
        startDate: new Date(startDate).getTime(),
        endDate: new Date(endDate || startDate).getTime(),
      }),
    onSuccess: (result) => {
      if (result.eligible === 0) {
        toast.error("No eligible crew found for that role and date range");
      } else {
        toast.success(`Availability requested from ${result.offered} of ${result.eligible} eligible crew`);
      }
      if (result.errors?.length) toast.error(`${result.errors.length} offer(s) failed to send`);
      onOpenChange(false);
      refreshProjectCrew(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = !!serviceId && !!startDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request availability</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-ui-text text-muted">
            Sends the crew offer email to every eligible, available crew member for the role and
            dates below — first come, first filled, up to the service&apos;s required headcount.
          </p>
          <div className="space-y-1.5">
            <Label>Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger aria-label="Service">
                <SelectValue>{serviceSelectLabel(services, serviceId)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title}
                    {s.crewCountRequired ? ` (needs ${s.crewCountRequired})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasNoCrewCountSet(selectedService) && (
              <p className="text-caption text-muted">
                This service has no crew count set — offers still send, but there&apos;s nothing to
                auto-fill against.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={crewRoleId} onValueChange={setCrewRoleId}>
              <SelectTrigger aria-label="Role">
                <SelectValue>{roleSelectLabel(roles, crewRoleId)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any role</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !canSubmit}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Send className="mr-2 h-4 w-4" />
              Request availability
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
