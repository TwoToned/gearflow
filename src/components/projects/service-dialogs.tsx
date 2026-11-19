"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  Loader2,
  Copy,
  ArrowRightLeft,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  generateCrewMessage,
} from "@/server/project-services";
import { useProjectServiceWrites } from "@/hooks/use-project-service-writes";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { PersonAvatar } from "@/components/ui/avatar";
import { ComboboxPicker } from "@/components/ui/combobox-picker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// ─── Crew Rate Table (issue #796) ─────────────────────────────────────────────
//
// Per-crew-member rate table shown inside the service dialog once 1+ crew are
// assigned. Each row's override writes to that CrewAssignment.rateOverride (via the
// existing rate cascade — resolveRate/calculateEstimatedCost, convex/lib/crewRate.ts).
// The displayed rate/cost is a live client-side PREVIEW of that same cascade; the
// server always recomputes authoritatively on save (POLICY.md R-9.3 — no money
// originates from the client).

export type ServiceCrewTableRow = { crewMemberId: string; rateOverride?: number; rateType?: "" | "HOURLY" | "DAILY" | "FLAT"; estimatedHours?: number };
export type CrewRateTableMember = { id: string; firstName: string; lastName: string; image: string | null } & CrewConflictSummary;

const memberDisplayName = (member: CrewRateTableMember | undefined, fallback: string): string =>
  member ? `${member.firstName} ${member.lastName}` : fallback;

/** "" | undefined → undefined, otherwise parse to a number — shared by the rate
 *  override and hours inputs below. */
const parseOptionalNumber = (v: string): number | undefined => (v === "" ? undefined : Number(v));

export function CrewRateTable({
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
