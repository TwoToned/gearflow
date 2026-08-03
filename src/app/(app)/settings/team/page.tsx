"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { Separator } from "@/components/ui/separator";
import { InviteMember } from "@/components/settings/invite-member";
import { MemberList } from "@/components/settings/member-list";
import { JoinPolicySettings } from "@/components/settings/join-policy-settings";
import { JoinRequestApprovals } from "@/components/settings/join-request-approvals";
import { FormSection, SettingsCard } from "@/components/layout/page-layouts";
import { useCanDo } from "@/lib/use-permissions";
import { FadeIn } from "@/components/ui/motion";

export default function TeamSettingsPage() {
  const canInvite = useCanDo("orgMembers", "invite");
  const canManageJoinPolicy = useCanDo("orgSettings", "update");

  return (
    <FadeIn>
    <div className="space-y-6">
      <SettingsCard>
        <FormSection
          title="Team Members"
          description="Invite and manage members of your organization."
        >
          <div className="sm:col-span-2 space-y-4">
            {canInvite && (
              <>
                <InviteMember />
                <Separator />
              </>
            )}
            <MemberList />
          </div>
        </FormSection>
      </SettingsCard>

      {canManageJoinPolicy && (
        <SettingsCard>
          <FormSection
            title="Join Policy"
            description="Control whether people can ask to join this organisation without an invite."
          >
            <div className="sm:col-span-2">
              <JoinPolicySettings />
            </div>
          </FormSection>
        </SettingsCard>
      )}

      {canInvite && (
        <SettingsCard>
          <FormSection
            title="Pending Join Requests"
            description="Review people who asked to join by matching your organisation's email domain."
          >
            <div className="sm:col-span-2">
              <JoinRequestApprovals />
            </div>
          </FormSection>
        </SettingsCard>
      )}
    </div>
    </FadeIn>
  );
}
