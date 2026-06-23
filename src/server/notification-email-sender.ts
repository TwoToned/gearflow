"use server";

/**
 * Outbound email delivery for in-app notifications.
 *
 * Reuses the same query logic as `getNotifications()` but is org-and-user
 * neutral — it pulls per-org notifications, fans them out to every active
 * member of the org, checks each member's per-type opt-in flag, dedupes via
 * `NotificationEmailLog`, and sends through `sendEmail()`.
 *
 * Called by `/api/cron/notifications` on a fixed cadence (e.g. every 15
 * minutes). Safe to call repeatedly — the log table guarantees one email per
 * (user, notificationKey).
 *
 * NOT used for the `pending_invitation` notification — that already has a
 * dedicated email on creation (`auth.ts` sends the invite link directly).
 * Re-emailing pending invitations from here would just be noise.
 */

import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { sendEmail } from "@/lib/email";
import { getModelMap } from "@/lib/models-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import { getMaintenanceRecordsByOrg } from "@/lib/maintenance-read";
import { getMaintenanceAssetLinksByRecordIds } from "@/lib/maintenance-record-asset-read";
import {
  getCrewAssignmentsByOrg,
  getCrewTimeEntriesByOrg,
  countAssignmentsByStatus,
  countTimeEntriesByStatus,
} from "@/lib/crew-scheduling-read";
import { env } from "@/env";
import {
  flaggedAssetEmail,
  overdueMaintenanceEmail,
  overdueReturnEmail,
  pendingOffersEmail,
  pendingTimesheetsEmail,
  upcomingProjectEmail,
} from "@/lib/notification-emails";
import {
  NOTIFICATION_PREFERENCE_DEFAULTS,
  NOTIFICATION_TYPE_TO_PREFERENCE,
  type NotificationPreferenceValues,
} from "@/lib/validations/notification-preferences";
import { getUserNotificationPreferenceMap } from "@/lib/user-notification-preferences-read";

interface OrgRecipient {
  userId: string;
  email: string;
  name: string;
  preferences: NotificationPreferenceValues;
}

interface BuildContext {
  organizationId: string;
  organizationName: string;
  appBaseUrl: string;
  now: Date;
  /** 3-day-out cutoff for upcoming projects. */
  soon: Date;
}

interface NotificationToSend {
  key: string;
  type: keyof typeof NOTIFICATION_TYPE_TO_PREFERENCE;
  build: (recipient: OrgRecipient, ctx: BuildContext) => { subject: string; html: string };
}

export interface SendNotificationEmailsResult {
  orgsProcessed: number;
  candidates: number;
  sent: number;
  skippedAlreadySent: number;
  skippedOptOut: number;
  errors: { recipient: string; key: string; message: string }[];
}

async function loadOrgRecipients(organizationId: string): Promise<OrgRecipient[]> {
  // Member + User stay on Prisma (Better Auth); the per-user notification
  // preferences are now CONVEX-ONLY (bucket-2 Phase B). Load the eligible members
  // first, then resolve each user's preferences from the Convex copy in one batch
  // (defaults applied for users with no row).
  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          banned: true,
        },
      },
    },
  });

  const eligible = members.filter((m) => m.user.email && !m.user.banned);
  // getUserNotificationPreferenceMap returns an entry for every requested userId
  // (defaults applied for users with no Convex row), so the get() never misses.
  const prefMap = await getUserNotificationPreferenceMap(
    eligible.map((m) => m.user.id),
  );

  return eligible.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name || m.user.email,
    preferences: prefMap.get(m.user.id) ?? { ...NOTIFICATION_PREFERENCE_DEFAULTS },
  }));
}

async function buildOrgNotifications(ctx: BuildContext): Promise<NotificationToSend[]> {
  const { organizationId, now, soon } = ctx;
  const out: NotificationToSend[] = [];

  const modelMap = await getModelMap(organizationId);

  // 1. Overdue maintenance
  // maintenanceRecord is Convex-only (Phase C). Read the org's records, replicate
  // the old `where` (status in [SCHEDULED, IN_PROGRESS], scheduledDate < now) +
  // `take: 50` in JS. The maintenanceRecordAsset join + assets live in Convex.
  const overdueMaintenance = (await getMaintenanceRecordsByOrg(organizationId))
    .filter(
      (m) =>
        (m.status === "SCHEDULED" || m.status === "IN_PROGRESS") &&
        m.scheduledDate != null &&
        m.scheduledDate.getTime() < now.getTime(),
    )
    .slice(0, 50);

  const overdueRecordIds = overdueMaintenance.map((m) => m.id);
  const overdueLinks = await getMaintenanceAssetLinksByRecordIds(overdueRecordIds);
  const overdueAssets = await getAssetsByOrg(organizationId);
  const overdueAssetMap = new Map(overdueAssets.map((a) => [a.id, a]));
  const overdueLinksByRecord = new Map<string, typeof overdueLinks>();
  for (const l of overdueLinks) {
    const arr = overdueLinksByRecord.get(l.maintenanceRecordId) ?? [];
    arr.push(l);
    overdueLinksByRecord.set(l.maintenanceRecordId, arr);
  }
  for (const m of overdueMaintenance) {
    const recordLinks = overdueLinksByRecord.get(m.id) ?? [];
    const first = recordLinks[0] ? overdueAssetMap.get(recordLinks[0].assetId) : undefined;
    const count = recordLinks.length;
    const firstModelName = first?.modelId ? modelMap.get(first.modelId)?.name : undefined;
    const desc = first
      ? count > 1
        ? `${first.assetTag} — ${firstModelName ?? first.assetTag} + ${count - 1} more overdue`
        : `${first.assetTag} — ${firstModelName ?? first.assetTag} is overdue`
      : `${m.title} is overdue`;
    out.push({
      key: `maint-${m.id}`,
      type: "overdue_maintenance",
      build: (recipient, c) =>
        overdueMaintenanceEmail({
          recipientName: recipient.name,
          orgName: c.organizationName,
          appBaseUrl: c.appBaseUrl,
          href: `/maintenance/${m.id}`,
          notificationKey: `maint-${m.id}`,
          title: m.title,
          description: desc,
          scheduledDate: m.scheduledDate?.toISOString() ?? null,
        }),
    });
  }

  // 2. Overdue returns
  const allProjects = await getProjectsByOrg(organizationId);
  const overdueProjectCandidates = allProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        (p.status === "CHECKED_OUT" || p.status === "ON_SITE") &&
        p.rentalEndDate != null &&
        (p.rentalEndDate as number) < now.getTime(),
    )
    .slice(0, 50);

  if (overdueProjectCandidates.length > 0) {
    const overdueIds = overdueProjectCandidates.map((p) => p.id);
    // projectLineItem is Convex-only — fetch the candidate projects' lines and
    // group CHECKED_OUT counts by projectId in JS (replicates the groupBy).
    const checkedOutLines = await (await getConvexClient()).query(
      api.projectLineItems.listByProjectIds,
      { orgId: organizationId, projectIds: overdueIds },
    );
    const countMap = new Map<string, number>();
    for (const li of checkedOutLines) {
      if (li.status !== "CHECKED_OUT") continue;
      countMap.set(li.projectId, (countMap.get(li.projectId) ?? 0) + 1);
    }
    for (const p of overdueProjectCandidates) {
      const deployed = countMap.get(p.id) ?? 0;
      if (deployed <= 0) continue;
      out.push({
        key: `return-${p.id}`,
        type: "overdue_return",
        build: (recipient, c) =>
          overdueReturnEmail({
            recipientName: recipient.name,
            orgName: c.organizationName,
            appBaseUrl: c.appBaseUrl,
            href: `/projects/${p.id}`,
            notificationKey: `return-${p.id}`,
            projectNumber: p.projectNumber,
            projectName: p.name,
            rentalEndDate: p.rentalEndDate ? new Date(p.rentalEndDate as number).toISOString() : null,
            itemsDeployed: deployed,
          }),
      });
    }
  }

  // 3. Upcoming projects
  const upcomingProjects = allProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        (p.status === "CONFIRMED" || p.status === "PREPPING") &&
        p.rentalStartDate != null &&
        (p.rentalStartDate as number) >= now.getTime() &&
        (p.rentalStartDate as number) <= soon.getTime(),
    )
    .slice(0, 50);
  for (const p of upcomingProjects) {
    out.push({
      key: `upcoming-${p.id}`,
      type: "upcoming_project",
      build: (recipient, c) =>
        upcomingProjectEmail({
          recipientName: recipient.name,
          orgName: c.organizationName,
          appBaseUrl: c.appBaseUrl,
          href: `/projects/${p.id}`,
          notificationKey: `upcoming-${p.id}`,
          projectNumber: p.projectNumber,
          projectName: p.name,
          rentalStartDate: p.rentalStartDate ? new Date(p.rentalStartDate as number).toISOString() : null,
        }),
    });
  }

    // 6. Pending crew offers — aggregate, one email per day-bucket.
  const pendingOffers = countAssignmentsByStatus(
    await getCrewAssignmentsByOrg(organizationId),
    ["OFFERED"],
  );
  if (pendingOffers > 0) {
    const dayKey = now.toISOString().slice(0, 10);
    out.push({
      key: `crew-pending-offers:${dayKey}`,
      type: "pending_offers",
      build: (recipient, c) =>
        pendingOffersEmail({
          recipientName: recipient.name,
          orgName: c.organizationName,
          appBaseUrl: c.appBaseUrl,
          href: `/crew`,
          notificationKey: `crew-pending-offers:${dayKey}`,
          count: pendingOffers,
        }),
    });
  }

  // 7. Pending timesheets — aggregate, one email per day-bucket.
  const submittedTimesheets = countTimeEntriesByStatus(
    await getCrewTimeEntriesByOrg(organizationId),
    ["SUBMITTED"],
  );
  if (submittedTimesheets > 0) {
    const dayKey = now.toISOString().slice(0, 10);
    out.push({
      key: `crew-pending-timesheets:${dayKey}`,
      type: "pending_timesheets",
      build: (recipient, c) =>
        pendingTimesheetsEmail({
          recipientName: recipient.name,
          orgName: c.organizationName,
          appBaseUrl: c.appBaseUrl,
          href: `/crew/timesheets`,
          notificationKey: `crew-pending-timesheets:${dayKey}`,
          count: submittedTimesheets,
        }),
    });
  }

  // 8. Flagged assets.
  // projectLineItem is Convex-only — read the org's lines, filter by prepStatus
  // in JS, take 50. Asset tags + project headers are resolved from Convex.
  const allOrgLines = await (await getConvexClient()).query(
    api.projectLineItems.list,
    { orgId: organizationId },
  );
  const flagged = allOrgLines
    .filter(
      (li) =>
        li.prepStatus === "FLAGGED_FAULTY" || li.prepStatus === "FLAGGED_TT_OVERDUE",
    )
    .slice(0, 50);
  if (flagged.length > 0) {
    const assets = await getAssetsByOrg(organizationId);
    const assetTagMap = new Map(assets.map((a) => [a.id, a.assetTag]));
    const projectMap = new Map(allProjects.map((p) => [p.id, p]));
    for (const li of flagged) {
      const liModelName = li.modelId ? modelMap.get(li.modelId)?.name : undefined;
      const label = (li.assetId ? assetTagMap.get(li.assetId) : undefined) || liModelName || "Unknown";
      const reason = li.prepStatus === "FLAGGED_TT_OVERDUE" ? "T&T overdue" : "faulty";
      const proj = projectMap.get(li.projectId);
      out.push({
        key: `flagged-${li.id}`,
        type: "flagged_asset",
        build: (recipient, c) =>
          flaggedAssetEmail({
            recipientName: recipient.name,
            orgName: c.organizationName,
            appBaseUrl: c.appBaseUrl,
            href: `/warehouse/${li.projectId}`,
            notificationKey: `flagged-${li.id}`,
            assetLabel: label,
            reason,
            projectNumber: proj?.projectNumber ?? "",
            projectName: proj?.name ?? "",
          }),
      });
    }
  }

  return out;
}

/**
 * Run the email-send pass across every organization. Idempotent — uses
 * NotificationEmailLog to ensure a user is emailed about a given
 * notificationKey at most once.
 */
export async function sendNotificationEmails(): Promise<SendNotificationEmailsResult> {
  const result: SendNotificationEmailsResult = {
    orgsProcessed: 0,
    candidates: 0,
    sent: 0,
    skippedAlreadySent: 0,
    skippedOptOut: 0,
    errors: [],
  };

  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  for (const org of orgs) {
    result.orgsProcessed += 1;
    const ctx: BuildContext = {
      organizationId: org.id,
      organizationName: org.name,
      appBaseUrl: env.NEXT_PUBLIC_APP_URL,
      now,
      soon,
    };

    const [notifications, recipients] = await Promise.all([
      buildOrgNotifications(ctx),
      loadOrgRecipients(org.id),
    ]);
    if (notifications.length === 0 || recipients.length === 0) continue;

    // Pre-fetch existing log rows for these keys to avoid one query per pair.
    const existing = await prisma.notificationEmailLog.findMany({
      where: {
        organizationId: org.id,
        notificationKey: { in: notifications.map((n) => n.key) },
      },
      select: { userId: true, notificationKey: true },
    });
    const alreadySent = new Set(existing.map((e) => `${e.userId}::${e.notificationKey}`));

    for (const notif of notifications) {
      const prefField = NOTIFICATION_TYPE_TO_PREFERENCE[notif.type];

      for (const recipient of recipients) {
        result.candidates += 1;

        if (!recipient.preferences[prefField]) {
          result.skippedOptOut += 1;
          continue;
        }
        const dedupeKey = `${recipient.userId}::${notif.key}`;
        if (alreadySent.has(dedupeKey)) {
          result.skippedAlreadySent += 1;
          continue;
        }

        try {
          const { subject, html } = notif.build(recipient, ctx);
          await sendEmail({ to: recipient.email, subject, html });
          await prisma.notificationEmailLog.create({
            data: {
              organizationId: org.id,
              userId: recipient.userId,
              notificationKey: notif.key,
            },
          });
          alreadySent.add(dedupeKey);
          result.sent += 1;
        } catch (e) {
          result.errors.push({
            recipient: recipient.email,
            key: notif.key,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  return result;
}

/**
 * Lazily garbage-collect old log rows whose underlying notification key is
 * no longer active. Bounded by 30 days as a backstop so even keys we don't
 * see in the active set anymore eventually fall out.
 */
export async function pruneStaleNotificationEmailLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.notificationEmailLog.deleteMany({
    where: { sentAt: { lt: cutoff } },
  });
  return result.count;
}
