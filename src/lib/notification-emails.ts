/**
 * Email templates for in-app notification delivery.
 *
 * One factory per notification type. Each returns the `{ subject, html }`
 * shape expected by `sendEmail()`. Templates are intentionally lightweight
 * inline HTML to match the rest of the email codebase (`src/lib/email.ts`,
 * `src/lib/crew-emails.ts`) — no MJML / no React Email yet.
 */

interface BaseEmailData {
  recipientName: string;
  orgName: string;
  appBaseUrl: string;
  /** Absolute path or full URL to the linked page in the app. */
  href: string;
  /** Stable id of the underlying notification (used for the unsubscribe link copy). */
  notificationKey: string;
}

function absolute(appBaseUrl: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${appBaseUrl.replace(/\/$/, "")}${href.startsWith("/") ? href : `/${href}`}`;
}

function emailWrapper(
  content: string,
  data: Pick<BaseEmailData, "orgName" | "appBaseUrl">,
): string {
  const prefsUrl = `${data.appBaseUrl.replace(/\/$/, "")}/account/notifications`;
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      ${content}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#999;font-size:12px;">
        Sent by ${data.orgName} via GearFlow.
        <a href="${prefsUrl}" style="color:#0d9488;">Update notification preferences</a>.
      </p>
    </div>
  `;
}

function ctaButton(url: string, label: string): string {
  return `
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;background-color:#0d9488;color:white;text-decoration:none;border-radius:6px;font-weight:600;">
        ${label}
      </a>
    </p>
  `;
}

// ─── Per-type templates ──────────────────────────────────────────────────────

export interface OverdueMaintenanceEmailData extends BaseEmailData {
  title: string;
  description: string;
  scheduledDate: string | null;
}

export function overdueMaintenanceEmail(data: OverdueMaintenanceEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `Overdue maintenance: ${data.title}`,
    html: emailWrapper(
      `
        <h2>Maintenance is overdue</h2>
        <p>Hi ${data.recipientName},</p>
        <p><strong>${data.title}</strong> was scheduled for ${
          data.scheduledDate
            ? new Date(data.scheduledDate).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "earlier"
        } and is now overdue.</p>
        <p>${data.description}</p>
        ${ctaButton(link, "View maintenance")}
      `,
      data,
    ),
  };
}

export interface OverdueReturnEmailData extends BaseEmailData {
  projectNumber: string;
  projectName: string;
  rentalEndDate: string | null;
  itemsDeployed: number;
}

export function overdueReturnEmail(data: OverdueReturnEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `Overdue return: ${data.projectNumber} — ${data.projectName}`,
    html: emailWrapper(
      `
        <h2>Project return is overdue</h2>
        <p>Hi ${data.recipientName},</p>
        <p><strong>${data.projectNumber} — ${data.projectName}</strong> was due back ${
          data.rentalEndDate
            ? `on ${new Date(data.rentalEndDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
            : "already"
        }, but ${data.itemsDeployed} item${data.itemsDeployed === 1 ? " is" : "s are"} still deployed.</p>
        ${ctaButton(link, "Open project")}
      `,
      data,
    ),
  };
}

export interface UpcomingProjectEmailData extends BaseEmailData {
  projectNumber: string;
  projectName: string;
  rentalStartDate: string | null;
}

export function upcomingProjectEmail(data: UpcomingProjectEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `Starting soon: ${data.projectNumber} — ${data.projectName}`,
    html: emailWrapper(
      `
        <h2>A project is starting soon</h2>
        <p>Hi ${data.recipientName},</p>
        <p><strong>${data.projectNumber} — ${data.projectName}</strong> kicks off ${
          data.rentalStartDate
            ? new Date(data.rentalStartDate).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })
            : "within the next few days"
        }.</p>
        ${ctaButton(link, "Open project")}
      `,
      data,
    ),
  };
}

export interface PendingInvitationEmailData extends BaseEmailData {
  invitingOrgName: string;
  role: string | null;
}

export function pendingInvitationEmail(data: PendingInvitationEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `Invitation to ${data.invitingOrgName} on GearFlow`,
    html: emailWrapper(
      `
        <h2>You have a pending invitation</h2>
        <p>Hi ${data.recipientName},</p>
        <p>You've been invited to join <strong>${data.invitingOrgName}</strong>${data.role ? ` as <strong>${data.role}</strong>` : ""}.</p>
        ${ctaButton(link, "Review invitation")}
      `,
      data,
    ),
  };
}

export interface PendingOffersEmailData extends BaseEmailData {
  count: number;
}

export function pendingOffersEmail(data: PendingOffersEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `${data.count} pending crew offer${data.count === 1 ? "" : "s"}`,
    html: emailWrapper(
      `
        <h2>Crew offers awaiting response</h2>
        <p>Hi ${data.recipientName},</p>
        <p>You have <strong>${data.count}</strong> crew offer${data.count === 1 ? "" : "s"} waiting on a response.</p>
        ${ctaButton(link, "Review offers")}
      `,
      data,
    ),
  };
}

export interface PendingTimesheetsEmailData extends BaseEmailData {
  count: number;
}

export function pendingTimesheetsEmail(data: PendingTimesheetsEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `${data.count} timesheet${data.count === 1 ? "" : "s"} awaiting approval`,
    html: emailWrapper(
      `
        <h2>Timesheets need your approval</h2>
        <p>Hi ${data.recipientName},</p>
        <p><strong>${data.count}</strong> crew timesheet${data.count === 1 ? " has" : "s have"} been submitted for review.</p>
        ${ctaButton(link, "Review timesheets")}
      `,
      data,
    ),
  };
}

export interface FlaggedAssetEmailData extends BaseEmailData {
  assetLabel: string;
  reason: string;
  projectNumber: string;
  projectName: string;
}

export function flaggedAssetEmail(data: FlaggedAssetEmailData) {
  const link = absolute(data.appBaseUrl, data.href);
  return {
    subject: `Flagged: ${data.assetLabel} — ${data.reason}`,
    html: emailWrapper(
      `
        <h2>Asset flagged during prep</h2>
        <p>Hi ${data.recipientName},</p>
        <p><strong>${data.assetLabel}</strong> was flagged as <strong>${data.reason}</strong> on <strong>${data.projectNumber} — ${data.projectName}</strong>.</p>
        ${ctaButton(link, "Open warehouse")}
      `,
      data,
    ),
  };
}
