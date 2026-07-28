import { NextResponse, type NextRequest } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { getConvexClient } from "@/lib/convex-client";
import { authenticateRoute } from "@/lib/api/route-auth";
import { RESOURCES, rolePermissions, type PermissionMap } from "../../../../../convex/lib/permissionsCore";
import { AGENT_READ_LIMIT, AGENT_WRITE_LIMIT, MAX_BULK_ITEMS_AGENT } from "../../../../../convex/lib/rateLimits";

export const runtime = "nodejs";

/** Owner is unrestricted by construction (`hasPermission` special-cases it) —
 *  report it as "every resource, every action" rather than whatever happens to
 *  be listed in `rolePermissions.owner` today, so this can never under-report. */
function effectivePermissions(role: string | null): PermissionMap {
  if (role === "owner") {
    return Object.fromEntries(RESOURCES.map((r) => [r, ["*"]])) as PermissionMap;
  }
  return role ? (rolePermissions[role] ?? {}) : {};
}

/**
 * `GET /api/v1/whoami` — the "test connection" primitive (design §11). Org,
 * acting user, LIVE effective permissions (re-read from the `members` mirror on
 * every call — never the token's cached `role` claim, so a demotion/removal
 * takes effect on the NEXT request, not after the 60s token TTL), scopes, and
 * rate/bulk limits.
 */
export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id");
  const auth = await authenticateRoute(request, requestId);
  if (!auth.ok) return auth.response;
  const { agent } = auth;

  const service = await getConvexClient();
  const member = await service.query(api.members.getByOrgAndUser, {
    organizationId: agent.key.organizationId,
    userId: agent.key.actingUserId,
  });
  const role = member?.role ?? null;

  return NextResponse.json({
    data: {
      organizationId: agent.key.organizationId,
      actingUser: { id: agent.actor.userId, name: agent.actor.userName },
      apiKeyId: agent.key.id,
      // null = the acting user is no longer a member of this org (removed/left)
      // — every RBAC-gated call will now fail "not a member", live.
      role,
      permissions: effectivePermissions(role),
      scopes: agent.actor.scopes ?? [],
      limits: {
        agentRead: AGENT_READ_LIMIT,
        agentWrite: AGENT_WRITE_LIMIT,
        maxBulkItems: MAX_BULK_ITEMS_AGENT,
      },
    },
    requestId,
  });
}
