"use client";

import { useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { refreshProjectServices, refreshProjectServicesSummary, } from "@/hooks/use-project-services";
import { refreshProjectCrew } from "@/hooks/use-project-crew";
import { useServerQuery } from "@/hooks/use-server-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Loader2,
  Send,
  UserCheck,
  Copy,
  ArrowRightLeft,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import {
  updateServiceCrewStatus,
  generateCrewMessage,
} from "@/server/project-services";
import { useProjectServiceWrites } from "@/hooks/use-project-service-writes";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { useCrewRoles } from "@/hooks/use-crew";
import { useConvex, useConvexAuth } from "convex/react";
import { api as crewAsgApi } from "../../../convex/_generated/api";
import {
  projectServiceSchema,
  type ProjectServiceFormValues,
} from "@/lib/validations/project-service";
import { SERVICE_TYPE_LABELS, } from "@/lib/constants/services";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { resolveRate, calculateEstimatedCost, resolveChargeRate } from "../../../convex/lib/crewRate";
import { useIsManagerPlus } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { formatCurrency } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { PersonAvatar } from "@/components/ui/avatar";
import { ComboboxPicker, MultiComboboxPicker } from "@/components/ui/combobox-picker";
import { XeroAccountCodeField, XeroTaxTypeField } from "@/components/settings/xero-coding-fields";
import { defaultServiceDay, type ServiceStatus, type ServiceType } from "@/lib/logistics-model";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockedField } from "@/components/ui/locked-field";
import { Textarea } from "@/components/ui/textarea";
import { useProjectPricingLock } from "@/hooks/use-project-lock";
import { resolveLockCopy, scrollToLockStrip } from "@/lib/lock-copy";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AddressInput } from "@/components/ui/address-input";
import type { PlaceResult } from "@/lib/address-autocomplete";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Constants ────────────────────────────────────────────────────────────────

interface ServiceRow {
  id: string;
  type: ServiceType;
  title: string;
  description: string | null;
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  scheduledTime: string | null;
  status: ServiceStatus;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  showOnDocuments: boolean;
  unitPrice: number | null;
  lineTotal: number | null;
  costTotal: number | null;
  chargeRateOverride: number | null;
  crewChargeTotal: number | null;
  discount: number | null;
  vehicleDescription: string | null;
  crewCountRequired: number | null;
  crewRoleId: string | null;
  crewRole: { id: string; name: string; color: string | null } | null;
  crewAssignments: {
    id: string;
    status: string;
    estimatedCost: number | null;
    crewMember: { id: string; firstName: string; lastName: string; image: string | null };
    rateOverride: number | null;
    rateType: string | null;
    estimatedHours: number | null;
    resolvedRate: number;
    resolvedRateType: string;
  }[];
}

// ─── Clone Services Dialog ────────────────────────────────────────────────────

export function CloneServicesDialog({
  open,
  onOpenChange,
  targetProjectId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetProjectId: string;
  onSuccess: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const svcWrites = useProjectServiceWrites();
  const [sourceProjectId, setSourceProjectId] = useState("");

  // Fetch recent projects to pick from
  const { data: projects = [] } = useServerQuery({
    queryKey: ["projects-list", orgId],
    queryFn: async () => {
      const { getProjects } = await import("@/server/projects");
      return getProjects();
    },
    enabled: open,
  });

  const projectOptions = (projects as { id: string; projectNumber: string; name: string }[])
    .filter((p) => p.id !== targetProjectId)
    .map((p) => ({
      value: p.id,
      label: `${p.projectNumber} — ${p.name}`,
    }));

  const cloneMutation = useServerMutation({
    mutationFn: () => svcWrites.clone(targetProjectId, sourceProjectId),
    onSuccess: (result) => {
      const r = result as { cloned: number };
      toast.success(`Cloned ${r.cloned} services`);
      onOpenChange(false);
      setSourceProjectId("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Import services</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-ink-2">
          Clone services from a previous job. Dates will be automatically adjusted to match this job.
        </p>
        <div className="space-y-1.5">
          <Label>Source job</Label>
          <ComboboxPicker
            value={sourceProjectId}
            onChange={setSourceProjectId}
            options={projectOptions}
            placeholder="Search jobs..."
            searchPlaceholder="Search by name or number..."
            emptyMessage="No jobs found"
          />
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => cloneMutation.mutate()}
            disabled={!sourceProjectId || cloneMutation.isPending}
          >
            {cloneMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Clone services
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Crew Message Dialog ──────────────────────────────────────────────────────

export function CrewMessageDialog({
  open,
  onOpenChange,
  projectId,
  crewMemberId,
  crewMemberName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  crewMemberId: string;
  crewMemberName: string;
}) {
  const { data: messageData, isLoading } = useServerQuery({
    queryKey: ["crew-message", projectId, crewMemberId],
    queryFn: () => generateCrewMessage(projectId, crewMemberId),
    enabled: open && !!crewMemberId,
  });

  const msg = messageData as {
    message: string;
    crewMemberName: string;
    crewMemberPhone: string | null;
    crewMemberEmail: string | null;
  } | undefined;

  function copyToClipboard() {
    if (msg?.message) {
      navigator.clipboard.writeText(msg.message);
      toast.success("Message copied to clipboard");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message for {crewMemberName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : msg ? (
          <div className="space-y-3">
            {(msg.crewMemberPhone || msg.crewMemberEmail) && (
              <div className="flex items-center gap-3 text-ui-text text-muted">
                {msg.crewMemberPhone && (
                  <a href={`tel:${msg.crewMemberPhone}`} className={cn("text-link hover:underline rounded-sm", focusRing)}>
                    {msg.crewMemberPhone}
                  </a>
                )}
                {msg.crewMemberEmail && (
                  <a href={`mailto:${msg.crewMemberEmail}`} className={cn("text-link hover:underline rounded-sm", focusRing)}>
                    {msg.crewMemberEmail}
                  </a>
                )}
              </div>
            )}
            <pre className="whitespace-pre-wrap rounded-[var(--r)] border border-line bg-paper-2 p-3 text-ui-text text-ink-2 font-sans">
              {msg.message}
            </pre>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={copyToClipboard} disabled={!msg?.message}>
            <Copy className="mr-2 h-4 w-4" />
            Copy message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Crew Helpers ─────────────────────────────────────────────────────────────

/** A single crew-conflict entry (WS8 #947) — matches the shape
 *  `crewAssignments.membersForAssignment`'s range branch returns per member. */
interface CrewConflictEntry {
  severity: "hard" | "soft";
  label: string;
}

/** The conflict/availability summary `membersForAssignment` attaches to every
 *  member row — shared by the picker badge, the rate-table sub-line, and the
 *  section-level "N of M selected have clashes" summary (WS8 #947). */
export interface CrewConflictSummary {
  conflicts: CrewConflictEntry[];
  isUnavailable: boolean;
  availability: "available" | "tentative" | "unavailable" | "busy";
  hasPreferredBlock: boolean;
}

/**
 * ONE badge per member, precedence: unavailable/hard-conflict (red, "Booked:"/
 * "Unavailable") > tentative/soft-conflict (amber, "Tentative"/"Pencilled:")
 * > a positive PREFERRED hint (green) > nothing. Advisory only — never gates
 * the picker, the rate table, or submit (FEATUREDOCS/31).
 */
export function pickConflictBadge(m: CrewConflictSummary | undefined): { severity: "hard" | "soft" | "preferred"; label: string } | null {
  if (!m) return null;
  if (m.isUnavailable) return { severity: "hard", label: "Unavailable" };
  const hardConflict = m.conflicts.find((c) => c.severity === "hard");
  if (hardConflict) return { severity: "hard", label: hardConflict.label };
  if (m.availability === "tentative") return { severity: "soft", label: "Tentative" };
  const softConflict = m.conflicts.find((c) => c.severity === "soft");
  if (softConflict) return { severity: "soft", label: softConflict.label };
  if (m.hasPreferredBlock) return { severity: "preferred", label: "Preferred" };
  return null;
}

function CrewMemberSelect({
  needed,
  values,
  onChange,
  options,
}: {
  needed: number;
  values: string[];
  onChange: (ids: string[]) => void;
  options: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        Assign crew members
        <CrewCountBadge needed={needed} assigned={values.length} />
      </Label>
      <MultiComboboxPicker
        values={values}
        onChange={onChange}
        options={options}
        placeholder="Search and select crew..."
        searchPlaceholder="Search crew members..."
        emptyMessage="No crew members available"
        showSelectedTags={false}
      />
    </div>
  );
}

function CrewCountBadge({ needed, assigned }: { needed: number; assigned: number }) {
  if (needed <= 0 && assigned <= 0) return null;
  const color = needed <= 0
    ? "text-muted"
    : assigned > needed
      ? "text-t-out"
      : assigned === needed
        ? "text-ok"
        : "text-warn";
  return (
    <span className={`text-caption font-normal ${color}`}>
      ({assigned}/{needed || "?"})
    </span>
  );
}

// ─── Crew Rate Table (issue #796) ─────────────────────────────────────────────
//
// Per-crew-member rate table shown inside the service dialog once 1+ crew are
// assigned. Each row's override writes to that CrewAssignment.rateOverride (via the
// existing rate cascade — resolveRate/calculateEstimatedCost, convex/lib/crewRate.ts).
// The displayed rate/cost is a live client-side PREVIEW of that same cascade; the
// server always recomputes authoritatively on save (POLICY.md R-9.3 — no money
// originates from the client).

type ServiceCrewTableRow = { crewMemberId: string; rateOverride?: number; rateType?: "" | "HOURLY" | "DAILY" | "FLAT"; estimatedHours?: number };
type CrewRateTableMember = { id: string; firstName: string; lastName: string; image: string | null } & CrewConflictSummary;

const memberDisplayName = (member: CrewRateTableMember | undefined, fallback: string): string =>
  member ? `${member.firstName} ${member.lastName}` : fallback;

/** "" | undefined → undefined, otherwise parse to a number — shared by the rate
 *  override and hours inputs below. */
const parseOptionalNumber = (v: string): number | undefined => (v === "" ? undefined : Number(v));

function CrewRateTable({
  rows,
  crewMemberById,
  previewCost,
  onChangeRow,
  onRemoveRow,
  total,
}: {
  rows: ServiceCrewTableRow[];
  crewMemberById: Map<string, CrewRateTableMember>;
  previewCost: (row: ServiceCrewTableRow) => { rate: number; rateType: string; cost: number };
  onChangeRow: (crewMemberId: string, patch: Partial<ServiceCrewTableRow>) => void;
  onRemoveRow: (crewMemberId: string) => void;
  total: number;
}) {
  // Hours only applies to hourly-rated rows — the column is dropped entirely
  // (not just blanked per-row) when nothing on the service is hourly, so the
  // common daily/flat case stays a tight 4-column table.
  const showHours = rows.some((row) => (row.rateType || previewCost(row).rateType) === "HOURLY");
  const labelColSpan = showHours ? 3 : 2;

  return (
    <div className="space-y-1.5">
      <Label>Crew rates</Label>
      <div className="rounded-[var(--r)] border border-line overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Crew</TableHead>
              <TableHead>Rate</TableHead>
              {showHours && <TableHead className="text-right">Hours</TableHead>}
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <CrewRateTableRow
                key={row.crewMemberId}
                row={row}
                member={crewMemberById.get(row.crewMemberId)}
                previewCost={previewCost}
                onChangeRow={onChangeRow}
                onRemoveRow={onRemoveRow}
                showHours={showHours}
              />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={labelColSpan} className="font-medium text-ink-2">
                Total labour cost
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-ink">
                {formatCurrency(total)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

function CrewRateTableRow({
  row,
  member,
  previewCost,
  onChangeRow,
  onRemoveRow,
  showHours,
}: {
  row: ServiceCrewTableRow;
  member: CrewRateTableMember | undefined;
  previewCost: (row: ServiceCrewTableRow) => { rate: number; rateType: string; cost: number };
  onChangeRow: (crewMemberId: string, patch: Partial<ServiceCrewTableRow>) => void;
  onRemoveRow: (crewMemberId: string) => void;
  /** Whether the table is rendering the Hours column at all (see CrewRateTable). */
  showHours: boolean;
}) {
  const { rate, rateType, cost } = previewCost(row);
  const effectiveRateType = row.rateType || rateType;
  // Conflict sub-line (WS8 #947) — the existing sub-line slot under the name,
  // same badge the picker row shows (pickConflictBadge, one source of truth).
  const conflictBadge = pickConflictBadge(member);

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <PersonAvatar name={memberDisplayName(member, "?")} src={member?.image ?? undefined} className="size-6 shrink-0" />
          <div className="min-w-0">
            <span className="block truncate font-medium text-ink-2">{memberDisplayName(member, "Unknown")}</span>
            {conflictBadge && (
              <StatusIndicator category="conflictSeverity" value={conflictBadge.severity} label={conflictBadge.label} variant="pill" />
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {/* Amount + unit rendered as one joined control (shared border) so the
            row reads as a single "Rate" field despite being two inputs. */}
        <div className="flex w-fit">
          <Input
            type="number"
            step="0.01"
            min={0}
            value={row.rateOverride ?? ""}
            onChange={(e) => onChangeRow(row.crewMemberId, { rateOverride: parseOptionalNumber(e.target.value) })}
            placeholder={formatCurrency(rate)}
            aria-label="Rate override"
            className="h-7 w-[72px] rounded-r-none border-r-0 text-caption"
          />
          <Select
            value={effectiveRateType}
            onValueChange={(v) => onChangeRow(row.crewMemberId, { rateType: v as ServiceCrewTableRow["rateType"] })}
          >
            <SelectTrigger aria-label="Rate type" className="h-7 w-[72px] rounded-l-none text-caption">
              <SelectValue>{crewRateTypeLabels[effectiveRateType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="HOURLY">Hourly</SelectItem>
              <SelectItem value="FLAT">Flat</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </TableCell>
      {showHours && (
        <TableCell className="text-right">
          {effectiveRateType === "HOURLY" ? (
            <Input
              type="number"
              step="0.5"
              min={0}
              value={row.estimatedHours ?? ""}
              onChange={(e) => onChangeRow(row.crewMemberId, { estimatedHours: parseOptionalNumber(e.target.value) })}
              aria-label="Estimated hours"
              className="ml-auto h-7 w-16 text-right text-caption"
            />
          ) : (
            <span className="text-muted">—</span>
          )}
        </TableCell>
      )}
      <TableCell className="text-right font-medium tabular-nums text-ink whitespace-nowrap">
        {formatCurrency(cost)}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="touch-target size-7 shrink-0"
          onClick={() => onRemoveRow(row.crewMemberId)}
          aria-label={`Remove ${memberDisplayName(member, "crew member")}`}
        >
          <X className="h-3.5 w-3.5 text-muted" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ─── Create/Edit Dialog ───────────────────────────────────────────────────────

export function ServiceDialog({
  open,
  onOpenChange,
  projectId,
  editingService,
  preselectedType,
  templates,
  projectAddress,
  projectLatitude,
  projectLongitude,
  projectLoadInDate,
  projectLoadOutDate,
  projectEventStartDate,
  projectEventEndDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editingService: Record<string, unknown> | null;
  preselectedType: ServiceType | null;
  templates: Record<string, unknown>[];
  projectAddress?: string;
  projectLatitude?: number | null;
  projectLongitude?: number | null;
  projectLoadInDate?: string;
  projectLoadOutDate?: string;
  projectEventStartDate?: string;
  projectEventEndDate?: string;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();
  const isEditing = !!editingService;
  const isManagerPlus = useIsManagerPlus();
  const svcWrites = useProjectServiceWrites();
  const xeroLinked = useXeroLinked();

  // #990 — unitPrice/discount/costTotal are the fields `updateServiceNative`'s
  // `moneyChanged` check gates as "financial" (an unchanged resend is
  // "structural" and passes even locked — see convex/projectServicesWrites.ts);
  // a new service's price fields are force-zeroed the same way
  // (`createServiceNative`'s `guard.defaultToZero`). `chargeRateOverride` is
  // NOT in that gate today, so it's deliberately left editable here too —
  // wrapping it would be a UI lie the server doesn't back up.
  const svcLockStatus = useProjectPricingLock(open ? projectId : undefined, orgId);
  const svcMoneyLocked = svcLockStatus.pricingLocked;
  const svcLockReason = resolveLockCopy(svcLockStatus).oneLiner;

  const matchingTemplate = preselectedType
    ? templates.find((t) => t.type === preselectedType && t.isActive)
    : null;

  // One definition of "which day does a new <type> default to" (logistics-model.ts),
  // shared with the Logistics AddBar's quick add.
  function getDefaultDate(type: ServiceType | null): string {
    return defaultServiceDay(type, {
      start: projectLoadInDate || projectEventStartDate || "",
      end: projectLoadOutDate || projectEventEndDate || "",
    });
  }

  const defaultAddress = projectAddress || "";
  const defaultLat = projectLatitude ?? null;
  const defaultLng = projectLongitude ?? null;

  const defaultValues: ProjectServiceFormValues = editingService
    ? {
        type: editingService.type as ServiceType,
        title: editingService.title as string,
        description: (editingService.description as string) || "",
        notes: (editingService.notes as string) || "",
        date: editingService.date
          ? new Date(editingService.date as string).toISOString().slice(0, 10)
          : "",
        endDate: editingService.endDate
          ? new Date(editingService.endDate as string).toISOString().slice(0, 10)
          : editingService.date
            ? new Date(editingService.date as string).toISOString().slice(0, 10)
            : "",
        startTime: (editingService.startTime as string) || "",
        endTime: (editingService.endTime as string) || "",
        scheduledTime: (editingService.scheduledTime as string) || "",
        estimatedDuration: (editingService.estimatedDuration as number) || undefined,
        address: (editingService.address as string) || "",
        latitude: editingService.latitude as number | null,
        longitude: editingService.longitude as number | null,
        showOnDocuments: (editingService.showOnDocuments as boolean) || false,
        unitPrice: (editingService.unitPrice as number) || undefined,
        discount: (editingService.discount as number) || undefined,
        costTotal: (editingService.costTotal as number) || undefined,
        chargeRateOverride: (editingService.chargeRateOverride as number) || undefined,
        taxable: editingService.taxable !== false,
        vehicleDescription: (editingService.vehicleDescription as string) || "",
        numberOfTrips: (editingService.numberOfTrips as number) || undefined,
        crewCountRequired: (editingService.crewCountRequired as number) || undefined,
        crewRoleId: (editingService.crewRoleId as string) || "",
        xeroAccountCode: (editingService.xeroAccountCode as string) || undefined,
        xeroTaxType: (editingService.xeroTaxType as string) || undefined,
        crew: editingService.crewAssignments
          ? (editingService.crewAssignments as ServiceRow["crewAssignments"])
              .filter((a): a is typeof a & { crewMember: NonNullable<typeof a.crewMember> } => !!a.crewMember)
              .map((a) => ({
                crewMemberId: a.crewMember.id,
                rateOverride: a.rateOverride ?? undefined,
                rateType: (a.rateType as "HOURLY" | "DAILY" | "FLAT" | null) || "",
                estimatedHours: a.estimatedHours ?? undefined,
              }))
          : [],
      }
    : {
        type: preselectedType || "MISC",
        title: preselectedType ? SERVICE_TYPE_LABELS[preselectedType] : "",
        description: (matchingTemplate?.description as string) || "",
        notes: "",
        date: getDefaultDate(preselectedType),
        endDate: getDefaultDate(preselectedType),
        startTime: "",
        endTime: "",
        scheduledTime: "",
        address: defaultAddress,
        latitude: defaultLat,
        longitude: defaultLng,
        showOnDocuments: (matchingTemplate?.showOnDocuments as boolean) || false,
        unitPrice: (matchingTemplate?.defaultUnitPrice as number) || undefined,
        discount: undefined,
        taxable: true,
        vehicleDescription: (matchingTemplate?.defaultVehicle as string) || "",
        numberOfTrips: undefined,
        crewCountRequired: (matchingTemplate?.defaultCrewCount as number) || undefined,
        crewRoleId: "",
        crew: [],
      };

  const form = useForm<ProjectServiceFormValues>({
    resolver: zodResolver(projectServiceSchema),
    defaultValues,
    values: open ? defaultValues : undefined,
  });

  const watchType = form.watch("type") as ServiceType;
  const showAddress = watchType === "DELIVERY" || watchType === "PICKUP" || watchType === "MISC";
  const showVehicle = watchType === "DELIVERY" || watchType === "PICKUP";
  const canBeMultiDay = watchType === "BUMP_IN" || watchType === "BUMP_OUT" || watchType === "LABOUR";
  const watchDate = form.watch("date") as string;
  const watchEndDate = form.watch("endDate") as string;
  const isCurrentlyMultiDay = canBeMultiDay && watchDate && watchEndDate && watchDate !== watchEndDate;

  // Service date range as epoch-ms (WS8 #947 — the whole #796 conflict-badge
  // gap: this was already computed further down for the cost preview but
  // never passed to the crew query). Computed here, ABOVE the query, so both
  // the query args and the cost preview below share the one calculation.
  const serviceRangeStartMs = watchDate ? new Date(watchDate).getTime() : null;
  const serviceRangeEndMs = (watchEndDate || watchDate) ? new Date(watchEndDate || watchDate).getTime() : null;
  const excludeServiceId = (editingService?.id as string | undefined) ?? undefined;

  // Reactive crew roles (Convex), skipped while closed (mirrors enabled:open).
  // Re-apply getCrewRoleOptions's active filter + sortOrder/name sort.
  const roleDocs = useCrewRoles(open ? orgId : undefined);
  const roleOptions = useMemo(
    () =>
      [...(roleDocs ?? [])]
        .filter((r) => r.isActive === true)
        .sort((a, b) => {
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          return so !== 0 ? so : a.name.localeCompare(b.name);
        })
        .map((r) => ({ value: r.id, label: r.name })),
    [roleDocs],
  );

  const spConvex = useConvex();
  const { isAuthenticated: spAuthed } = useConvexAuth();
  const { data: crewMembers = [] } = useServerQuery({
    queryKey: ["crew-members-for-assignment", orgId, projectId, serviceRangeStartMs, serviceRangeEndMs, excludeServiceId, spAuthed],
    queryFn: () =>
      spConvex.query(crewAsgApi.crewAssignments.membersForAssignment, {
        projectId,
        orgId: orgId as string,
        rangeStartMs: serviceRangeStartMs ?? undefined,
        rangeEndMs: serviceRangeEndMs ?? undefined,
        excludeServiceId,
      }),
    enabled: open && !!orgId && spAuthed,
  });

  type CrewMemberOption = {
    id: string;
    firstName: string;
    lastName: string;
    image: string | null;
    defaultDayRate: number | null;
    defaultHourlyRate: number | null;
  } & CrewConflictSummary;
  const crewMemberDocs = crewMembers as CrewMemberOption[];
  const crewMemberById = new Map(crewMemberDocs.map((m) => [m.id, m]));
  const hasServiceDates = serviceRangeStartMs != null && serviceRangeEndMs != null;

  const crewMemberOptions: { value: string; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] =
    crewMemberDocs.map((m) => {
      const badge = pickConflictBadge(m);
      return {
        value: m.id,
        label: `${m.firstName} ${m.lastName}`,
        icon: (
          <PersonAvatar
            name={`${m.firstName} ${m.lastName}`}
            src={m.image ?? undefined}
            className="size-6"
          />
        ),
        // Non-searchable slot (combobox-picker.tsx) — a StatusIndicator dot+label,
        // never plain text in `description` (WS8 #947).
        badge: badge ? (
          <StatusIndicator category="conflictSeverity" value={badge.severity} label={badge.label} variant="pill" />
        ) : undefined,
      };
    });

  type ServiceCrewRow = { crewMemberId: string; rateOverride?: number; rateType?: "" | "HOURLY" | "DAILY" | "FLAT"; estimatedHours?: number };
  const watchCrew = (form.watch("crew") || []) as ServiceCrewRow[];
  const watchCrewMemberIds = watchCrew.map((c) => c.crewMemberId);
  const watchCrewNeeded = Number(form.watch("crewCountRequired") || 0);
  // Section-level + bulk pre-flight count (WS8 #947) — selected members with a
  // hard OR soft clash (a "preferred" hint doesn't count as a clash).
  const selectedConflictCount = watchCrewMemberIds.filter((id) => {
    const badge = pickConflictBadge(crewMemberById.get(id));
    return badge != null && badge.severity !== "preferred";
  }).length;
  const setCrewMemberIds = (ids: string[]) => {
    const existing = new Map(watchCrew.map((c) => [c.crewMemberId, c]));
    form.setValue("crew", ids.map((id) => existing.get(id) ?? { crewMemberId: id }));
  };
  const updateCrewRow = (crewMemberId: string, patch: Partial<ServiceCrewRow>) => {
    form.setValue(
      "crew",
      watchCrew.map((c) => (c.crewMemberId === crewMemberId ? { ...c, ...patch } : c)),
    );
  };

  // Selected crew role doc (for the rate-cascade fallback) — all crew on a service
  // currently share the one service-level role (per-row role overrides aren't a thing
  // in this dialog), mirroring updateServiceNative's role-patch-all-survivors behaviour.
  const watchCrewRoleId = form.watch("crewRoleId") as string;
  const selectedCrewRole = (roleDocs ?? []).find((r) => r.id === watchCrewRoleId) ?? null;
  const rateOverrideUnitSuffix = selectedCrewRole?.rateType ? ` / ${crewRateTypeLabels[selectedCrewRole.rateType].toLowerCase()}` : "";
  // serviceRangeStartMs/serviceRangeEndMs computed once, above the crew query.
  const serviceStartMs = serviceRangeStartMs;
  const serviceEndMs = serviceRangeEndMs;

  /** Live client-side preview of the SAME cascade the server runs (convex/lib/crewRate.ts) —
   *  UX only, never authoritative; the server always recomputes on save (issue #796). */
  function previewCrewCost(row: ServiceCrewRow): { rate: number; rateType: string; cost: number } {
    const member = crewMemberById.get(row.crewMemberId);
    const { rate, rateType } = resolveRate(
      row.rateOverride,
      row.rateType || null,
      { defaultDayRate: member?.defaultDayRate ?? null, defaultHourlyRate: member?.defaultHourlyRate ?? null },
      selectedCrewRole ? { defaultRate: selectedCrewRole.defaultRate ?? null, rateType: selectedCrewRole.rateType ?? null } : null,
    );
    const cost = calculateEstimatedCost(rate, rateType, serviceStartMs, serviceEndMs, row.estimatedHours ?? null);
    return { rate, rateType, cost };
  }

  const crewCostTotal = watchCrew.reduce((sum, row) => sum + previewCrewCost(row).cost, 0);

  /** Live client-side preview of the charge-side cascade (convex/lib/crewRate.ts
   *  resolveChargeRate) — UX only, mirrors previewCrewCost. Role-first, no member
   *  level (spec decision — client pricing shouldn't wobble per crew member): the
   *  service's chargeRateOverride, else the selected role's chargeRate, else null
   *  (this member contributes nothing to the auto-price). */
  const watchChargeRateOverrideRaw = form.watch("chargeRateOverride");
  const watchChargeRateOverride = watchChargeRateOverrideRaw != null && watchChargeRateOverrideRaw !== ("" as unknown)
    ? Number(watchChargeRateOverrideRaw)
    : undefined;
  function previewChargeCost(row: ServiceCrewRow): number {
    const resolved = resolveChargeRate(
      watchChargeRateOverride,
      selectedCrewRole ? { chargeRate: selectedCrewRole.chargeRate ?? null, rateType: selectedCrewRole.rateType ?? null } : null,
    );
    if (!resolved) return 0;
    return calculateEstimatedCost(resolved.rate, resolved.rateType, serviceStartMs, serviceEndMs, row.estimatedHours ?? null);
  }
  const anyChargeResolved = watchCrew.length > 0 && (
    watchChargeRateOverride != null && Number(watchChargeRateOverride) > 0
      ? true
      : selectedCrewRole?.chargeRate != null && Number(selectedCrewRole.chargeRate) > 0
  );
  const crewChargeTotalPreview = anyChargeResolved ? watchCrew.reduce((sum, row) => sum + previewChargeCost(row), 0) : 0;

  const invalidateAll = () => {
    refreshProjectServices(projectId);
    refreshProjectServicesSummary(projectId);
    refreshProjectDetail(projectId);
    refreshProjectCrew(projectId);
  };

  const createMutation = useServerMutation({
    mutationFn: (data: ProjectServiceFormValues) =>
      svcWrites.create(projectId, data),
    onSuccess: () => {
      toast.success("Service added");
      invalidateAll();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: ProjectServiceFormValues) =>
      svcWrites.update(editingService!.id as string, data),
    onSuccess: () => {
      toast.success("Service updated");
      invalidateAll();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const crewStatusMutation = useServerMutation({
    mutationFn: ({ status }: { status: "OFFERED" | "CONFIRMED" | "CANCELLED" }) =>
      updateServiceCrewStatus(editingService!.id as string, status),
    onSuccess: (result, { status }) => {
      const labels: Record<string, string> = {
        OFFERED: "Offers sent",
        CONFIRMED: "Crew confirmed",
        CANCELLED: "Crew cancelled",
      };
      toast.success(`${labels[status]} (${(result as { updated: number }).updated} updated)`);
      invalidateAll();
      setCrewBulkAction(null);
    },
    onError: (e) => toast.error(e.message),
  });

  // "Send offers"/"Confirm all" pre-flight confirm dialog (WS8 #947) — a
  // non-gating pre-flight conflict-count line, per CLAUDE.md's "no AlertDialog,
  // use Dialog with confirm/cancel" convention (reuses DeleteDialog's generic
  // confirm shell — it isn't destructive, but the shape fits).
  const [crewBulkAction, setCrewBulkAction] = useState<"OFFERED" | "CONFIRMED" | null>(null);

  function onSubmit(data: ProjectServiceFormValues) {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? `Edit ${SERVICE_TYPE_LABELS[form.watch("type") as ServiceType]} service`
              : `Add ${SERVICE_TYPE_LABELS[watchType]} service`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...form.register("title")} placeholder="Service title" />
            {form.formState.errors.title && (
              <p className="text-caption text-t-out">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              {...form.register("description")}
              placeholder="Details..."
              rows={2}
            />
          </div>

          {/* Date & Time */}
          {canBeMultiDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input
                  type="date"
                  {...form.register("date")}
                  onChange={(e) => {
                    form.setValue("date", e.target.value);
                    const currentEnd = form.getValues("endDate") as string;
                    if (!currentEnd || currentEnd < e.target.value) {
                      form.setValue("endDate", e.target.value);
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input
                  type="date"
                  {...form.register("endDate")}
                  min={watchDate || undefined}
                />
              </div>
            </div>
          ) : (
            /* Date takes the full row on mobile; the two times pair up beneath it. */
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label>Date</Label>
                <Input
                  type="date"
                  {...form.register("date")}
                  onChange={(e) => {
                    // Single-day service types: keep endDate locked to date so
                    // changing the date doesn't leave a stale endDate behind
                    // (which would render as a 2-day service).
                    form.setValue("date", e.target.value);
                    form.setValue("endDate", e.target.value);
                  }}
                />
              </div>
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

          {canBeMultiDay && !isCurrentlyMultiDay && (
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

          {(watchType === "DELIVERY" || watchType === "PICKUP") && (
            <div className="space-y-1.5">
              <Label>{watchType === "DELIVERY" ? "Delivery time" : "Pickup time"}</Label>
              <Input type="time" {...form.register("scheduledTime")} />
              <p className="text-caption text-muted">
                The actual {watchType === "DELIVERY" ? "delivery" : "pickup"} time (separate from crew work window)
              </p>
            </div>
          )}

          {/* Address */}
          {showAddress && (
            <div className="space-y-1.5">
              <Label>
                {watchType === "DELIVERY"
                  ? "Delivery to"
                  : watchType === "PICKUP"
                    ? "Pickup from"
                    : "Address"}
              </Label>
              <AddressInput
                value={form.watch("address") || ""}
                onChange={(v) => form.setValue("address", v)}
                onPlaceSelect={(place: PlaceResult | null) => {
                  if (place) {
                    form.setValue("latitude", place.latitude);
                    form.setValue("longitude", place.longitude);
                  } else {
                    form.setValue("latitude", null);
                    form.setValue("longitude", null);
                  }
                }}
                initialCoordinates={
                  form.getValues("latitude") != null
                    ? {
                        latitude: form.getValues("latitude") as number,
                        longitude: form.getValues("longitude") as number,
                      }
                    : undefined
                }
                countryCode={orgCountry}
              />
            </div>
          )}

          {/* Vehicle */}
          {showVehicle && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vehicle</Label>
                <Input
                  {...form.register("vehicleDescription")}
                  placeholder="e.g. 3-tonne truck"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Number of Trips</Label>
                <Input
                  type="number"
                  min={1}
                  {...form.register("numberOfTrips")}
                  placeholder="1"
                />
              </div>
            </div>
          )}

          {/* Crew Section */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="text-card-title font-semibold text-ink">Crew</h4>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Crew role</Label>
                <ComboboxPicker
                  value={form.watch("crewRoleId") || ""}
                  onChange={(v) => form.setValue("crewRoleId", v)}
                  options={roleOptions}
                  placeholder="Select role..."
                  allowClear
                />
              </div>
              <div className="space-y-1.5">
                <Label>Crew needed</Label>
                <Input
                  type="number"
                  min={0}
                  {...form.register("crewCountRequired")}
                  placeholder="0"
                />
              </div>
            </div>

            <CrewMemberSelect
              needed={watchCrewNeeded}
              values={watchCrewMemberIds}
              onChange={setCrewMemberIds}
              options={crewMemberOptions}
            />

            {/* No-dates neutral hint (equipment-add-form.tsx precedent) vs. a
                section-level "N of M have clashes" summary once dates ARE set
                and 1+ selected member has one (WS8 #947). Both advisory only. */}
            {!hasServiceDates ? (
              <p className="text-caption text-muted">Set service dates to check availability</p>
            ) : (
              selectedConflictCount > 0 && (
                <p className="flex items-center gap-1.5 text-caption font-medium text-warn">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {selectedConflictCount} of {watchCrewMemberIds.length} selected have clashes
                </p>
              )
            )}

            {watchCrew.length > 0 && (
              <CrewRateTable
                rows={watchCrew}
                crewMemberById={crewMemberById}
                previewCost={previewCrewCost}
                onChangeRow={updateCrewRow}
                onRemoveRow={(id) => setCrewMemberIds(watchCrewMemberIds.filter((m) => m !== id))}
                total={crewCostTotal}
              />
            )}

            {watchCrewMemberIds.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="line"
                  size="sm"
                  disabled={!isEditing || crewStatusMutation.isPending}
                  title={!isEditing ? "Save the service first" : undefined}
                  onClick={() => setCrewBulkAction("OFFERED")}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send offers
                </Button>
                <Button
                  type="button"
                  variant="line"
                  size="sm"
                  disabled={!isEditing || crewStatusMutation.isPending}
                  title={!isEditing ? "Save the service first" : undefined}
                  onClick={() => setCrewBulkAction("CONFIRMED")}
                >
                  <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                  Confirm all
                </Button>
                {crewStatusMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                )}
                {!isEditing && (
                  <span className="text-caption text-muted">Save first to send offers</span>
                )}
              </div>
            )}

            {/* Pre-flight confirm — non-gating conflict-count line (WS8 #947). */}
            <DeleteDialog
              open={crewBulkAction != null}
              onOpenChange={(o) => !o && setCrewBulkAction(null)}
              title={crewBulkAction === "OFFERED" ? "Send offers to all assigned crew?" : "Confirm all assigned crew?"}
              description={
                <>
                  {crewBulkAction === "OFFERED"
                    ? "Every pending crew member on this service receives their offer email or SMS now."
                    : "Every assigned crew member on this service is marked confirmed."}
                  {selectedConflictCount > 0 && (
                    <span className="mt-1.5 block font-medium text-warn">
                      {selectedConflictCount} of {watchCrewMemberIds.length} have scheduling clashes — this doesn&apos;t block the action.
                    </span>
                  )}
                </>
              }
              confirmLabel={crewBulkAction === "OFFERED" ? "Send offers" : "Confirm all"}
              onConfirm={() => {
                if (crewBulkAction) crewStatusMutation.mutate({ status: crewBulkAction });
              }}
              pending={crewStatusMutation.isPending}
            />
          </div>

          {/* Financial Section */}
          <div className="border-t pt-4 space-y-4">
            <h4 className="text-card-title font-semibold text-ink">Pricing</h4>

            {/* Charge to Client — visible to everyone (spec: "members see the
                charge side"). unitPrice stays a normal editable input even when
                crew are auto-priced: typing a value is the EXPLICIT manual
                override (never silently clobbered by a crew edit — the costTotal
                clobber lesson, #796, applied to price). */}
            <div className="space-y-3 rounded-[var(--r)] border border-line p-3">
              <div className="t-overline text-muted">
                Charge to client
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Rate ($)</Label>
                  <LockedField locked={svcMoneyLocked} reason={svcLockReason} exitLabel="Unlock financials" onExit={scrollToLockStrip}>
                    <Input
                      type="number"
                      step="0.01"
                      {...form.register("unitPrice")}
                      placeholder={crewChargeTotalPreview > 0 ? formatCurrency(crewChargeTotalPreview) : "0.00"}
                    />
                  </LockedField>
                  {!svcMoneyLocked && !form.watch("unitPrice") && crewChargeTotalPreview > 0 && (
                    <p className="text-[11px] text-muted">
                      Auto from crew: {formatCurrency(crewChargeTotalPreview)}.{" "}
                      <button
                        type="button"
                        className="text-link underline-offset-2 hover:underline"
                        onClick={() => form.setValue("unitPrice", Number(crewChargeTotalPreview.toFixed(2)))}
                      >
                        Use manual rate
                      </button>
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Discount ($)</Label>
                  <LockedField locked={svcMoneyLocked} reason={svcLockReason} exitLabel="Unlock financials" onExit={scrollToLockStrip}>
                    <Input
                      type="number"
                      step="0.01"
                      {...form.register("discount")}
                      placeholder="0.00"
                    />
                  </LockedField>
                </div>
              </div>
              {/* Derived, not a toggle — a service shows on the client's quote/
                  invoice (and the pushed Xero invoice) automatically once it has
                  a charge, same rule the server applies at build time (R-3.1: no
                  second flag to keep in sync with the rate typed above). Mirrors
                  calculateServiceLineTotal: manual rate wins, else the crew
                  auto-price, minus discount, clamped at 0 — UX preview only. */}
              {(() => {
                const watchUnitPrice = Number(form.watch("unitPrice")) || 0;
                const watchDiscount = Number(form.watch("discount")) || 0;
                const base = watchUnitPrice > 0 ? watchUnitPrice : crewChargeTotalPreview;
                const previewCharge = Math.max(0, base - watchDiscount);
                return (
                  <p className="text-[11px] text-muted">
                    {previewCharge > 0
                      ? "Has a charge — will show on quotes, invoices & Xero."
                      : "No charge set — stays internal, won't show on quotes, invoices or Xero."}
                  </p>
                );
              })()}
              {watchCrew.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Charge rate override ($){rateOverrideUnitSuffix}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...form.register("chargeRateOverride")}
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-muted">
                    Overrides the crew role&apos;s charge rate for this service&apos;s crew.
                    Leave blank to use the role default{selectedCrewRole?.chargeRate ? ` ($${selectedCrewRole.chargeRate})` : " (none set — no auto-pricing)"}.
                  </p>
                </div>
              )}
            </div>

            {/* Cost to Business — manager+ only (spec: "cost + margin visible to
                manager+ only"). */}
            {isManagerPlus && (
              <div className="space-y-3 rounded-[var(--r)] border border-line p-3">
                <div className="t-overline text-muted">
                  Cost to Business
                </div>
                {watchCrew.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label>Total cost</Label>
                    <div className="flex h-9 items-center rounded-[var(--r)] border border-line bg-paper-2 px-3 text-ui-text font-medium tabular-nums text-ink">
                      {formatCurrency(crewCostTotal)}
                    </div>
                    <p className="text-[11px] text-muted">
                      Auto-calculated from {watchCrew.length} crew member{watchCrew.length === 1 ? "" : "s"}&apos; rates above. Used for margin calculation.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Total cost</Label>
                    <LockedField locked={svcMoneyLocked} reason={svcLockReason} exitLabel="Unlock financials" onExit={scrollToLockStrip}>
                      <Input
                        type="number"
                        step="0.01"
                        {...form.register("costTotal")}
                        placeholder="0.00"
                      />
                    </LockedField>
                    <p className="text-[11px] text-muted">
                      What this service costs you (transport, materials, etc). Assign crew above to auto-calculate labour cost instead.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {xeroLinked && (
            <Accordion type="single" collapsible className="rounded-[var(--r)] border border-line">
              <AccordionItem value="xero-coding" className="border-none px-3">
                <AccordionTrigger>Advanced: Xero coding</AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <Controller
                      control={form.control}
                      name="xeroAccountCode"
                      render={({ field }) => (
                        <XeroAccountCodeField value={field.value} onChange={field.onChange} label="Account" placeholder="Inherit default" />
                      )}
                    />
                    <Controller
                      control={form.control}
                      name="xeroTaxType"
                      render={({ field }) => (
                        <XeroTaxTypeField value={field.value} onChange={field.onChange} label="Tax type" placeholder="Use org default" />
                      )}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Internal notes</Label>
            <Textarea
              {...form.register("notes")}
              placeholder="Internal notes (not on client docs)..."
              rows={2}
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
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
