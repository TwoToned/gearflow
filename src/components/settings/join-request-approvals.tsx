"use client";

import { useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Clock } from "lucide-react";
import { getPendingJoinRequests, approveJoinRequest, rejectJoinRequest } from "@/server/org-join";
import { useActiveOrganization } from "@/lib/auth-client";
import { toast } from "sonner";

const BUILT_IN_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "warehouse", label: "Warehouse" },
  { value: "viewer", label: "Viewer" },
];

/** B2 (#1094) — verified-domain "ask to join" requests, reviewed here rather
 *  than a second queue: the design doc calls for these landing beside
 *  approvals in Settings → Team, not a copy of the SSO queue's location. */
export function JoinRequestApprovals() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>({});

  const { data: requests, isLoading, refetch } = useServerQuery({
    queryKey: ["org-join-requests", orgId],
    queryFn: () => getPendingJoinRequests(),
  });

  const approveMut = useServerMutation({
    mutationFn: ({ id, role }: { id: string; role?: string }) => approveJoinRequest(id, role),
    onSuccess: () => {
      refetch();
      toast.success("Request approved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMut = useServerMutation({
    mutationFn: (id: string) => rejectJoinRequest(id),
    onSuccess: () => {
      refetch();
      toast.success("Request rejected");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-md bg-bg-inset" />;
  }

  if (!requests || requests.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-fg-3">
        <Clock className="mx-auto mb-2 h-8 w-8 opacity-50" />
        No pending join requests.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {requests.map((request: any) => (
        <div key={request.id} className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{request.name || request.email}</p>
              {request.name && <span className="text-xs text-fg-3">{request.email}</span>}
            </div>
            <p className="text-xs text-fg-3">{new Date(request.createdAt).toLocaleDateString()}</p>
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={roleOverrides[request.id] || "member"}
              onValueChange={(v) => setRoleOverrides({ ...roleOverrides, [request.id]: v })}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue>
                  {BUILT_IN_ROLES.find((r) => r.value === (roleOverrides[request.id] || "member"))?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="line"
              className="border-green-600/20 text-green-600 hover:bg-green-600/10"
              onClick={() => approveMut.mutate({ id: request.id, role: roleOverrides[request.id] })}
              disabled={approveMut.isPending}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="line"
              className="border-red-600/20 text-red-600 hover:bg-red-600/10"
              onClick={() => rejectMut.mutate(request.id)}
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
