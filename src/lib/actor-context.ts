import { getOrgContext } from "./org-context";

/**
 * How the caller was authenticated. `session` is the web UI (Better Auth cookie);
 * `apiKey` is the future API/MCP layer, where a key acts on behalf of a user.
 */
export type ActorType = "session" | "apiKey";

/**
 * The identity + scope on whose behalf a guarded operation runs.
 *
 * Both the web UI (session) and the API/MCP layer (API key acting as a user)
 * resolve to this ONE shape, so the RBAC check (`resolvePermissionForActor`) and,
 * by extension, every `src/server/*.ts` guard, runs unchanged regardless of who
 * called it. This is the seam that lets an API key drive the existing guarded
 * server actions without spoofing a Better Auth session.
 *
 * See docs/designs/api-mcp-agent-access.md (§"ActorContext seam").
 */
export interface ActorContext {
  organizationId: string;
  userId: string;
  userName: string;
  actorType: ActorType;
  /** Present only when `actorType === "apiKey"`. Identifies the calling key for audit. */
  apiKeyId?: string;
  /**
   * API-key scopes as `resource:action` strings. Effective permission is the
   * intersection of these and the acting user's live RBAC. Undefined for
   * `session` actors (a session carries the user's full RBAC, unscoped).
   */
  scopes?: string[];
}

/**
 * Resolve the acting context from the current Better Auth session (the web-UI path).
 * This is the default actor `requirePermission` uses when none is passed explicitly,
 * so existing callers are unaffected.
 */
export async function getSessionActorContext(): Promise<ActorContext> {
  const { organizationId, userId, userName } = await getOrgContext();
  return { organizationId, userId, userName, actorType: "session" };
}
