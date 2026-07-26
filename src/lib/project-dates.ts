/**
 * One answer to "when is this job?".
 *
 * WS2 (#941) collapsed the date model to TWO windows:
 *
 * - `projectStartDate` / `projectEndDate` — the gear-committed window (when it
 *   leaves/returns the warehouse). What a human means by "when is this job".
 *   Blank on most projects — falls back to the rental window (see
 *   `getProjectWindow`, `src/lib/project-window.ts`).
 * - `rentalStartDate` / `rentalEndDate` — the chargeable window. Pricing reads
 *   this directly (untouched by WS2 — see #943).
 *
 * The legacy `eventStartDate`/`eventEndDate`/`loadInDate`/`loadOutDate` fields are
 * DEPRECATED (no longer written by any consumer — see FEATUREDOCS/10) and are
 * intentionally NOT consulted here; the backfill migrates `loadInDate` into
 * `projectStartDate` so old projects still resolve correctly once it's run.
 *
 * Callers (agents especially) had no way to know which to read, so they guessed —
 * one asked for `startDate`, a field that does not exist on a project, got `null`,
 * and concluded the dates were missing. This resolves the hierarchy once,
 * server-side, and reports which field the answer came from.
 *
 * IMPORTANT: this is the *human* answer. For availability and overbooking, use
 * `getProjectWindow` (or the `check_availability` verb) directly — same
 * precedence, but without the ISO-string/ProjectDates wire mapping. For pricing,
 * always use `rentalStartDate`/`rentalEndDate` directly — the project window is
 * not what pricing runs on.
 */

/** Which pair of fields the range was resolved from. */
export type PrimaryDateSource = "project" | "rental" | "none";

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
  projectStartDate?: DateLike;
  projectEndDate?: DateLike;
  rentalStartDate?: DateLike;
  rentalEndDate?: DateLike;
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
 * Precedence is by START date: project, then rental. The end is taken from the
 * SAME pair when present, so a range never straddles two different meanings; a
 * single-day job (start, no end) reports `end === start` rather than null, which
 * is what a caller sorting or filtering by date actually wants.
 */
export function resolvePrimaryDateRange(project: ProjectDates): PrimaryDateRange {
  const pairs: Array<[PrimaryDateSource, DateLike, DateLike]> = [
    ["project", project.projectStartDate, project.projectEndDate],
    ["rental", project.rentalStartDate, project.rentalEndDate],
  ];

  for (const [source, rawStart, rawEnd] of pairs) {
    const start = toIso(rawStart);
    if (!start) continue;
    return { start, end: toIso(rawEnd) ?? start, source };
  }

  return { start: null, end: null, source: "none" };
}
