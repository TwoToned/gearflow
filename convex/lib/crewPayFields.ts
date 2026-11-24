/**
 * THE crew pay field lists (R-3.1): every redaction of a crew member's or a
 * crew role's pay reads these, never a local copy. Gated by the one pay rule
 * (`canSeeCrewPay` / `crewPayVisible`).
 */

/** A crew member's own pay: default rates and the overtime multiplier. */
export const MEMBER_RATE_FIELDS = ["defaultDayRate", "defaultHourlyRate", "overtimeMultiplier"] as const;

/** A crew role's pay: the cost (`defaultRate`) and the charge (`chargeRate`). */
export const ROLE_RATE_FIELDS = ["defaultRate", "chargeRate"] as const;
