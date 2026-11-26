import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { callerMay, getAuthContext } from "./auth";
import { crewDocumentsVisible } from "./crewDocumentCore";

/**
 * Who may see a crew member's documents (owner ruling B2): `crewDocumentsVisible`, decided for
 * the live caller. Only a USER session in this org counts: the service identity is the trusted
 * backend (its callers decide), and an API key / agent never does, even acting as a user who
 * could. Mirrors how `memberRowRedactor` guards `icalToken`.
 */
export async function canSeeCrewDocuments(ctx: QueryCtx | MutationCtx, orgId: string, member: { userId?: string | null }): Promise<boolean> {
  const auth = await getAuthContext(ctx);
  const user = auth?.kind === "user" && auth.orgId === orgId ? auth : null;
  if (!user) return false;
  const managesCrew = await callerMay(ctx, orgId, "crew", "update");
  return crewDocumentsVisible({ userSession: true, managesCrew, isSelf: member.userId != null && member.userId === user.userId });
}

/**
 * The write guard: a USER session with `crew:update` (the member themself may READ their
 * documents but never writes them). An agent is refused with the same message as a missing
 * permission, so the surface does not advertise what exists.
 */
export async function requireCrewDocumentWriter(ctx: MutationCtx, orgId: string): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind !== "user" || auth.orgId !== orgId || !(await callerMay(ctx, orgId, "crew", "update"))) {
    throw new ConvexError({ code: "FORBIDDEN", message: "You don't have permission to manage crew documents." });
  }
}
