/**
 * Transactional email templates (POLICY.md R-8.10.4, R-3.1). Each factory takes
 * typed inputs and returns the `{ subject, html }` shape `sendEmail()` expects.
 * All chrome comes from `email-layout.ts` so there is one authoritative wrapper
 * and CTA button. This is the single home for these templates — before, several
 * were duplicated inline in `auth.ts`, `settings.ts`, `sso.ts`, `site-admin.ts`.
 *
 * NOT a `"use server"` module (plain lib) so it can be imported anywhere and
 * unit-tested directly.
 */
import { emailButton, emailMutedNote, emailShell } from "@/lib/email-layout";
import { formatDate } from "@/lib/formatters";

export interface EmailContent {
  subject: string;
  html: string;
}

/** A single test & tag asset row as summarised for the digest email. */
export interface TestTagDigestAsset {
  testTagId: string;
  description: string;
  nextDueDate: Date | null;
  location: string | null;
}

const EXPIRES_7_DAYS = "This invitation expires in 7 days.";

/**
 * Invitation to an existing organisation (org-plugin flow — links to the
 * in-app accept page). Used by Better Auth's `sendInvitationEmail`.
 */
export function invitationEmail({
  orgName,
  inviterName,
  role,
  acceptUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  inviterName?: string;
  role: string;
  acceptUrl: string;
  platformName?: string;
}): EmailContent {
  const intro = inviterName
    ? `${inviterName} has invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong> on ${platformName}.`
    : `You've been invited to join <strong>${orgName}</strong> as a <strong>${role}</strong> on ${platformName}.`;
  return {
    subject: `You've been invited to ${orgName} on ${platformName}`,
    html: emailShell(
      `<h2>You've been invited to join ${orgName}</h2>` +
        `<p>${intro}</p>` +
        emailButton({ href: acceptUrl, label: "Accept Invitation" }) +
        emailMutedNote(EXPIRES_7_DAYS),
    ),
  };
}

/**
 * Invitation that requires creating an account first (links to /register with
 * the invite token). Used by org-admin and site-admin invite flows.
 */
export function invitationRegisterEmail({
  orgName,
  role,
  registerUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  role: string;
  registerUrl: string;
  platformName?: string;
}): EmailContent {
  return {
    subject: `You've been invited to ${orgName} on ${platformName}`,
    html: emailShell(
      `<h2>You've been invited to join ${orgName}</h2>` +
        `<p>You've been invited to join <strong>${orgName}</strong> as a <strong>${role}</strong> on ${platformName}.</p>` +
        `<p>Click the button below to create your account and accept the invitation.</p>` +
        emailButton({ href: registerUrl, label: "Create Account &amp; Join" }) +
        emailMutedNote(EXPIRES_7_DAYS),
    ),
  };
}

/** Site-admin invitation to create a platform account (no specific org). */
export function siteAdminInvitationEmail({
  registerUrl,
  platformName = "RVLT Flow",
}: {
  registerUrl: string;
  platformName?: string;
}): EmailContent {
  return {
    subject: `You've been invited to join ${platformName}`,
    html: emailShell(
      `<h2>You've been invited to join ${platformName}</h2>` +
        `<p>A site administrator has invited you to create an account on ${platformName}.</p>` +
        `<p>Click the button below to create your account.</p>` +
        emailButton({ href: registerUrl, label: "Create Account" }) +
        emailMutedNote(EXPIRES_7_DAYS),
    ),
  };
}

export function passwordResetEmail({
  resetUrl,
  platformName = "RVLT Flow",
}: {
  resetUrl: string;
  platformName?: string;
}): EmailContent {
  return {
    subject: `Reset your ${platformName} password`,
    html: emailShell(
      `<h2>Password Reset Request</h2>` +
        `<p>Click the button below to reset your password.</p>` +
        emailButton({ href: resetUrl, label: "Reset Password" }) +
        emailMutedNote("If you didn't request this, you can safely ignore this email."),
    ),
  };
}

export function verificationEmail({
  verifyUrl,
  platformName = "RVLT Flow",
}: {
  verifyUrl: string;
  platformName?: string;
}): EmailContent {
  return {
    subject: `Verify your ${platformName} email`,
    html: emailShell(
      `<h2>Verify Your Email</h2>` +
        `<p>Click the button below to verify your email address.</p>` +
        emailButton({ href: verifyUrl, label: "Verify Email" }),
    ),
  };
}

export function roleChangedEmail({
  orgName,
  newRole,
}: {
  orgName: string;
  newRole: string;
}): EmailContent {
  return {
    subject: `Your role in ${orgName} has been updated`,
    html: emailShell(
      `<h2>Role Update</h2>` +
        `<p>Your role in <strong>${orgName}</strong> has been changed to <strong>${newRole}</strong>.</p>`,
    ),
  };
}

export function removedFromOrgEmail({
  orgName,
}: {
  orgName: string;
}): EmailContent {
  return {
    subject: `You've been removed from ${orgName}`,
    html: emailShell(
      `<h2>Organization Access Removed</h2>` +
        `<p>You have been removed from <strong>${orgName}</strong> on RVLT Flow.</p>` +
        `<p>If you believe this is a mistake, please contact the organization admin.</p>`,
    ),
  };
}

export function ssoAccessApprovedEmail({
  orgName,
  role,
  dashboardUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  role: string;
  dashboardUrl: string;
  platformName?: string;
}): EmailContent {
  return {
    subject: `Your access to ${orgName} has been approved`,
    html: emailShell(
      `<h2>Access Approved</h2>` +
        `<p>Your request to join <strong>${orgName}</strong> on ${platformName} has been approved.</p>` +
        `<p>You've been assigned the role of <strong>${role}</strong>.</p>` +
        emailButton({ href: dashboardUrl, label: "Go to Dashboard" }),
    ),
  };
}

export function ssoAccessRejectedEmail({
  orgName,
  note,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  note?: string;
  platformName?: string;
}): EmailContent {
  return {
    subject: `Your access request to ${orgName} was not approved`,
    html: emailShell(
      `<h2>Access Request Not Approved</h2>` +
        `<p>Your request to join <strong>${orgName}</strong> on ${platformName} was not approved.</p>` +
        (note ? `<p>Reason: ${note}</p>` : "") +
        `<p>If you believe this is a mistake, please contact your organization administrator.</p>`,
    ),
  };
}

const DIGEST_BODY_FONT_SIZE = "14px";

function testTagDigestRow(item: TestTagDigestAsset): string {
  return `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${item.testTagId}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.description}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.location || "-"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${formatDate(item.nextDueDate)}</td>
    </tr>`;
}

const TEST_TAG_DIGEST_TABLE_HEADER = `
    <tr style="background:#f9fafb;">
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Tag ID</th>
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Description</th>
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Location</th>
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Due Date</th>
    </tr>`;

/**
 * Daily test & tag reminder digest, sent to org admins/owners for DUE_SOON and
 * OVERDUE active assets. Used by `sendTestTagReminderDigests`
 * (`src/server/test-tag-reminders.ts`).
 */
export function testTagDigestEmail({
  orgName,
  overdueAssets,
  dueSoonAssets,
}: {
  orgName: string;
  overdueAssets: TestTagDigestAsset[];
  dueSoonAssets: TestTagDigestAsset[];
}): EmailContent {
  const totalOverdue = overdueAssets.length;
  const totalDueSoon = dueSoonAssets.length;

  const subject = totalOverdue > 0
    ? `Test & Tag: ${totalOverdue} overdue item${totalOverdue !== 1 ? "s" : ""} — ${orgName}`
    : `Test & Tag: ${totalDueSoon} item${totalDueSoon !== 1 ? "s" : ""} due soon — ${orgName}`;

  let overdueSection = "";
  if (overdueAssets.length > 0) {
    overdueSection = `
      <div style="margin-bottom:24px;">
        <h3 style="color:#991b1b;font-size:16px;margin:0 0 8px;">Overdue (${totalOverdue})</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${TEST_TAG_DIGEST_TABLE_HEADER}
          ${overdueAssets.map(testTagDigestRow).join("")}
        </table>
      </div>`;
  }

  let dueSoonSection = "";
  if (dueSoonAssets.length > 0) {
    dueSoonSection = `
      <div style="margin-bottom:24px;">
        <h3 style="color:#92400e;font-size:16px;margin:0 0 8px;">Due Soon (${totalDueSoon})</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${TEST_TAG_DIGEST_TABLE_HEADER}
          ${dueSoonAssets.map(testTagDigestRow).join("")}
        </table>
      </div>`;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${DIGEST_BODY_FONT_SIZE};color:#111827;max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="font-size:20px;margin:0 0 16px;">${subject}</h2>
      <p style="margin:0 0 20px;color:#4b5563;">
        The following test &amp; tag items in <strong>${orgName}</strong> require your attention.
      </p>
      ${overdueSection}
      ${dueSoonSection}
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
        This is an automated reminder from RVLT Flow. Manage your test &amp; tag schedule in the app.
      </p>
    </body>
    </html>`;

  return { subject, html };
}
