"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useOrganization } from "@/hooks/use-organization";
import { useLocations } from "@/hooks/use-locations";
import { useOrgMembers } from "@/hooks/use-org-members";
import { usePendingInvitations } from "@/hooks/use-pending-invitations";
import { useSetupDismissal } from "@/hooks/use-setup-dismissal";
import { cn, focusRing } from "@/lib/utils";

interface ChecklistItem {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

interface OrgRecord {
  settings?: {
    currency?: string;
    branding?: { logoUrl?: string };
  };
}

const CARD = "rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]";

/** Bundles the five loading flags and the derived counts/completion state —
 *  split out purely to keep `FinishSetupChecklist`'s own cyclomatic
 *  complexity under the R-3.6/complexity-ratchet ceiling (optional
 *  chaining/`??`/`||` each count as a decision point in this repo's eslint
 *  config — see the identical note throughout the wizard steps).
 *
 *  `invitesLoading` matters as much as the other four: `usePendingInvitations`
 *  is its own independent shared-resource store, so it can still be mid-fetch
 *  after org/locations/members have all resolved — omitting it let the "team"
 *  item flash "not done" (with a live "Fix it" link) for an org that had
 *  already invited a second person, for the one render before invites loaded. */
/** Split out of `checklistState` purely to keep ITS OWN complexity under
 *  the ceiling too — five `||` terms alone was enough to trip it. */
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

function checklistState(opts: {
  org: OrgRecord | undefined;
  orgLoading: boolean;
  locations: unknown[] | undefined;
  members: unknown[] | undefined;
  membersLoading: boolean;
  invites: unknown[] | undefined;
  invitesLoading: boolean;
  dismissedAt: number | null | undefined;
}): { loading: boolean; items: ChecklistItem[]; doneCount: number; complete: boolean } {
  const loading = isChecklistLoading(opts);
  const teamCount = (opts.members?.length ?? 0) + (opts.invites?.length ?? 0);
  const items = buildItems(opts.org, opts.locations?.length ?? 0, teamCount);
  const doneCount = items.filter((i) => i.done).length;
  return { loading, items, doneCount, complete: doneCount === items.length };
}

/** Every item is computed from the org's actual settings — nothing here
 *  tracks "step N done" (C6, #1104; D5/R-3.1). Team counts pending invites
 *  alongside accepted members: an owner who's invited a teammate has
 *  genuinely finished this step even before the invite is accepted, and the
 *  wizard's own team screen (C5) is itself about sending invites, not
 *  waiting on acceptance.
 *
 *  Known gap: `approveJoinRequest` (B2, #1094) creates a `Member` row
 *  directly without cancelling any pending `Invitation` for the same email,
 *  so an org using domain-join alongside a stale (not yet expired/revoked)
 *  invite can double-count one real person by one for up to 7 days. Judged
 *  acceptable — the failure mode is this card disappearing slightly early
 *  for an already-legitimately-staffed org, not a false "unfinished" state;
 *  a real fix belongs in the join-request/invite reconciliation itself, out
 *  of scope for a dashboard checklist. */
function buildItems(org: OrgRecord | undefined, locationCount: number, teamCount: number): ChecklistItem[] {
  return [
    { key: "operating", label: "Set your currency & tax details", href: "/settings", done: !!org?.settings?.currency },
    { key: "branding", label: "Add your logo", href: "/settings/branding", done: !!org?.settings?.branding?.logoUrl },
    { key: "location", label: "Add a location", href: "/locations", done: locationCount > 0 },
    { key: "team", label: "Invite your team", href: "/settings/team", done: teamCount >= 2 },
  ];
}

/**
 * Dashboard "Finish setup" card (C6, #1104) — what makes D3's "skip
 * everything" in the wizard safe: a dismissible, always-accurate checklist
 * that deep-links back into the real settings pages for whatever's still
 * unset. Lives BESIDE the activation checklist (#1105, D1), never merged
 * with it — setup is "configure the company", activation is "do the work".
 *
 * Progress is derived every render from the org's real settings/locations/
 * members — someone who configured tax in Settings rather than the wizard
 * has genuinely finished that item, and a stored flag would say otherwise.
 * The only persisted bit is the dismissal itself (`useSetupDismissal`, its
 * own Convex table — see the schema comment on `orgSetupDismissals` for why
 * it isn't a `notificationDismissals` row). Disappears for good once
 * dismissed OR complete; each row links to the ONE place that setting is
 * actually edited, never back into a wizard step.
 */

/**
 * Same gating `FinishSetupChecklist`'s own early-return uses, exposed for
 * the same reason as `useActivationChecklistVisible` beside it — a `bare`
 * render correctly returns null once complete, but an external wrapper
 * (the dashboard widget board's `<DashboardCard>`) needs to know that
 * BEFORE deciding whether to render its own title bar around nothing.
 */
export function useFinishSetupChecklistVisible(orgId: string | undefined): boolean {
  const { data: org, isLoading: orgLoading } = useOrganization(orgId) as {
    data: OrgRecord | undefined;
    isLoading: boolean;
  };
  const locations = useLocations(orgId);
  const { data: members, isLoading: membersLoading } = useOrgMembers(orgId) as {
    data: unknown[] | undefined;
    isLoading: boolean;
  };
  const { data: invites, isLoading: invitesLoading } = usePendingInvitations(orgId) as {
    data: unknown[] | undefined;
    isLoading: boolean;
  };
  const { dismissedAt } = useSetupDismissal();
  const { loading, complete } = checklistState({
    org,
    orgLoading,
    locations,
    members,
    membersLoading,
    invites,
    invitesLoading,
    dismissedAt,
  });
  return !loading && dismissedAt == null && !complete;
}

export function FinishSetupChecklist({ orgId, bare = false }: { orgId: string | undefined; bare?: boolean }) {
  const { data: org, isLoading: orgLoading } = useOrganization(orgId) as {
    data: OrgRecord | undefined;
    isLoading: boolean;
  };
  const locations = useLocations(orgId);
  const { data: members, isLoading: membersLoading } = useOrgMembers(orgId) as {
    data: unknown[] | undefined;
    isLoading: boolean;
  };
  const { data: invites, isLoading: invitesLoading } = usePendingInvitations(orgId) as {
    data: unknown[] | undefined;
    isLoading: boolean;
  };
  const { dismissedAt, dismiss } = useSetupDismissal();
  const [dismissing, setDismissing] = useState(false);

  const { loading, items, doneCount, complete } = checklistState({
    org,
    orgLoading,
    locations,
    members,
    membersLoading,
    invites,
    invitesLoading,
    dismissedAt,
  });

  if (loading || dismissedAt != null || complete) return null;

  const dismissButton = (
    <button
      type="button"
      disabled={dismissing}
      onClick={async () => {
        setDismissing(true);
        try {
          await dismiss();
        } finally {
          setDismissing(false);
        }
      }}
      className={cn("text-xs text-muted hover:text-ink disabled:opacity-50", focusRing)}
    >
      Dismiss
    </button>
  );

  const body = (
    <>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
        <div
          className="h-full rounded-full bg-red transition-all"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <ChecklistRow key={item.key} item={item} />
        ))}
      </ul>
    </>
  );

  // `bare` (dashboard-widget-board mode) — see the identical note on
  // ActivationChecklist: skip this component's own card/header (the shared
  // `<DashboardCard>` shell supplies both), keep Dismiss (a distinct,
  // org-wide "done showing me this" bit, not the same as removing the widget
  // from just this board).
  if (bare) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg-3">
            {doneCount} of {items.length} done
          </p>
          {dismissButton}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="t-overline text-muted">Finish setup</h2>
          <p className="text-xs text-fg-3">
            {doneCount} of {items.length} done
          </p>
        </div>
        {dismissButton}
      </div>
      {body}
    </div>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 flex-none items-center justify-center rounded-full border-2",
            item.done ? "border-ok bg-ok/10 text-ok" : "border-line-2 text-transparent",
          )}
        >
          <Check className="h-3 w-3" aria-hidden />
        </span>
        <span className={item.done ? "text-fg-3 line-through" : "text-ink"}>{item.label}</span>
      </span>
      {!item.done && (
        <Link href={item.href} className="text-xs font-medium text-red hover:underline">
          Fix it
        </Link>
      )}
    </li>
  );
}
