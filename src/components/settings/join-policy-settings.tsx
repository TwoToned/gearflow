"use client";
// use-client: draft state, a server action and a leave guard (R-8.1.1)

import * as React from "react";
import { toast } from "sonner";

import { SettingsSaveBar } from "@/components/settings/settings-section";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { getJoinPolicy, setJoinPolicy } from "@/server/org-join";
import { ORG_JOIN_POLICIES, type OrgJoinPolicy } from "@/lib/org-join-policy";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const POLICY_LABELS: Record<OrgJoinPolicy, { label: string; desc: string }> = {
  INVITE_ONLY: { label: "Invite only", desc: "Only an admin-sent invite can add someone to this org." },
  DOMAIN_REQUEST: {
    label: "Allow domain requests",
    desc: "People whose verified email matches an existing member's domain can ask to join.",
  },
  CLOSED: { label: "Closed", desc: "No self-serve path at all — not even discoverable by domain." },
};

/**
 * Join policy: three radio rows (B2 #1094, #1073's deferred per-org control). It
 * gates whether `/welcome`'s verified-domain "ask to join" search surfaces this
 * org. Editing makes it a draft: the Save/Discard bar names the section, and
 * leaving the page with a draft asks first.
 */
export function JoinPolicySettings() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: policy, isLoading, refetch } = useServerQuery({
    queryKey: ["org-join-policy", orgId],
    queryFn: () => getJoinPolicy(),
  });

  const [draft, setDraft] = React.useState<OrgJoinPolicy | null>(null);
  const saved: OrgJoinPolicy = policy ?? "INVITE_ONLY";
  const current = draft ?? saved;
  const isDirty = draft !== null && draft !== saved;

  const mutation = useServerMutation({
    mutationFn: (next: OrgJoinPolicy) => setJoinPolicy(next),
    onSuccess: () => {
      refetch();
      setDraft(null);
      toast.success("Join policy saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  React.useEffect(() => {
    if (!isDirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [isDirty]);

  if (isLoading) return <div className="h-24 animate-pulse rounded-md bg-bg-inset" />;

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1" aria-label="Join policy">
        {ORG_JOIN_POLICIES.map((p) => (
          <label
            key={p}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--r)] border border-line px-3 py-2 hover:bg-elev",
              current === p && "border-red bg-red-soft/40",
            )}
          >
            <input
              type="radio"
              name="join-policy"
              value={p}
              checked={current === p}
              onChange={() => setDraft(p)}
              className="mt-1 accent-[var(--red)]"
            />
            <span>
              <span className="block text-ui-text font-medium text-ink">{POLICY_LABELS[p].label}</span>
              <span className="block t-micro text-muted">{POLICY_LABELS[p].desc}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {isDirty ? (
        <SettingsSaveBar
          isDirty
          pending={mutation.isPending}
          saveLabel="Save join policy"
          onReset={() => setDraft(null)}
          onSave={() => mutation.mutate(current)}
        />
      ) : null}
    </div>
  );
}
