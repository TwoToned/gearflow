import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { generate } from "@pdfme/generator";
import { requireOrganization } from "@/lib/auth-server";
import { getProjectServicesFromConvex } from "@/lib/project-service-read";
import { buildDocumentData } from "@/lib/pdfme/build-document-data";
import {
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

    // Fetch services with crew assignments. project_service is Convex-only —
    // read via the helper (which attaches crewRole + crewAssignments and orders
    // by [date asc, sortOrder asc]), then replicate the dropped Prisma filters:
    // skip CANCELLED services and CANCELLED/DECLINED assignments.
    const allServices = await getProjectServicesFromConvex(organizationId, projectId);
    const services = allServices.filter((s) => s.status !== "CANCELLED");

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
      crewAssignments: s.crewAssignments
        .filter((ca) => ca.status !== "CANCELLED" && ca.status !== "DECLINED" && ca.crewMember != null)
        .map((ca) => ({
          crewMember: {
            firstName: ca.crewMember!.firstName,
            lastName: ca.crewMember!.lastName,
          },
          status: ca.status ?? "",
        })),
      lineTotal: s.lineTotal ? Number(s.lineTotal) : null,
      costTotal: s.costTotal ? Number(s.costTotal) : null,
    }));

    const { inputs, template } = buildTimelineInputs(data, timelineServices, settings);

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
    logger.error("Timeline PDF generation error", { error: error });
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
