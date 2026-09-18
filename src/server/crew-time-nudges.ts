"use server";

/**
 * Work-layer Phase 4 (#1246, design §8.5) — two cron-invoked crew email
 * sweeps, both riding the SAME 15-minute notification cron
 * (`/api/cron/notifications`, `convex/crons.ts`'s `notification-emails` job)
 * and its EXISTING `notificationEmailLogs` dedupe ledger, per the issue's own
 * instruction ("using the existing notification cron and its
 * notificationEmailLogs dedupe" — not a second mechanism).
 *
 * Deliberately a SEPARATE file from `crew-communication.ts`: every function in
 * that file is a user-invoked server action gated by `requirePermission`, but
 * these two run with no session (a cron sweep, like `sendNotificationEmails`
 * in `notification-email-sender.ts`) — mixing an unguarded, cron-only function
 * into the user-facing file would risk it later being called from a client
 * component with no RBAC check at all.
 *
 * `notificationEmailLogs.userId` is repurposed here to hold the CREW MEMBER's
 * id (not a Better Auth user id) — it's just a dedupe key column, and this is
 * the same posture the mention/notification tables take toward "whoever this
 * event is about". `createIfMissing` (never `create` — CLAUDE.md's Convex
 * mutation rules) makes each dedupe key idempotent across overlapping cron
 * ticks without a second existence check.
 */

import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { deliverSideEffectEmail } from "@/lib/email-side-effect";
import { env } from "@/env";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
import { getCrewAssignmentsByOrg } from "@/lib/crew-scheduling-read";
import { crewOfferReminderEmail, crewCallTimeReminderEmail } from "@/lib/crew-emails";
import { buildAssignmentEmailData } from "@/server/crew-communication";
import { startOfDayInTimezone, endOfDayInTimezone } from "@/lib/quote-validity";

export interface CrewTimeNudgeResult {
  sent: number;
  skipped: number;
  errors: string[];
}

/** A crew member sits unanswered on an OFFERED assignment this long before the
 *  auto-nudge fires. Fixed per issue #1246 ("auto-nudge unanswered after 24
 *  hours") — distinct from the PM-facing Triage threshold
 *  (`resolveCrewOfferStaleHours`, an org setting, design §8.5/§9), which
 *  surfaces to a DIFFERENT audience (the PM, not the crew member). */
const OFFER_NUDGE_HOURS = 24;

/** How far past "now" to probe for the org's calendar "tomorrow" — long
 *  enough to always land on the next calendar day even across a ±1h DST
 *  transition, short enough to never reach the day after. */
const TOMORROW_PROBE_OFFSET_MS = 25 * 60 * 60 * 1000;

/**
 * 24h auto-nudge — reminds a CREW MEMBER (never the PM) that their offer is
 * still open, reusing the assignment's own still-live single-use token so the
 * accept/decline links keep working. One nudge per assignment, ever
 * (`notificationEmailLogs` dedupe key = the assignment id) — this fires once
 * an offer crosses 24h unanswered, not on every subsequent cron tick.
 */
export async function sendCrewOfferNudges(): Promise<CrewTimeNudgeResult> {
  const convex = await getConvexClient();
  const orgs = await prisma.organization.findMany({ where: { archivedAt: null }, select: { id: true } });
  const cutoff = Date.now() - OFFER_NUDGE_HOURS * 60 * 60 * 1000;
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const org of orgs) {
    const stale = (await getCrewAssignmentsByOrg(org.id)).filter(
      (a) => a.status === "OFFERED" && a.offeredAt != null && a.offeredAt < cutoff,
    );
    for (const a of stale) {
      const notificationKey = `crew-offer-nudge:${a.id}`;
      const { created } = await convex.mutation(api.notificationEmailLogs.createIfMissing, {
        id: notificationKey,
        organizationId: org.id,
        userId: a.crewMemberId,
        notificationKey,
        sentAt: Date.now(),
      });
      if (!created) { skipped++; continue; }
      try {
        const { assignment, emailData } = await buildAssignmentEmailData(a.id);
        const crewEmail = assignment.crewMember.email;
        // The assignment hasn't been responded to, so its single-use token is
        // still live — reuse it rather than minting a second one.
        const token = assignment.responseToken;
        if (!crewEmail || !token) { skipped++; continue; }
        const baseUrl = env.NEXT_PUBLIC_APP_URL;
        const acceptUrl = `${baseUrl}/api/crew/respond/${token}?action=accept`;
        const declineUrl = `${baseUrl}/api/crew/respond/${token}?action=decline`;
        const email = crewOfferReminderEmail(emailData, acceptUrl, declineUrl);
        await deliverSideEffectEmail({
          idempotencyKey: notificationKey,
          to: crewEmail,
          subject: email.subject,
          html: email.html,
        });
        sent++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  return { sent, skipped, errors };
}

/**
 * Day-before call-time reminder for a CONFIRMED shift — off by default per
 * org (`resolveCrewCallReminderEnabled`, a deliberate opt-in since it emails
 * crew on the org's behalf). "Tomorrow" is resolved in the ORG's stored
 * timezone (POLICY.md R-9.3), never the server's clock. Dedupe key includes
 * the calendar day so a shift confirmed and re-confirmed doesn't double-send,
 * but a DIFFERENT day-before reminder for the same long-running assignment
 * still can.
 */
export async function sendCrewCallTimeReminders(): Promise<CrewTimeNudgeResult> {
  const convex = await getConvexClient();
  const orgs = await prisma.organization.findMany({ where: { archivedAt: null }, select: { id: true } });
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const org of orgs) {
    const settings = await readOrgSettingsBlob(org.id);
    if (settings.crewTime?.callReminderEnabled !== true) continue; // off by default

    const probe = Date.now() + TOMORROW_PROBE_OFFSET_MS;
    const tomorrowStart = startOfDayInTimezone(probe, settings.timezone);
    const tomorrowEnd = endOfDayInTimezone(probe, settings.timezone);
    const dayKey = new Date(tomorrowStart).toISOString().slice(0, 10);

    const confirmedTomorrow = (await getCrewAssignmentsByOrg(org.id)).filter(
      (a) => a.status === "CONFIRMED" && a.startDate != null && a.startDate >= tomorrowStart && a.startDate <= tomorrowEnd,
    );

    for (const a of confirmedTomorrow) {
      const notificationKey = `crew-call-reminder:${a.id}:${dayKey}`;
      const { created } = await convex.mutation(api.notificationEmailLogs.createIfMissing, {
        id: notificationKey,
        organizationId: org.id,
        userId: a.crewMemberId,
        notificationKey,
        sentAt: Date.now(),
      });
      if (!created) { skipped++; continue; }
      try {
        const { assignment, emailData } = await buildAssignmentEmailData(a.id);
        const crewEmail = assignment.crewMember.email;
        if (!crewEmail) { skipped++; continue; }
        const email = crewCallTimeReminderEmail(emailData);
        await deliverSideEffectEmail({
          idempotencyKey: notificationKey,
          to: crewEmail,
          subject: email.subject,
          html: email.html,
        });
        sent++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  return { sent, skipped, errors };
}
