import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Phase 6a — Convex durable cron schedule.
 *
 * Replaces the EXTERNAL cron scheduler that used to POST the Next.js cron routes
 * with `Bearer <CRON_SECRET>`. Convex now owns the schedule (durable, retried,
 * observable in the dashboard); the executor logic stays in the Next route,
 * invoked by the internalActions in `convex/scheduledJobs.ts`. See that file for
 * the full rationale and the DORMANT-until-`ENABLE_CONVEX_CRONS` gate — these
 * jobs no-op every tick until the flag is flipped on the deployment, so
 * registering them here changes nothing live.
 *
 * The date-derived reminders the design doc lists (overdue-return checks,
 * maintenance reminders) are already produced by the notification-email job
 * (`sendNotificationEmails` builds the `overdue_return` / `overdue_maintenance` /
 * `upcoming_project` notifications from date comparisons at run time), so they
 * ride the 15-minute cadence below rather than needing their own cron. There is
 * no existing sub-hire-due-date job in the codebase to port.
 */
const crons = cronJobs();

// Notification emails — every 15 minutes. Idempotent (NotificationEmailLog
// dedupes each user/notificationKey), so a tight cadence is safe.
crons.interval(
  "notification-emails",
  { minutes: 15 },
  internal.scheduledJobs.runNotificationEmails,
  {},
);

// Test & tag reminder digests — once daily. 22:00 UTC ≈ 08:00 AEST (the org's
// working timezone), so digests land at the start of the business day.
crons.daily(
  "test-tag-reminders",
  { hourUTC: 22, minuteUTC: 0 },
  internal.scheduledJobs.runTestTagReminders,
  {},
);

// Recurring preventative maintenance (WS6 #945) — generate/merge due PM cycles
// from serviceSchedules. NATIVE Convex internalMutation, NOT the HTTP-hop
// pattern the two crons above use — this job only ever touches Convex tables
// (serviceSchedules/models/assets/bulkAssets/maintenanceRecords), so there is
// no Postgres/Better-Auth dependency to route through the Next.js route for.
// Still gated behind ENABLE_CONVEX_CRONS for the same off-by-default rollout
// discipline as the rest of this file. See maintenanceScheduleGeneration.ts.
crons.daily(
  "maintenance-schedule-generation",
  { hourUTC: 22, minuteUTC: 0 },
  internal.maintenanceScheduleGeneration.generateDueCycles,
  {},
);

export default crons;
