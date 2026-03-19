"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Mail, X } from "lucide-react";
import { NotViewer } from "@/components/auth/permission-gate";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { getMembers, getPendingInvitations, revokeInvitation } from "@/server/settings";
import { changeMemberRole, removeOrgMember } from "@/server/org-members";
import { getCustomRoles } from "@/server/custom-roles";
import { ROLE_COLORS } from "./role-editor-dialog";
import type { PermissionMap } from "@/lib/permissions";

const roleColors: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  admin: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  manager: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  member: "bg-green-500/10 text-green-500 border-green-500/20",
  staff: "bg-green-500/10 text-green-500 border-green-500/20",
  warehouse: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  viewer: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const builtInAssignableRoles = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

interface CustomRoleData {
  id: string;
  name: string;
  color: string | null;
  permissions: PermissionMap;
}

function getCustomRoleColorClasses(color: string | null): string {
  const entry = ROLE_COLORS.find((c) => c.value === color);
  return entry?.classes ?? "bg-gray-500/10 text-gray-500 border-gray-500/20";
}

function getRoleDisplay(role: string, customRolesMap: Map<string, CustomRoleData>) {
  if (role.startsWith("custom:")) {
    const id = role.slice("custom:".length);
    const cr = customRolesMap.get(id);
    return {
      label: cr?.name ?? "Unknown Role",
      colorClass: cr ? getCustomRoleColorClasses(cr.color) : roleColors.viewer,
    };
  }
  return {
    label: role.charAt(0).toUpperCase() + role.slice(1),
    colorClass: roleColors[role] || "",
  };
}

export function MemberList() {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: members, isLoading } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: getMembers,
  });

  const { data: customRoles } = useQuery({
    queryKey: ["custom-roles", orgId],
    queryFn: getCustomRoles,
  });

  const { data: pendingInvitations } = useQuery({
    queryKey: ["pending-invitations", orgId],
    queryFn: getPendingInvitations,
  });

  const revokeMut = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invitations"] });
      toast.success("Invitation revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const changeRoleMut = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      changeMemberRole(memberId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      queryClient.invalidateQueries({ queryKey: ["current-role"] });
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: removeOrgMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Member removed");
    },
    onError: (e) => toast.error(e.message),
  });

  // Build custom roles lookup map
  const customRolesMap = new Map<string, CustomRoleData>();
  if (customRoles) {
    for (const cr of customRoles as CustomRoleData[]) {
      customRolesMap.set(cr.id, cr);
    }
  }

  // Build assignable roles list (built-in + custom)
  const allAssignableRoles = [
    ...builtInAssignableRoles,
    ...((customRoles || []) as CustomRoleData[]).map((cr) => ({
      value: `custom:${cr.id}`,
      label: cr.name,
    })),
  ];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const items = (members || []) as Array<{
    id: string;
    role: string;
    user: { id: string; name: string | null; email: string; image: string | null };
  }>;

  if (items.length === 0) {
    return (
      <p className="text-sm text-fg-3">
        No team members yet. Add someone above.
      </p>
    );
  }

  const hasCustomRoles = ((customRoles || []) as CustomRoleData[]).length > 0;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const invites = (pendingInvitations || []) as any[];

  return (
    <div className="space-y-3">
      {invites.length > 0 && (
        <>
          {invites.map((inv) => {
            const display = inv.role ? getRoleDisplay(inv.role, customRolesMap) : { label: "Member", colorClass: roleColors.member };
            return (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-md border border-dashed p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-inset">
                    <Mail className="h-3.5 w-3.5 text-fg-3" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-fg-3">Invited</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={display.colorClass}>
                    {display.label}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    Pending
                  </Badge>
                  <NotViewer>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        if (confirm(`Revoke invitation for ${inv.email}?`)) {
                          revokeMut.mutate(inv.id);
                        }
                      }}
                    >
                      <X className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </NotViewer>
                </div>
              </div>
            );
          })}
        </>
      )}
      {items.map((member) => {
        const display = getRoleDisplay(member.role, customRolesMap);

        return (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-md border p-3"
          >
            <div className="flex items-center gap-3">
              <UserAvatar user={member.user} size="sm" />
              <div>
                <p className="text-sm font-medium">{member.user.name || "Unnamed"}</p>
                <p className="text-xs text-fg-3">
                  {member.user.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {member.role === "owner" ? (
                <Badge
                  variant="outline"
                  className={display.colorClass}
                >
                  {display.label}
                </Badge>
              ) : (
                <NotViewer fallback={
                  <Badge variant="outline" className={display.colorClass}>
                    {display.label}
                  </Badge>
                }>
                  <Select
                    value={member.role}
                    onValueChange={(v) => {
                      if (v && v !== member.role) {
                        changeRoleMut.mutate({ memberId: member.id, role: v });
                      }
                    }}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue>{display.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {allAssignableRoles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </NotViewer>
              )}
              <NotViewer>
                {member.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      if (confirm(`Remove ${member.user.name || member.user.email} from the organization?`)) {
                        removeMut.mutate(member.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </NotViewer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
