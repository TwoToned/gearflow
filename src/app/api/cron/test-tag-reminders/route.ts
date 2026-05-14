import { NextRequest, NextResponse } from "next/server";
import { recalculateAllTestTagStatuses, sendTestTagReminderDigests } from "@/server/test-tag-reminders";
import { env } from "@/env";

/**
 * POST /api/cron/test-tag-reminders
 *
 * Sends daily digest emails for DUE_SOON and OVERDUE test-tag assets.
 * Secured by CRON_SECRET — call from an external scheduler (e.g. Vercel Cron,
 * cron-job.org, AWS EventBridge) with Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(request: NextRequest) {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Recalculate statuses first so the digest uses fresh data
    const statusesUpdated = await recalculateAllTestTagStatuses();
    const result = await sendTestTagReminderDigests();
    return NextResponse.json({ ...result, statusesUpdated });
  } catch (e) {
    console.error("[Cron] Test tag reminders failed:", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

// Also support GET for Vercel Cron (which sends GET requests)
export async function GET(request: NextRequest) {
  return POST(request);
}
