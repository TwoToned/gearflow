"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlertTriangle,
  Clock,
  Activity,
  Wrench,
  CalendarClock,
  ListChecks,
  Pencil,
  Ban,
  Plus,
} from "lucide-react";

import { useActiveOrganization } from "@/lib/auth-client";
import { useMaintenanceWorklist, type WorklistSection } from "@/hooks/use-maintenance-worklist";
import { useMaintenanceCheckoff } from "@/hooks/use-maintenance-checkoff";
import { useServiceSchedules, useServiceScheduleWrites, type ServiceScheduleRow } from "@/hooks/use-service-schedules";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { ServiceScheduleDialog } from "@/components/maintenance/service-schedule-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { maintenanceStatusLabels, formatLabel } from "@/lib/status-labels";
import { cn, focusRing } from "@/lib/utils";

function StatTile({ title, value, icon: Icon, tone }: { title: string; value: number; icon: typeof Wrench; tone: "alert" | "warn" | "accent" | "neutral" }) {
  const toneColor = tone === "alert" ? "text-t-out" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-blue" : "text-ink";
  return (
    <div className="rounded-[var(--r-lg)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-text font-medium text-ink-2">{title}</span>
        <Icon className={cn("size-4", toneColor)} />
      </div>
      <div className={cn("text-section-header font-display font-extrabold tabular-nums", toneColor)}>{value}</div>
    </div>
  );
}

function BulkSection({ section }: { section: WorklistSection }) {
  const checkoff = useMaintenanceCheckoff();
  const [qty, setQty] = useState("");
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
            <Input
              type="number"
              min={1}
              max={remaining}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Qty"
              className="w-24"
            />
            <Button
              size="sm"
              variant="line"
              disabled={!qty || Number(qty) < 1 || Number(qty) > remaining || qtyMutation.isPending}
              onClick={() => qtyMutation.mutate()}
            >
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

function SerializedSection({ section }: { section: WorklistSection }) {
  const checkoff = useMaintenanceCheckoff();
  const unitMutation = useServerMutation({
    mutationFn: (assetId: string) => checkoff.checkOffUnit(section.recordId, assetId),
    onSuccess: (res) => { if (res.completed) toast.success("Cycle completed"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {(section.units ?? []).map((u) => (
        <CanDo
          key={u.assetId}
          resource="maintenance"
          action="update"
          fallback={
            <div className={cn("rounded-[var(--r)] border px-3 py-2 text-table-cell", u.checkedOff ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-ink-2")}>
              <span className="t-mono">{u.assetTag}</span>
              {u.customName && <span className="ml-1 text-muted">({u.customName})</span>}
            </div>
          }
        >
          <button
            type="button"
            disabled={u.checkedOff || unitMutation.isPending}
            onClick={() => unitMutation.mutate(u.assetId)}
            className={cn(
              "rounded-[var(--r)] border px-3 py-2 text-left text-table-cell transition-colors",
              focusRing,
              u.checkedOff
                ? "border-ok/40 bg-ok-soft text-ok cursor-default"
                : "border-line text-ink-2 hover:bg-elev",
            )}
          >
            <span className="t-mono">{u.assetTag}</span>
            {u.customName && <span className="ml-1 text-muted">({u.customName})</span>}
          </button>
        </CanDo>
      ))}
    </div>
  );
}

function WorklistSectionCard({ section }: { section: WorklistSection }) {
  const isOverdue = section.status !== "IN_PROGRESS" && new Date(section.dueDate).getTime() < Date.now();
  return (
    <div className="space-y-3 rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-card-title font-semibold text-ink">{section.modelName}</p>
          <p className="text-caption text-muted">{section.scheduleName}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusIndicator
            category="maintenance"
            value={section.status}
            label={maintenanceStatusLabels[section.status] || formatLabel(section.status)}
            variant="pill"
          />
          {isOverdue ? <Badge status="overbooked">Overdue</Badge> : null}
          <span className="text-caption text-muted">Due {format(new Date(section.dueDate), "MMM d, yyyy")}</span>
        </div>
      </div>
      {section.isBulk ? <BulkSection section={section} /> : <SerializedSection section={section} />}
    </div>
  );
}

function SchedulesManager({ schedules, loading }: { schedules: ServiceScheduleRow[] | undefined; loading: boolean }) {
  const [editing, setEditing] = useState<ServiceScheduleRow | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<ServiceScheduleRow | null>(null);
  const writes = useServiceScheduleWrites();
  const deactivateMutation = useServerMutation({
    mutationFn: (id: string) => writes.deactivate(id),
    onSuccess: () => { toast.success("Schedule deactivated"); setDeactivating(null); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="t-title text-ink">Schedules</h2>
        <CanDo resource="maintenance" action="create">
          <Button size="sm" variant="line" onClick={() => { setEditing(undefined); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            New schedule
          </Button>
        </CanDo>
      </div>
      <div className="rounded-[var(--r-lg)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-x-auto">
        <table className="w-full text-table-cell">
          <thead>
            <tr className="border-b border-line text-caption text-muted">
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Every</th>
              <th className="px-4 py-2 text-left font-medium">Anchor</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-4"><Skeleton className="h-6 w-full" /></td></tr>
            ) : (schedules ?? []).length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No service schedules yet.</td></tr>
            ) : (
              (schedules ?? []).map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-ink">{s.modelName}</td>
                  <td className="px-4 py-2 text-ink-2">{s.name}</td>
                  <td className="px-4 py-2 text-ink-2 tabular-nums">{s.intervalMonths} mo</td>
                  <td className="px-4 py-2 text-ink-2 tabular-nums">{format(new Date(s.anchorDate), "MMM d, yyyy")}</td>
                  <td className="px-4 py-2">
                    <Badge status={s.isActive ? "ok" : "neutral"}>{s.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <CanDo resource="maintenance" action="update">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </CanDo>
                      {s.isActive && (
                        <CanDo resource="maintenance" action="delete">
                          <Button variant="ghost" size="icon" className="text-muted hover:text-t-out" onClick={() => setDeactivating(s)}>
                            <Ban className="h-4 w-4" />
                          </Button>
                        </CanDo>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ServiceScheduleDialog open={dialogOpen} onOpenChange={setDialogOpen} schedule={editing} />

      <Dialog open={!!deactivating} onOpenChange={(o) => !o && setDeactivating(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate schedule?</DialogTitle>
            <DialogDescription>
              {deactivating?.name} stops generating new service cycles. Already-generated records are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="line" onClick={() => setDeactivating(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivating && deactivateMutation.mutate(deactivating.id)}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MaintenanceDuePage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const worklist = useMaintenanceWorklist(orgId);
  const schedules = useServiceSchedules(orgId);
  const isLoading = worklist === undefined;

  return (
    <RequirePermission resource="maintenance" action="read">
      <FadeIn>
        <div className="space-y-6">
          <PageHeader
            title="Due for service"
            description="Recurring preventative maintenance — check off units and bulk quantities as they come due."
            actions={
              <Button size="sm" variant="line" asChild>
                <Link href="/maintenance">
                  <ListChecks className="mr-2 h-4 w-4" />
                  All records
                </Link>
              </Button>
            }
          />

          <div className="grid gap-4 sm:grid-cols-3">
            {isLoading ? (
              <>
                <Skeleton className="h-24 rounded-[var(--r-lg)]" />
                <Skeleton className="h-24 rounded-[var(--r-lg)]" />
                <Skeleton className="h-24 rounded-[var(--r-lg)]" />
              </>
            ) : (
              <>
                <StatTile title="Overdue" value={worklist.stats.overdue} icon={AlertTriangle} tone="alert" />
                <StatTile title="Due soon" value={worklist.stats.dueSoon} icon={Clock} tone="warn" />
                <StatTile title="In progress" value={worklist.stats.inProgress} icon={Activity} tone="accent" />
              </>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="t-title text-ink">Open cycles</h2>
            {isLoading ? (
              <Skeleton className="h-40 rounded-[var(--r-lg)]" />
            ) : worklist.sections.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-[var(--r-lg)] bg-card p-8 text-center ring-1 ring-line shadow-[var(--sh-card)]">
                <CalendarClock className="h-8 w-8 text-muted" />
                <p className="text-ui-text font-medium text-ink">Nothing due right now</p>
                <p className="text-caption text-muted">Generated cycles will appear here once a schedule comes due.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {worklist.sections.map((s) => <WorklistSectionCard key={s.recordId} section={s} />)}
              </div>
            )}
          </div>

          <SchedulesManager schedules={schedules} loading={schedules === undefined} />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
