/**
 * WS2 (#941) — the Convex-side copy of `src/lib/project-window.ts`'s
 * `getProjectWindow`, duplicated BYTE-FOR-BYTE (the Convex bundler can't resolve
 * the `@/` alias — same pattern as `convex/lib/availabilityCore.ts`'s
 * `resolveModelAssetType`/`computeStockBreakdown`). Pinned against the original by
 * a cross-import equality test in `convex/lib/projectWindow.test.ts`.
 *
 * Two windows only: RENTAL (chargeable — pricing reads this, untouched, see #943)
 * and PROJECT (gear committed — availability/conflicts read this). The project
 * window defaults to the rental window at READ TIME (not stored duplication,
 * POLICY.md R-3.1).
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
 * `projectEndDate` unset — that side still falls back to `rentalEndDate`).
 */
export function getProjectWindow(p: ProjectWindowInput): ProjectWindow {
  return {
    start: p.projectStartDate ?? p.rentalStartDate ?? null,
    end: p.projectEndDate ?? p.rentalEndDate ?? null,
  };
}
