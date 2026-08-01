"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { refreshOrgMembers } from "@/hooks/use-org-members";
import { refreshPendingInvitations } from "@/hooks/use-pending-invitations";

const builtInRoles = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

export function InviteMember() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const addMutation = useServerMutation({
    mutationFn: () => addMemberByEmail(email, role),
    onSuccess: () => {
      // Membership always requires the recipient to accept (#1073, A3) — this
      // only ever sends an invitation, never adds them directly.
      refreshOrgMembers(orgId);
      refreshPendingInvitations(orgId);
      toast.success(`Invitation sent to ${email}`);
      setEmail("");
    },
    onError: (e) => toast.error(e.message),
  });

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
              {builtInRoles.find((r) => r.value === role)?.label ??
                role.charAt(0).toUpperCase() + role.slice(1)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {builtInRoles.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !email}>
        <UserPlus className="mr-2 h-4 w-4" />
        Invite
      </Button>
    </div>
  );
}
