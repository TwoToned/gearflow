"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { getPlatformName } from "@/lib/platform";
import { logActivity } from "@/lib/activity-log";

export interface OrgBranding {
  primaryColor?: string;
  accentColor?: string;
  documentColor?: string;
  logoUrl?: string;
  iconUrl?: string;
  /** Which image to show on PDFs: "logo" (full width above header), "icon" (inline), or "none" */
  documentLogoMode?: "logo" | "icon" | "none";
  /** Whether to show the org name text on PDF documents (default true) */
  showOrgNameOnDocuments?: boolean;
}

export interface TestTagSettings {
  prefix?: string;
  digits?: number;
  counter?: number;
  defaultIntervalMonths?: number;
  defaultEquipmentClass?: "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY";
  dueSoonThresholdDays?: number;
  companyName?: string;
  defaultTesterName?: string;
  defaultTestMethod?: "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH";
  checkoutPolicy?: "WARN" | "BLOCK";
}

export interface OrgSettings {
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  taxRate?: number;
  taxLabel?: string;
  assetTagPrefix?: string;
  assetTagCounter?: number;
  assetTagDigits?: number;
  branding?: OrgBranding;
  testTag?: TestTagSettings;
  icalToken?: string;
  icalEnabled?: boolean;
  prepKitCategoryId?: string;
}

export async function getOrganization() {
  const { organizationId } = await getOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!org) throw new Error("Organization not found");

  let settings: OrgSettings = {};
  if (org.metadata) {
    try {
      settings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  return serialize({ ...org, settings });
}

export async function updateOrganization(data: {
  name: string;
  settings: OrgSettings;
}) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      name: data.name,
      metadata: JSON.stringify(data.settings),
    },
  });

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

  return serialize(updated);
}

/** Get org-level T&T settings (for fallback defaults). */
export async function getOrgTestTagSettings(): Promise<TestTagSettings> {
  const { organizationId } = await getOrgContext();
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org?.metadata) return {};
  try {
    const settings = JSON.parse(org.metadata) as OrgSettings;
    return settings.testTag || {};
  } catch {
    return {};
  }
}

/** Read-only preview of the next N asset tags — does NOT increment the counter. */
export async function peekNextAssetTags(count = 1): Promise<string[]> {
  const { organizationId } = await getOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  let settings: OrgSettings = {};
  if (org.metadata) {
    try {
      settings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

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

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new Error("Organization not found");

    let settings: OrgSettings = {};
    if (org.metadata) {
      try {
        settings = JSON.parse(org.metadata);
      } catch {
        // ignore
      }
    }

    const prefix = settings.assetTagPrefix || "ASSET";
    const digits = settings.assetTagDigits || 4;
    const currentCounter = settings.assetTagCounter || 0;

    const tags: string[] = [];
    for (let i = 1; i <= count; i++) {
      tags.push(`${prefix}${String(currentCounter + i).padStart(digits, "0")}`);
    }

    settings.assetTagCounter = currentCounter + count;

    await tx.organization.update({
      where: { id: organizationId },
      data: { metadata: JSON.stringify(settings) },
    });

    return tags;
  });
}

/** Read-only preview of the next N test tag IDs — does NOT increment the counter. */
export async function peekNextTestTagIds(count = 1): Promise<string[]> {
  const { organizationId } = await getOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  let settings: OrgSettings = {};
  if (org.metadata) {
    try {
      settings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

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

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new Error("Organization not found");

    let settings: OrgSettings = {};
    if (org.metadata) {
      try {
        settings = JSON.parse(org.metadata);
      } catch {
        // ignore
      }
    }

    const tt = settings.testTag || {};
    const prefix = tt.prefix || "TT";
    const digits = tt.digits || 4;
    const currentCounter = tt.counter || 0;

    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      ids.push(`${prefix}${String(currentCounter + i).padStart(digits, "0")}`);
    }

    settings.testTag = { ...tt, counter: currentCounter + count };

    await tx.organization.update({
      where: { id: organizationId },
      data: { metadata: JSON.stringify(settings) },
    });

    return ids;
  });
}

/** @deprecated Use peekNextAssetTags for preview, reserveAssetTags for creation */
export async function getNextAssetTag(): Promise<string> {
  const tags = await peekNextAssetTags(1);
  return tags[0];
}

const VALID_BUILT_IN_ROLES = ["admin", "manager", "member", "staff", "warehouse", "viewer"] as const;

export async function addMemberByEmail(email: string, role: string) {
  const { organizationId, userId, userName } = await getOrgContext();

  // Validate: either a built-in role or a custom role belonging to this org
  const isBuiltIn = (VALID_BUILT_IN_ROLES as readonly string[]).includes(role);
  const isCustom = role.startsWith("custom:");

  if (!isBuiltIn && !isCustom) {
    throw new Error("Invalid role");
  }

  if (isCustom) {
    const customRoleId = role.slice("custom:".length);
    const customRole = await prisma.customRole.findFirst({
      where: { id: customRoleId, organizationId },
    });
    if (!customRole) throw new Error("Custom role not found in this organization.");
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const registerUrl = `${baseUrl}/register?invite=${invitation.id}`;
  const pName = await getPlatformName();

  await sendEmail({
    to: normalizedEmail,
    subject: `You've been invited to ${org?.name || "an organization"} on ${pName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited to join ${org?.name || "an organization"}</h2>
        <p>You've been invited to join <strong>${org?.name}</strong> as a <strong>${role}</strong> on ${pName}.</p>
        <p>Click the button below to create your account and accept the invitation.</p>
        <p>
          <a href="${registerUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Create Account &amp; Join
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
      </div>
    `,
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
