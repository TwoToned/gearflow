"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  RESOURCES,
  type PermissionMap,
} from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";

// ─── Read ───────────────────────────────────────────────────────────────────

/** List all custom roles for the current org */
export async function getCustomRoles() {
  const { organizationId } = await getOrgContext();

  const roles = await prisma.customRole.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });

  return serialize(
    roles.map((r) => ({
      ...r,
      permissions: JSON.parse(r.permissions) as PermissionMap,
    })),
  );
}

/** Get a single custom role by ID */
export async function getCustomRole(id: string) {
  const { organizationId } = await getOrgContext();

  const role = await prisma.customRole.findFirst({
    where: { id, organizationId },
  });

  if (!role) throw new Error("Role not found");

  return serialize({
    ...role,
    permissions: JSON.parse(role.permissions) as PermissionMap,
  });
}

// ─── Write ──────────────────────────────────────────────────────────────────

/** Create a new custom role */
export async function createCustomRole(data: {
  name: string;
  description?: string;
  color?: string;
  ssoGroupClaim?: string;
  permissions: PermissionMap;
}) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "update_role");

  validatePermissions(data.permissions);

  const role = await prisma.customRole.create({
    data: {
      organizationId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      color: data.color || null,
      ssoGroupClaim: data.ssoGroupClaim?.trim() || null,
      permissions: JSON.stringify(data.permissions),
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "customRole",
    entityId: role.id,
    entityName: role.name,
    summary: `Created custom role ${role.name}`,
    details: { permissions: data.permissions },
  });

  return serialize({
    ...role,
    permissions: data.permissions,
  });
}

/** Update an existing custom role */
export async function updateCustomRole(
  id: string,
  data: {
    name?: string;
    description?: string;
    color?: string;
    ssoGroupClaim?: string;
    permissions?: PermissionMap;
  },
) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "update_role");

  const existing = await prisma.customRole.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Role not found");

  if (data.permissions) {
    validatePermissions(data.permissions);
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.color !== undefined) updateData.color = data.color || null;
  if (data.ssoGroupClaim !== undefined) updateData.ssoGroupClaim = data.ssoGroupClaim?.trim() || null;
  if (data.permissions !== undefined) updateData.permissions = JSON.stringify(data.permissions);

  const updated = await prisma.customRole.update({
    where: { id, organizationId },
    data: updateData,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "customRole",
    entityId: id,
    entityName: updated.name,
    summary: `Updated custom role ${updated.name}`,
    details: updateData,
  });

  return serialize({
    ...updated,
    permissions: data.permissions
      ? data.permissions
      : (JSON.parse(updated.permissions) as PermissionMap),
  });
}

/** Delete a custom role. Fails if any members are assigned to it. */
export async function deleteCustomRole(id: string) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "update_role");

  const existing = await prisma.customRole.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Role not found");

  // Check if any members use this role
  const memberCount = await prisma.member.count({
    where: { organizationId, role: `custom:${id}` },
  });

  if (memberCount > 0) {
    throw new Error(
      `Cannot delete this role — ${memberCount} member${memberCount > 1 ? "s" : ""} still assigned to it. Reassign them first.`,
    );
  }

  await prisma.customRole.delete({ where: { id, organizationId } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "customRole",
    entityId: id,
    entityName: existing.name,
    summary: `Deleted custom role ${existing.name}`,
  });

  return { success: true };
}

/** Duplicate a custom role with a new name */
export async function duplicateCustomRole(id: string, newName: string) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "update_role");

  const existing = await prisma.customRole.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Role not found");

  const role = await prisma.customRole.create({
    data: {
      organizationId,
      name: newName.trim(),
      description: existing.description,
      color: existing.color,
      permissions: existing.permissions,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DUPLICATE",
    entityType: "customRole",
    entityId: role.id,
    entityName: role.name,
    summary: `Duplicated custom role ${existing.name} as ${role.name}`,
    details: { sourceId: id, sourceName: existing.name },
  });

  return serialize({
    ...role,
    permissions: JSON.parse(role.permissions) as PermissionMap,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function validatePermissions(permissions: PermissionMap) {
  const validResources = new Set<string>(RESOURCES);

  for (const key of Object.keys(permissions)) {
    if (!validResources.has(key)) {
      throw new Error(`Invalid resource: ${key}`);
    }
  }
}
