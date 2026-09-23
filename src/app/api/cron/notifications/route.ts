import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { env } from "@/env";
import {
  pruneStaleNotificationEmailLogs,
  sendNotificationEmails,
} from "@/server/notification-email-sender";
import { sendCrewOfferNudges, sendCrewCallTimeReminders } from "@/server/crew-time-nudges";
import { sendFollowUpBriefs } from "@/server/follow-up-brief";
import { syncXeroPayments } from "@/server/xero-payment-sync";

/**
 * POST /api/cron/notifications
 *
 * Sends emails for active in-app notifications to opted-in org members.
 * Idempotent — each (user, notificationKey) is emailed at most once thanks
 * to the NotificationEmailLog table.
 *
 * Secured by CRON_SECRET — call from an external scheduler with
 * `Authorization: Bearer <CRON_SECRET>`. Run on a 15-minute cadence (or
 * whatever cadence makes sense; the dedupe log handles over-firing safely).
 */
export async function POST(request: NextRequest) {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendNotificationEmails();
    // Follow-up automation phase 2 (FEATUREDOCS/82) — read payment state back
    // from Xero (hourly per org) BEFORE the brief, so an invoice paid in Xero
    // overnight has already closed its chase by the time the email is built.
    const xeroPayments = await syncXeroPayments().catch((e: unknown) => ({ orgs: 0, checked: 0, settled: 0, errors: [e instanceof Error ? e.message : String(e)] }));
    // Work-layer Phase 4 (#1246) — rides the SAME cron + dedupe ledger as the
    // sweep above, per the issue's own instruction. Each sweep is independent
    // and best-effort against the other: a failure in one must not skip the
    // rest of this route's work.
    const [crewOfferNudges, crewCallReminders, followUpBriefs] = await Promise.all([
      sendCrewOfferNudges().catch((e: unknown) => ({ sent: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] })),
      sendCrewCallTimeReminders().catch((e: unknown) => ({ sent: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] })),
      // Follow-up automation (FEATUREDOCS/82) — the morning brief; same ledger.
      sendFollowUpBriefs().catch((e: unknown) => ({ sent: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] })),
    ]);
    const pruned = await pruneStaleNotificationEmailLogs();
    return NextResponse.json({ ...result, prunedLogs: pruned, crewOfferNudges, crewCallReminders, followUpBriefs, xeroPayments });
  } catch (e) {
    logger.error("[Cron] Notification emails failed", { error: e });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Also support GET for Vercel Cron compatibility.
export async function GET(request: NextRequest) {
  return POST(request);
}
