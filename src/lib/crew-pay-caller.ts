import { getCurrentRole } from "@/lib/org-context";
import { getAmbientActor } from "@/lib/request-actor";
import { isManagerPlusRole } from "@/lib/permissions";
import { crewPayVisible } from "../../convex/lib/crewPayRule";

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
