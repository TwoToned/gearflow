"use server";

import { prisma } from "@/lib/prisma";

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

/**
 * Resolve the org an invitation belongs to. Public (no session required) — the
 * invite-accept page calls this right after `organization.acceptInvitation()`
 * to set the active org, replacing the single-org `getTheOrgId()` (#1071, A1):
 * the org to activate comes from the invitation row itself, not a guess.
 */
export async function getInvitationOrganizationId(invitationId: string): Promise<string | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { organizationId: true },
  });
  return invitation?.organizationId ?? null;
}
