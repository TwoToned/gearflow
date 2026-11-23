import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthContext, isAgentNoFinancials, isCallerManagerPlus } from "./auth";
import { crewPayVisible } from "./crewPayRule";

/**
 * May this caller see crew PAY (rates, estimated cost, timesheet totals)?
 * UX Phase 15 (D49): manager+ standing, the same rule the roles admin uses
 * (`crewRoles.listForSettings`), AND not an API key flagged `noFinancials`,
 * which force-redacts cost regardless of the acting user's role. Server-side
 * so the UI hiding a column is never the only thing keeping it private
 * (R-9.3, R-8.4.2). One helper so the planner, the timesheets list and the
 * offer sheet's people list cannot disagree.
 */
export async function canSeeCrewPay(ctx: QueryCtx | MutationCtx, orgId: string): Promise<boolean> {
  const managerPlus = await isCallerManagerPlus(ctx, orgId);
  if (!managerPlus) return false;
  return crewPayVisible({ managerPlus, noFinancials: await isAgentNoFinancials(ctx, await getAuthContext(ctx)) });
}
