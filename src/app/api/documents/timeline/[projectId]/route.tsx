import { NextRequest, NextResponse } from "next/server";
import { generate } from "@pdfme/generator";
import { requireOrganization } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { buildDocumentData } from "@/lib/pdfme/build-document-data";
import {
  buildTimelineTemplate,
  buildTimelineInputs,
  DEFAULT_TIMELINE_SETTINGS,
} from "@/lib/pdfme/templates/timeline";
import { gearflowPlugins } from "@/lib/pdfme/plugins";
import { getPdfmeFonts } from "@/lib/pdfme/fonts";
import type { TimelineService, TimelineSettings } from "@/lib/pdfme/templates/timeline";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  // Parse settings from query params (all default to DEFAULT_TIMELINE_SETTINGS)
  const parseBool = (key: keyof TimelineSettings): boolean => {
    const val = url.searchParams.get(key);
    if (val === null) return DEFAULT_TIMELINE_SETTINGS[key];
    return val === "true";
  };

  const settings: TimelineSettings = {
    showCrew: parseBool("showCrew"),
    showLocation: parseBool("showLocation"),
    showNotes: parseBool("showNotes"),
    showCharge: parseBool("showCharge"),
    showCost: parseBool("showCost"),
    showStatus: parseBool("showStatus"),
  };

  try {
    // Build standard document data (project, org, branding, etc.)
    const data = await buildDocumentData(projectId, organizationId, "quote");

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
      costTotal: s.costTotal ? Number(s.costTotal) : null,
    }));

    const inputs = buildTimelineInputs(data, timelineServices, settings);
    const template = buildTimelineTemplate(inputs.length);

    const pdf = await generate({
      template,
      inputs,
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
