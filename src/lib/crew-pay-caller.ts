import { getCurrentRole } from "@/lib/org-context";
import { getAmbientActor } from "@/lib/request-actor";
import { hasPermission, isManagerPlusRole } from "@/lib/permissions";
import { crewPayVisible, jobCostVisible } from "../../convex/lib/crewPayRule";
import { JOB_COST_FIELDS } from "../../convex/lib/crewPayFields";

/**
 * May the REAL caller of a server action see crew pay? A server action reads
 * Convex with the service identity, which always passes `canSeeCrewPay`, so it
 * must decide for its caller itself — with THE one rule, `crewPayVisible`
 * (`convex/lib/crewPayRule.ts`, the function `canSeeCrewPay` decides with):
 * manager+ and not a `noFinancials` key. The ambient API-key actor carries no
 * `noFinancials` flag here, so a key counts as noFinancials (fail closed) —
 * keys read pay through the Convex reads, where the flag is known.
 *
 * Every server action that returns crew pay (rates, `estimatedCost`,
 * `rateOverride`, a resolved rate, a service's own `costTotal`) gates it on
 * this (CLAUDE.md lists them).
 */
export async function callerSeesCrewPay(): Promise<boolean> {
  const actor = getAmbientActor();
  return crewPayVisible({ managerPlus: isManagerPlusRole(await getCurrentRole()), noFinancials: actor?.actorType === "apiKey" });
}

/**
 * May the REAL caller of a server action see JOB-LEVEL cost and margin
 * (`JOB_COST_FIELDS`, a services summary's cost total)? The server-action twin
 * of Convex's `canSeeJobCost`, decided by THE job-cost rule `jobCostVisible`:
 * `invoice:read` for the caller's live role, and not a `noFinancials` key (an
 * ambient API key fails closed, as in `callerSeesCrewPay`). Owner ruling
 * 2026-11-24. Never inline an `invoice:read` check instead.
 */
export async function callerSeesJobCost(): Promise<boolean> {
  const actor = getAmbientActor();
  const role = await getCurrentRole();
  return jobCostVisible({ invoiceRead: role != null && hasPermission(role, "invoice", "read"), noFinancials: actor?.actorType === "apiKey" });
}

/**
 * Strip a project's job-level cost (`JOB_COST_FIELDS`: service and labour cost,
 * and margin) for a caller who fails the job-cost rule — ABSENT, never reduced.
 * The server-action twin of Convex's `jobCostRedactor`, the same field list.
 */
export function withoutJobCost<R extends object>(row: R, jobCostShown: boolean): R {
  if (jobCostShown) return row;
  const out = { ...row } as Record<string, unknown>;
  for (const f of JOB_COST_FIELDS) delete out[f];
  return out as R;
}

/** May `sortBy` be used as a sort key? A job-cost field may not for a caller who can't see it (its order would leak it). */
export function jobCostSortAllowed(sortBy: string, jobCostShown: boolean): boolean {
  return jobCostShown || !(JOB_COST_FIELDS as readonly string[]).includes(sortBy);
}
