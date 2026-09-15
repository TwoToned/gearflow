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
import { emailButton, emailMutedNote, emailShell, escapeHtml } from "@/lib/email-layout";
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
  const safeOrgName = escapeHtml(orgName);
  const safeRole = escapeHtml(role);
  const intro = inviterName
    ? `${escapeHtml(inviterName)} has invited you to join <strong>${safeOrgName}</strong> as a <strong>${safeRole}</strong> on ${platformName}.`
    : `You've been invited to join <strong>${safeOrgName}</strong> as a <strong>${safeRole}</strong> on ${platformName}.`;
  return {
    subject: `You've been invited to ${orgName} on ${platformName}`,
    html: emailShell(
      `<h2>You've been invited to join ${safeOrgName}</h2>` +
        `<p>${intro}</p>` +
        emailButton({ href: acceptUrl, label: "Accept Invitation" }) +
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
        `<p>Your role in <strong>${escapeHtml(orgName)}</strong> has been changed to <strong>${escapeHtml(newRole)}</strong>.</p>`,
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
        `<p>You have been removed from <strong>${escapeHtml(orgName)}</strong> on RVLT Flow.</p>` +
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
        `<p>Your request to join <strong>${escapeHtml(orgName)}</strong> on ${platformName} has been approved.</p>` +
        `<p>You've been assigned the role of <strong>${escapeHtml(role)}</strong>.</p>` +
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
        `<p>Your request to join <strong>${escapeHtml(orgName)}</strong> on ${platformName} was not approved.</p>` +
        (note ? `<p>Reason: ${escapeHtml(note)}</p>` : "") +
        `<p>If you believe this is a mistake, please contact your organization administrator.</p>`,
    ),
  };
}

/**
 * B2 (#1094) — an org admin/owner is notified immediately when someone asks
 * to join via verified-domain match, the same "send right away, don't wait
 * for the notification cron" posture as `invitationEmail` (Better Auth's own
 * invite email is immediate too). Approval/rejection of the request reuses
 * `ssoAccessApprovedEmail`/`ssoAccessRejectedEmail` as-is — the "your request
 * to join X was approved/not approved" copy is identical regardless of
 * whether the request came from SSO auto-provisioning or a domain match, so a
 * second near-duplicate template would just be two copies of one fact (R-3.1).
 */
export function joinRequestReceivedEmail({
  orgName,
  requesterName,
  requesterEmail,
  reviewUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  requesterName?: string;
  requesterEmail: string;
  reviewUrl: string;
  platformName?: string;
}): EmailContent {
  const who = requesterName
    ? `${escapeHtml(requesterName)} (${escapeHtml(requesterEmail)})`
    : escapeHtml(requesterEmail);
  return {
    subject: `${who} wants to join ${orgName}`,
    html: emailShell(
      `<h2>Join Request</h2>` +
        `<p>${who} has asked to join <strong>${escapeHtml(orgName)}</strong> on ${platformName}, matched by your organisation's email domain.</p>` +
        emailButton({ href: reviewUrl, label: "Review Request" }),
    ),
  };
}

const DIGEST_BODY_FONT_SIZE = "14px";

function testTagDigestRow(item: TestTagDigestAsset): string {
  return `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${escapeHtml(item.testTagId)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${escapeHtml(item.description)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.location ? escapeHtml(item.location) : "-"}</td>
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
      <h2 style="font-size:20px;margin:0 0 16px;">${escapeHtml(subject)}</h2>
      <p style="margin:0 0 20px;color:#4b5563;">
        The following test &amp; tag items in <strong>${escapeHtml(orgName)}</strong> require your attention.
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

// ─── B4 (#1096) — the "never activated" email ladder ───────────────────────
// Four distinct tones, matching the design doc's own table: days 1/3/7 are
// encouraging nudges, day 23/29 are plain warnings, day 30 is reassuring
// (archive is reversible) rather than a goodbye. Sent to the org's owner —
// the only member of a never-activated org by definition (R-8.12.4: no
// other org data is safe to reference in these, since the whole point is
// that none exists).

/** Day 1/3/7 — deep-links to the resumable dashboard checklist (#1104). */
export function dormancyNudgeEmail({
  orgName,
  checklistUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  checklistUrl: string;
  platformName?: string;
}): EmailContent {
  const safeOrgName = escapeHtml(orgName);
  return {
    subject: `Finish setting up ${orgName}`,
    html: emailShell(
      `<h2>Pick up where you left off</h2>` +
        `<p><strong>${safeOrgName}</strong> is set up on ${platformName}, but there's nothing in it yet — ` +
        `no gear, no jobs. The checklist below picks up exactly where you left off.</p>` +
        emailButton({ href: checklistUrl, label: "Continue setup" }),
    ),
  };
}

/** Day 23 — "we'll archive in 7 days, add anything at all and we won't." */
export function dormancyArchiveWarningEmail({
  orgName,
  checklistUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  checklistUrl: string;
  platformName?: string;
}): EmailContent {
  const safeOrgName = escapeHtml(orgName);
  return {
    subject: `We'll archive ${orgName} in 7 days`,
    html: emailShell(
      `<h2>Still there?</h2>` +
        `<p><strong>${safeOrgName}</strong> has had no activity since it was created on ${platformName}. ` +
        `We'll archive it in 7 days. Add a piece of gear, or anything else at all, and we won't.</p>` +
        emailButton({ href: checklistUrl, label: "Continue setup" }),
    ),
  };
}

/** Day 29 — the final warning, 24 hours out. */
export function dormancyFinalWarningEmail({
  orgName,
  checklistUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  checklistUrl: string;
  platformName?: string;
}): EmailContent {
  const safeOrgName = escapeHtml(orgName);
  return {
    subject: `Last chance — ${orgName} will be archived tomorrow`,
    html: emailShell(
      `<h2>One day left</h2>` +
        `<p><strong>${safeOrgName}</strong> will be archived on ${platformName} in 24 hours. ` +
        `Add anything at all before then and it stays active.</p>` +
        emailButton({ href: checklistUrl, label: "Continue setup" }),
    ),
  };
}

/** Day 30 — archived. Reassuring, not a goodbye: it's reversible, one click. */
export function dormancyArchivedEmail({
  orgName,
  reactivateUrl,
  platformName = "RVLT Flow",
}: {
  orgName: string;
  reactivateUrl: string;
  platformName?: string;
}): EmailContent {
  const safeOrgName = escapeHtml(orgName);
  return {
    subject: `${orgName} has been archived`,
    html: emailShell(
      `<h2>${safeOrgName} is archived</h2>` +
        `<p>It had no activity for 30 days, so we've archived it on ${platformName}. ` +
        `This isn't permanent — everything is still there, and one click brings it straight back.</p>` +
        emailButton({ href: reactivateUrl, label: "Reactivate this organisation" }),
    ),
  };
}
