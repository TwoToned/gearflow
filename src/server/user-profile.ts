"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";
import { serialize } from "@/lib/serialize";
import { mirrorUserToConvex } from "@/lib/user-mirror";

export async function getProfile() {
  const session = await requireSession();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      twoFactorEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) throw new Error("User not found");
  return serialize(user);
}

export async function updateProfile(data: { name?: string; image?: string | null }) {
  const session = await requireSession();

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: data.name,
      image: data.image,
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
    },
  });

  // Keep the Convex user mirror in sync (best-effort).
  await mirrorUserToConvex(session.user.id);

  return serialize(updated);
}

export async function getUserOrganizations() {
  const session = await requireSession();

  const members = await prisma.member.findMany({
    where: { userId: session.user.id },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, logo: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return serialize(members);
}

export async function leaveOrganization(orgId: string) {
  const session = await requireSession();

  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, userId: session.user.id },
  });

  if (!member) throw new Error("You are not a member of this organization.");
  if (member.role === "owner") {
    throw new Error("You are the owner. Transfer ownership to another member before leaving.");
  }

  await prisma.member.delete({ where: { id: member.id } });
  return { success: true };
}

export async function getActiveSessions() {
  const session = await requireSession();

  const sessions = await prisma.session.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
      token: true,
    },
  });

  // Mark current session
  const currentToken = session.session.token;
  const mapped = sessions.map((s) => ({
    ...s,
    isCurrent: s.token === currentToken,
    token: undefined, // Don't expose token to client
  }));

  return serialize(mapped);
}

export async function revokeSession(sessionId: string) {
  const session = await requireSession();

  const target = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!target || target.userId !== session.user.id) {
    throw new Error("Session not found");
  }

  if (target.token === session.session.token) {
    throw new Error("Cannot revoke your current session. Use sign out instead.");
  }

  await prisma.session.delete({ where: { id: sessionId } });
  return { success: true };
}

export async function revokeAllOtherSessions() {
  const session = await requireSession();

  await prisma.session.deleteMany({
    where: {
      userId: session.user.id,
      token: { not: session.session.token },
    },
  });

  return { success: true };
}
