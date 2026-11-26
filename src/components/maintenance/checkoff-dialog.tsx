"use client";

import * as React from "react";
import { toast } from "sonner";

import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { useMaintenanceCheckoff } from "@/hooks/use-maintenance-checkoff";
import { useMaintenanceWorklist, type WorklistSection } from "@/hooks/use-maintenance-worklist";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatDate } from "@/lib/formatters";
import { formatLabel, maintenanceStatusLabels } from "@/lib/status-labels";
import { cn, focusRing } from "@/lib/utils";

/** A bulk pool's progress with `Check off n` / `Check all remaining`. */
function BulkSection({ section }: { section: WorklistSection }) {
  const checkoff = useMaintenanceCheckoff();
  const [qty, setQty] = React.useState("");
  const remaining = Math.max(0, section.poolQuantitySnapshot - section.progress);
  const pct = section.poolQuantitySnapshot > 0 ? Math.min(100, Math.round((section.progress / section.poolQuantitySnapshot) * 100)) : 0;

  const qtyMutation = useServerMutation({
    mutationFn: () => checkoff.checkOffBulkQuantity(section.recordId, section.bulkAssetId!, Number(qty)),
    onSuccess: (res) => {
      toast.success(res.completed ? "Cycle completed" : `Checked off ${res.quantityRecorded}`);
      setQty("");
    },
    onError: (e) => toast.error(e.message),
  });
  const allMutation = useServerMutation({
    mutationFn: () => checkoff.checkOffAllRemaining(section.recordId, section.bulkAssetId!),
    onSuccess: (res) => toast.success(res.completed ? "Cycle completed" : `Checked off ${res.quantityRecorded}`),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-table-cell">
        <span className="text-muted">
          {section.progress} of {section.poolQuantitySnapshot} checked{section.bulkAssetTag ? ` — ${section.bulkAssetTag}` : ""}
        </span>
        <span className="font-medium text-ink">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-elev">
        <div className="h-full rounded-full bg-blue transition-all" style={{ width: `${pct}%` }} />
      </div>
      {section.bulkAssetId && remaining > 0 && (
        <CanDo resource="maintenance" action="update">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="number" min={1} max={remaining} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" aria-label="Quantity" className="w-24" />
            <Button size="sm" variant="line" disabled={!qty || Number(qty) < 1 || Number(qty) > remaining || qtyMutation.isPending} onClick={() => qtyMutation.mutate()}>
              Check off
            </Button>
            <Button size="sm" disabled={allMutation.isPending} onClick={() => allMutation.mutate()}>
              Check all remaining ({remaining})
            </Button>
          </div>
        </CanDo>
      )}
    </div>
  );
}

const unitStyle = (checkedOff: boolean) => (checkedOff ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-ink-2");

/** A serialised cycle: one tile per unit, a tap checks it off. */
function SerializedSection({ section }: { section: WorklistSection }) {
  const checkoff = useMaintenanceCheckoff();
  const unitMutation = useServerMutation({
    mutationFn: (assetId: string) => checkoff.checkOffUnit(section.recordId, assetId),
    onSuccess: (res) => { if (res.completed) toast.success("Cycle completed"); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {(section.units ?? []).map((u) => {
        const label = (
          <>
            <span className="t-mono">{u.assetTag}</span>
            {u.customName && <span className="ml-1 text-muted">({u.customName})</span>}
          </>
        );
        return (
          <CanDo key={u.assetId} resource="maintenance" action="update" fallback={<div className={cn("rounded-[var(--r)] border px-3 py-2 text-table-cell", unitStyle(u.checkedOff))}>{label}</div>}>
            <button
              type="button"
              disabled={u.checkedOff || unitMutation.isPending}
              onClick={() => unitMutation.mutate(u.assetId)}
              className={cn("rounded-[var(--r)] border px-3 py-2 text-left text-table-cell transition-colors", focusRing, unitStyle(u.checkedOff), u.checkedOff ? "cursor-default" : "hover:bg-elev")}
            >
              {label}
            </button>
          </CanDo>
        );
      })}
    </div>
  );
}

function CycleCard({ section }: { section: WorklistSection }) {
  const isOverdue = section.status !== "IN_PROGRESS" && new Date(section.dueDate).getTime() < Date.now();
  return (
    <div className="space-y-3 rounded-[var(--r-lg)] border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-card-title font-semibold text-ink">{section.modelName}</p>
          <p className="text-caption text-muted">{section.scheduleName}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusIndicator category="maintenance" value={section.status} label={maintenanceStatusLabels[section.status] || formatLabel(section.status)} variant="pill" />
          {isOverdue ? <Badge status="overbooked">Overdue</Badge> : null}
          <span className="text-caption text-muted">Due {formatDate(new Date(section.dueDate))}</span>
        </div>
      </div>
      {section.isBulk ? <BulkSection section={section} /> : <SerializedSection section={section} />}
    </div>
  );
}

/**
 * `Check off cycle…` (UX Phase 14, 14a-3b): the open service cycles (recurring preventative maintenance), checked off unit by unit
 * or by bulk quantity, in a dialog from the Maintenance page instead of the old `/maintenance/due` page. With `recordId` it
 * shows only that record's cycle (a row's own `Check off cycle…`). The writes are the existing check-off mutations.
 */
export function CheckoffDialog({ open, onOpenChange, orgId, recordId }: { open: boolean; onOpenChange: (open: boolean) => void; orgId: string | undefined; recordId?: string | null }) {
  const worklist = useMaintenanceWorklist(open ? orgId : undefined);
  const sections = (worklist?.sections ?? []).filter((s) => !recordId || s.recordId === recordId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check off cycle</DialogTitle>
          <DialogDescription>
            {worklist ? `${worklist.stats.overdue} overdue · ${worklist.stats.dueSoon} due soon · ${worklist.stats.inProgress} in progress` : "Recurring preventative maintenance: check off units and bulk quantities as they come due."}
          </DialogDescription>
        </DialogHeader>
        {worklist === undefined ? (
          <Skeleton className="h-32 rounded-[var(--r-lg)]" />
        ) : sections.length === 0 ? (
          <p className="py-6 text-center text-table-cell text-muted">{recordId ? "That cycle has nothing left to check off." : "Nothing due right now. Generated cycles appear here once a schedule comes due."}</p>
        ) : (
          <div className="space-y-3">{sections.map((s) => <CycleCard key={s.recordId} section={s} />)}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
