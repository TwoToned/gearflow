"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatDate } from "@/lib/formatters";
import type { OrgSettings } from "@/server/settings";

/**
 * Recalculate statuses for all active test-tag assets across all orgs.
 * Transitions CURRENT → DUE_SOON → OVERDUE based on nextDueDate.
 * Should run daily before sending digest emails.
 */
export async function recalculateAllTestTagStatuses(): Promise<number> {
  const now = new Date();

  // Move CURRENT/DUE_SOON assets past their due date to OVERDUE
  const overdue = await prisma.testTagAsset.updateMany({
    where: {
      isActive: true,
      status: { in: ["CURRENT", "DUE_SOON"] },
      nextDueDate: { lt: now },
    },
    data: { status: "OVERDUE" },
  });

  // For DUE_SOON: we need per-org threshold, so fetch all orgs with test-tag assets
  const orgs = await prisma.organization.findMany({
    where: { testTagAssets: { some: { isActive: true, status: "CURRENT" } } },
    select: { id: true, metadata: true },
  });

  let dueSoonCount = 0;
  for (const org of orgs) {
    let dueSoonDays = 14;
    if (org.metadata) {
      try {
        const settings: OrgSettings = JSON.parse(org.metadata);
        dueSoonDays = settings.testTag?.dueSoonThresholdDays || 14;
      } catch { /* ignore */ }
    }

    const threshold = new Date(now);
    threshold.setDate(threshold.getDate() + dueSoonDays);

    const result = await prisma.testTagAsset.updateMany({
      where: {
        organizationId: org.id,
        isActive: true,
        status: "CURRENT",
        nextDueDate: { lte: threshold },
      },
      data: { status: "DUE_SOON" },
    });
    dueSoonCount += result.count;
  }

  return overdue.count + dueSoonCount;
}

/**
 * Send daily digest emails for DUE_SOON and OVERDUE test-tag assets.
 * Called by the /api/cron/test-tag-reminders route.
 *
 * For each organization:
 *  1. Recalculate all asset statuses
 *  2. Fetch all DUE_SOON and OVERDUE active assets
 *  3. If any exist, send a digest email to all org admins/owners
 */
export async function sendTestTagReminderDigests(): Promise<{
  orgsSent: number;
  emailsSent: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let orgsSent = 0;
  let emailsSent = 0;

  // Get all organisations that have at least one active test-tag asset
  const orgs = await prisma.organization.findMany({
    where: {
      testTagAssets: {
        some: {
          isActive: true,
          status: { in: ["DUE_SOON", "OVERDUE"] },
        },
      },
    },
    select: {
      id: true,
      name: true,
      metadata: true,
    },
  });

  for (const org of orgs) {
    try {
      // Check if reminders are enabled (default: true)
      let remindersEnabled = true;
      if (org.metadata) {
        try {
          const settings: OrgSettings = JSON.parse(org.metadata);
          if (settings.testTag?.emailReminders === false) {
            remindersEnabled = false;
          }
        } catch { /* ignore parse errors */ }
      }
      if (!remindersEnabled) continue;

      // Fetch overdue and due-soon assets
      const [overdueAssets, dueSoonAssets] = await Promise.all([
        prisma.testTagAsset.findMany({
          where: { organizationId: org.id, isActive: true, status: "OVERDUE" },
          select: {
            testTagId: true,
            description: true,
            nextDueDate: true,
            location: true,
          },
          orderBy: { nextDueDate: "asc" },
          take: 50, // Cap at 50 to keep email reasonable
        }),
        prisma.testTagAsset.findMany({
          where: { organizationId: org.id, isActive: true, status: "DUE_SOON" },
          select: {
            testTagId: true,
            description: true,
            nextDueDate: true,
            location: true,
          },
          orderBy: { nextDueDate: "asc" },
          take: 50,
        }),
      ]);

      if (overdueAssets.length === 0 && dueSoonAssets.length === 0) continue;

      // Get all admins/owners for this org
      const recipients = await prisma.member.findMany({
        where: {
          organizationId: org.id,
          role: { in: ["owner", "admin"] },
        },
        include: {
          user: { select: { email: true, name: true } },
        },
      });

      if (recipients.length === 0) continue;

      const emailContent = buildDigestEmail({
        orgName: org.name,
        overdueAssets,
        dueSoonAssets,
      });

      for (const member of recipients) {
        try {
          await sendEmail({
            to: member.user.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
          emailsSent++;
        } catch (e) {
          errors.push(`Failed to send to ${member.user.email}: ${(e as Error).message}`);
        }
      }

      orgsSent++;
    } catch (e) {
      errors.push(`Error processing org ${org.id}: ${(e as Error).message}`);
    }
  }

  return { orgsSent, emailsSent, errors };
}

// ─── Email Template ──────────────────────────────────────────────────────────

function buildDigestEmail({
  orgName,
  overdueAssets,
  dueSoonAssets,
}: {
  orgName: string;
  overdueAssets: { testTagId: string; description: string; nextDueDate: Date | null; location: string | null }[];
  dueSoonAssets: { testTagId: string; description: string; nextDueDate: Date | null; location: string | null }[];
}): { subject: string; html: string } {
  const totalOverdue = overdueAssets.length;
  const totalDueSoon = dueSoonAssets.length;

  const subject = totalOverdue > 0
    ? `Test & Tag: ${totalOverdue} overdue item${totalOverdue !== 1 ? "s" : ""} — ${orgName}`
    : `Test & Tag: ${totalDueSoon} item${totalDueSoon !== 1 ? "s" : ""} due soon — ${orgName}`;

  const buildRow = (item: { testTagId: string; description: string; nextDueDate: Date | null; location: string | null }) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${item.testTagId}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.description}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${item.location || "-"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${formatDate(item.nextDueDate)}</td>
    </tr>`;

  const tableHeader = `
    <tr style="background:#f9fafb;">
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Tag ID</th>
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Description</th>
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Location</th>
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Due Date</th>
    </tr>`;

  let overdueSection = "";
  if (overdueAssets.length > 0) {
    overdueSection = `
      <div style="margin-bottom:24px;">
        <h3 style="color:#991b1b;font-size:16px;margin:0 0 8px;">Overdue (${totalOverdue})</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${tableHeader}
          ${overdueAssets.map(buildRow).join("")}
        </table>
      </div>`;
  }

  let dueSoonSection = "";
  if (dueSoonAssets.length > 0) {
    dueSoonSection = `
      <div style="margin-bottom:24px;">
        <h3 style="color:#92400e;font-size:16px;margin:0 0 8px;">Due Soon (${totalDueSoon})</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${tableHeader}
          ${dueSoonAssets.map(buildRow).join("")}
        </table>
      </div>`;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:20px;">
      <div style="border-bottom:3px solid #0d9488;padding-bottom:12px;margin-bottom:20px;">
        <h2 style="margin:0;color:#111827;">Test & Tag — Daily Digest</h2>
        <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">${orgName} · ${formatDate(new Date())}</p>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:20px;">
        ${totalOverdue > 0 ? `<div style="flex:1;background:#fef2f2;border-radius:8px;padding:12px 16px;border-left:4px solid #ef4444;">
          <div style="font-size:24px;font-weight:700;color:#991b1b;">${totalOverdue}</div>
          <div style="font-size:13px;color:#991b1b;">Overdue</div>
        </div>` : ""}
        ${totalDueSoon > 0 ? `<div style="flex:1;background:#fffbeb;border-radius:8px;padding:12px 16px;border-left:4px solid #f59e0b;">
          <div style="font-size:24px;font-weight:700;color:#92400e;">${totalDueSoon}</div>
          <div style="font-size:13px;color:#92400e;">Due Soon</div>
        </div>` : ""}
      </div>

      ${overdueSection}
      ${dueSoonSection}

      <div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px;">
        <p style="color:#9ca3af;font-size:12px;margin:0;">
          This is an automated daily digest from GearFlow. Log in to view full details and manage your test schedule.
        </p>
      </div>
    </div>`;

  return { subject, html };
}
