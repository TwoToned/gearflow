import { getOrgContext } from "./org-context";
import type { ActorContext } from "./actor-types";

export type { ActorType, ActorContext } from "./actor-types";

/**
 * Resolve the acting context from the current Better Auth session (the web-UI path).
 * This is the default actor `requirePermission` uses when none is passed explicitly,
 * so existing callers are unaffected.
 */
export async function getSessionActorContext(): Promise<ActorContext> {
  const { organizationId, userId, userName } = await getOrgContext();
  return { organizationId, userId, userName, actorType: "session" };
}
