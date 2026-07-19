import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { generateCallSheetPdf } from "@/lib/pdfme/generate-pdf";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const datesParam = url.searchParams.get("dates");
  const allDates = url.searchParams.get("allDates") === "true";
  const crewMemberId = url.searchParams.get("crewMemberId") || undefined;
  const crewRoleId = url.searchParams.get("crewRoleId") || undefined;
  const templateId = url.searchParams.get("templateId") || undefined;

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  // Validate dates param
  let callSheetDates: Date[] | undefined;
  if (datesParam) {
    const dateStrings = datesParam.split(",").map(s => s.trim());
    if (dateStrings.length > 31) {
      return NextResponse.json(
        { error: "Too many dates (max 31)" },
        { status: 400 }
      );
    }
    callSheetDates = [];
    for (const ds of dateStrings) {
      const d = new Date(ds);
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: `Invalid date: ${ds}` },
          { status: 400 }
        );
      }
      callSheetDates.push(d);
    }
  }

  // Validate crewMemberId if provided. crew_assignment is Convex-only — list the
  // project's assignments and check one is for this member.
  if (crewMemberId) {
    const { getAssignmentsByProject } = await import("@/lib/crew-scheduling-read");
    const projectAssignments = await getAssignmentsByProject(projectId, organizationId);
    const assignment = projectAssignments.find((a) => a.crewMemberId === crewMemberId);
    if (!assignment) {
      return NextResponse.json(
        { error: "Crew member not found on this project" },
        { status: 400 }
      );
    }
  }

  try {
    // Always use service-based call sheet generator
    const pdf = await generateCallSheetPdf(projectId, organizationId, {
      callSheetDates,
      allDates,
      crewMemberId,
      crewRoleId,
      templateId,
    });

    const filename = `CallSheet-${projectId}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("Call sheet PDF generation error", { error: error });
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
