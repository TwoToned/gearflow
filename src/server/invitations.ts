"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";
import { serialize } from "@/lib/serialize";
import { isSiteAdmin } from "@/lib/admin-auth";

/** Get pending invitations for the current user (by email). No org context needed. */
export async function getMyPendingInvitations() {
  const session = await requireSession();
  const email = session.user.email?.toLowerCase();
  if (!email) return [];

  const invitations = await prisma.invitation.findMany({
    where: {
      email,
      status: "pending",
      expiresAt: { gte: new Date() },
    },
    include: {
      organization: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return serialize(invitations);
}

/** Get invitation details by ID (public, for prefilling registration). */
export async function getInvitationEmail(invitationId: string): Promise<string | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { email: true, status: true, expiresAt: true },
  });

  if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    return null;
  }

  return invitation.email;
}

/** Check if the current user is a site admin. No org context needed. */
export async function checkIsSiteAdmin(): Promise<boolean> {
  return isSiteAdmin();
}
