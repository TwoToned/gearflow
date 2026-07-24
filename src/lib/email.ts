import { Resend } from "resend";
import { z } from "zod";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { retryWithBackoff } from "@/lib/retry-with-backoff";
import { reportVendorUsage } from "@/lib/vendor-cost-tracking";

// Vendor responses are untrusted input (POLICY.md R-8.10.3): validate the shape.
const resendSendResponseSchema = z.object({ id: z.string().min(1) });

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

/**
 * Bounded retry with backoff (POLICY.md R-8.10.3) — this is the DEFAULT inline send
 * path used directly by auth.ts/sso.ts/org-members.ts/settings.ts/site-admin.ts/
 * test-tag-reminders.ts, including auth-critical flows (password reset, invitations,
 * SSO approval). Previously a single transient Resend blip failed the whole request;
 * only the newer Convex-scheduled path (convex/emailActions.ts) had retry.
 */
async function sendViaResend(args: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<unknown> {
  try {
    return await retryWithBackoff(
      async () => {
        const result = await getResend().emails.send({
          from: env.EMAIL_FROM,
          to: args.to,
          subject: args.subject,
          html: args.html,
          attachments: args.attachments?.map((a) => ({
            filename: a.filename,
            content:
              typeof a.content === "string"
                ? Buffer.from(a.content, "utf8")
                : a.content,
            contentType: a.contentType,
          })),
        });
        if (result.error) {
          throw new Error(`Failed to send email: ${result.error.message}`);
        }
        return result.data;
      },
      {
        onRetry: (error, attempt) =>
          logger.warn("[Email] send failed, retrying", {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          }),
      },
    );
  } catch (error) {
    logger.error("[Email] send failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
      // Dev-mode: don't log the recipient address (PII, R-8.12.4).
      logger.info("[Email] dev-mode — not sent", {
        subject,
        attachments: attachments?.map((a) => a.filename),
      });
    }
    return { id: "dev-mock" };
  }

  const data = await sendViaResend({ to, subject, html, attachments });

  const parsed = resendSendResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Unexpected Resend response: ${parsed.error.message}`);
  }
  reportVendorUsage("resend", "send"); // T-P4 cost tracking, R-9.12/#764
  return parsed.data;
}

// Email templates now live in `@/lib/email-templates` (single source, R-8.10.4).
// Re-exported here for back-compat with existing `@/lib/email` importers.
export {
  invitationEmail,
  passwordResetEmail,
  roleChangedEmail,
  removedFromOrgEmail,
  testTagDigestEmail,
} from "@/lib/email-templates";
