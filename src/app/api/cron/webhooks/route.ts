import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { timingSafeEqual } from "crypto";
import { deliverPendingWebhooks } from "@/lib/webhooks/deliver";

export const runtime = "nodejs";

/**
 * POST /api/cron/webhooks
 *
 * Delivers pending webhook deliveries whose backoff has elapsed. `emitWebhookEvent`
 * kicks a fire-and-forget attempt on the happy path, so this exists to RETRY: a
 * consumer that was down when the event fired gets it on the next tick.
 *
 * Safe to over-fire — a delivery is claimed by `status`/`nextAttemptAt`, and the
 * envelope's stable `id` makes duplicates a consumer-side dedupe, not a double-apply.
 *
 * Secured by CRON_SECRET. Run every minute or two; the backoff schedule starts at 1m.
 */
export async function POST(request: NextRequest) {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await deliverPendingWebhooks({ limit: 100 });
    return NextResponse.json({
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delivery run failed" },
      { status: 500 },
    );
  }
}
