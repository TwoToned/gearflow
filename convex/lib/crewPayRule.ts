/**
 * THE crew-pay visibility rule (UX Phase 15, D49), as a plain function of its
 * two inputs so the Convex reads (`canSeeCrewPay`) and the Node-side timesheet
 * CSV (`src/server/crew-time.ts`) decide pay with ONE definition (R-3.1):
 * manager+ standing, and not an API key flagged `noFinancials`. No runtime
 * imports, so `src/` can use it.
 */
export function crewPayVisible(input: { managerPlus: boolean; noFinancials: boolean }): boolean {
  return input.managerPlus && !input.noFinancials;
}
