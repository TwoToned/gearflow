/**
 * Email templates for crew assignment communication.
 */

import { emailShell, escapeHtml } from "@/lib/email-layout";
import { phaseLabels } from "@/lib/status-labels";
import { formatDate } from "@/lib/formatters";

interface AssignmentEmailData {
  crewFirstName: string;
  projectName: string;
  projectNumber: string;
  roleName: string | null;
  phase: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  locationName: string | null;
  locationAddress: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  notes: string | null;
  orgName: string;
}

function buildDetailsHtml(data: AssignmentEmailData): string {
  const location = [data.locationName, data.locationAddress]
    .filter(Boolean)
    .join(", ");
  const phase = data.phase ? phaseLabels[data.phase] || data.phase : null;

  const rows: string[] = [];
  rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Project</td><td style="padding:4px 0;font-size:14px;"><strong>${escapeHtml(data.projectNumber)}</strong> — ${escapeHtml(data.projectName)}</td></tr>`);
  if (data.roleName) {
    rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Role</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(data.roleName)}</td></tr>`);
  }
  if (phase) {
    rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Phase</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(phase)}</td></tr>`);
  }
  rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Dates</td><td style="padding:4px 0;font-size:14px;">${formatDate(data.startDate)}${data.endDate && data.endDate !== data.startDate ? ` — ${formatDate(data.endDate)}` : ""}</td></tr>`);
  if (data.startTime) {
    rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Times</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(data.startTime)}${data.endTime ? ` — ${escapeHtml(data.endTime)}` : ""}</td></tr>`);
  }
  if (location) {
    rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Location</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(location)}</td></tr>`);
  }
  if (data.siteContactName) {
    rows.push(`<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:14px;">Site Contact</td><td style="padding:4px 0;font-size:14px;">${escapeHtml(data.siteContactName)}${data.siteContactPhone ? ` (${escapeHtml(data.siteContactPhone)})` : ""}</td></tr>`);
  }

  return `<table style="border-collapse:collapse;">${rows.join("")}</table>`;
}

const buttonStyle = (bg: string) =>
  `display:inline-block;padding:12px 24px;background-color:${bg};color:white;text-decoration:none;border-radius:6px;font-weight:600;margin-right:8px;`;

function emailWrapper(content: string, orgName: string): string {
  return emailShell(
    `${content}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#999;font-size:12px;">Sent by ${escapeHtml(orgName)} via RVLT Flow</p>`,
  );
}

export function crewOfferEmail(
  data: AssignmentEmailData,
  acceptUrl: string,
  declineUrl: string
) {
  return {
    subject: `Crew Offer: ${data.projectName} — ${data.roleName || "Crew"}`,
    html: emailWrapper(
      `
      <h2>Hi ${escapeHtml(data.crewFirstName)},</h2>
      <p>You've been offered a crew position for an upcoming project. Please review the details below and let us know if you're available.</p>
      ${buildDetailsHtml(data)}
      ${data.notes ? `<p style="margin-top:16px;padding:12px;background:#f8f8f8;border-radius:6px;font-size:14px;"><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ""}
      <div style="margin-top:24px;">
        <a href="${acceptUrl}" style="${buttonStyle("#0d9488")}">Accept</a>
        <a href="${declineUrl}" style="${buttonStyle("#dc2626")}">Decline</a>
      </div>
      <p style="color:#888;font-size:13px;margin-top:16px;">Or reply to this email to discuss availability.</p>
      `,
      data.orgName
    ),
  };
}

export function crewConfirmationEmail(data: AssignmentEmailData) {
  return {
    subject: `Confirmed: ${data.projectName} — ${data.roleName || "Crew"}`,
    html: emailWrapper(
      `
      <h2>Hi ${escapeHtml(data.crewFirstName)},</h2>
      <p>Your assignment has been <strong>confirmed</strong>. Here are the details:</p>
      ${buildDetailsHtml(data)}
      ${data.notes ? `<p style="margin-top:16px;padding:12px;background:#f8f8f8;border-radius:6px;font-size:14px;"><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ""}
      `,
      data.orgName
    ),
  };
}

export function crewCancellationEmail(data: AssignmentEmailData) {
  return {
    subject: `Cancelled: ${data.projectName} — ${data.roleName || "Crew"}`,
    html: emailWrapper(
      `
      <h2>Hi ${escapeHtml(data.crewFirstName)},</h2>
      <p>Your assignment for <strong>${escapeHtml(data.projectName)}</strong> has been <strong>cancelled</strong>.</p>
      ${buildDetailsHtml(data)}
      <p style="color:#888;font-size:13px;margin-top:16px;">If you have any questions, please contact us.</p>
      `,
      data.orgName
    ),
  };
}

export function crewUpdateEmail(data: AssignmentEmailData) {
  return {
    subject: `Updated: ${data.projectName} — ${data.roleName || "Crew"}`,
    html: emailWrapper(
      `
      <h2>Hi ${escapeHtml(data.crewFirstName)},</h2>
      <p>Your assignment details for <strong>${escapeHtml(data.projectName)}</strong> have been updated:</p>
      ${buildDetailsHtml(data)}
      ${data.notes ? `<p style="margin-top:16px;padding:12px;background:#f8f8f8;border-radius:6px;font-size:14px;"><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ""}
      `,
      data.orgName
    ),
  };
}

export function crewBulkMessageEmail(
  crewFirstName: string,
  projectName: string,
  projectNumber: string,
  message: string,
  senderName: string,
  orgName: string
) {
  return {
    subject: `Message from ${orgName}: ${projectName}`,
    html: emailWrapper(
      `
      <h2>Hi ${escapeHtml(crewFirstName)},</h2>
      <p>You have a message regarding <strong>${escapeHtml(projectNumber)} — ${escapeHtml(projectName)}</strong>:</p>
      <div style="margin:16px 0;padding:16px;background:#f8f8f8;border-radius:6px;font-size:14px;white-space:pre-wrap;">${escapeHtml(message)}</div>
      <p style="color:#888;font-size:13px;">— ${escapeHtml(senderName)}</p>
      `,
      orgName
    ),
  };
}
