/**
 * Team writes (UX Phase 17, D58/D59): role change, removal, invite resend and
 * revoke, each as a single-or-many core that the thin `"use server"` actions in
 * `src/server/team.ts` call after `requirePermission`. Every row is checked
 * against the ONE policy (`member-role-policy.ts`), org-scoped in the query,
 * and reports what it changed and what it skipped (with the reason) — a bulk
 * call never fails as a whole because one row was off limits.
 *
 * Restrictive writes mirror to Convex FIRST (strict), then commit Prisma
 * (§3.3.4), as the single-member actions always did.
 */
import { env } from "@/env";
import { api } from "../../convex/_generated/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { sendEmail, roleChangedEmail, removedFromOrgEmail } from "@/lib/email";
import { invitationEmail } from "@/lib/email-templates";
import { getPlatformName } from "@/lib/platform";
import { removeMemberMirror, upsertMemberMirror } from "@/lib/member-mirror";
import { canManageMember, removeMemberVerdict, roleChangeVerdict } from "@/lib/member-role-policy";
import {
  createTeamUndoToken,
  verifyTeamUndoToken,
  type TeamUndoPayload,
} from "@/lib/team-undo-token";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TeamActor {
  organizationId: string;
  userId: string;
  userName: string;
  role: string | null;
}

export interface TeamSkip {
  id: string;
  label: string;
  reason: string;
}

export interface TeamWriteResult {
  /** How many rows actually changed. */
  changed: number;
  skipped: TeamSkip[];
  /** Opaque, server-signed; absent when there is nothing to undo or no exact reverse. */
  undoToken: string | null;
}

export async function loadActor(input: { organizationId: string; userId: string; userName: string }): Promise<TeamActor> {
  const m = await prisma.member.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId },
    select: { role: true },
  });
  return { ...input, role: m?.role ?? null };
}

function labelOf(user: { name: string | null; email: string | null }): string {
  return user.name || user.email || "Member";
}

function mailLater(to: string | null | undefined, content: ReturnType<typeof roleChangedEmail>) {
  if (!to) return;
  sendEmail({ to, ...content }).catch((e) => logger.error("async task failed", { error: e }));
}

async function orgName(organizationId: string): Promise<string | undefined> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return org?.name;
}

function result(changed: number, skipped: TeamSkip[], undo: { actor: TeamActor; body: TeamUndoPayload } | null): TeamWriteResult {
  if (!undo || changed === 0) return { changed, skipped, undoToken: null };
  const { token } = createTeamUndoToken({ orgId: undo.actor.organizationId, actorId: undo.actor.userId, body: undo.body });
  return { changed, skipped, undoToken: token };
}

// ─── Roles ─────────────────────────────────────────────────────────────────

export async function changeMemberRoles(actor: TeamActor, memberIds: string[], newRole: string): Promise<TeamWriteResult> {
  const members = await prisma.member.findMany({
    where: { organizationId: actor.organizationId, id: { in: memberIds } },
    include: { user: { select: { email: true, name: true } } },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const skipped: TeamSkip[] = [];
  const items: { memberId: string; from: string; to: string }[] = [];
  const name = await orgName(actor.organizationId);

  for (const id of memberIds) {
    const target = byId.get(id);
    if (!target) {
      skipped.push({ id, label: "Unknown member", reason: "Member not found" });
      continue;
    }
    const label = labelOf(target.user);
    const verdict = roleChangeVerdict({
      actorRole: actor.role,
      targetRole: target.role,
      newRole,
      isSelf: target.userId === actor.userId,
    });
    if (!verdict.ok) {
      skipped.push({ id, label, reason: verdict.reason });
      continue;
    }
    if (target.role === newRole) {
      skipped.push({ id, label, reason: `Already ${newRole}` });
      continue;
    }
    // Restrictive (a change may reduce permissions): Convex first, strict.
    await upsertMemberMirror(
      { id, organizationId: actor.organizationId, userId: target.userId, role: newRole, createdAt: target.createdAt },
      { strict: true },
    );
    await prisma.member.update({ where: { id }, data: { role: newRole } });
    items.push({ memberId: id, from: target.role, to: newRole });
    await logActivity({
      organizationId: actor.organizationId,
      userId: actor.userId,
      userName: actor.userName,
      action: "UPDATE",
      entityType: "member",
      entityId: id,
      entityName: label,
      summary: `Changed role of ${label} from ${target.role} to ${newRole}`,
      details: { changes: [{ field: "role", from: target.role, to: newRole }] },
    });
    if (name) mailLater(target.user.email, roleChangedEmail({ orgName: name, newRole }));
  }
  return result(items.length, skipped, { actor, body: { kind: "role", items } });
}

export async function removeMembers(actor: TeamActor, memberIds: string[]): Promise<TeamWriteResult> {
  const members = await prisma.member.findMany({
    where: { organizationId: actor.organizationId, id: { in: memberIds } },
    include: { user: { select: { email: true, name: true } } },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const skipped: TeamSkip[] = [];
  let removed = 0;
  const name = await orgName(actor.organizationId);

  for (const id of memberIds) {
    const target = byId.get(id);
    if (!target) {
      skipped.push({ id, label: "Unknown member", reason: "Member not found" });
      continue;
    }
    const label = labelOf(target.user);
    const verdict = removeMemberVerdict({ actorRole: actor.role, targetRole: target.role, isSelf: target.userId === actor.userId });
    if (!verdict.ok) {
      skipped.push({ id, label, reason: verdict.reason });
      continue;
    }
    // Restrictive (revocation): Convex first, strict, then Prisma.
    await removeMemberMirror({ organizationId: actor.organizationId, userId: target.userId }, { strict: true });
    await prisma.member.delete({ where: { id } });
    removed += 1;
    await logActivity({
      organizationId: actor.organizationId,
      userId: actor.userId,
      userName: actor.userName,
      action: "DELETE",
      entityType: "member",
      entityId: id,
      entityName: target.user.email || label,
      summary: `Removed member ${target.user.email ?? label} from organization`,
    });
    if (name) mailLater(target.user.email, removedFromOrgEmail({ orgName: name }));
  }
  // No Undo: a removal emails the person and ends their access; re-adding creates a
  // new membership (new id, new joined date), not the one that was removed.
  return result(removed, skipped, null);
}

// ─── Invitations ───────────────────────────────────────────────────────────

async function pendingInvites(actor: TeamActor, ids: string[]) {
  const rows = await prisma.invitation.findMany({
    where: { organizationId: actor.organizationId, id: { in: ids }, status: "pending" },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Resend = extend the SAME invitation and email the same link. One row means
 * one live token, never two. Its Undo puts the prior expiry back (compare-and-
 * set); the email that already went out cannot be recalled, and says so.
 */
export async function resendInvitations(actor: TeamActor, ids: string[]): Promise<TeamWriteResult> {
  const rows = await pendingInvites(actor, ids);
  const skipped: TeamSkip[] = [];
  const items: { invitationId: string; prevExpiresAt: number; newExpiresAt: number }[] = [];
  const [name, pName] = await Promise.all([orgName(actor.organizationId), getPlatformName()]);

  for (const id of ids) {
    const inv = rows.get(id);
    if (!inv) {
      skipped.push({ id, label: "Unknown invitation", reason: "Invitation not found or no longer pending" });
      continue;
    }
    const verdict = canManageMember(actor.role, inv.role ?? "member");
    if (!verdict.ok) {
      skipped.push({ id, label: inv.email, reason: verdict.reason });
      continue;
    }
    const prev = inv.expiresAt.getTime();
    const next = Date.now() + INVITE_TTL_MS;
    const claimed = await prisma.invitation.updateMany({
      where: { id, organizationId: actor.organizationId, status: "pending", expiresAt: inv.expiresAt },
      data: { expiresAt: new Date(next) },
    });
    if (claimed.count !== 1) {
      skipped.push({ id, label: inv.email, reason: "Changed while resending" });
      continue;
    }
    try {
      await sendEmail({
        to: inv.email,
        ...invitationEmail({
          orgName: name || "an organization",
          inviterName: actor.userName,
          role: inv.role ?? "member",
          acceptUrl: `${env.NEXT_PUBLIC_APP_URL}/invite/${inv.id}`,
          platformName: pName,
        }),
      });
    } catch (e) {
      logger.error("resend invitation email failed", { error: e });
      await prisma.invitation.updateMany({
        where: { id, organizationId: actor.organizationId, status: "pending", expiresAt: new Date(next) },
        data: { expiresAt: inv.expiresAt },
      });
      skipped.push({ id, label: inv.email, reason: "The email could not be sent" });
      continue;
    }
    items.push({ invitationId: id, prevExpiresAt: prev, newExpiresAt: next });
    await logActivity({
      organizationId: actor.organizationId,
      userId: actor.userId,
      userName: actor.userName,
      action: "UPDATE",
      entityType: "invitation",
      entityId: id,
      entityName: inv.email,
      summary: `Resent invitation to ${inv.email}`,
      details: { changes: [{ field: "expiresAt", from: prev, to: next }] },
    });
  }
  return result(items.length, skipped, { actor, body: { kind: "resend", items } });
}

export async function revokeInvitations(actor: TeamActor, ids: string[]): Promise<TeamWriteResult> {
  const rows = await pendingInvites(actor, ids);
  const skipped: TeamSkip[] = [];
  const items: { invitationId: string; expiresAt: number }[] = [];

  for (const id of ids) {
    const inv = rows.get(id);
    if (!inv) {
      skipped.push({ id, label: "Unknown invitation", reason: "Invitation not found or no longer pending" });
      continue;
    }
    const verdict = canManageMember(actor.role, inv.role ?? "member");
    if (!verdict.ok) {
      skipped.push({ id, label: inv.email, reason: verdict.reason });
      continue;
    }
    const claimed = await prisma.invitation.updateMany({
      where: { id, organizationId: actor.organizationId, status: "pending" },
      data: { status: "cancelled" },
    });
    if (claimed.count !== 1) {
      skipped.push({ id, label: inv.email, reason: "Changed while revoking" });
      continue;
    }
    items.push({ invitationId: id, expiresAt: inv.expiresAt.getTime() });
    await logActivity({
      organizationId: actor.organizationId,
      userId: actor.userId,
      userName: actor.userName,
      action: "DELETE",
      entityType: "invitation",
      entityId: id,
      entityName: inv.email,
      summary: `Revoked invitation to ${inv.email}`,
    });
  }
  return result(items.length, skipped, { actor, body: { kind: "revoke", items } });
}

// ─── Undo ──────────────────────────────────────────────────────────────────

export class TeamUndoRefused extends Error {}

/** The `undo:<id>` marker: written once, so a token can never be replayed. */
async function claimTeamUndo(actor: TeamActor, tokenId: string, kind: string): Promise<void> {
  const convex = await getConvexClient();
  const { created } = await convex.mutation(api.activityLogWrites.record, {
    id: `undo:${tokenId}`,
    organizationId: actor.organizationId,
    action: "UNDO",
    entityType: "teamUndo",
    entityId: tokenId,
    entityName: kind,
    userId: actor.userId,
    userName: actor.userName,
    summary: `Undid a team change (${kind})`,
    createdAt: Date.now(),
  });
  if (!created) throw new TeamUndoRefused("That change was already undone.");
}

const CHANGED_SINCE = "Can't undo: it changed since.";

async function undoRoles(actor: TeamActor, items: { memberId: string; from: string; to: string }[]) {
  const members = await prisma.member.findMany({
    where: { organizationId: actor.organizationId, id: { in: items.map((i) => i.memberId) } },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const i of items) {
    const m = byId.get(i.memberId);
    if (!m || m.role !== i.to) throw new TeamUndoRefused(CHANGED_SINCE);
    const v = roleChangeVerdict({ actorRole: actor.role, targetRole: m.role, newRole: i.from, isSelf: m.userId === actor.userId });
    if (!v.ok) throw new TeamUndoRefused(v.reason);
  }
  return byId;
}

type Invitation = Awaited<ReturnType<typeof prisma.invitation.findMany>>[number];

/** Restore a revoked invite only if it is still exactly as the revoke left it and
 *  bringing it back can't create a second live invite or invite an existing member. */
async function assertRevokeUndoable(actor: TeamActor, inv: Invitation, expiresAt: number) {
  if (inv.status !== "cancelled" || inv.expiresAt.getTime() !== expiresAt) throw new TeamUndoRefused(CHANGED_SINCE);
  const [live, member] = await Promise.all([
    prisma.invitation.findFirst({ where: { organizationId: actor.organizationId, email: inv.email, status: "pending" } }),
    prisma.member.findFirst({ where: { organizationId: actor.organizationId, user: { email: inv.email } } }),
  ]);
  if (live || member) throw new TeamUndoRefused(`Can't undo: ${inv.email} was invited again or has joined.`);
}

async function loadInvitesForUndo(actor: TeamActor, ids: string[]) {
  const rows = await prisma.invitation.findMany({ where: { organizationId: actor.organizationId, id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const inv = byId.get(id);
    if (!inv) throw new TeamUndoRefused(CHANGED_SINCE);
    const verdict = canManageMember(actor.role, inv.role ?? "member");
    if (!verdict.ok) throw new TeamUndoRefused(verdict.reason);
  }
  return byId;
}

async function undoRevoke(actor: TeamActor, tokenId: string, items: { invitationId: string; expiresAt: number }[]) {
  const byId = await loadInvitesForUndo(actor, items.map((i) => i.invitationId));
  for (const i of items) await assertRevokeUndoable(actor, byId.get(i.invitationId)!, i.expiresAt);
  await claimTeamUndo(actor, tokenId, "revoke");
  for (const i of items) {
    const done = await prisma.invitation.updateMany({
      where: { id: i.invitationId, organizationId: actor.organizationId, status: "cancelled" },
      data: { status: "pending" },
    });
    if (done.count !== 1) throw new TeamUndoRefused(CHANGED_SINCE);
  }
  return { restored: items.length };
}

async function undoResend(
  actor: TeamActor,
  tokenId: string,
  items: { invitationId: string; prevExpiresAt: number; newExpiresAt: number }[],
) {
  const byId = await loadInvitesForUndo(actor, items.map((i) => i.invitationId));
  for (const i of items) {
    const inv = byId.get(i.invitationId)!;
    if (inv.status !== "pending" || inv.expiresAt.getTime() !== i.newExpiresAt) throw new TeamUndoRefused(CHANGED_SINCE);
  }
  await claimTeamUndo(actor, tokenId, "resend");
  for (const i of items) {
    const done = await prisma.invitation.updateMany({
      where: { id: i.invitationId, organizationId: actor.organizationId, status: "pending", expiresAt: new Date(i.newExpiresAt) },
      data: { expiresAt: new Date(i.prevExpiresAt) },
    });
    if (done.count !== 1) throw new TeamUndoRefused(CHANGED_SINCE);
  }
  return { restored: items.length };
}

async function undoRoleChanges(actor: TeamActor, tokenId: string, items: { memberId: string; from: string; to: string }[]) {
  const byId = await undoRoles(actor, items);
  await claimTeamUndo(actor, tokenId, "role");
  for (const i of items) {
    const m = byId.get(i.memberId)!;
    await upsertMemberMirror(
      { id: i.memberId, organizationId: actor.organizationId, userId: m.userId, role: i.from, createdAt: m.createdAt },
      { strict: true },
    );
    const done = await prisma.member.updateMany({
      where: { id: i.memberId, organizationId: actor.organizationId, role: i.to },
      data: { role: i.from },
    });
    if (done.count !== 1) throw new TeamUndoRefused(CHANGED_SINCE);
  }
  return { restored: items.length };
}

/** Reverse a Team write. Takes only the server-signed token the forward write returned. */
export async function undoTeamChange(actor: TeamActor, token: string): Promise<{ restored: number }> {
  let envelope;
  try {
    envelope = verifyTeamUndoToken(token);
  } catch (e) {
    throw new TeamUndoRefused(e instanceof Error ? e.message : "That Undo is no longer valid.");
  }
  if (envelope.orgId !== actor.organizationId || envelope.actorId !== actor.userId) {
    throw new TeamUndoRefused("Only the person who made a change can undo it.");
  }
  const body = envelope.body;
  if (body.kind === "role") return undoRoleChanges(actor, envelope.id, body.items);
  if (body.kind === "revoke") return undoRevoke(actor, envelope.id, body.items);
  return undoResend(actor, envelope.id, body.items);
}

/** Which permission an Undo needs: read from the signed token, never the client. */
export function peekTeamUndoKind(token: string): "role" | "revoke" | "resend" {
  try {
    return verifyTeamUndoToken(token).body.kind;
  } catch (e) {
    throw new TeamUndoRefused(e instanceof Error ? e.message : "That Undo is no longer valid.");
  }
}
