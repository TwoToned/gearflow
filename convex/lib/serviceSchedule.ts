/**
 * Pure date maths for moving a service's schedule (UX Phase 5, "linked
 * re-timing"). Service dates are UTC-midnight epoch-ms days, so a move by whole
 * days is plain addition; clock times (`startTime` / `endTime` / `scheduledTime`)
 * are strings and never change. The crew-assignment + shift re-sync that must
 * follow a changed schedule lives in `projectServicesWrites.ts`
 * (`syncServiceCrewSchedule`) and is shared by `updateServiceNative` and
 * `shiftScheduleNative`; this file is only the arithmetic and the caps.
 */

export const DAY_MS = 86_400_000;
/** A shift of more than a year is a typo, not a re-timing. */
export const MAX_SHIFT_DAYS = 366;
/** Distinct offsets in one call: load in and load out, with headroom. */
export const MAX_SHIFT_GROUPS = 4;
/** Services moved in one call (a job rarely has more than a few dozen). */
export const MAX_SHIFT_SERVICES = 200;

/** `ms` moved by `offsetDays` whole days; undefined stays undefined. */
export function shiftDay(ms: number | undefined, offsetDays: number): number | undefined {
  return ms == null ? undefined : ms + offsetDays * DAY_MS;
}
