import { Resend } from "resend";
import { env } from "@/env";

// Lazily construct the Resend client. Building it at module scope throws
// "Missing API key" when RESEND_API_KEY is unset, which breaks `next build`
// page-data collection in CI (no secrets) for any route that transitively
// imports this module (e.g. /api/auditor/[token]). sendEmail only reaches
// getResend() after the dev-mock guard below, so the key is present here.
let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * Optional attachment payload. Filename is what the recipient sees; content
 * is the raw bytes (Buffer / Uint8Array) — Resend handles base64 encoding
 * internally.
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  if (!env.RESEND_API_KEY || env.RESEND_API_KEY === "re_xxxxxxxxxxxxxxxxxxxx") {
    if (process.env.NODE_ENV === "development") {
      console.log(`[Email] Would send to ${to}: ${subject}`);
      console.log(`[Email] HTML: ${html.substring(0, 200)}...`);
      if (attachments?.length) {
        console.log(`[Email] Attachments: ${attachments.map((a) => a.filename).join(", ")}`);
      }
    }
    return { id: "dev-mock" };
  }

  const { data, error } = await getResend().emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content:
        typeof a.content === "string"
          ? Buffer.from(a.content, "utf8")
          : a.content,
      contentType: a.contentType,
    })),
  });

  if (error) {
    console.error("[Email] Send failed:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}

export function invitationEmail({
  orgName,
  inviterName,
  role,
  acceptUrl,
}: {
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}) {
  return {
    subject: `You've been invited to ${orgName} on RVLT Flow`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited to join ${orgName}</h2>
        <p>${inviterName} has invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong> on RVLT Flow.</p>
        <p>
          <a href="${acceptUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Accept Invitation
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
      </div>
    `,
  };
}

export function passwordResetEmail({ resetUrl }: { resetUrl: string }) {
  return {
    subject: "Reset your RVLT Flow password",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>Click the button below to reset your password.</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Reset Password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}

export function roleChangedEmail({
  orgName,
  newRole,
}: {
  orgName: string;
  newRole: string;
}) {
  return {
    subject: `Your role in ${orgName} has been updated`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Role Update</h2>
        <p>Your role in <strong>${orgName}</strong> has been changed to <strong>${newRole}</strong>.</p>
      </div>
    `,
  };
}

export function removedFromOrgEmail({ orgName }: { orgName: string }) {
  return {
    subject: `You've been removed from ${orgName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Organization Access Removed</h2>
        <p>You have been removed from <strong>${orgName}</strong> on RVLT Flow.</p>
        <p>If you believe this is a mistake, please contact the organization admin.</p>
      </div>
    `,
  };
}
