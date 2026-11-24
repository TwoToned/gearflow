/**
 * THE money field lists (R-3.1): every redaction of a crew member's or a crew
 * role's pay, and of a job's cost, reads these, never a local copy. Pay is gated
 * by the pay rule (`canSeeCrewPay` / `crewPayVisible`); `JOB_COST_FIELDS` by the
 * job-cost rule (`canSeeJobCost` / `jobCostVisible`), lib/crewPayRule.ts.
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
 * JOB-LEVEL cost: the project's `serviceCostTotal` (services' costs, crew
 * rolled in), `labourCostTotal` (unlinked crew) and `margin`. NOT behind the
 * pay line: owner ruling 2026-11-24, these follow the job-cost rule
 * (`canSeeJobCost` / `callerSeesJobCost`: `invoice:read` and not a
 * `noFinancials` key), and are ABSENT for everyone else.
 */
export const JOB_COST_FIELDS = ["serviceCostTotal", "labourCostTotal", "margin"] as const;
