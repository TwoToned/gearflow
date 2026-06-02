import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import {
  generateVCalendar,
  buildDateTime,
  type ICalEvent,
} from "@/lib/ical";
import type { OrgSettings } from "@/server/settings";

/**
 * GET /api/crew/calendar/assignment/[id]
 *
 * Download a single .ics file for one crew assignment.
 * Requires authentication (session-based via getOrgContext).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizationId } = await getOrgContext();
    const { id } = await params;

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { metadata: true },
    });
    let tzid = "Australia/Sydney";
    if (org?.metadata) {
      try {
        const settings = JSON.parse(org.metadata) as OrgSettings;
        tzid = settings.timezone || "Australia/Sydney";
      } catch {
        // ignore
      }
    }

    const assignment = await prisma.crewAssignment.findUnique({
      where: { id, organizationId },
      include: {
        crewMember: { select: { firstName: true, lastName: true } },
        crewRole: { select: { name: true } },
        project: {
          select: {
            name: true,
            projectNumber: true,
            location: { select: { name: true, address: true } },
            siteContactName: true,
            siteContactPhone: true,
          },
        },
        shifts: {
          where: { status: { not: "CANCELLED" } },
          orderBy: { date: "asc" },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 }
      );
    }

    const roleName = assignment.crewRole?.name || "Crew";
    const project = assignment.project;
    const crew = assignment.crewMember;
    const locationName = project.location?.name || "";
    const locationAddress = project.location?.address || "";
    const location = [locationName, locationAddress]
      .filter(Boolean)
      .join(", ");

    const descLines = [
      `Project: ${project.projectNumber} - ${project.name}`,
      `Role: ${roleName}`,
      `Crew: ${crew.firstName} ${crew.lastName}`,
    ];
    if (assignment.phase) descLines.push(`Phase: ${assignment.phase}`);
    if (location) descLines.push(`Location: ${location}`);
    if (project.siteContactName) {
      descLines.push(
        `Site Contact: ${project.siteContactName}${project.siteContactPhone ? ` (${project.siteContactPhone})` : ""}`
      );
    }
    if (assignment.notes) descLines.push(`\nNotes: ${assignment.notes}`);

    const events: ICalEvent[] = [];
    const calName = `${project.name} - ${crew.firstName} ${crew.lastName}`;

    if (assignment.shifts.length > 0) {
      for (const shift of assignment.shifts) {
        const dtstart = buildDateTime(shift.date, shift.callTime, tzid);
        const dtend = shift.endTime
          ? buildDateTime(shift.date, shift.endTime, tzid)
          : buildDateTime(shift.date, "23:59", tzid);

        events.push({
          uid: `shift-${shift.id}@gearflow`,
          summary: `${project.name} - ${roleName}`,
          description: descLines.join("\n"),
          location: shift.location || location,
          dtstart,
          dtend,
          status:
            assignment.status === "CONFIRMED"
              ? "CONFIRMED"
              : "TENTATIVE",
          categories: ["GearFlow", assignment.phase || ""].filter(Boolean),
        });
      }
    } else {
      const dtstart = buildDateTime(
        assignment.startDate || new Date(),
        assignment.startTime,
        tzid
      );
      const dtend = buildDateTime(
        assignment.endDate || assignment.startDate || new Date(),
        assignment.endTime || assignment.startTime || "23:59",
        tzid
      );

      events.push({
        uid: `assignment-${assignment.id}@gearflow`,
        summary: `${project.name} - ${roleName}`,
        description: descLines.join("\n"),
        location,
        dtstart,
        dtend,
        status:
          assignment.status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE",
        categories: ["GearFlow", assignment.phase || ""].filter(Boolean),
      });
    }

    const icsContent = generateVCalendar(calName, events, tzid);
    const filename = `${project.projectNumber}-${crew.firstName}-${crew.lastName}.ics`;

    return new NextResponse(icsContent, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
