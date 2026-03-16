import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { requireOrganization } from "@/lib/auth-server";
import { CallSheetPDF } from "@/lib/pdf/call-sheet-pdf";
import { getFileAsDataUri } from "@/lib/storage";
import { generatePdf } from "@/lib/pdfme/generate-pdf";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const engine = url.searchParams.get("engine");

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  // pdfme engine: ?engine=pdfme for A/B comparison
  if (engine === "pdfme") {
    try {
      const callSheetDate = dateParam ? new Date(dateParam) : undefined;
      const pdf = await generatePdf(projectId, organizationId, "call-sheet", callSheetDate);
      const filename = `CallSheet-${projectId}.pdf`;
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
        },
      });
    } catch (error) {
      console.error("pdfme call-sheet error:", error);
      return NextResponse.json(
        { error: "pdfme generation failed", details: String(error) },
        { status: 500 }
      );
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      projectNumber: true,
      name: true,
      loadInDate: true,
      loadOutDate: true,
      eventStartDate: true,
      rentalStartDate: true,
      rentalEndDate: true,
      siteContactName: true,
      siteContactPhone: true,
      siteContactEmail: true,
      crewNotes: true,
      location: { select: { name: true, address: true } },
      crewAssignments: {
        where: {
          organizationId,
          status: { notIn: ["CANCELLED", "DECLINED"] },
        },
        include: {
          crewMember: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          crewRole: { select: { name: true } },
          shifts: { orderBy: { date: "asc" } },
        },
        orderBy: [
          { isProjectManager: "desc" },
          { phase: "asc" },
          { crewMember: { lastName: "asc" } },
        ],
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Determine the date for the call sheet
  const callDate = dateParam
    ? new Date(dateParam)
    : project.loadInDate || project.eventStartDate || project.rentalStartDate || new Date();

  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try {
      orgSettings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  const branding = orgSettings.branding as {
    primaryColor?: string;
    accentColor?: string;
    documentColor?: string;
    logoUrl?: string;
    iconUrl?: string;
    documentLogoMode?: "logo" | "icon" | "none";
  } | undefined;

  const [logoData, iconData] = await Promise.all([
    branding?.logoUrl ? getFileAsDataUri(branding.logoUrl) : null,
    branding?.iconUrl ? getFileAsDataUri(branding.iconUrl) : null,
  ]);

  const orgData = {
    name: org?.name || "",
    email: (orgSettings.email as string) || undefined,
    phone: (orgSettings.phone as string) || undefined,
    address: (orgSettings.address as string) || undefined,
    branding,
    logoData,
    iconData,
  };

  // Build crew entries — if a specific date, check shifts for that date
  const crew = project.crewAssignments.map((a) => {
    // Check if there's a shift for this specific date
    const dateStr = new Date(callDate).toISOString().split("T")[0];
    const shift = a.shifts.find((s) => {
      const shiftDate = new Date(s.date).toISOString().split("T")[0];
      return shiftDate === dateStr;
    });

    return {
      name: `${a.crewMember.firstName} ${a.crewMember.lastName}`,
      role: a.crewRole?.name || null,
      phase: a.phase,
      callTime: shift?.callTime || a.startTime || null,
      endTime: shift?.endTime || a.endTime || null,
      phone: a.crewMember.phone || null,
      email: a.crewMember.email || null,
      notes: a.notes || null,
      status: a.status,
    };
  });

  const projectData = {
    projectNumber: project.projectNumber,
    name: project.name,
    date: new Date(callDate).toISOString(),
    location: project.location?.name || null,
    locationAddress: project.location?.address || null,
    siteContactName: project.siteContactName,
    siteContactPhone: project.siteContactPhone,
    siteContactEmail: project.siteContactEmail,
    crewNotes: project.crewNotes,
    crew,
  };

  const doc = <CallSheetPDF org={orgData} project={projectData} />;
  const filename = `CallSheet-${project.projectNumber}-${dateStr(callDate)}.pdf`;

  const buffer = await renderToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

function dateStr(d: Date | string): string {
  return new Date(d).toISOString().split("T")[0];
}
