/**
 * THE crew pay field lists (R-3.1): every redaction of a crew member's or a
 * crew role's pay reads these, never a local copy. Gated by the one pay rule
 * (`canSeeCrewPay` / `crewPayVisible`).
 */

/** A crew member's own pay: default rates and the overtime multiplier. */
export const MEMBER_RATE_FIELDS = ["defaultDayRate", "defaultHourlyRate", "overtimeMultiplier"] as const;

/** A crew role's pay: the cost (`defaultRate`) and the charge (`chargeRate`). */
export const ROLE_RATE_FIELDS = ["defaultRate", "chargeRate"] as const;

/**
 * Totals that INCLUDE crew cost, so are pay-shaped too (UX Phase 15 ruling):
 * a service's `costTotal` rolls up its crew's resolved pay
 * (`recalcServiceCostFromCrew`). Absent — never reduced — below the pay line,
 * so no crew number can be back-solved from it.
 */
export const SERVICE_CREW_COST_FIELDS = ["costTotal"] as const;

/**
 * The project's totals that include crew cost: `serviceCostTotal` (services'
 * costs, crew rolled in), `labourCostTotal` (unlinked crew) and `margin`
 * (total − costs, which back-solves them). Absent below the pay line.
 */
export const PROJECT_CREW_COST_FIELDS = ["serviceCostTotal", "labourCostTotal", "margin"] as const;
