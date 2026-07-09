/**
 * One answer to "when is this job?".
 *
 * A project carries six nullable dates with different meanings, and most jobs set
 * only some of them:
 *
 * - `eventStartDate` / `eventEndDate` — when the show actually happens. What a
 *   human means by "when is this job".
 * - `rentalStartDate` / `rentalEndDate` — the window the gear is committed for.
 *   This is the window `overbooking-core.ts` enforces availability against.
 * - `loadInDate` / `loadOutDate` — the logistics moments either side.
 *
 * Callers (agents especially) had no way to know which to read, so they guessed —
 * one asked for `startDate`, a field that does not exist on a project, got `null`,
 * and concluded the dates were missing. This resolves the hierarchy once,
 * server-side, and reports which field the answer came from.
 *
 * IMPORTANT: this is the *human* answer. For availability and overbooking, always
 * use `rentalStartDate`/`rentalEndDate` (or the `check_availability` verb) — the
 * event window is not what the inventory maths runs on.
 */

/** Which pair of fields the range was resolved from. */
export type PrimaryDateSource = "event" | "rental" | "load" | "none";

export interface PrimaryDateRange {
  /** ISO 8601, or null when the project has no usable start date at all. */
  start: string | null;
  /** ISO 8601. Falls back to `start` for single-day jobs. Null when start is null. */
  end: string | null;
  /** The field pair `start` came from. `none` means the project is undated. */
  source: PrimaryDateSource;
}

/** Dates arrive as Date (Prisma), epoch ms (Convex), or ISO string (JSON). */
export type DateLike = Date | number | string | null | undefined;

interface ProjectDates {
  eventStartDate?: DateLike;
  eventEndDate?: DateLike;
  rentalStartDate?: DateLike;
  rentalEndDate?: DateLike;
  loadInDate?: DateLike;
  loadOutDate?: DateLike;
}

/** Normalise any of the three wire shapes to an ISO string, or null if unusable. */
function toIso(value: DateLike): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Resolve the project's primary date range.
 *
 * Precedence is by START date: event, then rental, then load-in. The end is taken
 * from the SAME pair when present, so a range never straddles two different
 * meanings; a single-day job (start, no end) reports `end === start` rather than
 * null, which is what a caller sorting or filtering by date actually wants.
 */
export function resolvePrimaryDateRange(project: ProjectDates): PrimaryDateRange {
  const pairs: Array<[PrimaryDateSource, DateLike, DateLike]> = [
    ["event", project.eventStartDate, project.eventEndDate],
    ["rental", project.rentalStartDate, project.rentalEndDate],
    ["load", project.loadInDate, project.loadOutDate],
  ];

  for (const [source, rawStart, rawEnd] of pairs) {
    const start = toIso(rawStart);
    if (!start) continue;
    return { start, end: toIso(rawEnd) ?? start, source };
  }

  return { start: null, end: null, source: "none" };
}
