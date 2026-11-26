"use client";
// use-client: composes live lists, selection and dialogs (R-8.1.1)

import * as React from "react";
import { UserPlus } from "lucide-react";

import { InviteDialog } from "@/components/settings/team/invite-dialog";
import { RolesGridView } from "@/components/settings/team/roles-grid-view";
import { TeamList } from "@/components/settings/team/team-list";
import { JoinPolicySettings } from "@/components/settings/join-policy-settings";
import { JoinRequestApprovals } from "@/components/settings/join-request-approvals";
import { Button } from "@/components/ui/button";
import { useOrgMembers } from "@/hooks/use-org-members";
import { usePendingInvitations } from "@/hooks/use-pending-invitations";
import { useTeamWrites } from "@/hooks/use-team-writes";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useCanDo, useCurrentRole } from "@/lib/use-permissions";
import type { FactColumn } from "@/lib/primitives/types";
import {
  inviteBulkActions,
  inviteRow,
  memberBulkActions,
  memberRow,
  type TeamInviteSource,
  type TeamMemberSource,
  type TeamViewer,
} from "@/lib/team-model";

const MEMBER_COLUMNS: FactColumn[] = [
  { id: "role", header: "Role" },
  { id: "joined", header: "Joined" },
  { id: "status", header: "" },
];
const INVITE_COLUMNS: FactColumn[] = [
  { id: "role", header: "Role" },
  { id: "expires", header: "Expires" },
  { id: "status", header: "Status" },
];

/** The API serialises members with the user nested; this is the shape the model reads. */
function toMemberSources(members: unknown[] | undefined): TeamMemberSource[] {
  return ((members ?? []) as { id: string; userId: string; role: string; createdAt: string; user: { name: string | null; email: string | null } }[]).map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    createdAt: m.createdAt,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
  }));
}

/**
 * Settings → Team (UX Phase 17, §9k.3): Members, Invitations, Join requests,
 * Join policy, Roles & permissions, each a hairline section with a mono count.
 * Every write goes through `useTeamWrites` (one toast, server-signed Undo where
 * an exact reverse exists); every menu and bulk verb is built from the same role
 * policy the server enforces, so what a role can't do is absent, not greyed.
 */
export function TeamPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: session } = useSession();
  const { role } = useCurrentRole();
  const now = useStableNow();
  const canInvite = useCanDo("orgMembers", "invite");
  const canPolicy = useCanDo("orgSettings", "update");
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const { data: memberData, isLoading } = useOrgMembers(orgId);
  const { data: inviteData } = usePendingInvitations(orgId);
  const writes = useTeamWrites(orgId);

  const viewer: TeamViewer = React.useMemo(() => ({ userId: session?.user?.id ?? null, role }), [session?.user?.id, role]);
  const members = React.useMemo(() => toMemberSources(memberData), [memberData]);
  const invites = React.useMemo(() => (inviteData ?? []) as TeamInviteSource[], [inviteData]);

  const memberRows = React.useMemo(
    () =>
      members.map((m) =>
        memberRow(m, viewer, {
          onChangeRole: (id, r) => writes.changeRoles([id], r),
          onRemove: (id) => writes.removeMembers([id]),
        }),
      ),
    [members, viewer, writes],
  );
  const inviteRows = React.useMemo(
    () =>
      invites.map((i) =>
        inviteRow(i, viewer, now, { onResend: (id) => writes.resend([id]), onRevoke: (id) => writes.revoke([id]) }),
      ),
    [invites, viewer, now, writes],
  );

  return (
    <div className="space-y-10">
      {canInvite ? (
        <div className="flex justify-end">
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 size-4" aria-hidden="true" />
            Invite member
          </Button>
        </div>
      ) : null}

      <TeamList
        title="Members"
        noun="member"
        rows={memberRows}
        columns={MEMBER_COLUMNS}
        itemHeader="Name"
        loading={isLoading}
        empty="No members yet."
        bulkActions={(ids) =>
          memberBulkActions(viewer, {
            onChangeRoles: (r) => writes.changeRoles(ids, r),
            onRemoveMany: () => writes.removeMembers(ids),
          })
        }
      />

      {canInvite ? (
        <TeamList
          title="Invitations"
          noun="invitation"
          rows={inviteRows}
          columns={INVITE_COLUMNS}
          itemHeader="Email"
          empty="No pending invitations."
          bulkActions={(ids) => inviteBulkActions({ onResendMany: () => writes.resend(ids), onRevokeMany: () => writes.revoke(ids) })}
        />
      ) : null}

      {canInvite ? (
        <section aria-labelledby="team-requests" className="space-y-2">
          <h2 id="team-requests" className="t-heading text-ink">
            Join requests
          </h2>
          <JoinRequestApprovals />
        </section>
      ) : null}

      {canPolicy ? (
        <section aria-labelledby="team-policy" className="space-y-2">
          <h2 id="team-policy" className="t-heading text-ink">
            Join policy
          </h2>
          <JoinPolicySettings />
        </section>
      ) : null}

      <section aria-labelledby="team-roles" className="space-y-2">
        <h2 id="team-roles" className="t-heading text-ink">
          Roles &amp; permissions
        </h2>
        <p className="t-micro text-muted">What each role can do. This is read-only: roles are built in.</p>
        <RolesGridView />
      </section>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        orgId={orgId}
        viewerRole={role}
        members={members}
        invites={invites}
      />
    </div>
  );
}
