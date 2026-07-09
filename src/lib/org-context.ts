import { prisma } from "./prisma";
import { requireOrganization } from "./auth-server";
import {
  hasPermission,
  rolePermissions,
  type Resource,
  type PermissionMap,
} from "./permissions";
import type { ActorContext } from "./actor-context";
import { getAmbientActor } from "./request-actor";
import { requireApiScope } from "./api-key";

/**
 * Get the current organization context for server-side operations.
 * Validates the user's membership and returns scoped query helpers.
 *
 * Two paths resolve to the same shape:
 * - **Ambient actor** (API/MCP): the dispatcher wrapped this call in
 *   `runWithActor()`, so the identity comes from the API key. No cookie is read.
 * - **Session** (web UI): the identity comes from the Better Auth cookie. Unchanged.
 *
 * Every `src/server/*.ts` action funnels through here, which is why wiring the
 * ambient actor in at this one point makes the entire action surface callable by
 * an API key without touching the actions themselves.
 */
export async function getOrgContext() {
  const ambient = getAmbientActor();
  if (ambient) {
    // The acting user is a real user row; load the profile fields callers rely on
    // (e.g. `ctx.user.image`). Membership + RBAC are still enforced per-operation
    // by `requirePermission`, so this lookup grants nothing on its own.
    const user = await prisma.user.findUnique({
      where: { id: ambient.userId },
      select: { id: true, name: true, email: true, image: true },
    });

    if (!user) {
      throw new Error("The user this API key acts as no longer exists.");
    }

    return {
      organizationId: ambient.organizationId,
      userId: ambient.userId,
      userName: ambient.userName,
      user,
      session: null,
    };
  }

  const { session, organizationId } = await requireOrganization();

  return {
    organizationId,
    userId: session.user.id,
    userName: session.user.name || "Unknown",
    user: session.user,
    session: session.session,
  };
}

/**
 * Helper to create a where clause scoped to the current organization.
 */
export async function orgWhere<T extends Record<string, unknown>>(
  where?: T
): Promise<T & { organizationId: string }> {
  const { organizationId } = await getOrgContext();
  return { ...where, organizationId } as T & { organizationId: string };
}

/**
 * Validate that a user has the required role in the current organization.
 */
export async function requireRole(requiredRoles: string[]) {
  const { organizationId, userId } = await getOrgContext();

  const member = await prisma.member.findFirst({
    where: {
      organizationId,
      userId,
    },
  });

  if (!member || !requiredRoles.includes(member.role)) {
    throw new Error("Insufficient permissions");
  }

  return member;
}

/**
 * Resolve a member's permission map.
 * Built-in roles use the static map; custom roles load from DB.
 */
async function resolvePermissions(
  role: string,
): Promise<PermissionMap | null> {
  // Built-in role
  if (!role.startsWith("custom:")) {
    return rolePermissions[role] ?? null;
  }

  // Custom role: load from DB
  const customRoleId = role.slice("custom:".length);
  const customRole = await prisma.customRole.findUnique({
    where: { id: customRoleId },
    select: { permissions: true },
  });

  if (!customRole) return null;

  try {
    return JSON.parse(customRole.permissions) as PermissionMap;
  } catch {
    return null;
  }
}

/**
 * Core permission check against an EXPLICIT actor context. Shared by the session
 * path (`requirePermission`) and the API-key path. Does the member/role lookup +
 * `hasPermission` against the actor's org+user; it never reads the request or
 * session, so it runs identically for a UI session and an API key acting as a user.
 *
 * For `apiKey` actors, effective permission is the intersection of the acting
 * user's live RBAC (checked here) and the key's `scopes` (checked separately at
 * the API boundary before this is called) — see docs/designs/api-mcp-agent-access.md.
 */
export async function resolvePermissionForActor(
  actor: ActorContext,
  resource: Resource,
  action: string,
): Promise<{ organizationId: string; userId: string; userName: string }> {
  const { organizationId, userId, userName } = actor;

  const member = await prisma.member.findFirst({
    where: { organizationId, userId },
  });

  if (!member) {
    throw new Error("You are not a member of this organization.");
  }

  let customPermissions: PermissionMap | null = null;

  if (member.role.startsWith("custom:")) {
    customPermissions = await resolvePermissions(member.role);
    if (!customPermissions) {
      throw new Error("Your role no longer exists. Contact your administrator.");
    }
  }

  if (!hasPermission(member.role, resource, action, customPermissions)) {
    throw new Error("You don't have permission to perform this action.");
  }

  return { organizationId, userId, userName };
}

/**
 * Check that a caller has a specific permission in the active org. Throws if not
 * permitted. Works for both built-in and custom roles.
 *
 * Actor resolution, in order: an explicit `actor` argument, then the ambient
 * actor set by the API dispatcher (`runWithActor`), then the Better Auth session
 * (the web-UI path — unchanged).
 *
 * For API-key actors this ALSO enforces the key's scopes, not just the acting
 * user's RBAC. That makes scope enforcement follow the real code path rather than
 * the registry's declared metadata: an action that guards itself with
 * `requirePermission("project", "delete")` demands the `project:delete` scope even
 * if the operation registry described it wrongly. Effective permission stays
 * intersection(live user RBAC, key scopes).
 */
export async function requirePermission(
  resource: Resource,
  action: string,
  actor?: ActorContext,
): Promise<{ organizationId: string; userId: string; userName: string }> {
  let resolvedActor = actor ?? getAmbientActor();
  if (!resolvedActor) {
    // Session path: derive the actor from the request, exactly as before.
    const { organizationId, userId, userName } = await getOrgContext();
    resolvedActor = { organizationId, userId, userName, actorType: "session" };
  }

  // No-op for session actors; throws MISSING_SCOPE for an under-scoped key.
  requireApiScope(resolvedActor, resource, action);

  return resolvePermissionForActor(resolvedActor, resource, action);
}

/**
 * Get the current user's role and resolved permissions in the active org.
 * Used by the /api/current-role endpoint.
 */
export async function getResolvedPermissions(): Promise<{
  role: string;
  roleName: string;
  permissions: PermissionMap;
} | null> {
  const { organizationId, userId } = await getOrgContext();

  const member = await prisma.member.findFirst({
    where: { organizationId, userId },
    select: { role: true },
  });

  if (!member) return null;

  const permissions = await resolvePermissions(member.role);
  if (!permissions) return null;

  // Get display name for custom roles
  let roleName = member.role;
  if (member.role.startsWith("custom:")) {
    const customRoleId = member.role.slice("custom:".length);
    const customRole = await prisma.customRole.findUnique({
      where: { id: customRoleId },
      select: { name: true },
    });
    roleName = customRole?.name ?? "Custom Role";
  }

  return { role: member.role, roleName, permissions };
}

/**
 * Get the current user's role in the active org (or null if not a member).
 */
export async function getCurrentRole(): Promise<string | null> {
  const { organizationId, userId } = await getOrgContext();

  const member = await prisma.member.findFirst({
    where: { organizationId, userId },
    select: { role: true },
  });

  return member?.role ?? null;
}
