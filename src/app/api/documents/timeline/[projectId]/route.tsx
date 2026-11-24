import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { requirePermission } from "@/lib/org-context";
import { callerSeesCrewPay } from "@/lib/crew-pay-caller";
import { getProjectByIdMapped } from "@/lib/projects-read";
import { getProjectServicesFromConvex } from "@/lib/project-service-read";
import { buildDocumentData } from "@/lib/pdfme/build-document-data";
import {
  buildTimelineInputs,
  DEFAULT_TIMELINE_SETTINGS,
} from "@/lib/pdfme/templates/timeline";
import { renderPdfTemplate } from "@/lib/pdfme/pdf-render";
import type { TimelineService, TimelineSettings } from "@/lib/pdfme/templates/timeline";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);

  try {
    await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The timeline prints a project's services and crew: `project:read` in the
  // caller's org, and the project must be in that org.
  let organizationId: string;
  try {
    ({ organizationId } = await requirePermission("project", "read"));
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const project = await getProjectByIdMapped(projectId, organizationId).catch(() => null);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A service's cost rolls up its crew's pay: `showCost` prints only for a caller
  // who sees crew pay (the ONE rule); for anyone else it is ignored and no cost
  // reaches the template at all (UX Phase 15).
  const payVisible = await callerSeesCrewPay();

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
    showCost: payVisible && parseBool("showCost"),
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
      costTotal: payVisible && s.costTotal ? Number(s.costTotal) : null,
    }));

    const { inputs, template } = buildTimelineInputs(data, timelineServices, settings);

    const pdf = await renderPdfTemplate(template, inputs);

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
