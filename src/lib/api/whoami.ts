import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "../convex-client";
import { RESOURCES, rolePermissions, type PermissionMap } from "../../../convex/lib/permissionsCore";
import { AGENT_READ_LIMIT, AGENT_WRITE_LIMIT, MAX_BULK_ITEMS_AGENT } from "../../../convex/lib/rateLimits";
import type { AgentRequestContext } from "./agent-auth";

/**
 * The `whoami` data (design §11) — shared by `GET /api/v1/whoami` and the MCP
 * `whoami` curated tool so the two surfaces can't report different things for
 * the same key. "Test your credentials" is the first call every new
 * connection makes, REST or MCP alike.
 */
export interface WhoamiData {
  organizationId: string;
  actingUser: { id: string; name: string };
  apiKeyId: string;
  role: string | null;
  permissions: PermissionMap;
  scopes: string[];
  limits: { agentRead: typeof AGENT_READ_LIMIT; agentWrite: typeof AGENT_WRITE_LIMIT; maxBulkItems: number };
}

/** Owner is unrestricted by construction (`hasPermission` special-cases it) —
 *  report it as "every resource, every action" rather than whatever happens to
 *  be listed in `rolePermissions.owner` today, so this can never under-report. */
function effectivePermissions(role: string | null): PermissionMap {
  if (role === "owner") {
    return Object.fromEntries(RESOURCES.map((r) => [r, ["*"]])) as PermissionMap;
  }
  return role ? (rolePermissions[role] ?? {}) : {};
}

/** LIVE role/permissions (re-read from the `members` mirror on every call —
 *  never the token's cached `role` claim, so a demotion/removal takes effect
 *  on the NEXT request, not after the 60s token TTL). */
export async function getWhoamiData(agent: AgentRequestContext): Promise<WhoamiData> {
  const service = await getConvexClient();
  const member = await service.query(api.members.getByOrgAndUser, {
    organizationId: agent.key.organizationId,
    userId: agent.key.actingUserId,
  });
  const role = member?.role ?? null;

  return {
    organizationId: agent.key.organizationId,
    actingUser: { id: agent.actor.userId, name: agent.actor.userName },
    apiKeyId: agent.key.id,
    role,
    permissions: effectivePermissions(role),
    scopes: agent.actor.scopes ?? [],
    limits: {
      agentRead: AGENT_READ_LIMIT,
      agentWrite: AGENT_WRITE_LIMIT,
      maxBulkItems: MAX_BULK_ITEMS_AGENT,
    },
  };
}
