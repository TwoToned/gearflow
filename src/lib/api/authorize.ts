import type { ActorContext } from "../actor-context";
import type { Resource } from "../permissions";
import { requirePermission } from "../org-context";
import { requireApiScope } from "../api-key";

/**
 * The single authorization gate every API/MCP capability verb goes through.
 *
 * Effective permission for an API key is the INTERSECTION of two independent checks:
 *   1. Key scope   — does this key carry `resource:action`?          (requireApiScope)
 *   2. User RBAC   — does the acting user's LIVE role allow it?       (requirePermission)
 *
 * Both must pass. A broadly-scoped key still can't exceed its acting user's role,
 * and a powerful user still can't act through a narrowly-scoped key. For a session
 * actor, the scope check is a no-op (sessions carry full user RBAC), so this
 * collapses to the exact same `requirePermission` the web UI already uses.
 *
 * Scope is checked first: it's a cheap in-memory check with no DB round-trip, and
 * it lets us return a precise `MISSING_SCOPE` (fixable by the operator) before
 * spending a query on the role lookup.
 *
 * See docs/designs/api-mcp-agent-access.md.
 */
export async function authorizeApiOperation(
  actor: ActorContext,
  resource: Resource,
  action: string,
): Promise<{ organizationId: string; userId: string; userName: string }> {
  requireApiScope(actor, resource, action);
  return requirePermission(resource, action, actor);
}
