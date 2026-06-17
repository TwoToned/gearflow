"use server";

import { prisma } from "@/lib/prisma";
import { removeKitSerializedItemFromConvex, removeKitBulkItemFromConvex } from "@/lib/kit-mirror";
import { removeAssetScanLogFromConvex } from "@/lib/asset-scan-log-mirror";
import {
  removeTestTagRecordFromConvex,
  removeSubTestRecordFromConvex,
} from "@/lib/test-tag-mirror";
import { requireSession } from "@/lib/auth-server";
import { serialize } from "@/lib/serialize";
import { invalidatePlatformNameCache } from "@/lib/platform";
import { sendEmail } from "@/lib/email";
import { getPlatformName } from "@/lib/platform";
import { getTheOrg, invalidateOrgCache } from "@/lib/single-org";
import { env } from "@/env";
import { logActivity } from "@/lib/activity-log";

/** Verify the current user is a site admin. Throws if not. */
async function requireSiteAdmin() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "admin") {
    throw new Error("Access denied. Site admin required.");
  }
  return session;
}

/** Check if the current user is a site admin */
export async function isSiteAdmin(): Promise<boolean> {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    return user?.role === "admin";
  } catch {
    return false;
  }
}

// ─── Site Settings ─────────────────────────────────────────────────────────

export async function getSiteSettings() {
  let settings = await prisma.siteSettings.findFirst();
  if (!settings) {
    settings = await prisma.siteSettings.create({ data: {} });
  }
  return serialize(settings);
}

export async function updateSiteSettings(data: {
  platformName?: string;
  platformIcon?: string | null;
  platformLogo?: string | null;
  registrationPolicy?: string;
  twoFactorGlobalPolicy?: string;
  defaultCurrency?: string;
  defaultTaxRate?: number;
  allowOrgCreation?: boolean;
}) {
  const session = await requireSiteAdmin();

  let settings = await prisma.siteSettings.findFirst();
  if (!settings) {
    settings = await prisma.siteSettings.create({ data: {} });
  }

  const updated = await prisma.siteSettings.update({
    where: { id: settings.id },
    data,
  });

  // Invalidate the cached platform name so it picks up changes immediately
  invalidatePlatformNameCache();

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "siteSettings",
      entityId: updated.id,
      entityName: "Site Settings",
      summary: "Updated site settings",
      details: data as Record<string, unknown>,
    });
  }

  return serialize(updated);
}

// ─── Org Creation Policy ──────────────────────────────────────────────────

/** Check whether the current user is allowed to create organizations.
 * Single-org mode: only allowed if no org exists yet (bootstrap).
 */
export async function checkOrgCreationAllowed(): Promise<{ allowed: boolean; isSiteAdmin: boolean }> {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    const admin = user?.role === "admin";
    const org = await getTheOrg();
    // Only allow creation if no org exists (bootstrap)
    return { allowed: !org && admin, isSiteAdmin: admin };
  } catch {
    return { allowed: false, isSiteAdmin: false };
  }
}

/** Get the single organization for admin pages. */
export async function adminGetTheOrg() {
  await requireSiteAdmin();
  const org = await getTheOrg();
  if (!org) return null;
  return serialize(org);
}

// ─── Organization Management ───────────────────────────────────────────────

export async function adminCreateOrganization(data: {
  name: string;
  slug: string;
  ownerUserId?: string;
}) {
  const session = await requireSiteAdmin();
  const { name, slug, ownerUserId } = data;

  if (!name.trim() || !slug.trim()) {
    throw new Error("Name and slug are required.");
  }

  // Validate slug format
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/(^-|-$)/g, "");
  if (!normalizedSlug) throw new Error("Invalid slug.");

  // Check slug uniqueness
  const existing = await prisma.organization.findUnique({ where: { slug: normalizedSlug } });
  if (existing) throw new Error("An organization with this slug already exists.");

  // Determine owner — defaults to the admin performing the action
  const ownerId = ownerUserId || session.user.id;
  const ownerUser = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!ownerUser) throw new Error("Owner user not found.");

  const org = await prisma.$transaction(async (tx) => {
    const newOrg = await tx.organization.create({
      data: { name: name.trim(), slug: normalizedSlug },
    });
    await tx.member.create({
      data: { organizationId: newOrg.id, userId: ownerId, role: "owner" },
    });
    return newOrg;
  });

  await logActivity({
    organizationId: org.id,
    userId: session.user.id,
    userName: session.user.name,
    action: "CREATE",
    entityType: "organization",
    entityId: org.id,
    entityName: org.name,
    summary: `Created organization ${org.name}`,
  });

  return serialize(org);
}

export async function getAllOrganizations(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  await requireSiteAdmin();
  const { page = 1, pageSize = 20, search } = params || {};

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { slug: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          where: { role: "owner" },
          take: 1,
        },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.organization.count({ where }),
  ]);

  return serialize({
    organizations,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function adminUpdateOrganization(
  orgId: string,
  data: { name?: string; slug?: string },
) {
  const session = await requireSiteAdmin();

  if (data.slug) {
    const normalizedSlug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/(^-|-$)/g, "");
    if (!normalizedSlug) throw new Error("Invalid slug.");
    const existing = await prisma.organization.findFirst({
      where: { slug: normalizedSlug, id: { not: orgId } },
    });
    if (existing) throw new Error("An organization with this slug already exists.");
    data.slug = normalizedSlug;
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data,
  });

  invalidateOrgCache();

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "UPDATE",
    entityType: "organization",
    entityId: orgId,
    entityName: updated.name,
    summary: `Updated organization ${updated.name}`,
    details: data,
  });

  return serialize(updated);
}

export async function adminDeleteOrganization(orgId: string) {
  const session = await requireSiteAdmin();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) throw new Error("Organization not found");

  await prisma.organization.delete({ where: { id: orgId } });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "DELETE",
    entityType: "organization",
    entityId: orgId,
    entityName: org.name,
    summary: `Deleted organization ${org.name}`,
  });

  return { success: true };
}

export async function adminGetOrganizationDetails(orgId: string) {
  await requireSiteAdmin();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: {
          assets: true,
          bulkAssets: true,
          projects: true,
          kits: true,
        },
      },
    },
  });

  if (!org) throw new Error("Organization not found");
  return serialize(org);
}

// ─── User Management ───────────────────────────────────────────────────────

export async function getAllUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  roleFilter?: string;
}) {
  await requireSiteAdmin();
  const { page = 1, pageSize = 20, search, roleFilter } = params || {};

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  if (roleFilter) {
    where.role = roleFilter;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        banned: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
        members: {
          include: {
            organization: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return serialize({
    users,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function promoteToSiteAdmin(userId: string) {
  const session = await requireSiteAdmin();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { role: "admin" },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Promoted ${targetUser?.name || userId} to site admin`,
    });
  }

  return { success: true };
}

export async function demoteFromSiteAdmin(userId: string) {
  const session = await requireSiteAdmin();
  if (session.user.id === userId) {
    throw new Error("You cannot demote yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { role: "user" },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Demoted ${targetUser?.name || userId} from site admin`,
    });
  }

  return { success: true };
}

export async function banUser(userId: string) {
  const session = await requireSiteAdmin();
  if (session.user.id === userId) {
    throw new Error("You cannot ban yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { banned: true },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Banned ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function unbanUser(userId: string) {
  const session = await requireSiteAdmin();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { banned: false },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Unbanned ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function adminDeleteUser(userId: string) {
  const session = await requireSiteAdmin();
  if (session.user.id === userId) {
    throw new Error("You cannot delete yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  // Capture the dual-written rows this user owns, so we can mirror their
  // deletion to Convex after the transaction commits (Convex calls cannot run
  // inside a Prisma $transaction).
  const [serializedItemsToRemove, bulkItemsToRemove, scanLogsToRemove, testTagRecordsToRemove] =
    await Promise.all([
      prisma.kitSerializedItem.findMany({ where: { addedById: userId }, select: { id: true } }),
      prisma.kitBulkItem.findMany({ where: { addedById: userId }, select: { id: true } }),
      prisma.assetScanLog.findMany({ where: { scannedById: userId }, select: { id: true } }),
      prisma.testTagRecord.findMany({ where: { testedById: userId }, select: { id: true } }),
    ]);
  // SubTestRecords cascade-delete when their TestTagRecord is removed; capture
  // them so their Convex mirrors are removed too.
  const subTestRecordsToRemove = testTagRecordsToRemove.length
    ? await prisma.subTestRecord.findMany({
        where: { testTagRecordId: { in: testTagRecordsToRemove.map((r) => r.id) } },
        select: { id: true },
      })
    : [];

  await prisma.$transaction(async (tx) => {
    // Null out nullable User FK references
    await tx.maintenanceRecord.updateMany({ where: { reportedById: userId }, data: { reportedById: null } });
    await tx.maintenanceRecord.updateMany({ where: { assignedToId: userId }, data: { assignedToId: null } });
    await tx.project.updateMany({ where: { projectManagerId: userId }, data: { projectManagerId: null } });
    await tx.projectLineItem.updateMany({ where: { checkedOutById: userId }, data: { checkedOutById: null } });
    await tx.projectLineItem.updateMany({ where: { returnedById: userId }, data: { returnedById: null } });

    // Delete records with non-nullable User FKs
    await tx.assetScanLog.deleteMany({ where: { scannedById: userId } });
    await tx.kitSerializedItem.deleteMany({ where: { addedById: userId } });
    await tx.kitBulkItem.deleteMany({ where: { addedById: userId } });
    await tx.fileUpload.deleteMany({ where: { uploadedById: userId } });
    await tx.testTagRecord.deleteMany({ where: { testedById: userId } });

    await tx.user.delete({ where: { id: userId } });
  });

  // Mirror the deletions to Convex (these rows are dual-written) — strictly
  // post-commit, since Convex calls cannot run inside a $transaction.
  for (const item of serializedItemsToRemove) await removeKitSerializedItemFromConvex(item.id);
  for (const item of bulkItemsToRemove) await removeKitBulkItemFromConvex(item.id);
  for (const item of scanLogsToRemove) await removeAssetScanLogFromConvex(item.id);
  for (const item of subTestRecordsToRemove) await removeSubTestRecordFromConvex(item.id);
  for (const item of testTagRecordsToRemove) await removeTestTagRecordFromConvex(item.id);

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "DELETE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Deleted user ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function forceDisable2FA(userId: string) {
  const session = await requireSiteAdmin();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.$transaction([
    prisma.twoFactor.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    }),
  ]);

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Force-disabled 2FA for ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function adminTransferOwnership(orgId: string, newOwnerId: string) {
  const session = await requireSiteAdmin();

  const result = await prisma.$transaction(async (tx) => {
    // Find current owner
    const currentOwner = await tx.member.findFirst({
      where: { organizationId: orgId, role: "owner" },
      include: { user: { select: { name: true, email: true } } },
    });

    // Verify new owner is a member
    const newOwner = await tx.member.findFirst({
      where: { organizationId: orgId, userId: newOwnerId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!newOwner) throw new Error("New owner must be a member of the organization.");

    // Demote current owner
    if (currentOwner) {
      await tx.member.update({
        where: { id: currentOwner.id },
        data: { role: "admin" },
      });
    }

    // Promote new owner
    await tx.member.update({
      where: { id: newOwner.id },
      data: { role: "owner" },
    });

    return { currentOwner, newOwner };
  });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "UPDATE",
    entityType: "organization",
    entityId: orgId,
    entityName: orgId,
    summary: `Transferred ownership to ${result.newOwner.user.name || result.newOwner.user.email}`,
    details: {
      from: result.currentOwner?.user.name || result.currentOwner?.user.email,
      to: result.newOwner.user.name || result.newOwner.user.email,
    },
  });

  return { success: true };
}

// ─── Org Member Management (Site Admin) ───────────────────────────────────

export async function adminGetOrgCustomRoles(orgId: string) {
  await requireSiteAdmin();

  const roles = await prisma.customRole.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
  });

  return serialize(
    roles.map((r) => ({
      ...r,
      permissions: JSON.parse(r.permissions),
    })),
  );
}

export async function adminAddMemberToOrg(orgId: string, email: string, role: string) {
  const session = await requireSiteAdmin();

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) throw new Error("No account found with that email.");

  const existing = await prisma.member.findFirst({
    where: { organizationId: orgId, userId: user.id },
  });
  if (existing) throw new Error("User is already a member of this organization.");

  // Validate custom role belongs to this org
  if (role.startsWith("custom:")) {
    const customRoleId = role.slice("custom:".length);
    const customRole = await prisma.customRole.findFirst({
      where: { id: customRoleId, organizationId: orgId },
    });
    if (!customRole) throw new Error("Custom role not found in this organization.");
  }

  await prisma.member.create({
    data: { organizationId: orgId, userId: user.id, role },
  });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "CREATE",
    entityType: "member",
    entityId: user.id,
    entityName: user.name || user.email,
    summary: `Added ${user.name || user.email} to organization as ${role}`,
    details: { role },
  });

  return { success: true };
}

export async function adminRemoveMemberFromOrg(orgId: string, memberId: string) {
  const session = await requireSiteAdmin();

  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: orgId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("Cannot remove the owner. Transfer ownership first.");

  await prisma.member.delete({ where: { id: memberId } });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "DELETE",
    entityType: "member",
    entityId: memberId,
    entityName: member.user.name || member.user.email,
    summary: `Removed ${member.user.name || member.user.email} from organization`,
  });

  return { success: true };
}

export async function adminChangeMemberRole(orgId: string, memberId: string, newRole: string) {
  const session = await requireSiteAdmin();

  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: orgId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("Cannot change the owner's role. Transfer ownership instead.");

  // Validate custom role belongs to this org
  if (newRole.startsWith("custom:")) {
    const customRoleId = newRole.slice("custom:".length);
    const customRole = await prisma.customRole.findFirst({
      where: { id: customRoleId, organizationId: orgId },
    });
    if (!customRole) throw new Error("Custom role not found in this organization.");
  }

  await prisma.member.update({
    where: { id: memberId },
    data: { role: newRole },
  });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "UPDATE",
    entityType: "member",
    entityId: memberId,
    entityName: member.user.name || member.user.email,
    summary: `Changed ${member.user.name || member.user.email}'s role to ${newRole}`,
    details: { from: member.role, to: newRole },
  });

  return { success: true };
}

// ─── Platform Invite (Site Admin) ─────────────────────────────────────────

export async function adminInviteUser(email: string) {
  await requireSiteAdmin();

  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: { email: normalizedEmail },
  });
  if (existingUser) {
    throw new Error("A user with this email already exists.");
  }

  // Check for existing pending invitation (no org)
  const existingInvite = await prisma.invitation.findFirst({
    where: {
      email: normalizedEmail,
      status: "pending",
      expiresAt: { gte: new Date() },
    },
  });
  if (existingInvite) {
    throw new Error("An invitation has already been sent to this email.");
  }

  // We need an organizationId for the invitation record (Better Auth requires it).
  const anyOrg = await getTheOrg();
  if (!anyOrg) {
    throw new Error("No organization configured. Complete setup first.");
  }

  const session = await requireSession();

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: anyOrg.id,
      email: normalizedEmail,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: session.user.id,
    },
  });

  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const registerUrl = `${baseUrl}/register?invite=${invitation.id}`;
  const pName = await getPlatformName();

  await sendEmail({
    to: normalizedEmail,
    subject: `You've been invited to join ${pName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited to join ${pName}</h2>
        <p>A site administrator has invited you to create an account on ${pName}.</p>
        <p>Click the button below to create your account.</p>
        <p>
          <a href="${registerUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Create Account
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
      </div>
    `,
  });

  await logActivity({
    organizationId: anyOrg.id,
    userId: session.user.id,
    userName: session.user.name,
    action: "CREATE",
    entityType: "invitation",
    entityId: invitation.id,
    entityName: normalizedEmail,
    summary: `Invited ${normalizedEmail} to join`,
  });

  return { success: true, email: normalizedEmail };
}

// ─── Pending Invitations (Site Admin) ─────────────────────────────────────

export async function adminGetPendingInvitations() {
  await requireSiteAdmin();

  const invitations = await prisma.invitation.findMany({
    where: {
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

export async function adminRevokeInvitation(invitationId: string) {
  const session = await requireSiteAdmin();

  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation || invitation.status !== "pending") {
    throw new Error("Invitation not found or already processed.");
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "cancelled" },
  });

  await logActivity({
    organizationId: invitation.organizationId,
    userId: session.user.id,
    userName: session.user.name,
    action: "DELETE",
    entityType: "invitation",
    entityId: invitationId,
    entityName: invitation.email,
    summary: `Revoked invitation for ${invitation.email}`,
  });

  return { success: true };
}

// ─── Dashboard Stats ───────────────────────────────────────────────────────

export async function getAdminDashboardStats() {
  await requireSiteAdmin();

  const [totalUsers, totalOrgs, recentUsers, recentOrgs, siteAdminCount] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, createdAt: true },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, slug: true, createdAt: true },
    }),
    prisma.user.count({ where: { role: "admin" } }),
  ]);

  return serialize({
    totalUsers,
    totalOrgs,
    siteAdminCount,
    recentUsers,
    recentOrgs,
  });
}
