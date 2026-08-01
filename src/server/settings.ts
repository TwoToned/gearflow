"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { invitationEmail } from "@/lib/email-templates";
import { getPlatformName } from "@/lib/platform";
import { logActivity } from "@/lib/activity-log";
import { removeMemberMirror } from "@/lib/member-mirror";
import {
  readOrgSettings,
  readOrgSettingsBlob,
  saveOrgSettings,
  reserveAssetTagsConvex,
  reserveTestTagIdsConvex,
} from "@/lib/org-settings-read";
import { env } from "@/env";
import { validateProjectNumberFormat, hasIncrementToken, type IncrementReset } from "@/lib/project-number";
import {
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_INVOICE_NUMBER_INCREMENT_RESET,
  DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING,
} from "@/lib/invoice-number";
import { orgDocumentSettingsSchema } from "@/lib/validations/org-settings";
import { DEFAULT_QUOTE_VALIDITY_DAYS } from "@/lib/quote-validity";
import { DEFAULT_PAYMENT_TERMS_DAYS } from "@/lib/invoice-terms";
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

  // WS1 (#940) — same validator, same reason: reject a bad invoice-number
  // template before persisting so the always-on issue-time numbering path can
  // never fail. Unlike project numbers this format can't be left blank
  // (invoices have no manual-entry fallback) — an unset/blank format falls back
  // to the DEFAULT_INVOICE_NUMBER_FORMAT constant at issue time instead.
  const invFormat = data.settings.invoiceNumberFormat?.trim();
  if (invFormat) {
    const err = validateProjectNumberFormat(invFormat);
    if (err) throw new Error(`Invoice number format: ${err}`);
  }

  if (data.settings.documents) {
    const parsed = orgDocumentSettingsSchema.safeParse(data.settings.documents);
    if (!parsed.success) {
      throw new Error(`Document settings: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
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

/**
 * WS1 (#940) — the invoice-number equivalent of `getProjectNumberConfig()`
 * (src/server/projects.ts), but reads the CURRENT source of truth
 * (`readOrgSettingsBlob`, Convex) rather than that function's legacy
 * `organization.metadata` (Prisma) read — invoiceNumberFormat was only ever
 * stored via `saveOrgSettings`/Convex, never metadata. Unlike project
 * numbers, a missing/invalid format here falls back to the built-in default
 * (`DEFAULT_INVOICE_NUMBER_FORMAT`) rather than "auto-numbering disabled" —
 * invoices have no manual-entry fallback.
 */
export async function getInvoiceNumberConfig(): Promise<{
  format: string;
  reset: IncrementReset;
  padding: number;
  timezone?: string;
}> {
  const { organizationId } = await getOrgContext();
  const settings = (await readOrgSettingsBlob(organizationId)) as OrgSettings;
  const format = settings.invoiceNumberFormat?.trim();
  return {
    format: format && hasIncrementToken(format) ? format : DEFAULT_INVOICE_NUMBER_FORMAT,
    reset: settings.invoiceNumberIncrementReset || DEFAULT_INVOICE_NUMBER_INCREMENT_RESET,
    padding: settings.invoiceNumberIncrementPadding ?? DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING,
    timezone: settings.timezone,
  };
}

/**
 * The document-date defaults the Finance tab's send/issue dialogs preview
 * before submitting (#989) — quote validity and invoice payment terms, plus
 * the org's timezone so a client-side preview of the resolved date agrees with
 * what the mutation actually stamps. Read-only; the mutations re-resolve the
 * same config server-side rather than trusting this round trip (R-9.3).
 */
export async function getDocumentDatesConfig(): Promise<{
  quoteValidityDays: number;
  paymentTermsDays: number;
  timezone?: string;
}> {
  const { organizationId } = await getOrgContext();
  const settings = (await readOrgSettingsBlob(organizationId)) as OrgSettings;
  return {
    quoteValidityDays: settings.documents?.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS,
    paymentTermsDays: settings.documents?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS,
    timezone: settings.timezone,
  };
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

/**
 * @deprecated Use peekNextAssetTags for preview, reserveAssetTags for creation.
 * Removal condition: delete once no callers remain (grep `getNextAssetTag`). Tracked:
 * POLICY.md R-4.4.
 */
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

  // Every membership requires the recipient to accept (#1073, A3) — no
  // direct-add for a known account. Anyone with an org can otherwise type any
  // known email and pull that person's account into their org with no
  // consent, putting an unwanted org in the victim's switcher. One invitation
  // path either way; /invite/[id] itself handles "already have an account,
  // sign in" vs "need to register" for whoever opens it.
  if (await prisma.user.findFirst({ where: { email: normalizedEmail }, select: { id: true } })) {
    const existingMember = await prisma.member.findFirst({
      where: {
        organizationId,
        user: { email: normalizedEmail },
      },
    });
    if (existingMember) {
      throw new Error("This person is already a member of your organization.");
    }
  }

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
  const acceptUrl = `${baseUrl}/invite/${invitation.id}`;
  const pName = await getPlatformName();

  await sendEmail({
    to: normalizedEmail,
    ...invitationEmail({
      orgName: org?.name || "an organization",
      inviterName: userName,
      role,
      acceptUrl,
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
