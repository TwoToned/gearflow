import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganization } from "@/lib/auth-server";
import { getFileAsDataUri } from "@/lib/storage";
import { executeReport } from "@/lib/report-engine";
import { generateReportPdf } from "@/lib/pdfme/generate-pdf";
import type { ReportConfig } from "@/lib/report-types";

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

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  try {
    const body = await request.json();
    const { config, title, subtitle } = body as {
      config: ReportConfig;
      title?: string;
      subtitle?: string;
    };

    if (!config || !config.dataSource) {
      return NextResponse.json({ error: "config is required" }, { status: 400 });
    }

    // Execute the report (up to 10,000 rows for PDF)
    const result = await executeReport(config, organizationId, 1, 10000);

    // Load org branding
    const orgData = await getOrgData(organizationId);

    // Generate PDF
    const reportTitle = title || "Report";
    const pdf = await generateReportPdf(reportTitle, result, orgData, subtitle, config.dataSource);

    const filename = `${reportTitle.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-")}.pdf`;

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("Report PDF generation error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Report PDF generation failed" },
      { status: 500 }
    );
  }
}
