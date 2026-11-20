/**
 * The ONE source for module names and gear-stage words (UX unification D90,
 * docs/designs/ux-unification-2026-10.md §4). Labels only: enums, Convex
 * values, routes, API/MCP operation names and permission keys do not change.
 *
 *   Job      = project   (code and routes stay `project` / `/projects`)
 *   Home     = dashboard (route stays `/dashboard`)
 *   Schedule = availability (route stays `/availability`)
 *   Out      = CHECKED_OUT (the verb "Deploy" stays)
 *
 * Stage → colour intent lives in `status-colors.ts` (`gearStage` category) —
 * words here, intent there, never two copies of either (R-3.1).
 */

export const MODULE_NAMES = {
  job: "Job",
  jobs: "Jobs",
  home: "Home",
  schedule: "Schedule",
  logistics: "Logistics",
  floor: "The floor",
} as const;

/** Gear that is not in a case (replaces "Not planned" / "No container"). */
export const LOOSE_LABEL = "Loose";

/** Stages gear moves through, left to right, plus the archived end state. */
export type GearStageKey =
  | "to_prep"
  | "prepped"
  | "deployed"
  | "returned"
  | "deprepped"
  | "closed";

/** Keys are internal (kept from the pre-D90 code); only the words changed. */
export const GEAR_STAGE_LABELS: Record<GearStageKey, string> = {
  to_prep: "To pick",
  prepped: "Prepped",
  deployed: "Out",
  returned: "Returned",
  deprepped: "De-prepped",
  closed: "Closed",
};

/** The word for gear whose line / asset / kit / job status is CHECKED_OUT. */
export const OUT_LABEL = GEAR_STAGE_LABELS.deployed;

/**
 * The floor's five columns (spec §9c.2, D27). A JOB's stage, derived by
 * `warehouseStage()` (`convex/lib/warehouseStage.ts`) from its unit counts;
 * keys are that function's. Gear-stage words are reused where they mean the
 * same thing.
 */
export const FLOOR_STAGE_LABELS = {
  topick: GEAR_STAGE_LABELS.to_prep,
  prepping: "Prepping",
  ready: "Ready",
  out: OUT_LABEL,
  returning: "Returning",
} as const;

/**
 * Returning mode's outcome words (spec §9c.4): what happened to a unit on its
 * way back. `late` is derived (D29: came back, or is still out, after the end
 * day), never stored.
 */
export const RETURN_OUTCOME_LABELS = {
  out: OUT_LABEL,
  returned: GEAR_STAGE_LABELS.returned,
  damaged: "Damaged",
  missing: "Missing",
  late: "Late",
} as const;
