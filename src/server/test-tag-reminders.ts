"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formatDate } from "@/lib/formatters";
import type { OrgSettings } from "@/lib/org-settings-types";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

const EMAIL_BODY_FONT_SIZE = "14px";

/**
 * Recalculate statuses for all active test-tag assets across all orgs.
 * Transitions CURRENT → DUE_SOON → OVERDUE based on nextDueDate.
 * Should run daily before sending digest emails.
 * Convex-only write (testTagAsset is Convex-only, Phase B).
 */
export async function recalculateAllTestTagStatuses(): Promise<number> {
  const now = Date.now();

  // All orgs (org table stays Prisma) that have T&T assets.
  const orgs = await prisma.organization.findMany({
    select: { id: true, metadata: true },
  });

  const convex = await getConvexClient();
  let changed = 0;

  for (const org of orgs) {
    let dueSoonDays = 14;
    if (org.metadata) {
      try {
        const settings: OrgSettings = JSON.parse(org.metadata);
        dueSoonDays = settings.testTag?.dueSoonThresholdDays || 14;
      } catch { /* ignore */ }
    }
    const dueSoonMs = dueSoonDays * 24 * 60 * 60 * 1000;

    const assets = await convex.query(api.testTagAssets.list, { orgId: org.id });
    for (const asset of assets) {
      if (asset.isActive === false) continue;
      if (asset.status === "RETIRED" || asset.status === "FAILED") continue;

      const nextDue = asset.nextDueDate ?? null;
      let newStatus: string | null = null;

      if (!nextDue || nextDue < now) {
        if (asset.status !== "OVERDUE") newStatus = "OVERDUE";
      } else if (nextDue <= now + dueSoonMs) {
        if (asset.status !== "DUE_SOON") newStatus = "DUE_SOON";
      } else {
        if (asset.status !== "CURRENT") newStatus = "CURRENT";
      }

      if (newStatus) {
        await convex.mutation(api.testTagAssets.update, {
          id: asset.id,
          patch: { status: newStatus as "OVERDUE" | "DUE_SOON" | "CURRENT", updatedAt: now },
        });
        changed++;
      }
    }
  }

  return changed;
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

  const convex = await getConvexClient();

  // Get all organisations (org table stays Prisma).
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, metadata: true },
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

      // Fetch overdue and due-soon assets from Convex (testTagAsset is Convex-only).
      const allAssets = await convex.query(api.testTagAssets.list, { orgId: org.id });
      const activeAssets = allAssets.filter((a) => a.isActive !== false);

      const overdueAssets = activeAssets
        .filter((a) => a.status === "OVERDUE")
        .sort((a, b) => (a.nextDueDate ?? Infinity) - (b.nextDueDate ?? Infinity))
        .slice(0, 50)
        .map((a) => ({
          testTagId: a.testTagId,
          description: a.description,
          nextDueDate: a.nextDueDate ? new Date(a.nextDueDate) : null,
          location: a.location ?? null,
        }));

      const dueSoonAssets = activeAssets
        .filter((a) => a.status === "DUE_SOON")
        .sort((a, b) => (a.nextDueDate ?? Infinity) - (b.nextDueDate ?? Infinity))
        .slice(0, 50)
        .map((a) => ({
          testTagId: a.testTagId,
          description: a.description,
          nextDueDate: a.nextDueDate ? new Date(a.nextDueDate) : null,
          location: a.location ?? null,
        }));

      if (overdueAssets.length === 0 && dueSoonAssets.length === 0) continue;

      // Get all admins/owners for this org (auth tables stay Prisma).
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
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${EMAIL_BODY_FONT_SIZE};color:#111827;max-width:640px;margin:0 auto;padding:24px;">
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
