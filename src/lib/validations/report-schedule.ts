import { z } from "zod";

/**
 * Validation for a SavedReport's scheduling configuration.
 *
 * Lives outside any "use server" file so it can be imported on both client
 * (form resolver) and server (action input parsing).
 *
 * Times are interpreted as UTC at run time. The hour field is 0-23.
 *
 * Day-of-month is capped at 28 to avoid the February edge case (we'd rather
 * the report skip a day than silently fail for half the year).
 */

export const scheduleFrequencySchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>;

const emailListSchema = z
  .array(z.string().email("Must be a valid email"))
  .max(50, "Up to 50 recipients per scheduled report");

export const reportScheduleSchema = z
  .object({
    scheduleFrequency: scheduleFrequencySchema.nullable(),
    scheduleHour: z.number().int().min(0).max(23).nullable(),
    scheduleDayOfWeek: z.number().int().min(0).max(6).nullable(),
    scheduleDayOfMonth: z.number().int().min(1).max(28).nullable(),
    scheduleRecipients: emailListSchema.default([]),
  })
  .superRefine((val, ctx) => {
    if (val.scheduleFrequency === null) return; // schedule disabled — no further checks
    if (val.scheduleHour === null) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduleHour"],
        message: "Scheduled reports need an hour",
      });
    }
    if (val.scheduleFrequency === "WEEKLY" && val.scheduleDayOfWeek === null) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduleDayOfWeek"],
        message: "Weekly schedules need a day of the week",
      });
    }
    if (val.scheduleFrequency === "MONTHLY" && val.scheduleDayOfMonth === null) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduleDayOfMonth"],
        message: "Monthly schedules need a day of the month",
      });
    }
    if (val.scheduleRecipients.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduleRecipients"],
        message: "Scheduled reports need at least one recipient",
      });
    }
  });

export type ReportScheduleInput = z.input<typeof reportScheduleSchema>;
export type ReportScheduleValues = z.infer<typeof reportScheduleSchema>;

export const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Decide whether a scheduled report is due to run.
 *
 * - DAILY: due once per day at scheduleHour.
 * - WEEKLY: due once per week on scheduleDayOfWeek at scheduleHour.
 * - MONTHLY: due once per month on scheduleDayOfMonth at scheduleHour.
 *
 * Uses UTC-based comparisons. Tolerance is 6 hours — i.e. once the bucket has
 * passed and the report hasn't been run since the bucket start, it's due.
 * That keeps cron-jitter or temporary downtime from skipping runs entirely.
 */
export function isReportScheduleDue(
  schedule: {
    scheduleFrequency: ScheduleFrequency | null;
    scheduleHour: number | null;
    scheduleDayOfWeek: number | null;
    scheduleDayOfMonth: number | null;
    scheduleLastRunAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  const { scheduleFrequency, scheduleHour } = schedule;
  if (!scheduleFrequency || scheduleHour === null) return false;

  // Build the "current bucket start" — the most recent moment at which the
  // report should have fired according to its frequency.
  let bucketStart: Date;
  switch (scheduleFrequency) {
    case "DAILY": {
      bucketStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), scheduleHour),
      );
      if (bucketStart > now) {
        // Today's bucket hasn't started yet; check yesterday's.
        bucketStart.setUTCDate(bucketStart.getUTCDate() - 1);
      }
      break;
    }
    case "WEEKLY": {
      if (schedule.scheduleDayOfWeek === null) return false;
      // Find the most recent occurrence of scheduleDayOfWeek at scheduleHour.
      const candidate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), scheduleHour),
      );
      const delta = (candidate.getUTCDay() - schedule.scheduleDayOfWeek + 7) % 7;
      candidate.setUTCDate(candidate.getUTCDate() - delta);
      if (candidate > now) candidate.setUTCDate(candidate.getUTCDate() - 7);
      bucketStart = candidate;
      break;
    }
    case "MONTHLY": {
      if (schedule.scheduleDayOfMonth === null) return false;
      const candidate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), schedule.scheduleDayOfMonth, scheduleHour),
      );
      if (candidate > now) candidate.setUTCMonth(candidate.getUTCMonth() - 1);
      bucketStart = candidate;
      break;
    }
  }

  if (now < bucketStart) return false;
  if (!schedule.scheduleLastRunAt) return true;
  return schedule.scheduleLastRunAt < bucketStart;
}
