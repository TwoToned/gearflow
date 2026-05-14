"use server";

/**
 * Scheduled-report runner.
 *
 * Iterates SavedReports that have a non-null scheduleFrequency, decides
 * which ones are due via `isReportScheduleDue`, generates each report's
 * CSV via the existing report engine, emails it to scheduleRecipients, and
 * stamps scheduleLastRunAt so we don't re-run within the same bucket.
 *
 * Called by `POST /api/cron/reports`. Recommended cadence: hourly.
 */

import { prisma } from "@/lib/prisma";
import { executeReport, generateCSV } from "@/lib/report-engine";
import { sendEmail } from "@/lib/email";
import { scheduledReportEmail } from "@/lib/report-emails";
import { env } from "@/env";
import { isReportScheduleDue } from "@/lib/validations/report-schedule";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { logActivity } from "@/lib/activity-log";
import {
  reportScheduleSchema,
  type ReportScheduleValues,
} from "@/lib/validations/report-schedule";
import { serialize } from "@/lib/serialize";
import type { ReportConfig } from "@/lib/report-types";
import type { Prisma } from "@/generated/prisma/client";

export interface ScheduledReportRunResult {
  total: number;
  due: number;
  ran: number;
  emailedRecipients: number;
  errors: { reportId: string; message: string }[];
}

function frequencyLabel(freq: "DAILY" | "WEEKLY" | "MONTHLY"): string {
  switch (freq) {
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "MONTHLY":
      return "Monthly";
  }
}

/**
 * Run all scheduled reports that are currently due, send each to its
 * recipients, and stamp scheduleLastRunAt. Idempotent on a per-bucket basis.
 */
export async function runDueScheduledReports(): Promise<ScheduledReportRunResult> {
  const result: ScheduledReportRunResult = {
    total: 0,
    due: 0,
    ran: 0,
    emailedRecipients: 0,
    errors: [],
  };

  const candidates = await prisma.savedReport.findMany({
    where: {
      scheduleFrequency: { not: null },
    },
    include: {
      organization: { select: { id: true, name: true } },
    },
  });

  result.total = candidates.length;
  const now = new Date();

  for (const r of candidates) {
    if (!isReportScheduleDue(
      {
        scheduleFrequency: r.scheduleFrequency,
        scheduleHour: r.scheduleHour,
        scheduleDayOfWeek: r.scheduleDayOfWeek,
        scheduleDayOfMonth: r.scheduleDayOfMonth,
        scheduleLastRunAt: r.scheduleLastRunAt,
      },
      now,
    )) {
      continue;
    }
    result.due += 1;

    if (r.scheduleRecipients.length === 0) continue;

    try {
      const config = r.config as unknown as ReportConfig;
      const executed = await executeReport(config, r.organizationId, 1, 10000);
      const csv = generateCSV(executed);

      const reportUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/reports/${r.id}`;
      const filename = `${r.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "report"}-${now.toISOString().slice(0, 10)}.csv`;

      for (const to of r.scheduleRecipients) {
        const { subject, html } = scheduledReportEmail({
          recipientName: to.split("@")[0],
          orgName: r.organization.name,
          appBaseUrl: env.NEXT_PUBLIC_APP_URL,
          reportName: r.name,
          reportDescription: r.description ?? null,
          reportUrl,
          rowCount: executed.totalRows ?? executed.rows.length,
          generatedAt: now,
          frequencyLabel: frequencyLabel(r.scheduleFrequency!),
        });
        await sendEmail({
          to,
          subject,
          html,
          attachments: [
            {
              filename,
              content: csv,
              contentType: "text/csv",
            },
          ],
        });
        result.emailedRecipients += 1;
      }

      await prisma.savedReport.update({
        where: { id: r.id },
        data: { scheduleLastRunAt: now, lastRunAt: now },
      });
      result.ran += 1;
    } catch (e) {
      result.errors.push({
        reportId: r.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

/**
 * Update the schedule fields on a saved report. Only the report's creator
 * (or an admin) can set the schedule — read permission is checked via the
 * saved-report scope.
 */
export async function updateReportSchedule(
  id: string,
  input: ReportScheduleValues,
): Promise<void> {
  const parsed = reportScheduleSchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "reports",
    "view",
  );

  const existing = await prisma.savedReport.findFirst({
    where: { id, organizationId, createdById: userId },
  });
  if (!existing) {
    throw new Error("Report not found or you don't have permission to schedule it");
  }

  const data: Prisma.SavedReportUpdateInput = {
    scheduleFrequency: parsed.scheduleFrequency,
    scheduleHour: parsed.scheduleHour,
    scheduleDayOfWeek: parsed.scheduleDayOfWeek,
    scheduleDayOfMonth: parsed.scheduleDayOfMonth,
    scheduleRecipients: parsed.scheduleRecipients,
  };

  // Clear scheduleLastRunAt when the schedule is being disabled OR the
  // cadence is changing — otherwise leave it so we don't accidentally
  // re-run within the same bucket.
  if (parsed.scheduleFrequency === null) {
    data.scheduleLastRunAt = null;
  } else if (existing.scheduleFrequency !== parsed.scheduleFrequency) {
    data.scheduleLastRunAt = null;
  }

  await prisma.savedReport.update({ where: { id }, data });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: parsed.scheduleFrequency ? "scheduled" : "unscheduled",
    entityType: "SavedReport",
    entityId: existing.id,
    entityName: existing.name,
    summary: parsed.scheduleFrequency
      ? `Scheduled "${existing.name}" ${parsed.scheduleFrequency.toLowerCase()} to ${parsed.scheduleRecipients.length} recipient${parsed.scheduleRecipients.length === 1 ? "" : "s"}`
      : `Cleared schedule for "${existing.name}"`,
  });
}

/**
 * Read the schedule for a single saved report. Used by the UI to hydrate the
 * schedule form.
 */
export async function getReportSchedule(id: string): Promise<{
  scheduleFrequency: "DAILY" | "WEEKLY" | "MONTHLY" | null;
  scheduleHour: number | null;
  scheduleDayOfWeek: number | null;
  scheduleDayOfMonth: number | null;
  scheduleRecipients: string[];
  scheduleLastRunAt: string | null;
}> {
  const { organizationId } = await getOrgContext();
  const report = await prisma.savedReport.findFirst({
    where: { id, organizationId },
    select: {
      scheduleFrequency: true,
      scheduleHour: true,
      scheduleDayOfWeek: true,
      scheduleDayOfMonth: true,
      scheduleRecipients: true,
      scheduleLastRunAt: true,
    },
  });
  if (!report) throw new Error("Report not found");
  return serialize({
    scheduleFrequency: report.scheduleFrequency,
    scheduleHour: report.scheduleHour,
    scheduleDayOfWeek: report.scheduleDayOfWeek,
    scheduleDayOfMonth: report.scheduleDayOfMonth,
    scheduleRecipients: report.scheduleRecipients,
    scheduleLastRunAt: report.scheduleLastRunAt?.toISOString() ?? null,
  });
}
