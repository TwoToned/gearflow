"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { Separator } from "@/components/ui/separator";
import { InviteMember } from "@/components/settings/invite-member";
import { MemberList } from "@/components/settings/member-list";
import { FormSection } from "@/components/layout/page-layouts";
import { useCanDo } from "@/lib/use-permissions";
import { FadeIn } from "@/components/ui/motion";

export default function TeamSettingsPage() {
  const canInvite = useCanDo("orgMembers", "invite");

  return (
    <FadeIn>
    <div className="space-y-6">
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
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
      </div>
    </div>
    </FadeIn>
  );
}
