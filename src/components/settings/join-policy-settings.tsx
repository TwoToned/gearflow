"use client";

import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getJoinPolicy, setJoinPolicy } from "@/server/org-join";
import { ORG_JOIN_POLICIES, type OrgJoinPolicy } from "@/lib/org-join-policy";
import { useActiveOrganization } from "@/lib/auth-client";
import { toast } from "sonner";

const POLICY_LABELS: Record<OrgJoinPolicy, { label: string; desc: string }> = {
  INVITE_ONLY: { label: "Invite only", desc: "Only an admin-sent invite can add someone to this org." },
  DOMAIN_REQUEST: {
    label: "Allow domain requests",
    desc: "People whose verified email matches an existing member's domain can ask to join.",
  },
  CLOSED: { label: "Closed", desc: "No self-serve path at all — not even discoverable by domain." },
};

/** B2 (#1094) / #1073's deferred per-org join policy control. Gates whether
 *  `/welcome`'s verified-domain "ask to join" search surfaces this org. */
export function JoinPolicySettings() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: policy, isLoading, refetch } = useServerQuery({
    queryKey: ["org-join-policy", orgId],
    queryFn: () => getJoinPolicy(),
  });

  const mutation = useServerMutation({
    mutationFn: (next: OrgJoinPolicy) => setJoinPolicy(next),
    onSuccess: () => {
      refetch();
      toast.success("Join policy updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const current = policy ?? "INVITE_ONLY";

  if (isLoading) {
    return <div className="h-9 w-48 animate-pulse rounded-md bg-bg-inset" />;
  }

  return (
    <div className="space-y-1.5">
      <Select value={current} onValueChange={(v) => mutation.mutate(v as OrgJoinPolicy)}>
        <SelectTrigger className="w-full sm:w-[260px]">
          <SelectValue>{POLICY_LABELS[current].label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ORG_JOIN_POLICIES.map((p) => (
            <SelectItem key={p} value={p}>
              {POLICY_LABELS[p].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="t-micro text-muted">{POLICY_LABELS[current].desc}</p>
    </div>
  );
}
