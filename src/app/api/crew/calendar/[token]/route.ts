import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../../convex/_generated/api";
import {
  generateVCalendar,
  buildDateTime,
  type ICalEvent,
} from "@/lib/ical";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
import { getLocationMap } from "@/lib/locations-read";
import { getProjectById } from "@/lib/projects-read";
import { getProjectWindow } from "@/lib/project-window";
import { getCrewRoleMap } from "@/lib/crew-read";
import { getShiftsByAssignmentIds } from "@/lib/crew-scheduling-read";

/** Read the org's configured IANA timezone (default Australia/Sydney). */
async function getOrgTimezone(organizationId: string): Promise<string> {
  const settings = await readOrgSettingsBlob(organizationId);
  return settings.timezone || "Australia/Sydney";
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

  // crew_member is Convex-only — look up by the iCal feed token (service-only;
  // the token IS the auth). The nested assignments / role / project / shifts
  // joins are resolved from Convex below instead of a Prisma `include`.
  const convex = await getConvexClient();
  const memberDoc = await convex.query(api.crewMembers.getByIcalToken, {
    icalToken: cleanToken,
  });

  if (!memberDoc || !(memberDoc.icalEnabled ?? false)) {
    return NextResponse.json(
      { error: "Calendar feed not found or disabled" },
      { status: 404 }
    );
  }

  const organizationId = memberDoc.organizationId;

  // Per-member opt-in (Calendar tab toggle): also emit PENDING/OFFERED
  // assignments as STATUS:TENTATIVE, not just CONFIRMED/ACCEPTED. Absent
  // means "confirmed only" (pre-existing behaviour, every row before this).
  const includeTentative = memberDoc.icalIncludeTentative ?? false;
  const CONFIRMED_STATUSES = new Set(["CONFIRMED", "ACCEPTED"]);
  const TENTATIVE_STATUSES = new Set(["PENDING", "OFFERED"]);

  // The member's CONFIRMED/ACCEPTED assignments (plus PENDING/OFFERED when
  // opted in) come from Convex (org list filtered to this member). crewRole +
  // project resolve from Convex maps; shifts (non-CANCELLED, date asc) come
  // from the by-assignment Convex query.
  const [orgAssignments, roleMap] = await Promise.all([
    convex.query(api.crewAssignments.list, { orgId: organizationId }),
    getCrewRoleMap(organizationId),
  ]);
  const myRawAssignments = orgAssignments.filter(
    (a) =>
      a.crewMemberId === memberDoc.id &&
      a.status != null &&
      (CONFIRMED_STATUSES.has(a.status) ||
        (includeTentative && TENTATIVE_STATUSES.has(a.status))),
  );
  const shiftsAll = await getShiftsByAssignmentIds(myRawAssignments.map((a) => a.id));
  const shiftsByAssignment = new Map<string, typeof shiftsAll>();
  for (const s of shiftsAll) {
    if (s.status === "CANCELLED") continue;
    const arr = shiftsByAssignment.get(s.assignmentId);
    if (arr) arr.push(s);
    else shiftsByAssignment.set(s.assignmentId, [s]);
  }
  for (const arr of shiftsByAssignment.values()) {
    arr.sort((x, y) => x.date.getTime() - y.date.getTime());
  }

  // Resolve each assignment's project (Convex) once, keyed by projectId.
  const projectIds = [...new Set(myRawAssignments.map((a) => a.projectId))];
  const projectEntries = await Promise.all(
    projectIds.map(async (pid) => [pid, await getProjectById(pid)] as const),
  );
  const projectById = new Map(projectEntries);

  // Project-manager projects: a crew member linked to a platform user who is
  // a project manager on a project (`projectManagers` table — added via the
  // Project Managers panel, independent of crew assignments) sees the whole
  // project on their calendar as one all-day event spanning the full project
  // window, even when they have no crew assignment on it at all.
  const pmProjectIds = memberDoc.userId
    ? [
        ...new Set(
          (
            await convex.query(api.projectManagers.listByUserId, {
              userId: memberDoc.userId,
              orgId: organizationId,
            })
          ).map((pm) => pm.projectId),
        ),
      ]
    : [];
  const missingPmProjectIds = pmProjectIds.filter((id) => !projectById.has(id));
  const pmProjectEntries = await Promise.all(
    missingPmProjectIds.map(async (pid) => [pid, await getProjectById(pid)] as const),
  );
  for (const [pid, p] of pmProjectEntries) {
    if (p) projectById.set(pid, p);
  }

  const member = {
    id: memberDoc.id,
    firstName: memberDoc.firstName,
    lastName: memberDoc.lastName,
    organizationId,
    assignments: myRawAssignments.flatMap((a) => {
      const p = projectById.get(a.projectId);
      if (!p) return [];
      return [
        {
          id: a.id,
          tentative: a.status != null && TENTATIVE_STATUSES.has(a.status),
          phase: a.phase ?? null,
          notes: a.notes ?? null,
          startDate: a.startDate != null ? new Date(a.startDate) : null,
          startTime: a.startTime ?? null,
          endDate: a.endDate != null ? new Date(a.endDate) : null,
          endTime: a.endTime ?? null,
          crewRole: a.crewRoleId ? { name: roleMap.get(a.crewRoleId)?.name ?? null } : null,
          project: {
            name: p.name,
            projectNumber: p.projectNumber,
            locationId: p.locationId ?? null,
            siteContactName: p.siteContactName ?? null,
            siteContactPhone: p.siteContactPhone ?? null,
          },
          shifts: shiftsByAssignment.get(a.id) ?? [],
        },
      ];
    }),
  };

  const tzid = await getOrgTimezone(member.organizationId);
  // Location FK was dropped (Phase B); resolve project locations from the Convex
  // mirror (replaces the old nested `project.location` select).
  const locationMap = await getLocationMap(member.organizationId);
  const events: ICalEvent[] = [];
  const calName = `RVLT Flow - ${member.firstName} ${member.lastName}`;

  for (const a of member.assignments) {
    const roleName = a.crewRole?.name || "Crew";
    const project = a.project;
    const projLocation = project.locationId ? locationMap.get(project.locationId) ?? null : null;
    const locationName = projLocation?.name || "";
    const locationAddress = projLocation?.address || "";
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
    if (a.tentative) descLines.push("\n(Not yet confirmed)");

    const summary = a.tentative
      ? `(Tentative) ${project.name} - ${roleName}`
      : `${project.name} - ${roleName}`;
    const icsStatus = a.tentative ? "TENTATIVE" : "CONFIRMED";

    // If there are shifts, create one event per shift
    if (a.shifts.length > 0) {
      for (const shift of a.shifts) {
        const dtstart = buildDateTime(shift.date, shift.callTime, tzid);
        const dtend = shift.endTime
          ? buildDateTime(shift.date, shift.endTime, tzid)
          : buildDateTime(shift.date, "23:59", tzid);

        events.push({
          uid: `shift-${shift.id}@gearflow`,
          summary,
          description: descLines.join("\n"),
          location: shift.location || location,
          dtstart,
          dtend,
          status: icsStatus,
          categories: ["RVLT Flow", a.phase || ""].filter(Boolean),
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
        summary,
        description: descLines.join("\n"),
        location,
        dtstart,
        dtend,
        status: icsStatus,
        categories: ["RVLT Flow", a.phase || ""].filter(Boolean),
      });
    }
  }

  // One all-day event per PM project, spanning the full project window
  // (getProjectWindow — the same "gear committed" window used for
  // availability), regardless of whether this member has a crew assignment
  // on it.
  for (const pid of pmProjectIds) {
    const project = projectById.get(pid);
    if (!project) continue;

    const window = getProjectWindow(project);
    if (window.start == null) continue; // no dates set — nothing to show

    const dtstart = buildDateTime(new Date(window.start), null, tzid);
    const dtend = buildDateTime(new Date(window.end ?? window.start), null, tzid);

    const projLocation = project.locationId ? locationMap.get(project.locationId) ?? null : null;
    const location = [projLocation?.name, projLocation?.address]
      .filter(Boolean)
      .join(", ");

    const descLines = [
      `Project: ${project.projectNumber} - ${project.name}`,
      "Role: Project Manager",
    ];
    if (location) descLines.push(`Location: ${location}`);
    if (project.siteContactName) {
      descLines.push(
        `Site Contact: ${project.siteContactName}${project.siteContactPhone ? ` (${project.siteContactPhone})` : ""}`
      );
    }

    events.push({
      uid: `pm-project-${project.id}@gearflow`,
      summary: `${project.name} (Project Manager)`,
      description: descLines.join("\n"),
      location,
      dtstart,
      dtend,
      allDay: true,
      status: "CONFIRMED",
      categories: ["RVLT Flow", "Project Manager"],
    });
  }

  const icsContent = generateVCalendar(calName, events, tzid);

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${member.firstName}-${member.lastName}.ics"`,
      // Calendar clients (Google/Apple/Outlook) already poll this on their own
      // multi-minute-to-hourly cadence, not on every user action — unlike the
      // other token-feed routes (warehouse display, auditor) this isn't a
      // live status view, so a short cache window is safe and cuts repeated
      // full Convex round-trips (getByIcalToken + assignments/shifts/project
      // resolution) from external pollers hitting the same token back-to-back
      // (R-8.9.3 finding, #862).
      "Cache-Control": "private, max-age=300",
    },
  });
}
