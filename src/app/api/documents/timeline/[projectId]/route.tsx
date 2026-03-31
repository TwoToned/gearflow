import { NextRequest, NextResponse } from "next/server";
import { generate } from "@pdfme/generator";
import { requireOrganization } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { buildDocumentData } from "@/lib/pdfme/build-document-data";
import { buildTimelineTemplate, buildTimelineInputs } from "@/lib/pdfme/templates/timeline";
import { gearflowPlugins } from "@/lib/pdfme/plugins";
import { getPdfmeFonts } from "@/lib/pdfme/fonts";
import type { TimelineService } from "@/lib/pdfme/templates/timeline";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  try {
    // Build standard document data (project, org, branding, etc.)
    const data = await buildDocumentData(projectId, organizationId, "call-sheet");

    // Fetch services with crew assignments
    const services = await prisma.projectService.findMany({
      where: { organizationId, projectId, status: { not: "CANCELLED" } },
      include: {
        crewAssignments: {
          where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
          select: {
            crewMember: {
              select: { firstName: true, lastName: true },
            },
            status: true,
          },
        },
      },
      orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
    });

    // Map to timeline service shape
    const timelineServices: TimelineService[] = services.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      status: s.status,
      date: s.date ? s.date.toISOString() : null,
      startTime: s.startTime,
      endTime: s.endTime,
      address: s.address,
      notes: s.notes,
      crewAssignments: s.crewAssignments,
      lineTotal: s.lineTotal ? Number(s.lineTotal) : null,
    }));

    const template = buildTimelineTemplate();
    const inputs = buildTimelineInputs(data, timelineServices);

    const pdf = await generate({
      template,
      inputs: [inputs],
      plugins: gearflowPlugins,
      options: { font: getPdfmeFonts() },
    });

    const filename = `Timeline-${data.project_number}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Timeline PDF generation error:", error);
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
