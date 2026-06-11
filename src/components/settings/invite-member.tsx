"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { addMemberByEmail } from "@/server/settings";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCustomRoles } from "@/hooks/use-custom-roles";
import { refreshOrgMembers } from "@/hooks/use-org-members";
import { refreshPendingInvitations } from "@/hooks/use-pending-invitations";
import type { PermissionMap } from "@/lib/permissions";

const builtInRoles = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

interface CustomRoleData {
  id: string;
  name: string;
  permissions: PermissionMap;
}

export function InviteMember() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const { data: customRoles } = useCustomRoles(orgId);

  const addMutation = useServerMutation({
    mutationFn: () => addMemberByEmail(email, role),
    onSuccess: (result) => {
      refreshOrgMembers(orgId);
      refreshPendingInvitations(orgId);
      const data = result as { invited?: boolean };
      if (data.invited) {
        toast.success(`Invitation sent to ${email}`);
      } else {
        toast.success(`${email} added to your organization`);
      }
      setEmail("");
    },
    onError: (e) => toast.error(e.message),
  });

  const customRolesList = (customRoles || []) as CustomRoleData[];
  const hasCustomRoles = customRolesList.length > 0;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="invite-email">Email address</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && email) {
              e.preventDefault();
              addMutation.mutate();
            }
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v ?? "member")}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue>
              {(() => {
                const builtIn = builtInRoles.find((r) => r.value === role);
                if (builtIn) return builtIn.label;
                if (role.startsWith("custom:")) {
                  const cr = customRolesList.find((c) => `custom:${c.id}` === role);
                  return cr?.name ?? "Unknown Role";
                }
                return role.charAt(0).toUpperCase() + role.slice(1);
              })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {builtInRoles.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
            {hasCustomRoles && (
              <>
                <Separator className="my-1" />
                <div className="px-2 py-1 text-xs text-fg-3 font-medium">
                  Custom Roles
                </div>
                {customRolesList.map((cr) => (
                  <SelectItem key={`custom:${cr.id}`} value={`custom:${cr.id}`}>
                    {cr.name}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !email}>
        <UserPlus className="mr-2 h-4 w-4" />
        Add
      </Button>
    </div>
  );
}
