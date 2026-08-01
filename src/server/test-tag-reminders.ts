"use server";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { testTagDigestEmail } from "@/lib/email-templates";
import type { OrgSettings } from "@/lib/org-settings-types";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

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

  // Get all LIVE organisations (org table stays Prisma). A cron sweep has no
  // session, so it doesn't go through the identity chokepoints that already
  // refuse an archived org (#1075, A5) — filter explicitly, or an archived
  // org's members keep getting T&T digest emails forever.
  const orgs = await prisma.organization.findMany({
    where: { archivedAt: null },
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

      const emailContent = testTagDigestEmail({
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
