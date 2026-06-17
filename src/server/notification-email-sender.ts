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
import { sendEmail } from "@/lib/email";
import { getModelMap } from "@/lib/models-read";
import { getProjectsByOrg } from "@/lib/projects-read";
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

function resolvePreferences(
  raw: Awaited<ReturnType<typeof prisma.userNotificationPreference.findUnique>>,
): NotificationPreferenceValues {
  if (!raw) return { ...NOTIFICATION_PREFERENCE_DEFAULTS };
  return {
    overdueMaintenance: raw.overdueMaintenance,
    overdueReturn: raw.overdueReturn,
    upcomingProject: raw.upcomingProject,
    pendingInvitation: raw.pendingInvitation,
    pendingOffers: raw.pendingOffers,
    pendingTimesheets: raw.pendingTimesheets,
    flaggedAsset: raw.flaggedAsset,
  };
}

async function loadOrgRecipients(organizationId: string): Promise<OrgRecipient[]> {
  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          banned: true,
          notificationPreference: true,
        },
      },
    },
  });

  return members
    .filter((m) => m.user.email && !m.user.banned)
    .map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name || m.user.email,
      preferences: resolvePreferences(m.user.notificationPreference),
    }));
}

async function buildOrgNotifications(ctx: BuildContext): Promise<NotificationToSend[]> {
  const { organizationId, now, soon } = ctx;
  const out: NotificationToSend[] = [];

  const modelMap = await getModelMap(organizationId);

  // 1. Overdue maintenance
  const overdueMaintenance = await prisma.maintenanceRecord.findMany({
    where: {
      organizationId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledDate: { lt: now },
    },
    include: { assets: { include: { asset: true } } },
    take: 50,
  });
  for (const m of overdueMaintenance) {
    const first = m.assets[0]?.asset;
    const count = m.assets.length;
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
    const checkedOutCounts = await prisma.projectLineItem.groupBy({
      by: ["projectId"],
      where: { organizationId, projectId: { in: overdueIds }, status: "CHECKED_OUT" },
      _count: { _all: true },
    });
    const countMap = new Map(checkedOutCounts.map((g) => [g.projectId, g._count._all]));
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

        }),
    });
  }

  const pendingOffers = await prisma.crewAssignment.count({
    where: { organizationId, status: "OFFERED" },
  });
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
  const submittedTimesheets = await prisma.crewTimeEntry.count({
    where: { organizationId, status: "SUBMITTED" },
  });
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

  // 8. Flagged assets
  const flagged = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      prepStatus: { in: ["FLAGGED_FAULTY", "FLAGGED_TT_OVERDUE"] },
    },
    include: {
      asset: { select: { assetTag: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
    },
    take: 50,
  });
  for (const li of flagged) {
    const liModelName = li.modelId ? modelMap.get(li.modelId)?.name : undefined;
    const label = li.asset?.assetTag || liModelName || "Unknown";
    const reason = li.prepStatus === "FLAGGED_TT_OVERDUE" ? "T&T overdue" : "faulty";
    out.push({
      key: `flagged-${li.id}`,
      type: "flagged_asset",
      build: (recipient, c) =>
        flaggedAssetEmail({
          recipientName: recipient.name,
          orgName: c.organizationName,
          appBaseUrl: c.appBaseUrl,
          href: `/warehouse/${li.project.id}`,
          notificationKey: `flagged-${li.id}`,
          assetLabel: label,
          reason,
          projectNumber: li.project.projectNumber,
          projectName: li.project.name,
        }),
    });
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
