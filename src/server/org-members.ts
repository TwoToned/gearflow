"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail, roleChangedEmail, removedFromOrgEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity-log";
import {
  upsertMemberMirror,
  removeMemberMirror,
} from "@/lib/member-mirror";

export async function getOrgMembers(params?: {
  page?: number;
  pageSize?: number;
}) {
  await requirePermission("orgMembers", "read");
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 50 } = params || {};

  const where = { organizationId };

  const [members, total] = await Promise.all([
    prisma.member.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            twoFactorEnabled: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.member.count({ where }),
  ]);

  return serialize({
    members,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * Lightweight member directory for @mention pickers. Available to any org member
 * (no orgMembers:read gate) since it only exposes id/name/image already visible
 * across the app. Returns the current user first is NOT done here — callers can
 * filter themselves out if desired.
 */
export async function getMentionableMembers() {
  const { organizationId } = await getOrgContext();
  const members = await prisma.member.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });
  return serialize(
    members.map((m) => ({
      userId: m.user.id,
      name: m.user.name || m.user.email || "Unknown",
      image: m.user.image ?? null,
    })),
  );
}

export async function changeMemberRole(memberId: string, newRole: string) {
  await requirePermission("orgMembers", "update_role");
  const { organizationId, userId, userName } = await getOrgContext();

  const target = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!target) throw new Error("Member not found");

  // Can't change owner role
  if (target.role === "owner") {
    throw new Error("Cannot change the owner's role. Transfer ownership instead.");
  }

  // Can't change your own role
  if (target.userId === userId) {
    throw new Error("You cannot change your own role.");
  }

  // Only assignable built-in roles (custom roles were removed). This allow-list is
  // the sole rejection of arbitrary/elevated role strings here — do NOT drop it
  // (owner is intentionally excluded; ownership transfer is a separate flow).
  const VALID_ASSIGNABLE_ROLES = ["admin", "manager", "member", "warehouse", "viewer"];
  if (!VALID_ASSIGNABLE_ROLES.includes(newRole)) {
    throw new Error("Invalid role");
  }

  // Admins can't promote to admin or change other admins
  const actor = await prisma.member.findFirst({
    where: { organizationId, userId },
  });
  if (actor?.role === "admin" && (newRole === "admin" || target.role === "admin")) {
    throw new Error("Only the owner can manage admin roles.");
  }

  // Restrictive (a role change may reduce permissions): mirror the NEW role to
  // Convex FIRST (strict), then commit Prisma — never leave Convex granting the
  // old role after Prisma demotes (§3.3.4). A Convex failure aborts the change.
  await upsertMemberMirror(
    {
      id: memberId,
      organizationId,
      userId: target.userId,
      role: newRole,
      createdAt: target.createdAt,
    },
    { strict: true },
  );

  await prisma.member.update({
    where: { id: memberId },
    data: { role: newRole },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "member",
    entityId: memberId,
    entityName: target.user.name || target.user.email || "Member",
    summary: `Changed role of ${target.user.name || target.user.email} from ${target.role} to ${newRole}`,
    details: { changes: [{ field: "role", from: target.role, to: newRole }] },
  });

  // Send notification email
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (org && target.user.email) {
    const emailContent = roleChangedEmail({ orgName: org.name, newRole });
    sendEmail({ to: target.user.email, ...emailContent }).catch(console.error);
  }

  return { success: true };
}

export async function removeOrgMember(memberId: string) {
  await requirePermission("orgMembers", "remove");
  const { organizationId, userId, userName } = await getOrgContext();

  const target = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!target) throw new Error("Member not found");

  if (target.role === "owner") {
    throw new Error("Cannot remove the owner. Transfer ownership first.");
  }

  if (target.userId === userId) {
    throw new Error("You cannot remove yourself. Use 'Leave Organization' instead.");
  }

  // Admins can't remove other admins
  const actor = await prisma.member.findFirst({
    where: { organizationId, userId },
  });
  if (actor?.role === "admin" && target.role === "admin") {
    throw new Error("Only the owner can remove admins.");
  }

  // Restrictive (revocation): remove from the Convex mirror FIRST (strict), then
  // commit the Prisma delete (§3.3.4). A Convex failure aborts the removal.
  await removeMemberMirror(
    { organizationId, userId: target.userId },
    { strict: true },
  );

  await prisma.member.delete({ where: { id: memberId } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "member",
    entityId: memberId,
    entityName: target.user.email || "Member",
    summary: `Removed member ${target.user.email} from organization`,
  });

  // Send notification
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (org && target.user.email) {
    const emailContent = removedFromOrgEmail({ orgName: org.name });
    sendEmail({ to: target.user.email, ...emailContent }).catch(console.error);
  }

  return { success: true };
}

export async function transferOwnership(newOwnerId: string) {
  const { organizationId, userId } = await getOrgContext();

  // Only the owner can transfer
  const actor = await prisma.member.findFirst({
    where: { organizationId, userId },
  });
  if (!actor || actor.role !== "owner") {
    throw new Error("Only the owner can transfer ownership.");
  }

  const newOwner = await prisma.member.findFirst({
    where: { organizationId, userId: newOwnerId },
  });
  if (!newOwner) throw new Error("Target must be a member of this organization.");

  // transferOwnership is both a DEMOTION (old owner → admin) and a PROMOTION
  // (new member → owner). The demotion is restrictive, so mirror it to Convex
  // FIRST (strict) before the Prisma transaction; the promotion is additive, so
  // mirror it best-effort AFTER (§3.3.4).
  await upsertMemberMirror(
    {
      id: actor.id,
      organizationId,
      userId,
      role: "admin",
      createdAt: actor.createdAt,
    },
    { strict: true },
  );

  await prisma.$transaction([
    prisma.member.update({
      where: { id: actor.id },
      data: { role: "admin" },
    }),
    prisma.member.update({
      where: { id: newOwner.id },
      data: { role: "owner" },
    }),
  ]);

  await upsertMemberMirror({
    id: newOwner.id,
    organizationId,
    userId: newOwnerId,
    role: "owner",
    createdAt: newOwner.createdAt,
  });

  return { success: true };
}

export async function getPendingInvitations() {
  const { organizationId } = await getOrgContext();

  const invitations = await prisma.invitation.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });

  return serialize(invitations);
}

export async function revokeInvitation(invitationId: string) {
  await requirePermission("orgMembers", "invite");
  const { organizationId } = await getOrgContext();

  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, organizationId, status: "pending" },
  });
  if (!invitation) throw new Error("Invitation not found");

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "cancelled" },
  });

  return { success: true };
}
