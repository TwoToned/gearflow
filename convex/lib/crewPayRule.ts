/**
 * THE two money-visibility rules (UX Phase 15), as plain functions of their
 * inputs so the Convex reads (`canSeeCrewPay` / `canSeeJobCost`,
 * lib/crewPayVisibility.ts) and the server actions (`callerSeesCrewPay` /
 * `callerSeesJobCost`, src/lib/crew-pay-caller.ts) decide with ONE definition
 * each (R-3.1). No runtime imports, so `src/` can use them.
 *
 * - **Individual pay** (a person's or a role's rate, a call's cost, a service's
 *   own crew-rolled `costTotal`): manager+ standing, and not an API key flagged
 *   `noFinancials` (D49).
 * - **Job cost** (the project's `serviceCostTotal` / `labourCostTotal` /
 *   `margin`, the operational P&L): `invoice:read`, and not a `noFinancials`
 *   key. Owner ruling, 2026-11-24 ("anyone with invoice read").
 */
export function crewPayVisible(input: { managerPlus: boolean; noFinancials: boolean }): boolean {
  return input.managerPlus && !input.noFinancials;
}

/** Job-level cost and margin: `invoice:read` and not a `noFinancials` key (owner ruling, 2026-11-24). */
export function jobCostVisible(input: { invoiceRead: boolean; noFinancials: boolean }): boolean {
  return input.invoiceRead && !input.noFinancials;
}
