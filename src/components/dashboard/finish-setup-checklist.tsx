"use client";

import { useOrganization } from "@/hooks/use-organization";
import { useLocations } from "@/hooks/use-locations";
import { useOrgMembers } from "@/hooks/use-org-members";
import { usePendingInvitations } from "@/hooks/use-pending-invitations";
import { useSetupDismissal } from "@/hooks/use-setup-dismissal";
import type { SetupPanelHalf, SetupPanelItem } from "@/components/dashboard/setup-panel-types";

interface OrgRecord {
  settings?: {
    currency?: string;
    branding?: { logoUrl?: string };
  };
}

/** Split out purely to keep `useFinishSetupState`'s own complexity under the
 *  ratchet ceiling (each `||` counts as a decision point in this repo).
 *
 *  `invitesLoading` matters as much as the others: `usePendingInvitations` is its
 *  own shared store, so it can still be mid-fetch after the rest resolved, and
 *  omitting it let "team" flash not-done (with a live link) for one render. */
function isChecklistLoading(opts: {
  orgLoading: boolean;
  membersLoading: boolean;
  invitesLoading: boolean;
  locations: unknown[] | undefined;
  dismissedAt: number | null | undefined;
}): boolean {
  return (
    opts.orgLoading ||
    opts.membersLoading ||
    opts.invitesLoading ||
    opts.locations === undefined ||
    opts.dismissedAt === undefined
  );
}

/** Every item is computed from the org's actual settings: nothing tracks "step N
 *  done" (C6, #1104; D5/R-3.1). Team counts pending invites with accepted
 *  members: an owner who has invited a teammate has finished this step. Each row
 *  names the ONE place the setting is edited (`where`), never a wizard step.
 *
 *  Known gap: `approveJoinRequest` (B2, #1094) creates a `Member` without
 *  cancelling a pending `Invitation` for the same email, so one person can count
 *  twice for up to 7 days. The failure mode is the row ticking slightly early for
 *  an already staffed org, never a false "unfinished". */
function buildItems(org: OrgRecord | undefined, locationCount: number, teamCount: number): SetupPanelItem[] {
  return [
    { key: "operating", label: "Set your currency and tax details", href: "/settings", where: "Settings", done: !!org?.settings?.currency },
    { key: "branding", label: "Add your logo", href: "/settings/branding", where: "Branding", done: !!org?.settings?.branding?.logoUrl },
    { key: "location", label: "Add a location", href: "/locations", where: "Locations", done: locationCount > 0 },
    { key: "team", label: "Invite your team", href: "/settings/team", where: "Team", done: teamCount >= 2 },
  ];
}

/**
 * The "Finish setup" half of Home's setup panel (C6, #1104; UX Phase 11 merged
 * it with "Get started" into ONE panel, §6c.2). Progress is derived every
 * render from the org's real settings, locations and members. The only stored
 * bit is the per-(org, user) dismissal (`useSetupDismissal`, its own Convex
 * table). `visible` = loaded, not dismissed, not complete.
 */
export function useFinishSetupState(orgId: string | undefined): SetupPanelHalf {
  const { data: org, isLoading: orgLoading } = useOrganization(orgId) as { data: OrgRecord | undefined; isLoading: boolean };
  const locations = useLocations(orgId);
  const { data: members, isLoading: membersLoading } = useOrgMembers(orgId) as { data: unknown[] | undefined; isLoading: boolean };
  const { data: invites, isLoading: invitesLoading } = usePendingInvitations(orgId) as {
    data: unknown[] | undefined;
    isLoading: boolean;
  };
  const { dismissedAt, dismiss, undismiss } = useSetupDismissal();

  const loading = isChecklistLoading({ orgLoading, membersLoading, invitesLoading, locations, dismissedAt });
  const teamCount = (members?.length ?? 0) + (invites?.length ?? 0);
  const items = buildItems(org, locations?.length ?? 0, teamCount);
  const complete = items.every((i) => i.done);
  return { items, visible: !loading && dismissedAt == null && !complete, dismiss, undismiss };
}
