"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { invitationRegisterEmail } from "@/lib/email-templates";
import { getPlatformName } from "@/lib/platform";
import { logActivity } from "@/lib/activity-log";
import { upsertMemberMirrorById, removeMemberMirror } from "@/lib/member-mirror";
import {
  readOrgSettings,
  readOrgSettingsBlob,
  saveOrgSettings,
  reserveAssetTagsConvex,
  reserveTestTagIdsConvex,
} from "@/lib/org-settings-read";
import { env } from "@/env";
import { validateProjectNumberFormat } from "@/lib/project-number";
import type { OrgSettings, TestTagSettings } from "@/lib/org-settings-types";

export async function getOrganization() {
  const { organizationId } = await getOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!org) throw new Error("Organization not found");

  // Business settings are Convex-only now (blob + defaultTaxRate); the Postgres
  // columns are frozen/legacy. Identity fields (name/slug/logo) stay on the org row.
  const { settings, defaultTaxRate } = await readOrgSettings(organizationId);

  return serialize({ ...org, defaultTaxRate, settings });
}

export async function updateOrganization(data: {
  name: string;
  settings: OrgSettings;
  defaultTaxRate?: number | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  // Reject an invalid auto project-number format before persisting, so the
  // saved config can never push project creation into a failing auto path.
  const pnFormat = data.settings.projectNumberFormat?.trim();
  if (pnFormat) {
    const err = validateProjectNumberFormat(pnFormat);
    if (err) throw new Error(`Project number format: ${err}`);
  }

  // Identity (name) stays on the Better Auth org row; business settings + tax
  // rate go to Convex (source of truth).
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { name: data.name },
  });
  await saveOrgSettings(organizationId, data.settings, data.defaultTaxRate);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: organizationId,
    entityName: updated.name,
    summary: `Updated organization settings`,
  });

  return serialize({ ...updated, settings: data.settings, defaultTaxRate: data.defaultTaxRate });
}

/** Get org-level T&T settings (for fallback defaults). */
export async function getOrgTestTagSettings(): Promise<TestTagSettings> {
  const { organizationId } = await getOrgContext();
  const settings = await readOrgSettingsBlob(organizationId);
  return settings.testTag || {};
}

/** Read-only preview of the next N asset tags — does NOT increment the counter. */
export async function peekNextAssetTags(count = 1): Promise<string[]> {
  const { organizationId } = await getOrgContext();

  const settings = await readOrgSettingsBlob(organizationId);

  const prefix = settings.assetTagPrefix || "ASSET";
  const digits = settings.assetTagDigits || 4;
  const currentCounter = settings.assetTagCounter || 0;

  const tags: string[] = [];
  for (let i = 1; i <= count; i++) {
    tags.push(`${prefix}${String(currentCounter + i).padStart(digits, "0")}`);
  }
  return tags;
}

/** Atomically reserve N asset tags — increments the counter. Call only at creation time. */
export async function reserveAssetTags(count = 1): Promise<string[]> {
  const { organizationId } = await getOrgContext();
  // Atomic in a single Convex mutation (serializable → no read-modify-write race).
  return reserveAssetTagsConvex(organizationId, count);
}

/** Read-only preview of the next N test tag IDs — does NOT increment the counter. */
export async function peekNextTestTagIds(count = 1): Promise<string[]> {
  const { organizationId } = await getOrgContext();

  const settings = await readOrgSettingsBlob(organizationId);

  const tt = settings.testTag || {};
  const prefix = tt.prefix || "TT";
  const digits = tt.digits || 4;
  const currentCounter = tt.counter || 0;

  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${prefix}${String(currentCounter + i).padStart(digits, "0")}`);
  }
  return ids;
}

/** Atomically reserve N test tag IDs — increments the counter. Call only at creation time. */
export async function reserveTestTagIds(count = 1): Promise<string[]> {
  const { organizationId } = await getOrgContext();
  // Atomic in a single Convex mutation (serializable → no read-modify-write race).
  return reserveTestTagIdsConvex(organizationId, count);
}

/** @deprecated Use peekNextAssetTags for preview, reserveAssetTags for creation */
export async function getNextAssetTag(): Promise<string> {
  const tags = await peekNextAssetTags(1);
  return tags[0];
}

const VALID_BUILT_IN_ROLES = ["admin", "manager", "member", "warehouse", "viewer"] as const;

export async function addMemberByEmail(email: string, role: string) {
  const { organizationId, userId, userName } = await getOrgContext();

  // Only built-in roles (custom roles were removed).
  if (!(VALID_BUILT_IN_ROLES as readonly string[]).includes(role)) {
    throw new Error("Invalid role");
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check for existing pending invitation
  const existingInvite = await prisma.invitation.findFirst({
    where: { organizationId, email: normalizedEmail, status: "pending" },
  });
  if (existingInvite) {
    throw new Error("An invitation has already been sent to this email.");
  }

  // Find user by email
  const user = await prisma.user.findFirst({
    where: { email: normalizedEmail },
  });

  if (user) {
    // Check if already a member
    const existing = await prisma.member.findFirst({
      where: { organizationId, userId: user.id },
    });

    if (existing) {
      throw new Error("This person is already a member of your organization.");
    }

    // User exists — add directly as member
    const member = await prisma.member.create({
      data: {
        organizationId,
        userId: user.id,
        role,
      },
      include: { user: true },
    });

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "member",
      entityId: member.id,
      entityName: normalizedEmail,
      summary: `Added member ${normalizedEmail} with role ${role}`,
    });

    // Additive: Prisma committed; mirror best-effort after (§3.3.4).
    await upsertMemberMirrorById(member.id);

    return serialize(member);
  }

  // User doesn't exist — create invitation and send registration email
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email: normalizedEmail,
      role,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      inviterId: userId,
    },
  });

  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const registerUrl = `${baseUrl}/register?invite=${invitation.id}`;
  const pName = await getPlatformName();

  await sendEmail({
    to: normalizedEmail,
    ...invitationRegisterEmail({
      orgName: org?.name || "an organization",
      role,
      registerUrl,
      platformName: pName,
    }),
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "invitation",
    entityId: invitation.id,
    entityName: normalizedEmail,
    summary: `Invited ${normalizedEmail} to organization with role ${role}`,
  });

  return serialize({ id: invitation.id, invited: true, email: normalizedEmail });
}

export async function removeMember(memberId: string) {
  const { organizationId } = await getOrgContext();

  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
  });

  if (!member) throw new Error("Member not found");
  if (member.role === "owner") throw new Error("Cannot remove the owner");

  // Restrictive (revocation): remove from the Convex mirror FIRST (strict), then
  // commit the Prisma delete (§3.3.4).
  await removeMemberMirror(
    { organizationId, userId: member.userId },
    { strict: true },
  );

  await prisma.member.delete({ where: { id: memberId } });
  return { success: true };
}

export async function getMembers() {
  const { organizationId } = await getOrgContext();

  const members = await prisma.member.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  return serialize(members);
}

/** Get pending invitations for the current organization. */
export async function getPendingInvitations() {
  let organizationId: string;
  try {
    ({ organizationId } = await getOrgContext());
  } catch {
    return [];
  }

  const invitations = await prisma.invitation.findMany({
    where: {
      organizationId,
      status: "pending",
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  return serialize(invitations);
}

/** Revoke a pending invitation for the current organization. */
export async function revokeInvitation(invitationId: string) {
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
