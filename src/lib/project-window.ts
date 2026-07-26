/**
 * WS2 (#941) — the authoritative "what window does availability read?" answer.
 *
 * Two windows only: RENTAL (chargeable — pricing reads this, untouched by this
 * workstream, see #943) and PROJECT (gear committed — availability/conflicts read
 * this). The project window defaults to the rental window when unset — a
 * READ-TIME coalesce, not stored duplication (POLICY.md R-3.1): a project only
 * carries `projectStartDate`/`projectEndDate` when it explicitly diverges from its
 * rental window (e.g. an earlier load-in or a later load-out than the chargeable
 * dates).
 *
 * All dates here are epoch-ms numbers (how every Convex project doc — and every
 * consumer of it in `src/lib`/`src/server` — represents a date; see
 * `src/lib/project-dates.ts`'s `DateLike` note). Convex functions can't resolve the
 * `@/` alias, so this is duplicated BYTE-FOR-BYTE in `convex/lib/projectWindow.ts`
 * and pinned by a cross-import parity test (the `availabilityCore.ts` pattern).
 */

/** The subset of a project doc `getProjectWindow` reads. */
export interface ProjectWindowInput {
  projectStartDate?: number | null;
  projectEndDate?: number | null;
  rentalStartDate?: number | null;
  rentalEndDate?: number | null;
}

/** The resolved window, epoch-ms. Either side is `null` when neither the project
 *  nor the rental pair has that end set. */
export interface ProjectWindow {
  start: number | null;
  end: number | null;
}

/**
 * `{start, end}` = the project window if set, else the rental window. Each side is
 * resolved INDEPENDENTLY (a project can have `projectStartDate` set with
 * `projectEndDate` unset — that side still falls back to `rentalEndDate`), matching
 * every other partial-date coalesce in this codebase (e.g. `resolvePrimaryDateRange`).
 */
export function getProjectWindow(p: ProjectWindowInput): ProjectWindow {
  return {
    start: p.projectStartDate ?? p.rentalStartDate ?? null,
    end: p.projectEndDate ?? p.rentalEndDate ?? null,
  };
}
