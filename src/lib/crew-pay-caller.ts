import { getCurrentRole } from "@/lib/org-context";
import { getAmbientActor } from "@/lib/request-actor";
import { isManagerPlusRole } from "@/lib/permissions";
import { crewPayVisible } from "../../convex/lib/crewPayRule";
import { PROJECT_CREW_COST_FIELDS } from "../../convex/lib/crewPayFields";

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
 * `rateOverride`, a resolved rate) gates it on this (CLAUDE.md lists them).
 */
export async function callerSeesCrewPay(): Promise<boolean> {
  const actor = getAmbientActor();
  return crewPayVisible({ managerPlus: isManagerPlusRole(await getCurrentRole()), noFinancials: actor?.actorType === "apiKey" });
}

/**
 * Strip a project's crew-cost totals (`PROJECT_CREW_COST_FIELDS`: service and
 * labour cost, and the margin that back-solves them) for a caller below the pay
 * line — ABSENT, never reduced. The server-action twin of Convex's
 * `crewPayRedactor`, the same field list.
 */
export function withoutProjectCrewCost<R extends object>(row: R, payVisible: boolean): R {
  if (payVisible) return row;
  const out = { ...row } as Record<string, unknown>;
  for (const f of PROJECT_CREW_COST_FIELDS) delete out[f];
  return out as R;
}

/** May `sortBy` be used as a sort key? A crew-cost field may not, below the pay line (its order would leak it). */
export function crewCostSortAllowed(sortBy: string, payVisible: boolean): boolean {
  return payVisible || !(PROJECT_CREW_COST_FIELDS as readonly string[]).includes(sortBy);
}
