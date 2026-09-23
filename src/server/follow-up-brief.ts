"use server";

/**
 * Follow-up automation — the morning brief sender (design §8.6, FEATUREDOCS/82).
 * One email per person per business day from 07:00 org time, listing the quote
 * follow-ups due for THEM (assigned to them, due today or overdue). Not sent when
 * nothing is due. Rides the notification cron (`/api/cron/notifications`) and
 * its `notificationEmailLogs` ledger — `createIfMissing` on
 * `follow-up-brief:<orgId>:<userId>:<date>` makes every later tick a no-op, and
 * the org id in the key keeps a multi-org user's briefs separate.
 *
 * Cron-only, no session (same posture as `crew-time-nudges.ts`) — never import
 * this from a client component.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { deliverSideEffectEmail } from "@/lib/email-side-effect";
import { env } from "@/env";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
import { endOfDayInTimezone } from "@/lib/quote-validity";
import { getUserNotificationPreferenceMap } from "@/lib/user-notification-preferences-read";
import { followUpBriefEmail } from "@/lib/notification-emails";
import { briefDedupeKey, groupBrief, isBriefWindow, localClock } from "@/lib/follow-up-brief";

export interface FollowUpBriefResult {
  sent: number;
  skipped: number;
  errors: string[];
}

async function loadRecipients(orgId: string) {
  const members = await prisma.member.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, name: true, email: true, banned: true } } },
  });
  const eligible = members.filter((m) => m.user.email && !m.user.banned);
  const prefs = await getUserNotificationPreferenceMap(eligible.map((m) => m.user.id));
  return new Map(
    eligible
      .filter((m) => prefs.get(m.user.id)?.followUpBrief !== false)
      .map((m) => [m.user.id, { email: m.user.email, name: m.user.name }]),
  );
}

async function sendOrgBriefs(org: { id: string; name: string }, now: number, result: FollowUpBriefResult): Promise<void> {
  const settings = await readOrgSettingsBlob(org.id);
  // No timezone = no reliable "morning" (design review round 3): skip, don't guess.
  if (!settings.timezone || !isBriefWindow(now, settings.timezone)) return;
  const convex = await getConvexClient();
  const rows = await convex.query(api.followUpTick.briefForOrg, { orgId: org.id, dueBy: endOfDayInTimezone(now, settings.timezone) });
  if (!rows.length) return;
  const byUser = groupBrief(rows, now, settings.timezone);
  const recipients = await loadRecipients(org.id);
  const { dateKey } = localClock(now, settings.timezone);

  for (const [userId, sections] of byUser) {
    const recipient = recipients.get(userId);
    if (!recipient) { result.skipped++; continue; }
    const key = briefDedupeKey(org.id, userId, dateKey);
    const { created } = await convex.mutation(api.notificationEmailLogs.createIfMissing, {
      id: key, organizationId: org.id, userId, notificationKey: key, sentAt: now,
    });
    if (!created) { result.skipped++; continue; }
    try {
      const email = followUpBriefEmail({
        recipientName: recipient.name,
        orgName: org.name,
        appBaseUrl: env.NEXT_PUBLIC_APP_URL,
        href: "/dashboard",
        notificationKey: key,
        ...sections,
      });
      await deliverSideEffectEmail({ idempotencyKey: key, to: recipient.email, subject: email.subject, html: email.html });
      result.sent++;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
}

export async function sendFollowUpBriefs(): Promise<FollowUpBriefResult> {
  const result: FollowUpBriefResult = { sent: 0, skipped: 0, errors: [] };
  const now = Date.now();
  const orgs = await prisma.organization.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
  for (const org of orgs) {
    try {
      await sendOrgBriefs(org, now, result);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
