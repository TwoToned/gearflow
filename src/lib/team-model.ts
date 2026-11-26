import type { ActionItem, BulkAction, LineRowData, StatusValue } from "@/lib/primitives/types";
import { ASSIGNABLE_ROLE_OPTIONS } from "@/lib/role-descriptions";
import { roleLabels } from "@/lib/permissions";
import { canAssignRole, canManageMember, removeMemberVerdict } from "@/lib/member-role-policy";
import { plural, listWriteTitle } from "@/lib/list-write-toast";
import type { TeamWriteResult } from "@/lib/team-writes";

/**
 * Settings → Team, as pure data (UX Phase 17, §9k.3): the three row kinds, the
 * row ⋯ and bulk verbs for each, and the toast words. No React here, so the
 * rules (absent-not-disabled, who may do what) are testable and the surfaces
 * only render. The policy itself is `member-role-policy.ts`: the menus read the
 * SAME `canAssignRole` / `canManageMember` the server enforces, so a verb the
 * server would refuse is absent, and the server still refuses it if asked.
 */

export interface TeamMemberSource {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: string | Date;
}

export interface TeamInviteSource {
  id: string;
  email: string;
  role: string | null;
  expiresAt: string | Date;
}

export interface TeamViewer {
  userId: string | null;
  role: string | null;
}

const roleLabel = (role: string): string => roleLabels[role] ?? role.charAt(0).toUpperCase() + role.slice(1);

/** Pending / Expired, derived from `expiresAt` at read time; never stored. */
export function inviteStatus(expiresAt: string | Date, now: number): StatusValue {
  return new Date(expiresAt).getTime() < now
    ? { label: "Expired", intent: "warning" }
    : { label: "Pending", intent: "info" };
}

const dateText = (d: string | Date) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export interface MemberActionHandlers {
  onChangeRole: (memberId: string, role: string) => void | Promise<void>;
  onRemove: (memberId: string) => void | Promise<void>;
}

/** The roles this viewer may hand out: absent, not disabled, for the rest. */
export function assignableRoles(viewerRole: string | null) {
  return ASSIGNABLE_ROLE_OPTIONS.filter((r) => canAssignRole(viewerRole, r.value).ok);
}

export function memberMenu(m: TeamMemberSource, viewer: TeamViewer, h: MemberActionHandlers): ActionItem[] {
  const isSelf = m.userId === viewer.userId;
  const items: ActionItem[] = [];
  const roles = assignableRoles(viewer.role).filter((r) => r.value !== m.role);
  if (!isSelf && canManageMember(viewer.role, m.role).ok && roles.length > 0) {
    items.push({
      key: "change-role",
      label: "Change role",
      group: "edit",
      onSelect: () => {},
      children: roles.map((r) => ({ key: `role-${r.value}`, label: r.label, group: "edit" as const, onSelect: () => h.onChangeRole(m.id, r.value) })),
    });
  }
  if (removeMemberVerdict({ actorRole: viewer.role, targetRole: m.role, isSelf }).ok) {
    items.push({
      key: "remove",
      label: "Remove from organisation…",
      group: "danger",
      danger: true,
      onSelect: () => h.onRemove(m.id),
      confirm: {
        title: `Remove ${m.name || m.email || "this member"}?`,
        body: "They lose access to this organisation straight away and are emailed. Their past work and history stay. This can't be undone here: to bring them back, invite them again.",
        confirmLabel: "Remove",
      },
    });
  }
  return items;
}

export function memberRow(m: TeamMemberSource, viewer: TeamViewer, h: MemberActionHandlers): LineRowData {
  const items = memberMenu(m, viewer, h);
  return {
    id: m.id,
    kind: "crew",
    title: m.name || m.email || "Member",
    subtitle: m.name && m.email ? m.email : undefined,
    facts: {
      role: { kind: "text", label: roleLabel(m.role) },
      joined: { kind: "text", label: dateText(m.createdAt) },
    },
    menu: items.length > 0 ? { items } : undefined,
  };
}

export interface InviteActionHandlers {
  onResend: (id: string) => void | Promise<void>;
  onRevoke: (id: string) => void | Promise<void>;
}

export function inviteRow(i: TeamInviteSource, viewer: TeamViewer, now: number, h: InviteActionHandlers): LineRowData {
  const manageable = canManageMember(viewer.role, i.role ?? "member").ok;
  const items: ActionItem[] = manageable
    ? [
        { key: "resend", label: "Resend invite", group: "edit", onSelect: () => h.onResend(i.id) },
        {
          key: "revoke",
          label: "Revoke invite…",
          group: "danger",
          danger: true,
          onSelect: () => h.onRevoke(i.id),
          confirm: {
            title: `Revoke the invite to ${i.email}?`,
            body: "The link in their email stops working. You can bring this invite back with Undo, or send a new one.",
            confirmLabel: "Revoke",
          },
        },
      ]
    : [];
  return {
    id: i.id,
    kind: "crew",
    title: i.email,
    facts: {
      role: { kind: "text", label: roleLabel(i.role ?? "member") },
      expires: { kind: "text", label: `Expires ${dateText(i.expiresAt)}` },
    },
    status: inviteStatus(i.expiresAt, now),
    menu: items.length > 0 ? { items } : undefined,
  };
}

/** Bulk verbs for ticked MEMBER rows: `Change role… n`, then red `Remove n`. */
export function memberBulkActions(viewer: TeamViewer, h: { onChangeRoles: (role: string) => void | Promise<void>; onRemoveMany: () => void | Promise<void> }): BulkAction[] {
  const roles = assignableRoles(viewer.role);
  const out: BulkAction[] = [];
  if (roles.length > 0) {
    out.push({
      key: "change-role",
      label: (n) => `Change role… ${n}`,
      group: "edit",
      onSelect: () => {},
      children: roles.map((r) => ({ key: `role-${r.value}`, label: () => r.label, group: "edit" as const, onSelect: () => h.onChangeRoles(r.value) })),
    });
  }
  out.push({
    key: "remove",
    label: (n) => `Remove ${n}`,
    group: "danger",
    danger: true,
    onSelect: () => h.onRemoveMany(),
    confirm: {
      title: "Remove the selected members?",
      body: "They lose access straight away and are emailed. The owner, you, and anyone you can't manage are skipped, and the toast says who. Removal has no Undo: invite them again to bring them back.",
      confirmLabel: "Remove",
    },
  });
  return out;
}

/** Bulk verbs for ticked INVITATION rows. */
export function inviteBulkActions(h: { onResendMany: () => void | Promise<void>; onRevokeMany: () => void | Promise<void> }): BulkAction[] {
  return [
    { key: "resend", label: (n) => `Resend ${n}`, group: "edit", onSelect: () => h.onResendMany() },
    {
      key: "revoke",
      label: (n) => `Revoke ${n}`,
      group: "danger",
      danger: true,
      onSelect: () => h.onRevokeMany(),
      confirm: {
        title: "Revoke the selected invites?",
        body: "Their email links stop working. Undo brings back exactly the ones still revoked.",
        confirmLabel: "Revoke",
      },
    },
  ];
}

export type TeamVerb = "role" | "remove" | "resend" | "revoke";

const DONE: Record<TeamVerb, (n: number, role?: string) => string> = {
  role: (n, role) => `Changed ${plural(n, "member")} to ${roleLabel(role ?? "member")}`,
  remove: (n) => `Removed ${plural(n, "member")}`,
  resend: (n) => `Resent ${plural(n, "invite")}`,
  revoke: (n) => `Revoked ${plural(n, "invite")}`,
};

const UNDONE: Record<TeamVerb, string> = {
  role: "Roles put back",
  remove: "",
  resend: "Expiry put back (the email already sent can't be recalled)",
  revoke: "Invites restored",
};

/** The toast title for a write result: what changed, and the skips NAMED with the first reason. */
export function teamToast(verb: TeamVerb, res: Pick<TeamWriteResult, "changed" | "skipped">, role?: string) {
  const skipped = res.skipped.map((s) => ({ name: s.label, why: s.reason }));
  const title =
    res.changed === 0 && skipped.length > 0
      ? `Nothing changed · ${skipped[0].name}: ${skipped[0].why}`
      : listWriteTitle(DONE[verb](res.changed, role), skipped);
  return { title, undoneTitle: UNDONE[verb] };
}
