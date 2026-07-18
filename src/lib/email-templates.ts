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

export interface EmailContent {
  subject: string;
  html: string;
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
