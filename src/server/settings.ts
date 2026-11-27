"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { invitationEmail } from "@/lib/email-templates";
import { getPlatformName } from "@/lib/platform";
import { logActivity } from "@/lib/activity-log";
import { canAssignRole } from "@/lib/member-role-policy";
import { inviteSchema } from "@/lib/validations/team";
import { INVITE_TTL_MS } from "@/lib/invite-ttl";
import { UserFacingError } from "@/lib/errors/user-facing-error";
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
import { orgDocumentSettingsSchema, projectStatusAutomationSchema, crewTimeSettingsSchema } from "@/lib/validations/org-settings";
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

/** M6 — Organization.country is immutable after creation. Enforced by
 *  forcing the persisted value back onto the patch server-side (the
 *  PROJECT_UPDATE_IMMUTABLE pattern, convex/projectWrites.ts:420) — never a
 *  disabled input alone, since `settings` is a client-supplied blob R-9.3
 *  has to re-check regardless of what the UI sent. Only a still-unset
 *  country (first save) may be written. */
function withImmutableCountry(existing: OrgSettings, incoming: OrgSettings): OrgSettings {
  return existing.country ? { ...incoming, country: existing.country } : incoming;
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

  // #1160 — reject an unknown/mistyped automation switch rather than persisting a
  // blob the Convex side will silently read as "enabled" (`.strict()` in the schema).
  if (data.settings.projectStatusAutomation) {
    const parsed = projectStatusAutomationSchema.safeParse(data.settings.projectStatusAutomation);
    if (!parsed.success) {
      throw new Error(`Status automation: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
  }

  // Work-layer Phase 4 (#1246) — reject a bad crew-time setting before
  // persisting (same posture as the two blocks above).
  if (data.settings.crewTime) {
    const parsed = crewTimeSettingsSchema.safeParse(data.settings.crewTime);
    if (!parsed.success) {
      throw new Error(`Crew & time settings: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
  }

  const existingSettings = await readOrgSettingsBlob(organizationId);
  const settings = withImmutableCountry(existingSettings, data.settings);

  // Identity (name) stays on the Better Auth org row; business settings + tax
  // rate go to Convex (source of truth).
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { name: data.name },
  });
  await saveOrgSettings(organizationId, settings, data.defaultTaxRate);

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

  return serialize({ ...updated, settings, defaultTaxRate: data.defaultTaxRate });
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

export async function addMemberByEmail(email: string, role: string) {
  // The verb needs `orgMembers:invite` (it had no server gate before: only the UI hid the
  // button), and the ONE role policy decides which roles this actor may hand out: an Admin
  // can't invite another Admin, and `owner` is never assignable.
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "invite");
  const actorMember = await prisma.member.findFirst({ where: { organizationId, userId }, select: { role: true } });
  const parsed = inviteSchema.safeParse({ email, role });
  if (!parsed.success) {
    throw new UserFacingError({ code: "INVALID_INVITE", title: "Invalid invite", message: parsed.error.issues[0]?.message ?? "Invalid invite" });
  }
  const verdict = canAssignRole(actorMember?.role, parsed.data.role);
  if (!verdict.ok) throw new UserFacingError({ code: "ROLE_NOT_ALLOWED", title: "Can't give that role", message: verdict.reason });

  const normalizedEmail = parsed.data.email;

  // Check for existing pending invitation
  const existingInvite = await prisma.invitation.findFirst({
    where: { organizationId, email: normalizedEmail, status: "pending" },
  });
  if (existingInvite) {
    throw new UserFacingError({ code: "ALREADY_INVITED", title: "Already invited", message: "An invitation has already been sent to this email." });
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
      throw new UserFacingError({ code: "ALREADY_MEMBER", title: "Already a member", message: "This person is already a member of your organization." });
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
      role: parsed.data.role,
      status: "pending",
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
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
      role: parsed.data.role,
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

export async function getMembers() {
  const { organizationId } = await getOrgContext();

  const members = await prisma.member.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
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
    // Pending rows INCLUDING ones past `expiresAt`: Expired is derived on read
    // (`inviteStatus`) so an expired invite can be resent from Team. Bounded newest-first.
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return serialize(invitations);
}
