/**
 * Team writes (UX Phase 17, D58/D59): role change, removal, invite resend and
 * revoke, each as a single-or-many core that the thin `"use server"` actions in
 * `src/server/team.ts` call after `requirePermission`. Every row is checked
 * against the ONE policy (`member-role-policy.ts`), org-scoped in the query,
 * and reports what it changed and what it skipped (with the reason). A bulk
 * call never fails as a whole: a row that is off limits, changed under us, or
 * hits an infrastructure error is SKIPPED with its reason, and the Undo covers
 * exactly the rows that DID change (never thrown away with the failure).
 *
 * Order of writes. Prisma (Better Auth's tables) is the source of truth, so a
 * role change writes it FIRST with a compare-and-set on the role we read
 * (`where: { id, role: expected }`, count checked), then mirrors to Convex
 * (strict). If the mirror fails the Prisma write is compensated (CAS back) so the
 * two stores never disagree, and the row is reported, never hidden. Removal is the
 * one exception, deliberately Convex-FIRST: a revocation whose mirror write failed
 * after Prisma committed would leave a stale grant in Convex (RBAC reads it);
 * removing the mirror first fails CLOSED, and is compensated (re-upserted) if the
 * Prisma delete then loses its compare-and-set.
 */
import { env } from "@/env";
import { UserFacingError } from "@/lib/errors/user-facing-error";
import { INVITE_TTL_MS } from "@/lib/invite-ttl";
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

/** At most one resend per invitation in this window, enforced here on the server. */
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

export interface TeamActor {
  organizationId: string;
  userId: string;
  userName: string;
  role: string | null;
}

interface TeamSkip {
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

/** Run one row's write; an unexpected error skips THAT row with its message and the batch carries on. */
async function safely(skipped: TeamSkip[], id: string, label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    logger.error("team write row failed", { error: e });
    skipped.push({ id, label, reason: e instanceof Error ? e.message : "Unexpected error" });
  }
}

// ─── Roles ─────────────────────────────────────────────────────────────────

/** Prisma first with a compare-and-set, then the Convex mirror; compensate Prisma if the mirror fails. */
async function writeRole(actor: TeamActor, target: { id: string; userId: string; role: string; createdAt: Date }, newRole: string): Promise<string | null> {
  const where = { id: target.id, organizationId: actor.organizationId };
  const cas = await prisma.member.updateMany({ where: { ...where, role: target.role }, data: { role: newRole } });
  if (cas.count !== 1) return "Changed while saving";
  try {
    await upsertMemberMirror(
      { id: target.id, organizationId: actor.organizationId, userId: target.userId, role: newRole, createdAt: target.createdAt },
      { strict: true },
    );
  } catch (e) {
    logger.error("member mirror failed; reverting the role", { error: e });
    const back = await prisma.member.updateMany({ where: { ...where, role: newRole }, data: { role: target.role } });
    return back.count === 1
      ? "Couldn't sync permissions, so nothing was changed. Try again."
      : "Permissions may be out of sync. Try the change again.";
  }
  return null;
}

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
    await safely(skipped, id, label, async () => {
      const verdict = roleChangeVerdict({ actorRole: actor.role, targetRole: target.role, newRole, isSelf: target.userId === actor.userId });
      if (!verdict.ok) return void skipped.push({ id, label, reason: verdict.reason });
      if (target.role === newRole) return void skipped.push({ id, label, reason: `Already ${newRole}` });
      const failure = await writeRole(actor, target, newRole);
      if (failure) return void skipped.push({ id, label, reason: failure });
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
    });
  }
  return result(items.length, skipped, { actor, body: { kind: "role", items } });
}

/**
 * After a removal lost its compare-and-set, put the Convex mirror back to EXACTLY what Prisma now says:
 * re-read the row (never re-use the role we read earlier, which is stale by definition). Gone in Prisma
 * -> no mirror row (a concurrent removal must not leave a grant behind); present -> mirror its actual
 * current role (a concurrent role change must not leave the old, possibly higher, role).
 */
async function reconcileMirrorToPrisma(organizationId: string, memberId: string, userId: string): Promise<void> {
  try {
    const now = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
    if (!now) {
      await removeMemberMirror({ organizationId, userId }, { strict: false });
      return;
    }
    await upsertMemberMirror({ id: now.id, organizationId, userId: now.userId, role: now.role, createdAt: now.createdAt }, { strict: false });
  } catch (e) {
    logger.error("could not reconcile the member mirror after a lost removal", { error: e });
  }
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
    await safely(skipped, id, label, async () => {
      const verdict = removeMemberVerdict({ actorRole: actor.role, targetRole: target.role, isSelf: target.userId === actor.userId });
      if (!verdict.ok) return void skipped.push({ id, label, reason: verdict.reason });
      // Revocation fails CLOSED: drop the mirror first, then Prisma with a compare-and-set.
      await removeMemberMirror({ organizationId: actor.organizationId, userId: target.userId }, { strict: true });
      const del = await prisma.member.deleteMany({ where: { id, organizationId: actor.organizationId, role: target.role } });
      if (del.count !== 1) {
        await reconcileMirrorToPrisma(actor.organizationId, id, target.userId);
        return void skipped.push({ id, label, reason: "Changed while removing" });
      }
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
    });
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

/** An id that is claimed at most once, shared by the Undo marker and the resend cooldown. */
async function claimMarker(actor: TeamActor, id: string, entityType: string, entityName: string, summary: string): Promise<boolean> {
  const convex = await getConvexClient();
  const { created } = await convex.mutation(api.activityLogWrites.record, {
    id,
    organizationId: actor.organizationId,
    action: entityType === "teamUndo" ? "UNDO" : "UPDATE",
    entityType,
    entityId: id,
    entityName,
    userId: actor.userId,
    userName: actor.userName,
    summary,
    createdAt: Date.now(),
  });
  return created;
}

/**
 * The invitation was last sent at `expiresAt - TTL` (a send sets expiry = now + TTL),
 * so the cooldown needs no stored field. A marker per invitation per cooldown window
 * also holds across an Undo (which puts the old expiry back), so resend -> Undo ->
 * resend can't be used to mail someone in a loop.
 */
async function resendCooldownReason(actor: TeamActor, inv: { id: string; expiresAt: Date }, now: number): Promise<string | null> {
  const lastSent = inv.expiresAt.getTime() - INVITE_TTL_MS;
  const since = now - lastSent;
  if (since >= 0 && since < RESEND_COOLDOWN_MS) {
    const wait = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - since) / 60_000));
    return `Sent just now. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`;
  }
  const bucket = Math.floor(now / RESEND_COOLDOWN_MS);
  const first = await claimMarker(actor, `resend:${inv.id}:${bucket}`, "teamResend", inv.id, "Resent an invitation");
  return first ? null : "Sent just now. Try again in a few minutes.";
}

/**
 * Resend = extend the SAME invitation and email the same link. One row means one
 * live token, never two. Its Undo puts the prior expiry back (compare-and-set); the
 * email that already went out cannot be recalled, and the toast says so.
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
    await safely(skipped, id, inv.email, async () => {
      const verdict = canManageMember(actor.role, inv.role ?? "member");
      if (!verdict.ok) return void skipped.push({ id, label: inv.email, reason: verdict.reason });
      const now = Date.now();
      const cooldown = await resendCooldownReason(actor, inv, now);
      if (cooldown) return void skipped.push({ id, label: inv.email, reason: cooldown });
      const next = now + INVITE_TTL_MS;
      const claimed = await prisma.invitation.updateMany({
        where: { id, organizationId: actor.organizationId, status: "pending", expiresAt: inv.expiresAt },
        data: { expiresAt: new Date(next) },
      });
      if (claimed.count !== 1) return void skipped.push({ id, label: inv.email, reason: "Changed while resending" });
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
        return void skipped.push({ id, label: inv.email, reason: "The email could not be sent" });
      }
      items.push({ invitationId: id, prevExpiresAt: inv.expiresAt.getTime(), newExpiresAt: next });
      await logActivity({
        organizationId: actor.organizationId,
        userId: actor.userId,
        userName: actor.userName,
        action: "UPDATE",
        entityType: "invitation",
        entityId: id,
        entityName: inv.email,
        summary: `Resent invitation to ${inv.email}`,
        details: { changes: [{ field: "expiresAt", from: inv.expiresAt.getTime(), to: next }] },
      });
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
    await safely(skipped, id, inv.email, async () => {
      const verdict = canManageMember(actor.role, inv.role ?? "member");
      if (!verdict.ok) return void skipped.push({ id, label: inv.email, reason: verdict.reason });
      const claimed = await prisma.invitation.updateMany({
        where: { id, organizationId: actor.organizationId, status: "pending", expiresAt: inv.expiresAt },
        data: { status: "cancelled" },
      });
      if (claimed.count !== 1) return void skipped.push({ id, label: inv.email, reason: "Changed while revoking" });
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
    });
  }
  return result(items.length, skipped, { actor, body: { kind: "revoke", items } });
}

// ─── Undo ──────────────────────────────────────────────────────────────────

class TeamUndoRefused extends UserFacingError {
  constructor(message: string) {
    super({ code: "UNDO_REFUSED", title: "Can't undo", message });
  }
}

const CHANGED_SINCE = "Can't undo: it changed since.";
const OUT_OF_SYNC = "Can't undo: permissions are out of sync. Ask an admin to check them.";

/**
 * The `undo:<id>` marker: claimed once, so a token can't be replayed. It is claimed
 * only AFTER every pre-check has passed, so a refused Undo never burns the token.
 */
async function claimTeamUndo(actor: TeamActor, tokenId: string, kind: string): Promise<void> {
  const created = await claimMarker(actor, `undo:${tokenId}`, "teamUndo", kind, `Undid a team change (${kind})`);
  if (!created) throw new TeamUndoRefused("That change was already undone.");
}

async function mirrorRoleOf(organizationId: string, userId: string): Promise<string | null> {
  const convex = await getConvexClient();
  const row = await convex.query(api.members.getByOrgAndUser, { organizationId, userId });
  return row?.role ?? null;
}

/** Pre-check EVERY role row against BOTH stores before anything is written. */
async function precheckRoles(actor: TeamActor, items: { memberId: string; from: string; to: string }[]) {
  const members = await prisma.member.findMany({
    where: { organizationId: actor.organizationId, id: { in: items.map((i) => i.memberId) } },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const i of items) {
    const m = byId.get(i.memberId);
    if (!m || m.role !== i.to) throw new TeamUndoRefused(CHANGED_SINCE);
    const mirror = await mirrorRoleOf(actor.organizationId, m.userId);
    if (mirror !== m.role) throw new TeamUndoRefused(OUT_OF_SYNC);
    const v = roleChangeVerdict({ actorRole: actor.role, targetRole: m.role, newRole: i.from, isSelf: m.userId === actor.userId });
    if (!v.ok) throw new TeamUndoRefused(v.reason);
  }
  return byId;
}

/** Every update or none: an interactive transaction that throws if any compare-and-set misses. */
async function roleTransaction(actor: TeamActor, items: { memberId: string; from: string; to: string }[], direction: "undo" | "redo") {
  await prisma.$transaction(async (tx) => {
    for (const i of items) {
      const [expected, next] = direction === "undo" ? [i.to, i.from] : [i.from, i.to];
      const done = await tx.member.updateMany({ where: { id: i.memberId, organizationId: actor.organizationId, role: expected }, data: { role: next } });
      if (done.count !== 1) throw new TeamUndoRefused(CHANGED_SINCE);
    }
  });
}

async function undoRoleChanges(actor: TeamActor, tokenId: string, items: { memberId: string; from: string; to: string }[]) {
  const byId = await precheckRoles(actor, items);
  await claimTeamUndo(actor, tokenId, "role");
  await roleTransaction(actor, items, "undo");
  try {
    for (const i of items) {
      const m = byId.get(i.memberId)!;
      await upsertMemberMirror(
        { id: i.memberId, organizationId: actor.organizationId, userId: m.userId, role: i.from, createdAt: m.createdAt },
        { strict: true },
      );
    }
  } catch (e) {
    logger.error("undo: member mirror failed; reverting", { error: e });
    try {
      await roleTransaction(actor, items, "redo");
    } catch (inner) {
      logger.error("undo: could not revert Prisma after mirror failure", { error: inner });
      throw new TeamUndoRefused("Permissions may be out of sync after this Undo. Check Team and try again.");
    }
    throw new TeamUndoRefused("Couldn't sync permissions, so nothing was restored.");
  }
  return { restored: items.length };
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
  await prisma.$transaction(async (tx) => {
    for (const i of items) {
      const done = await tx.invitation.updateMany({
        where: { id: i.invitationId, organizationId: actor.organizationId, status: "cancelled", expiresAt: new Date(i.expiresAt) },
        data: { status: "pending" },
      });
      if (done.count !== 1) throw new TeamUndoRefused(CHANGED_SINCE);
    }
  });
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
  await prisma.$transaction(async (tx) => {
    for (const i of items) {
      const done = await tx.invitation.updateMany({
        where: { id: i.invitationId, organizationId: actor.organizationId, status: "pending", expiresAt: new Date(i.newExpiresAt) },
        data: { expiresAt: new Date(i.prevExpiresAt) },
      });
      if (done.count !== 1) throw new TeamUndoRefused(CHANGED_SINCE);
    }
  });
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
