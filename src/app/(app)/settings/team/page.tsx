"use client";

import { Separator } from "@/components/ui/separator";
import { InviteMember } from "@/components/settings/invite-member";
import { MemberList } from "@/components/settings/member-list";
import { RoleManager } from "@/components/settings/role-manager";
import { FormSection } from "@/components/layout/page-layouts";
import { useCanDo } from "@/lib/use-permissions";
import { FadeIn } from "@/components/ui/motion";

export default function TeamSettingsPage() {
  const canInvite = useCanDo("orgMembers", "invite");
  const canManageRoles = useCanDo("orgMembers", "update_role");

  return (
    <FadeIn>
    <div className="space-y-6">
      {canManageRoles && (
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <FormSection
            title="Roles & Permissions"
            description="Define custom roles with granular permissions for your team."
          >
            <div className="sm:col-span-2">
              <RoleManager />
            </div>
          </FormSection>
        </div>
      )}

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
