import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateVCalendar,
  buildDateTime,
  type ICalEvent,
} from "@/lib/ical";
import type { OrgSettings } from "@/server/settings";

/** Read the org's configured IANA timezone (default Australia/Sydney). */
async function getOrgTimezone(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true },
  });
  if (!org?.metadata) return "Australia/Sydney";
  try {
    const settings = JSON.parse(org.metadata) as OrgSettings;
    return settings.timezone || "Australia/Sydney";
  } catch {
    return "Australia/Sydney";
  }
}

/**
 * GET /api/crew/calendar/[token].ics
 *
 * Public iCal feed for a crew member. No auth required — the token IS the auth.
 * Returns all CONFIRMED assignments as VEVENT entries.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Strip .ics extension if present
  const cleanToken = token.replace(/\.ics$/, "");

  const member = await prisma.crewMember.findUnique({
    where: { icalToken: cleanToken },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      icalEnabled: true,
      organizationId: true,
      assignments: {
        where: {
          status: { in: ["CONFIRMED", "ACCEPTED"] },
        },
        include: {
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
      },
    },
  });

  if (!member || !member.icalEnabled) {
    return NextResponse.json(
      { error: "Calendar feed not found or disabled" },
      { status: 404 }
    );
  }

  const tzid = await getOrgTimezone(member.organizationId);
  const events: ICalEvent[] = [];
  const calName = `GearFlow - ${member.firstName} ${member.lastName}`;

  for (const a of member.assignments) {
    const roleName = a.crewRole?.name || "Crew";
    const project = a.project;
    const locationName = project.location?.name || "";
    const locationAddress = project.location?.address || "";
    const location = [locationName, locationAddress]
      .filter(Boolean)
      .join(", ");

    // Build description lines
    const descLines = [
      `Project: ${project.projectNumber} - ${project.name}`,
      `Role: ${roleName}`,
    ];
    if (a.phase) descLines.push(`Phase: ${a.phase}`);
    if (location) descLines.push(`Location: ${location}`);
    if (project.siteContactName) {
      descLines.push(
        `Site Contact: ${project.siteContactName}${project.siteContactPhone ? ` (${project.siteContactPhone})` : ""}`
      );
    }
    if (a.notes) descLines.push(`\nNotes: ${a.notes}`);

    // If there are shifts, create one event per shift
    if (a.shifts.length > 0) {
      for (const shift of a.shifts) {
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
          status: "CONFIRMED",
          categories: ["GearFlow", a.phase || ""].filter(Boolean),
        });
      }
    } else {
      // No shifts — use assignment dates
      const dtstart = buildDateTime(
        a.startDate || new Date(),
        a.startTime,
        tzid
      );
      const dtend = buildDateTime(
        a.endDate || a.startDate || new Date(),
        a.endTime || a.startTime || "23:59",
        tzid
      );

      events.push({
        uid: `assignment-${a.id}@gearflow`,
        summary: `${project.name} - ${roleName}`,
        description: descLines.join("\n"),
        location,
        dtstart,
        dtend,
        status: "CONFIRMED",
        categories: ["GearFlow", a.phase || ""].filter(Boolean),
      });
    }
  }

  const icsContent = generateVCalendar(calName, events, tzid);

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${member.firstName}-${member.lastName}.ics"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
