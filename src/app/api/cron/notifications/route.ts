import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import {
  pruneStaleNotificationEmailLogs,
  sendNotificationEmails,
} from "@/server/notification-email-sender";

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
    const pruned = await pruneStaleNotificationEmailLogs();
    return NextResponse.json({ ...result, prunedLogs: pruned });
  } catch (e) {
    console.error("[Cron] Notification emails failed:", e);
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
