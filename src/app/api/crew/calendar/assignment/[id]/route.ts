import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import {
  generateVCalendar,
  buildDateTime,
  type ICalEvent,
} from "@/lib/ical";
import type { OrgSettings } from "@/server/settings";
import { getLocationById } from "@/lib/locations-read";
import { getCrewMemberMap, getCrewRoleMap } from "@/lib/crew-read";
import { getAssignmentById, getShiftsByAssignmentIds } from "@/lib/crew-scheduling-read";
import { getProjectById } from "@/lib/projects-read";

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

    const assignment = await getAssignmentById(id);
    // Org-scope (replaces the Prisma `where: { id, organizationId }`).
    if (!assignment || assignment.organizationId !== organizationId) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 }
      );
    }

    // crewMember / crewRole / project were Prisma includes; resolve from Convex.
    const [crewMemberMap, crewRoleMap, project, allShifts] = await Promise.all([
      getCrewMemberMap(organizationId),
      getCrewRoleMap(organizationId),
      getProjectById(assignment.projectId),
      getShiftsByAssignmentIds([assignment.id]),
    ]);

    if (!project) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 }
      );
    }

    const member = crewMemberMap.get(assignment.crewMemberId);
    const crew = {
      firstName: member?.firstName ?? "",
      lastName: member?.lastName ?? "",
    };
    const roleName =
      (assignment.crewRoleId ? crewRoleMap.get(assignment.crewRoleId)?.name : null) || "Crew";
    // shifts: status != CANCELLED, date asc (replaces the Prisma include where/orderBy).
    const shifts = allShifts
      .filter((s) => s.status !== "CANCELLED")
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    // Location FK was dropped (Phase B); resolve from the Convex mirror.
    const projLocation = project.locationId ? await getLocationById(project.locationId) : null;
    const locationName = projLocation?.name || "";
    const locationAddress = projLocation?.address || "";
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

    if (shifts.length > 0) {
      for (const shift of shifts) {
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
