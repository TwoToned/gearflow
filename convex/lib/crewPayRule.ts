/**
 * THE two money-visibility rules (UX Phase 15), as plain functions of their
 * inputs so the Convex reads (`canSeeCrewPay` / `canSeeJobCost`,
 * lib/crewPayVisibility.ts) and the server actions (`callerSeesCrewPay` /
 * `callerSeesJobCost`, src/lib/crew-pay-caller.ts) decide with ONE definition
 * each (R-3.1). No runtime imports, so `src/` can use them.
 *
 * - **Job cost** (the project's `serviceCostTotal` / `labourCostTotal` /
 *   `margin`, the operational P&L): `invoice:read`, and not a `noFinancials`
 *   key. Owner ruling, 2026-11-24 ("anyone with invoice read").
 * - **Individual pay** (a person's or a role's rate, a call's cost, a service's
 *   own crew-rolled `costTotal`): the job-cost line AND manager+ standing (D49).
 *   The pay line IMPLIES the job-cost line (coordinator ruling): a caller who
 *   can't see a job's cost must not be able to rebuild it from the services'
 *   `costTotal` and the calls' `estimatedCost` — e.g. an owner's key scoped to
 *   `project:*` + `crew:*` with no `invoice` scope.
 */
export function crewPayVisible(input: { managerPlus: boolean; invoiceRead: boolean; noFinancials: boolean }): boolean {
  return input.managerPlus && jobCostVisible(input);
}

/** Job-level cost and margin: `invoice:read` and not a `noFinancials` key (owner ruling, 2026-11-24). */
export function jobCostVisible(input: { invoiceRead: boolean; noFinancials: boolean }): boolean {
  return input.invoiceRead && !input.noFinancials;
}
