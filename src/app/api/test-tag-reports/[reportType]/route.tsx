import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganization } from "@/lib/auth-server";
import { getFileAsDataUri } from "@/lib/storage";
import { generateTestTagReport } from "@/lib/pdfme/generate-pdf";
import type { TestTagReportType } from "@/lib/pdfme/types";
import type { ReportFilters } from "@/lib/test-tag-report-types";
import {
  getRegisterReportData, exportRegisterCSV,
  getOverdueReportData, exportOverdueCSV,
  getSessionReportData, exportSessionCSV,
  getItemHistoryReportData,
  getDueScheduleReportData, exportDueScheduleCSV,
  getClassSummaryReportData, exportClassSummaryCSV,
  getTesterActivityReportData, exportTesterActivityCSV,
  getFailedItemsReportData, exportFailedItemsCSV,
  getBulkSummaryReportData, exportBulkSummaryCSV,
  getComplianceCertificateData,
} from "@/server/test-tag-reports";

/** Map URL report types to pdfme report types */
const reportTypeMap: Record<string, TestTagReportType> = {
  register: "tt-register",
  overdue: "tt-overdue",
  session: "tt-session",
  "item-history": "tt-item-history",
  "due-schedule": "tt-due-schedule",
  "class-summary": "tt-class-summary",
  "tester-activity": "tt-tester-activity",
  "failed-items": "tt-failed-items",
  "bulk-summary": "tt-bulk-summary",
  "compliance-certificate": "tt-compliance-cert",
};

function parseFilters(url: URL): ReportFilters {
  const filters: ReportFilters = {};
  const get = (key: string) => url.searchParams.get(key) || undefined;
  const getArr = (key: string) => url.searchParams.getAll(key).filter(Boolean);

  filters.dateFrom = get("dateFrom");
  filters.dateTo = get("dateTo");
  filters.searchQuery = get("search");
  filters.bulkAssetId = get("bulkAssetId");
  filters.assetLinkType = get("assetLinkType") as ReportFilters["assetLinkType"];

  const statuses = getArr("status");
  if (statuses.length) filters.statuses = statuses;
  const classes = getArr("equipmentClass");
  if (classes.length) filters.equipmentClasses = classes;
  const types = getArr("applianceType");
  if (types.length) filters.applianceTypes = types;
  const results = getArr("result");
  if (results.length) filters.results = results;
  const testers = getArr("testedBy");
  if (testers.length) filters.testedBy = testers;
  const locations = getArr("location");
  if (locations.length) filters.locations = locations;

  return filters;
}

async function getOrgData(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try { orgSettings = JSON.parse(org.metadata); } catch { /* ignore */ }
  }
  const branding = orgSettings.branding as {
    primaryColor?: string; accentColor?: string; documentColor?: string;
    logoUrl?: string; iconUrl?: string; documentLogoMode?: "logo" | "icon" | "none";
    showOrgNameOnDocuments?: boolean;
  } | undefined;

  const [logoData, iconData] = await Promise.all([
    branding?.logoUrl ? getFileAsDataUri(branding.logoUrl) : null,
    branding?.iconUrl ? getFileAsDataUri(branding.iconUrl) : null,
  ]);

  return {
    name: org?.name || "",
    email: (orgSettings.email as string) || undefined,
    phone: (orgSettings.phone as string) || undefined,
    address: (orgSettings.address as string) || undefined,
    branding,
    logoData,
    iconData,
  };
}

// Helper to serialize dates to strings
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ser = (data: any) => JSON.parse(JSON.stringify(data, (_key, value) =>
  value instanceof Date ? value.toISOString() : value
));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportType: string }> }
) {
  const { reportType } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "pdf";

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;
  const filters = parseFilters(url);

  try {
    // CSV exports (unchanged — no PDF rendering needed)
    if (format === "csv") {
      let csv: string;
      let filename: string;

      switch (reportType) {
        case "register":
          csv = await exportRegisterCSV(filters);
          filename = "tt-register.csv";
          break;
        case "overdue":
          csv = await exportOverdueCSV(filters);
          filename = "tt-overdue.csv";
          break;
        case "session":
          csv = await exportSessionCSV(filters);
          filename = "tt-session.csv";
          break;
        case "due-schedule":
          csv = await exportDueScheduleCSV(filters);
          filename = "tt-due-schedule.csv";
          break;
        case "class-summary":
          csv = await exportClassSummaryCSV(filters);
          filename = "tt-class-summary.csv";
          break;
        case "tester-activity":
          csv = await exportTesterActivityCSV(filters);
          filename = "tt-tester-activity.csv";
          break;
        case "failed-items":
          csv = await exportFailedItemsCSV(filters);
          filename = "tt-failed-items.csv";
          break;
        case "bulk-summary":
          if (!filters.bulkAssetId) return NextResponse.json({ error: "bulkAssetId required" }, { status: 400 });
          csv = await exportBulkSummaryCSV(filters.bulkAssetId, filters);
          filename = "tt-bulk-summary.csv";
          break;
        default:
          return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
      }

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // PDF exports — pdfme generation
    const pdfmeType = reportTypeMap[reportType];
    if (!pdfmeType) {
      return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
    }

    const orgData = await getOrgData(organizationId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reportData: any;
    let filename: string;

    switch (reportType) {
      case "register":
        reportData = ser(await getRegisterReportData(filters));
        filename = "TT-Register.pdf";
        break;
      case "overdue":
        reportData = ser(await getOverdueReportData(filters));
        filename = "TT-NonCompliant.pdf";
        break;
      case "session":
        reportData = ser(await getSessionReportData(filters));
        filename = "TT-Session.pdf";
        break;
      case "item-history": {
        const id = url.searchParams.get("testTagAssetId");
        if (!id) return NextResponse.json({ error: "testTagAssetId required" }, { status: 400 });
        reportData = ser(await getItemHistoryReportData(id));
        filename = `TT-History-${reportData.testTagId}.pdf`;
        break;
      }
      case "due-schedule":
        reportData = ser(await getDueScheduleReportData(filters));
        filename = "TT-DueSchedule.pdf";
        break;
      case "class-summary":
        reportData = ser(await getClassSummaryReportData(filters));
        filename = "TT-ClassSummary.pdf";
        break;
      case "tester-activity":
        reportData = ser(await getTesterActivityReportData(filters));
        filename = "TT-TesterActivity.pdf";
        break;
      case "failed-items":
        reportData = ser(await getFailedItemsReportData(filters));
        filename = "TT-FailedItems.pdf";
        break;
      case "bulk-summary": {
        if (!filters.bulkAssetId) return NextResponse.json({ error: "bulkAssetId required" }, { status: 400 });
        reportData = ser(await getBulkSummaryReportData(filters.bulkAssetId, filters));
        filename = `TT-BulkSummary-${reportData.bulkAsset.assetTag}.pdf`;
        break;
      }
      case "compliance-certificate":
        reportData = ser(await getComplianceCertificateData(filters));
        filename = "TT-ComplianceCertificate.pdf";
        break;
      default:
        return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
    }

    const pdf = await generateTestTagReport(pdfmeType, reportData, orgData);

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("Report generation error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Report generation failed" }, { status: 500 });
  }
}
