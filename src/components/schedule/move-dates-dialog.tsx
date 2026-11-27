"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayDate } from "@/lib/crew-planner";
import { formatDateDayMonth } from "@/lib/formatters";
import { plural } from "@/lib/list-write-toast";
import type { ScheduleJob } from "@/lib/schedule";
import { MOVE_OPTIONS, moveDates, moveSkipReason } from "@/lib/schedule-move";
import { cn } from "@/lib/utils";

/**
 * `Move dates…` (spec §9o.5): one dialog for one or many jobs. `Move by` a week or
 * a day either way, then `old → new` per job. A job whose dates are locked (gear
 * out, or finished) is listed as skipped with the SERVER's own reason (the write
 * refuses it too, `lockDates`); the toast names it again. Confirming runs the
 * non-blocking date-move gate per job (a clash raises its heads-up) and ONE Undo.
 * Services and crew calls keep their dates: move them from the job's Logistics tab.
 */
interface Props {
  jobs: ScheduleJob[] | null;
  onClose: () => void;
  onMove: (jobs: ScheduleJob[], days: number) => void;
}

const span = (a: string, b: string) => (a === b ? formatDateDayMonth(displayDate(a)) : `${formatDateDayMonth(displayDate(a))} – ${formatDateDayMonth(displayDate(b))}`);

function Rows({ jobs, days }: { jobs: ScheduleJob[]; days: number | null }) {
  return (
    <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-ui-text" aria-label="Jobs to move">
      {jobs.map((j) => {
        const why = moveSkipReason(j);
        const to = days != null ? moveDates(j, days) : null;
        return (
          <li key={j.id} className="flex flex-col">
            <span className="flex items-baseline gap-2">
              <span className="font-mono font-medium text-ink">{j.projectNumber}</span>
              <span className="truncate text-ink">{j.name}</span>
            </span>
            {why ? (
              <span className="text-caption text-muted">skipped: {why}</span>
            ) : (
              <span className="font-mono text-caption text-muted">
                {to ? `${span(to.from.start, to.from.end)} → ${span(to.to.start, to.to.end)}` : span(moveDates(j, 0).from.start, moveDates(j, 0).from.end)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function MoveDatesDialog({ jobs, onClose, onMove }: Props) {
  const [days, setDays] = React.useState<number | null>(null);
  const movable = (jobs ?? []).filter((j) => moveSkipReason(j) == null);
  return (
    <Dialog open={!!jobs} onOpenChange={(o) => !o && (setDays(null), onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move dates</DialogTitle>
          <DialogDescription>
            {jobs && jobs.length === 1 ? "Moves the rental dates and the job window together." : `${plural(jobs?.length ?? 0, "job")} selected. Each moves by the same number of days.`}
          </DialogDescription>
        </DialogHeader>
        <div role="group" aria-label="Move by" className="flex flex-wrap gap-2">
          {MOVE_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              aria-pressed={days === o.days}
              onClick={() => setDays(o.days)}
              className={cn("min-h-11 rounded-[var(--r)] border px-3 text-ui-text md:min-h-9", days === o.days ? "border-ink font-medium text-ink" : "border-line-2 text-muted hover:text-ink")}
            >
              {o.label}
            </button>
          ))}
        </div>
        {jobs && <Rows jobs={jobs} days={days} />}
        <p className="text-caption text-muted">Services and crew calls keep their dates. Move them from the job&apos;s Logistics tab.</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => (setDays(null), onClose())}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={days == null || movable.length === 0}
            onClick={() => {
              if (days == null) return;
              onMove(jobs ?? [], days);
              setDays(null);
              onClose();
            }}
          >
            Move {movable.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
