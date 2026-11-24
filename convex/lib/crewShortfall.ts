import { EXCLUDED_ASSIGNMENT_STATUSES } from "./crewConflicts";

/**
 * How short of people a service is, DAY BY DAY (UX Phase 15, B1). The ONE
 * shortfall rule: `crewPlanner.openCalls` (the planner's Needs crew), the
 * Overbookings "services missing crew" board and the project readiness
 * "below crewCountRequired" check all read it through `missingCrewRowFor`.
 *
 * - A service needs `crewCountRequired` people on EVERY day of its run,
 *   `[date, endDate]` as UTC days (how Logistics stores them).
 * - An assignment fills only the days it covers: `[startDate, endDate]`, a
 *   single day when only one end is set, and the whole run when it has no
 *   dates at all (the pre-dates shape). DECLINED / CANCELLED fill nothing.
 * - A run is short if ANY day is short. `filled` and `shortfall` are the
 *   WORST day's, so a Mon-only call on a Mon–Wed run that needs 1 is `0 of 1`
 *   with `shortDays` Tue and Wed.
 * - A service with no date has no days: it is short when its active crew
 *   count is below the requirement (the old whole-service rule), with no
 *   `shortDays` to name.
 */

const DAY_MS = 86_400_000;
/** A run longer than this is read as its first year (a guard, far past any real service). */
const MAX_RUN_DAYS = 366;

export interface ShortfallService {
  date?: number | null;
  endDate?: number | null;
  crewCountRequired?: number | null;
}

export interface ShortfallAssignment {
  status?: string | null;
  startDate?: number | null;
  endDate?: number | null;
}

export interface ShortDay {
  /** UTC midnight of the day. */
  day: number;
  shortfall: number;
}

export interface CrewShortfall {
  required: number;
  /** The worst day's filled count. */
  filled: number;
  /** The worst day's gap (0 when every day is filled). */
  shortfall: number;
  /** Every short day of the run, in order, with its own gap. */
  shortDays: ShortDay[];
}

const utcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/** The UTC days `[date, endDate]` covers (empty for a dateless service). */
export function serviceDays(s: Pick<ShortfallService, "date" | "endDate">): number[] {
  if (s.date == null) return [];
  const from = utcDay(s.date);
  const to = Math.max(from, utcDay(s.endDate ?? s.date));
  const days: number[] = [];
  for (let d = from; d <= to && days.length < MAX_RUN_DAYS; d += DAY_MS) days.push(d);
  return days;
}

const isActive = (a: ShortfallAssignment) => !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "");

/** Does the assignment fill `day` (UTC midnight)? No dates = the whole run. */
export function assignmentCoversDay(a: ShortfallAssignment, day: number): boolean {
  if (a.startDate == null && a.endDate == null) return true;
  const from = utcDay((a.startDate ?? a.endDate)!);
  const to = utcDay((a.endDate ?? a.startDate)!);
  return from <= day && day <= to;
}

/**
 * Is every day `a` would cover already at the requirement, counting only
 * `filled` (the rows that hold a place)? The first-come fill's test for
 * cancelling an open offer: a Tue–Wed offer on a Mon–Wed run is NOT made
 * redundant by a Monday-only accept. A dateless service falls back to the
 * whole-service count; an offer that covers none of the run's days is never
 * "full" (it is left for a human).
 */
export function coveredDaysFull(service: ShortfallService, filled: readonly ShortfallAssignment[], a: ShortfallAssignment): boolean {
  const gap = crewShortfallByDay(service, filled);
  if (!gap) return false;
  const days = serviceDays(service);
  if (days.length === 0) return gap.shortfall === 0;
  const covered = days.filter((d) => assignmentCoversDay(a, d));
  const short = new Set(gap.shortDays.map((s) => s.day));
  return covered.length > 0 && covered.every((d) => !short.has(d));
}

/**
 * The service's shortfall per day, or `null` when it states no requirement
 * (`crewCountRequired` null or 0 is never a gap).
 */
export function crewShortfallByDay(service: ShortfallService, assignments: readonly ShortfallAssignment[]): CrewShortfall | null {
  const required = service.crewCountRequired;
  if (required == null || required <= 0) return null;
  const active = assignments.filter(isActive);
  const days = serviceDays(service);
  if (days.length === 0) {
    const filled = active.length;
    return { required, filled, shortfall: Math.max(0, required - filled), shortDays: [] };
  }
  let worst = Infinity;
  const shortDays: ShortDay[] = [];
  for (const day of days) {
    const filled = active.filter((a) => assignmentCoversDay(a, day)).length;
    worst = Math.min(worst, filled);
    if (filled < required) shortDays.push({ day, shortfall: required - filled });
  }
  return { required, filled: worst, shortfall: Math.max(0, required - worst), shortDays };
}
