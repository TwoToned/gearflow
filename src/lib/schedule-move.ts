/**
 * The Schedule's two bulk verbs, as pure rules (UX Phase 18, spec §9o.5): which
 * jobs `Confirm n` and `Move dates…` act on, and what a date move writes. No
 * React, no clock. The menus read these to HIDE what the server would refuse;
 * the server's own writes are the authority (`updateStatusNative`'s gates, and
 * `updateNative` with `lockDates`, `convex/lib/projectDatesLock.ts`), so a hidden
 * verb is a convenience, never the enforcement.
 */
import { datesLockedReason } from "../../convex/lib/projectDatesLock";
import { addDays, keyOfMs } from "@/lib/crew-planner";
import type { ScheduleJob } from "@/lib/schedule";
import { shiftWindowWithRental } from "@/lib/project-form-dates";
import type { ProjectSchedulePatch } from "@/lib/validations/project";

/** The most jobs one bulk Confirm or Move acts on (the server's agent cap is 50; each row is still gated server-side). */
export const MAX_SCHEDULE_BULK = 50;

/** `Move by`: a week or a day either way. */
export const MOVE_OPTIONS = [
  { days: -7, label: "1 week earlier" },
  { days: -1, label: "1 day earlier" },
  { days: 1, label: "1 day later" },
  { days: 7, label: "1 week later" },
] as const;

/** Why `Confirm` does not apply to this job, or null: only a Quoted job is confirmed from the Schedule. */
export function confirmSkipReason(job: Pick<ScheduleJob, "status">): string | null {
  return job.status === "QUOTED" ? null : "not Quoted";
}

/** Why this job's dates cannot move, or null. The reason is the server's own (`datesLockedReason`). */
export function moveSkipReason(job: Pick<ScheduleJob, "status">): string | null {
  return datesLockedReason(job.status);
}

const dayStr = (ms: number, days: number): string => addDays(keyOfMs(ms), days);
const msOf = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

export interface DateMove {
  /** The write: day strings for the rental window and, only when the job's own window is SET, its sides (blank stays blank). */
  patch: ProjectSchedulePatch;
  /** The window the date-move gate previews, resolved (`projectStartDate ?? rentalStartDate`), before and after. */
  before: { start: number; end: number };
  after: { start: number; end: number };
  /** The rental window as `YYYY-MM-DD`, for `old → new` in the dialog. */
  from: { start: string; end: string };
  to: { start: string; end: string };
}

/**
 * The rental window moves by whole calendar days; a SET job window is carried by the ONE shared rule
 * (`shiftWindowWithRental`, D25: each side moves by its own rental side's delta, a blank side stays
 * blank, times untouched), never a second copy of it here.
 */
export function moveDates(job: Pick<ScheduleJob, "rentalStart" | "rentalEnd" | "windowStart" | "windowEnd">, days: number): DateMove {
  const rentalStart = dayStr(job.rentalStart, days);
  const rentalEnd = dayStr(job.rentalEnd, days);
  const shifted = shiftWindowWithRental(
    { rentalStartDate: keyOfMs(job.rentalStart), rentalEndDate: keyOfMs(job.rentalEnd) },
    {
      rentalStartDate: rentalStart,
      rentalEndDate: rentalEnd,
      projectStartDate: job.windowStart != null ? keyOfMs(job.windowStart) : undefined,
      projectEndDate: job.windowEnd != null ? keyOfMs(job.windowEnd) : undefined,
    },
  );
  const patch: ProjectSchedulePatch = { rentalStartDate: rentalStart, rentalEndDate: rentalEnd };
  if (shifted.projectStartDate) patch.projectStartDate = shifted.projectStartDate;
  if (shifted.projectEndDate) patch.projectEndDate = shifted.projectEndDate;
  return {
    patch,
    before: { start: job.windowStart ?? job.rentalStart, end: job.windowEnd ?? job.rentalEnd },
    after: { start: msOf(patch.projectStartDate ?? rentalStart), end: msOf(patch.projectEndDate ?? rentalEnd) },
    from: { start: keyOfMs(job.rentalStart), end: keyOfMs(job.rentalEnd) },
    to: { start: rentalStart, end: rentalEnd },
  };
}
