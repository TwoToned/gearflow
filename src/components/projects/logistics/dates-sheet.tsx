"use client";

/**
 * The Logistics dates sheet (spec §8 "Dates on the page"): Rental · Load in ·
 * Load out, with linked re-timing. One save runs ONE sequence, nothing else
 * writes the window:
 *
 *   1. (confirmed jobs) `useDateMoveGate` previews the gear impact: a heads-up,
 *      never a block, failing open (#1227).
 *   2. the project window write, then
 *   3. ONE atomic `shiftScheduleNative` for the services and crew calls that
 *      follow the window (delivery + bump in follow load in; bump out + pickup
 *      follow load out), each by its own offset.
 *
 * If step 3 fails the toast says the dates saved but the services did not move
 * and offers to restore the window. Undo is the same two writes reversed.
 */
import * as React from "react";
import { toast } from "sonner";

import { DateMoveImpactDialog } from "@/components/projects/date-move-impact-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useDateMoveGate } from "@/hooks/use-date-move-gate";
import { useProjectServiceWrites } from "@/hooks/use-project-service-writes";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { useIsMobile } from "@/hooks/use-mobile";
import { daysBetween, planShift, reverseMoves, type LogisticsService, type ShiftMove } from "@/lib/logistics-model";
import type { ProjectSchedulePatch } from "@/lib/validations/project";
import { refreshLogistics } from "./use-logistics-writes";

/** The stored schedule as `yyyy-MM-dd` / `HH:mm` strings ("" = unset). */
export interface ScheduleSnapshot {
  rentalStart: string;
  rentalEnd: string;
  /** Raw stored job window; "" = same as rental (blank stays blank, R-3.1). */
  loadIn: string;
  loadInTime: string;
  loadOut: string;
  loadOutTime: string;
}

const dayMs = (day: string): number | null => (day ? new Date(day).getTime() : null);
const effective = (jobDay: string, rentalDay: string) => jobDay || rentalDay;

/** The patch that writes `s` (every key, so restoring a snapshot also clears what it cleared). */
export function schedulePatch(s: ScheduleSnapshot): ProjectSchedulePatch {
  return {
    rentalStartDate: s.rentalStart,
    rentalEndDate: s.rentalEnd,
    projectStartDate: s.loadIn,
    projectStartTime: s.loadInTime,
    projectEndDate: s.loadOut,
    projectEndTime: s.loadOutTime,
  };
}

/** How far each end of the effective window moved, in whole days. */
export function windowMoved(before: ScheduleSnapshot, after: ScheduleSnapshot) {
  return {
    loadInDays: daysBetween(effective(before.loadIn, before.rentalStart), effective(after.loadIn, after.rentalStart)),
    loadOutDays: daysBetween(effective(before.loadOut, before.rentalEnd), effective(after.loadOut, after.rentalEnd)),
  };
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-caption text-muted">{hint}</p>}
    </div>
  );
}

/** The two writes behind a save, and the one closure that undoes both. */
function useScheduleMove(projectId: string, orgId: string | undefined, snapshot: ScheduleSnapshot) {
  const projectWrites = useProjectWrites(orgId);
  const svcWrites = useProjectServiceWrites();
  const restoreWindow = () => projectWrites.updateSchedule(projectId, schedulePatch(snapshot));

  async function shift(plan: ShiftMove[]) {
    if (plan.length === 0) return undefined;
    return svcWrites.shiftSchedule(projectId, { moves: plan });
  }

  /** The single Undo (a second surface reuses this, never re-derives it). */
  const undo = (plan: ShiftMove[]) => () => {
    const back = plan.length ? svcWrites.shiftSchedule(projectId, { moves: reverseMoves(plan) }) : Promise.resolve();
    void back.then(restoreWindow).then(
      () => { refreshLogistics(projectId); toast.success("Dates restored"); },
      (e: Error) => toast.error(e.message),
    );
  };

  /** Returns false when the window itself could not be written. */
  async function apply(next: ScheduleSnapshot, plan: ShiftMove[]): Promise<boolean> {
    try {
      await projectWrites.updateSchedule(projectId, schedulePatch(next));
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
    try {
      const shifted = await shift(plan);
      toast.success(shiftedText(shifted), { action: { label: "Undo", onClick: undo(plan) } });
    } catch (e) {
      toast.error("Dates saved, but the services did not move: " + (e as Error).message, {
        action: { label: "Restore dates", onClick: () => void restoreWindow().then(() => refreshLogistics(projectId)) },
      });
    }
    refreshLogistics(projectId);
    return true;
  }
  return { apply };
}

const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");

function shiftedText(r?: { services: number; crewCalls: number }): string {
  return r ? "Dates moved · " + plural(r.services, "service") + " · " + plural(r.crewCalls, "crew call") : "Dates saved";
}

function DatesForm({
  snapshot, services, busy, onCancel, onSubmit,
}: {
  snapshot: ScheduleSnapshot;
  services: LogisticsService[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (form: ScheduleSnapshot, moves: ShiftMove[]) => void;
}) {
  const [form, setForm] = React.useState<ScheduleSnapshot>(snapshot);
  const [follow, setFollow] = React.useState(true);
  const set = (k: keyof ScheduleSnapshot) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const moves: ShiftMove[] = follow ? planShift(services, windowMoved(snapshot, form)) : [];
  const moving = new Set(moves.flatMap((m) => m.serviceIds));
  const crewCalls = services.filter((s) => moving.has(s.id)).reduce((n, s) => n + s.crewAssignments.length, 0);
  const hint = moving.size > 0
    ? "Moves " + plural(moving.size, "service") + " and " + plural(crewCalls, "crew call") + ": delivery and bump in follow load in, bump out and pickup follow load out."
    : "Delivery and bump in follow load in; bump out and pickup follow load out.";

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(form, moves); }}
      className="flex flex-col gap-5 p-1"
    >
      <SheetHeader>
        <SheetTitle>Dates</SheetTitle>
        <SheetDescription>Rental is what is charged. Load in and load out are when the gear and crew are on the move.</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field id="rental-start" label="Rental starts"><Input id="rental-start" type="date" value={form.rentalStart} onChange={set("rentalStart")} /></Field>
        <Field id="rental-end" label="Rental ends"><Input id="rental-end" type="date" value={form.rentalEnd} onChange={set("rentalEnd")} /></Field>
        <Field id="load-in" label="Load in" hint={form.loadIn ? undefined : "Same as rental"}>
          <Input id="load-in" type="date" value={form.loadIn} onChange={set("loadIn")} />
        </Field>
        <Field id="load-in-time" label="Load in time"><Input id="load-in-time" type="time" value={form.loadInTime} onChange={set("loadInTime")} /></Field>
        <Field id="load-out" label="Load out" hint={form.loadOut ? undefined : "Same as rental"}>
          <Input id="load-out" type="date" value={form.loadOut} onChange={set("loadOut")} />
        </Field>
        <Field id="load-out-time" label="Load out time"><Input id="load-out-time" type="time" value={form.loadOutTime} onChange={set("loadOutTime")} /></Field>
      </div>
      <label className="flex items-start gap-3 text-ui-text">
        <Switch checked={follow} onCheckedChange={setFollow} aria-label="Move services and crew calls with the window" />
        <span>
          <span className="font-medium text-ink">Move services and crew calls with the window</span>
          <span className="block text-caption text-muted">{hint}</span>
        </span>
      </label>
      <SheetFooter>
        <Button type="button" variant="line" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>Save dates</Button>
      </SheetFooter>
    </form>
  );
}

export function LogisticsDatesSheet({
  open, onOpenChange, orgId, projectId, projectStatus, snapshot, services,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  projectId: string;
  projectStatus: string | undefined;
  snapshot: ScheduleSnapshot;
  services: LogisticsService[];
}) {
  const isMobile = useIsMobile();
  const { apply } = useScheduleMove(projectId, orgId, snapshot);
  const [saving, setSaving] = React.useState(false);
  const submitted = React.useRef<ScheduleSnapshot>(snapshot);

  const run = async (plan: ShiftMove[]) => {
    setSaving(true);
    const ok = await apply(submitted.current, plan);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const gate = useDateMoveGate<ShiftMove[]>(
    orgId,
    projectId,
    projectStatus,
    { start: dayMs(effective(snapshot.loadIn, snapshot.rentalStart)), end: dayMs(effective(snapshot.loadOut, snapshot.rentalEnd)) },
    (plan) => void run(plan),
  );

  const submit = (form: ScheduleSnapshot, moves: ShiftMove[]) => {
    submitted.current = form;
    void gate.requestSave(
      { start: dayMs(effective(form.loadIn, form.rentalStart)), end: dayMs(effective(form.loadOut, form.rentalEnd)) },
      moves,
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isMobile ? "bottom" : "right"} className="overflow-y-auto sm:max-w-md">
          <DatesForm
            snapshot={snapshot}
            services={services}
            busy={saving || gate.checking}
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
          />
        </SheetContent>
      </Sheet>
      <DateMoveImpactDialog
        open={!!gate.pending}
        rows={gate.pending?.rows ?? []}
        pending={saving}
        onConfirm={gate.confirmPending}
        onCancel={gate.cancelPending}
      />
    </>
  );
}
