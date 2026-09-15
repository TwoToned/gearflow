import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { runOrgDormancySweep } from "@/server/org-dormancy";
import { env } from "@/env";

/**
 * POST /api/cron/org-dormancy
 *
 * B4 (#1096) — advances the "never activated" email ladder (day 1/3/7/23/29)
 * and archives orgs that hit day 30 with zero activity. Secured by
 * CRON_SECRET — invoked by convex/scheduledJobs.ts's runOrgDormancySweep.
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
    const result = await runOrgDormancySweep();
    return NextResponse.json(result);
  } catch (e) {
    logger.error("[Cron] Org dormancy sweep failed", { error: e });
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
