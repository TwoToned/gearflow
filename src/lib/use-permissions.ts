"use client";

import { useActiveOrganization } from "@/lib/auth-client";
import { isReadOnly, type Resource } from "./permissions";
import { useCurrentRoleResource } from "@/hooks/use-current-role";

export function useCurrentRole() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data, isLoading } = useCurrentRoleResource(orgId);
  return {
    role: data?.role ?? null,
    roleName: data?.roleName ?? null,
    permissions: data?.permissions ?? null,
    isLoading,
  };
}

/** Check if user can perform a specific action on a resource */
export function useCanDo(resource: Resource, action: string): boolean {
  const { permissions } = useCurrentRole();
  if (!permissions) return false;
  return permissions[resource]?.includes(action) ?? false;
}

/**
 * Returns true if the user is effectively read-only (no write permissions).
 * Works for both built-in viewer role AND custom roles with only read perms.
 */
export function useIsViewer(): boolean {
  const { permissions, isLoading } = useCurrentRole();
  // While loading, treat as viewer (safe default — don't flash edit buttons)
  if (isLoading || !permissions) return true;
  return isReadOnly(permissions);
}
