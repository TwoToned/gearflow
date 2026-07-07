import { prisma } from "./prisma";
import { requireOrganization } from "./auth-server";
import {
  hasPermission,
  rolePermissions,
  type Resource,
  type PermissionMap,
} from "./permissions";
import type { ActorContext } from "./actor-context";

/**
 * Get the current organization context for server-side operations.
 * Validates the user's membership and returns scoped query helpers.
 */
export async function getOrgContext() {
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
 * By default the caller is the current Better Auth session (existing web-UI
 * behaviour — unchanged). Pass an explicit `actor` to check on behalf of an API
 * key or any other resolved identity, reusing the exact same RBAC logic.
 */
export async function requirePermission(
  resource: Resource,
  action: string,
  actor?: ActorContext,
): Promise<{ organizationId: string; userId: string; userName: string }> {
  let resolvedActor = actor;
  if (!resolvedActor) {
    // Session path: derive the actor from the request, exactly as before.
    const { organizationId, userId, userName } = await getOrgContext();
    resolvedActor = { organizationId, userId, userName, actorType: "session" };
  }

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
