/**
 * Email template for scheduled report delivery.
 *
 * Plain-text-friendly summary in the body, plus a CSV attachment containing
 * the full result set. We use CSV (not PDF) because reports are tabular by
 * nature and CSV opens in any spreadsheet without needing the rendering
 * stack that the PDF builder requires.
 */

interface ScheduledReportEmailData {
  recipientName: string;
  orgName: string;
  appBaseUrl: string;
  reportName: string;
  reportDescription: string | null;
  reportUrl: string;
  rowCount: number;
  generatedAt: Date;
  frequencyLabel: string;
}

export function scheduledReportEmail(data: ScheduledReportEmailData) {
  const prefsUrl = `${data.appBaseUrl.replace(/\/$/, "")}/reports`;
  return {
    subject: `${data.frequencyLabel} report: ${data.reportName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2>${data.reportName}</h2>
        <p>Hi ${data.recipientName},</p>
        <p>Your ${data.frequencyLabel.toLowerCase()} report is attached. ${data.rowCount} row${data.rowCount === 1 ? "" : "s"} as of ${data.generatedAt.toLocaleString("en-AU", {
          dateStyle: "medium",
          timeStyle: "short",
        })}.</p>
        ${data.reportDescription ? `<p style="color:#666;font-size:14px;">${data.reportDescription}</p>` : ""}
        <p style="margin:24px 0;">
          <a href="${data.reportUrl}" style="display:inline-block;padding:12px 24px;background-color:#0d9488;color:white;text-decoration:none;border-radius:6px;font-weight:600;">
            Open report in GearFlow
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="color:#999;font-size:12px;">
          Sent by ${data.orgName} via GearFlow.
          <a href="${prefsUrl}" style="color:#0d9488;">Manage scheduled reports</a>.
        </p>
      </div>
    `,
  };
}
