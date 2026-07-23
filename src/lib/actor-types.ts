/**
 * Pure type definitions for the ActorContext seam — split out of
 * `actor-context.ts` so `org-context.ts`, `request-actor.ts`, and `api-key.ts`
 * can depend on the SHAPE without depending on `actor-context.ts` itself.
 * `actor-context.ts`'s `getSessionActorContext()` calls `org-context.ts`'s
 * `getOrgContext()`, so importing `actor-context.ts` from any of those three
 * would create a circular dependency (POLICY.md R-3.5).
 *
 * See docs/designs/api-mcp-agent-access.md (§"ActorContext seam").
 */

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
