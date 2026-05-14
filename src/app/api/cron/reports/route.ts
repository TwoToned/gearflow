import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { runDueScheduledReports } from "@/server/scheduled-reports";

/**
 * POST /api/cron/reports
 *
 * Runs every saved report whose schedule says it's due and emails the result
 * as a CSV attachment to the configured recipients. Auth: `Bearer ${CRON_SECRET}`.
 *
 * Recommended cadence: hourly. Reports are bucketed by frequency (daily /
 * weekly / monthly) and won't re-run within the same bucket.
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
    const result = await runDueScheduledReports();
    return NextResponse.json(result);
  } catch (e) {
    console.error("[Cron] Scheduled reports failed:", e);
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
