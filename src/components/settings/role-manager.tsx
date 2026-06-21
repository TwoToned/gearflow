"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Copy, Shield, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmActionMenuItem } from "@/components/ui/confirm-action-menu-item";
import { NotViewer } from "@/components/auth/permission-gate";
import { RoleEditorDialog, ROLE_COLORS } from "./role-editor-dialog";
import { PermissionMatrix } from "./permission-matrix";
import { deleteCustomRole, duplicateCustomRole } from "@/server/custom-roles";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useCustomRoles, refreshCustomRoles } from "@/hooks/use-custom-roles";
import {
  rolePermissions,
  roleLabels,
  ORG_ROLES,
  type PermissionMap,
} from "@/lib/permissions";

interface CustomRoleData {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  permissions: PermissionMap;
  [key: string]: unknown;
}

function getRoleColorClasses(color: string | null): string {
  const entry = ROLE_COLORS.find((c) => c.value === color);
  return entry?.classes ?? "bg-gray-500/10 text-gray-500 border-gray-500/20";
}

function BuiltInRoleCard({ role }: { role: string }) {
  const [expanded, setExpanded] = useState(false);
  const perms = rolePermissions[role];

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-fg-3" />
          <span className="font-medium text-sm">{roleLabels[role]}</span>
          <Badge status="neutral" className="text-xs">Built-in</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </div>
      {expanded && perms && (
        <div className="mt-3">
          <PermissionMatrix
            permissions={perms}
            onChange={() => {}}
            disabled
          />
        </div>
      )}
    </div>
  );
}

export function RoleManager() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRoleData | null>(null);

  const { data: customRoles, isLoading } = useCustomRoles(orgId);

  const deleteMut = useServerMutation({
    mutationFn: deleteCustomRole,
    onSuccess: () => {
      refreshCustomRoles(orgId);
      toast.success("Role deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const dupMut = useServerMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      duplicateCustomRole(id, name),
    onSuccess: () => {
      refreshCustomRoles(orgId);
      toast.success("Role duplicated");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleEdit = (role: CustomRoleData) => {
    setEditingRole(role);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingRole(null);
    setDialogOpen(true);
  };

  const roles = (customRoles || []) as CustomRoleData[];

  return (
    <div className="space-y-6">
      {/* Custom Roles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Custom Roles</h3>
            <p className="text-xs text-fg-3">
              Create roles with specific permission sets for your team
            </p>
          </div>
          <NotViewer>
            <Button size="sm" onClick={handleCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create Role
            </Button>
          </NotViewer>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : roles.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="text-sm text-fg-3">
              No custom roles yet. Create one to assign specific permissions to team members.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    status="neutral"
                    className={getRoleColorClasses(role.color)}
                  >
                    {role.name}
                  </Badge>
                  {role.description && (
                    <span className="text-xs text-fg-3">
                      {role.description}
                    </span>
                  )}
                </div>
                <NotViewer>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        Actions
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(role)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          dupMut.mutate({
                            id: role.id,
                            name: `${role.name} (copy)`,
                          })
                        }
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Duplicate
                      </DropdownMenuItem>
                      <ConfirmActionMenuItem
                        icon={<Trash2 className="mr-2 h-3.5 w-3.5" />}
                        onConfirm={() => deleteMut.mutate(role.id)}
                      >
                        Delete role
                      </ConfirmActionMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </NotViewer>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Built-in Roles Reference */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Built-in Roles</h3>
          <p className="text-xs text-fg-3">
            Default roles with fixed permissions — expand to see what each role can do
          </p>
        </div>
        <div className="space-y-2">
          {ORG_ROLES.map((role) => (
            <BuiltInRoleCard key={role} role={role} />
          ))}
        </div>
      </div>

      <RoleEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingRole={editingRole}
      />
    </div>
  );
}
