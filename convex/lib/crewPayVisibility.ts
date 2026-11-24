import type { MutationCtx, QueryCtx } from "../_generated/server";
import { callerMayRead, getAuthContext, isAgentNoFinancials, isCallerManagerPlus, redactFields } from "./auth";
import { JOB_COST_FIELDS } from "./crewPayFields";
import { crewPayVisible, jobCostVisible } from "./crewPayRule";

/**
 * Strip `fields` from each row unless the caller sees crew pay — the pay rule,
 * resolved once per call. Used for a service's crew-rolled `costTotal`
 * (`SERVICE_CREW_COST_FIELDS`, lib/crewPayFields.ts): the keys are ABSENT, never
 * zeroed, so nothing can be back-solved.
 */
export async function crewPayRedactor(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  fields: readonly string[],
): Promise<<R extends Record<string, unknown>>(row: R) => R> {
  if (await canSeeCrewPay(ctx, orgId)) return (row) => row;
  return (row) => redactFields(row, fields);
}

/**
 * May this caller see crew PAY (rates, estimated cost, timesheet totals, a
 * service's own cost)? UX Phase 15 (D49): manager+ standing, the same rule the
 * roles admin uses (`crewRoles.listForSettings`), AND not an API key flagged
 * `noFinancials`, which force-redacts cost regardless of the acting user's role.
 * Server-side so the UI hiding a column is never the only thing keeping it
 * private (R-9.3, R-8.4.2).
 */
export async function canSeeCrewPay(ctx: QueryCtx | MutationCtx, orgId: string): Promise<boolean> {
  const managerPlus = await isCallerManagerPlus(ctx, orgId);
  if (!managerPlus) return false;
  return crewPayVisible({ managerPlus, noFinancials: await isAgentNoFinancials(ctx, await getAuthContext(ctx)) });
}

/**
 * May this caller see JOB-LEVEL cost and margin (`JOB_COST_FIELDS`, the
 * operational P&L)? Owner ruling 2026-11-24: `invoice:read` (the real guard's
 * answer, `callerMayRead` — for an agent, the key's scope too) and not a
 * `noFinancials` key. The ONE place a job-cost read decides; never inline an
 * `invoice:read` check at a call site.
 */
export async function canSeeJobCost(ctx: QueryCtx | MutationCtx, orgId: string): Promise<boolean> {
  const invoiceRead = await callerMayRead(ctx, orgId, "invoice");
  if (!invoiceRead) return false;
  return jobCostVisible({ invoiceRead, noFinancials: await isAgentNoFinancials(ctx, await getAuthContext(ctx)) });
}

/** Strip `JOB_COST_FIELDS` from each project row unless the caller sees job cost — ABSENT, never zeroed. */
export async function jobCostRedactor(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<<R extends Record<string, unknown>>(row: R) => R> {
  if (await canSeeJobCost(ctx, orgId)) return (row) => row;
  return (row) => redactFields(row, JOB_COST_FIELDS);
}
