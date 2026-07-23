import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { reportConvexJobError } from "./lib/errorReporting";

/**
 * Phase 6a — Convex durable cron executors.
 *
 * These internalActions are invoked by `convex/crons.ts` on a fixed schedule.
 * They are the DURABLE, observable (Convex dashboard) replacement for the
 * EXTERNAL cron scheduler (cron-job.org / Vercel Cron / AWS EventBridge) that
 * previously hit the Next.js routes directly with `Bearer <CRON_SECRET>`. The
 * scheduler is what moves into Convex; the executor logic stays in the proven
 * Next route (see WHY below).
 *
 * WHY invoke the existing Next route instead of porting the whole pipeline into
 * Convex:
 *   - Both email pipelines fan out to org / member / user rows whose SOURCE OF
 *     TRUTH is Postgres (Better Auth — the migration's explicit do-not-touch
 *     list, §7). Convex mirrors of `organizations` / `members` / `users` are
 *     not verified-complete in prod (a `convex:backfill:members` run is still a
 *     prerequisite for other native surfaces), so reading recipients from the
 *     mirror could email an INCOMPLETE set — a silent regression.
 *   - The email pipelines are large and battle-tested; single-sourcing them
 *     avoids a parity-risk rewrite that can't be verified in this environment.
 * So Convex owns the SCHEDULE (durable + observable), the Next route stays the
 * executor. Fully removing the route + `CRON_SECRET` is deferred until (1) the
 * org/member/user mirrors are verified complete in prod and (2) email parity can
 * be checked in a real environment — that removal is a prod-impacting change
 * that must be verified before it ships, so it is NOT part of this slice.
 *
 * DORMANT until `ENABLE_CONVEX_CRONS === "true"` in the Convex deployment env.
 * Merging + deploying registers the crons but they no-op every tick until the
 * flag is flipped AND `CONVEX_CRON_TARGET_URL` + `CRON_SECRET` are set on the
 * deployment. This matches the OFF-by-default flag discipline of the rest of the
 * Convex-native migration, so shipping this changes nothing live.
 */

/**
 * POST the given app cron path with the shared `CRON_SECRET`. Returns a small
 * status summary. Throws on a non-2xx response so the failure surfaces in the
 * Convex dashboard's cron run log (a failed run is logged; the next scheduled
 * run proceeds normally — no retry storm, and the executor is idempotent).
 *
 * Also forwards any failure to PostHog (`reportConvexJobError`, R-8.9.1) before
 * throwing — the Convex dashboard's cron log was previously the ONLY place a
 * failure was visible; this is the missing forwarding leg. Reporting is
 * best-effort and never swallows or replaces the thrown error.
 */
async function invokeCronRoute(
  path: string,
): Promise<{ skipped?: boolean; status?: number; body?: string }> {
  if (process.env.ENABLE_CONVEX_CRONS !== "true") {
    console.log(
      `[convex-cron] disabled (ENABLE_CONVEX_CRONS != "true") — skipping ${path}`,
    );
    return { skipped: true };
  }

  try {
    const baseUrl = process.env.CONVEX_CRON_TARGET_URL;
    const secret = process.env.CRON_SECRET;
    if (!baseUrl || !secret) {
      throw new Error(
        `[convex-cron] CONVEX_CRON_TARGET_URL and CRON_SECRET must both be set on the ` +
          `Convex deployment to run ${path}`,
      );
    }

    const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `[convex-cron] ${path} failed: ${res.status} ${body.slice(0, 500)}`,
      );
    }
    console.log(`[convex-cron] ${path} ok: ${res.status}`);
    return { status: res.status, body };
  } catch (err) {
    await reportConvexJobError(`cron:${path}`, err, { path });
    throw err;
  }
}

/**
 * Every-15-minutes: send outbound emails for active in-app notifications
 * (overdue maintenance, overdue returns, upcoming projects, pending crew
 * offers/timesheets, flagged assets) + prune stale email-dedupe logs. Idempotent
 * — the executor dedupes each (user, notificationKey) via NotificationEmailLog,
 * so over-firing is safe.
 */
export const runNotificationEmails = internalAction({
  args: {},
  returns: v.object({
    skipped: v.optional(v.boolean()),
    status: v.optional(v.number()),
    body: v.optional(v.string()),
  }),
  handler: async () => invokeCronRoute("/api/cron/notifications"),
});

/**
 * Daily: recalculate test-and-tag asset statuses (CURRENT/DUE_SOON/OVERDUE) then
 * send a digest email to each org's admins/owners. Read-mostly + idempotent
 * (re-running the same day re-sends the digest by design — one digest/day cadence
 * is enforced by the daily schedule, not a dedupe log).
 */
export const runTestTagReminders = internalAction({
  args: {},
  returns: v.object({
    skipped: v.optional(v.boolean()),
    status: v.optional(v.number()),
    body: v.optional(v.string()),
  }),
  handler: async () => invokeCronRoute("/api/cron/test-tag-reminders"),
});
