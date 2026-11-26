"use client";

import * as React from "react";
import { Ban, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { CanDo } from "@/components/auth/permission-gate";
import { ServiceScheduleDialog } from "@/components/maintenance/service-schedule-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServiceScheduleWrites, useServiceSchedules, type ServiceScheduleRow } from "@/hooks/use-service-schedules";
import { formatDate } from "@/lib/formatters";

/** One schedule's row: model, name, interval, anchor, state, and its Edit / Deactivate verbs (each only for a caller who may). */
function ScheduleRow({ s, onEdit, onDeactivate }: { s: ServiceScheduleRow; onEdit: () => void; onDeactivate: () => void }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2 text-ink">{s.modelName}</td>
      <td className="px-3 py-2 text-ink-2">{s.name}</td>
      <td className="px-3 py-2 tabular-nums text-ink-2">{s.intervalMonths} mo</td>
      <td className="px-3 py-2 tabular-nums text-ink-2">{formatDate(new Date(s.anchorDate))}</td>
      <td className="px-3 py-2"><Badge status={s.isActive ? "ok" : "neutral"}>{s.isActive ? "Active" : "Inactive"}</Badge></td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <CanDo resource="maintenance" action="update">
            <Button variant="ghost" size="icon" aria-label={`Edit ${s.name}`} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          </CanDo>
          {s.isActive && (
            <CanDo resource="maintenance" action="delete">
              <Button variant="ghost" size="icon" aria-label={`Deactivate ${s.name}`} className="text-muted hover:text-t-out" onClick={onDeactivate}><Ban className="h-4 w-4" /></Button>
            </CanDo>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * `Service schedules…` (UX Phase 14, 14a-3b): the recurring-service schedules (create, edit, deactivate) in a dialog from the
 * Maintenance page instead of the old `/maintenance/due` page. The writes are the existing schedule mutations; Deactivate asks
 * first (it stops new cycles; generated records are untouched).
 */
export function ServiceSchedulesDialog({ open, onOpenChange, orgId }: { open: boolean; onOpenChange: (open: boolean) => void; orgId: string | undefined }) {
  const schedules = useServiceSchedules(open ? orgId : undefined);
  const writes = useServiceScheduleWrites();
  const [editing, setEditing] = React.useState<ServiceScheduleRow | undefined>(undefined);
  const [formOpen, setFormOpen] = React.useState(false);
  const [deactivating, setDeactivating] = React.useState<ServiceScheduleRow | null>(null);
  const deactivate = useServerMutation({
    mutationFn: (id: string) => writes.deactivate(id),
    onSuccess: () => { toast.success("Schedule deactivated"); setDeactivating(null); },
    onError: (e) => toast.error(e.message),
  });
  const rows = schedules ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Service schedules</DialogTitle>
            <DialogDescription>Each schedule generates a service cycle for its model on a fixed interval from its anchor date.</DialogDescription>
          </DialogHeader>
          <CanDo resource="maintenance" action="create">
            <div><Button size="sm" variant="line" onClick={() => { setEditing(undefined); setFormOpen(true); }}><Plus className="mr-2 h-4 w-4" />New schedule</Button></div>
          </CanDo>
          <div className="overflow-x-auto rounded-[var(--r-lg)] border border-line">
            <table className="w-full text-table-cell">
              <thead>
                <tr className="border-b border-line text-caption text-muted">
                  {["Model", "Name", "Every", "Anchor", "Status", ""].map((h, i) => <th key={i} className="px-3 py-2 text-left font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {schedules === undefined ? (
                  <tr><td colSpan={6} className="px-3 py-4"><Skeleton className="h-6 w-full" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No service schedules yet.</td></tr>
                ) : (
                  rows.map((s) => <ScheduleRow key={s.id} s={s} onEdit={() => { setEditing(s); setFormOpen(true); }} onDeactivate={() => setDeactivating(s)} />)
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <ServiceScheduleDialog open={formOpen} onOpenChange={setFormOpen} schedule={editing} />

      <Dialog open={!!deactivating} onOpenChange={(o) => !o && setDeactivating(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate schedule?</DialogTitle>
            <DialogDescription>{deactivating?.name} stops generating new service cycles. Already-generated records are untouched.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="line" onClick={() => setDeactivating(null)}>Cancel</Button>
            <Button variant="primary" disabled={deactivate.isPending} onClick={() => deactivating && deactivate.mutate(deactivating.id)}>Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
