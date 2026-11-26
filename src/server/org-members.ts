"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
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
