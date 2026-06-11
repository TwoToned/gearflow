"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock } from "lucide-react";
import { getPendingApprovals, approveSSOUser, rejectSSOUser } from "@/server/sso";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCustomRoles } from "@/hooks/use-custom-roles";
import { toast } from "sonner";
import { useState } from "react";

const BUILT_IN_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "warehouse", label: "Warehouse" },
  { value: "viewer", label: "Viewer" },
];

export function SSOPendingApprovals() {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>({});

  const { data: approvals, isLoading } = useQuery({
    queryKey: ["sso-pending-approvals"],
    queryFn: () => getPendingApprovals(),
  });

  const { data: customRoles } = useCustomRoles(orgId);

  const allRoles = [
    ...BUILT_IN_ROLES,
    ...(customRoles || []).map((r: { id: string; name: string }) => ({
      value: `custom:${r.id}`,
      label: r.name,
    })),
  ];

  const approveMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role?: string }) => approveSSOUser(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso-pending-approvals"] });
      toast.success("User approved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectSSOUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso-pending-approvals"] });
      toast.success("User rejected");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-md bg-bg-inset" />;
  }

  if (!approvals || approvals.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-fg-3">
        <Clock className="mx-auto h-8 w-8 mb-2 opacity-50" />
        No pending approvals.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {approvals.map((approval: any) => (
        <div key={approval.id} className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{approval.name || approval.email}</p>
              {approval.name && (
                <span className="text-xs text-fg-3">{approval.email}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {approval.suggestedRole && (
                <Badge variant="secondary" className="text-xs">
                  Suggested: {approval.suggestedRole}
                </Badge>
              )}
              {approval.idpGroups.length > 0 && (
                <span className="text-xs text-fg-3">
                  Groups: {approval.idpGroups.join(", ")}
                </span>
              )}
            </div>
            <p className="text-xs text-fg-3">
              {new Date(approval.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={roleOverrides[approval.id] || approval.suggestedRole || "member"}
              onValueChange={(v) => setRoleOverrides({ ...roleOverrides, [approval.id]: v })}
            >
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue>{allRoles.find((r) => r.value === (roleOverrides[approval.id] || approval.suggestedRole || "member"))?.label ?? (roleOverrides[approval.id] || approval.suggestedRole || "member")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {allRoles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="text-green-600 border-green-600/20 hover:bg-green-600/10"
              onClick={() =>
                approveMut.mutate({
                  id: approval.id,
                  role: roleOverrides[approval.id] || approval.suggestedRole || undefined,
                })
              }
              disabled={approveMut.isPending}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-600/20 hover:bg-red-600/10"
              onClick={() => rejectMut.mutate(approval.id)}
              disabled={rejectMut.isPending}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
