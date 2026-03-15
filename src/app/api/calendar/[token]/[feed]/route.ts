import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateVCalendar,
  buildDateTime,
  type ICalEvent,
} from "@/lib/ical";
import type { OrgSettings } from "@/server/settings";

const VALID_FEEDS = ["projects", "services", "maintenance", "crew"] as const;
type FeedType = (typeof VALID_FEEDS)[number];

/**
 * Look up organization by iCal token stored in metadata JSON.
 * Returns null if not found or feed is disabled.
 */
async function findOrgByToken(token: string) {
  // icalToken is stored in Organization.metadata JSON — query all orgs with metadata containing the token
  const orgs = await prisma.organization.findMany({
    where: {
      metadata: { contains: token },
    },
    select: { id: true, name: true, metadata: true },
  });

  for (const org of orgs) {
    if (!org.metadata) continue;
    try {
      const settings = JSON.parse(org.metadata) as OrgSettings;
      if (settings.icalToken === token && settings.icalEnabled) {
        return { id: org.id, name: org.name };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Feed Builders ──────────────────────────────────────────────────────────

async function buildProjectsFeed(
  orgId: string,
  orgName: string
): Promise<string> {
  const projects = await prisma.project.findMany({
    where: {
      organizationId: orgId,
      isTemplate: false,
      status: { notIn: ["ENQUIRY", "CANCELLED"] },
    },
    include: {
      client: { select: { name: true } },
      location: { select: { name: true, address: true } },
      projectManager: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const events: ICalEvent[] = [];

  for (const p of projects) {
    // Determine event span: loadIn→loadOut > rental > event dates
    const startDate = p.loadInDate || p.rentalStartDate || p.eventStartDate;
    const endDate = p.loadOutDate || p.rentalEndDate || p.eventEndDate;

    if (!startDate) continue; // Skip projects with no dates

    const startTime = p.loadInDate
      ? p.loadInTime
      : p.rentalStartDate
        ? null
        : p.eventStartTime;
    const endTime = p.loadOutDate
      ? p.loadOutTime
      : p.rentalEndDate
        ? null
        : p.eventEndTime;

    const dtstart = buildDateTime(startDate, startTime);
    const dtend = buildDateTime(endDate || startDate, endTime);

    const location = [p.location?.name, p.location?.address]
      .filter(Boolean)
      .join(", ");

    const descLines = [
      `Project: #${p.projectNumber} - ${p.name}`,
      `Status: ${p.status.replace(/_/g, " ")}`,
    ];
    if (p.client?.name) descLines.push(`Client: ${p.client.name}`);
    if (p.projectManager?.name)
      descLines.push(`PM: ${p.projectManager.name}`);
    if (location) descLines.push(`Location: ${location}`);
    if (p.siteContactName) {
      descLines.push(
        `Site Contact: ${p.siteContactName}${p.siteContactPhone ? ` (${p.siteContactPhone})` : ""}`
      );
    }

    // Map status to iCal status
    const icalStatus =
      p.status === "QUOTING" || p.status === "QUOTED"
        ? ("TENTATIVE" as const)
        : ("CONFIRMED" as const);

    events.push({
      uid: `project-${p.id}@gearflow`,
      summary: `#${p.projectNumber} — ${p.name}`,
      description: descLines.join("\n"),
      location: location || undefined,
      dtstart,
      dtend,
      status: icalStatus,
      categories: ["GearFlow", p.status.replace(/_/g, " ")],
    });
  }

  return generateVCalendar(`${orgName} — Projects`, events);
}

async function buildServicesFeed(
  orgId: string,
  orgName: string
): Promise<string> {
  const services = await prisma.projectService.findMany({
    where: {
      organizationId: orgId,
      status: { not: "CANCELLED" },
      date: { not: null },
      project: {
        isTemplate: false,
        status: { not: "CANCELLED" },
      },
    },
    include: {
      project: {
        select: { name: true, projectNumber: true },
      },
    },
    orderBy: { date: "desc" },
  });

  const events: ICalEvent[] = [];

  for (const s of services) {
    if (!s.date) continue;

    const dtstart = buildDateTime(s.date, s.startTime || s.scheduledTime);
    const dtend = s.endDate
      ? buildDateTime(s.endDate, s.endTime)
      : s.endTime
        ? buildDateTime(s.date, s.endTime)
        : buildDateTime(s.date, s.startTime ? undefined : s.scheduledTime);

    // If dtend <= dtstart (no end info), make it 1 hour
    if (dtend.getTime() <= dtstart.getTime()) {
      dtend.setTime(dtstart.getTime() + 60 * 60 * 1000);
    }

    const descLines = [
      `Service: ${s.title}`,
      `Type: ${s.type.replace(/_/g, " ")}`,
      `Project: #${s.project.projectNumber} - ${s.project.name}`,
      `Status: ${s.status.replace(/_/g, " ")}`,
    ];
    if (s.notes) descLines.push(`Notes: ${s.notes}`);
    if (s.crewCountRequired)
      descLines.push(`Crew Required: ${s.crewCountRequired}`);

    events.push({
      uid: `service-${s.id}@gearflow`,
      summary: `${s.title} — ${s.project.name}`,
      description: descLines.join("\n"),
      location: s.address || undefined,
      dtstart,
      dtend,
      status: s.status === "CONFIRMED" || s.status === "IN_PROGRESS"
        ? "CONFIRMED"
        : "TENTATIVE",
      categories: ["GearFlow", s.type.replace(/_/g, " ")],
    });
  }

  return generateVCalendar(`${orgName} — Services`, events);
}

async function buildMaintenanceFeed(
  orgId: string,
  orgName: string
): Promise<string> {
  const records = await prisma.maintenanceRecord.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledDate: { not: null },
    },
    include: {
      assignedTo: { select: { name: true } },
      assets: {
        include: {
          asset: {
            select: {
              assetTag: true,
              customName: true,
              model: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { scheduledDate: "asc" },
  });

  const events: ICalEvent[] = [];

  for (const r of records) {
    if (!r.scheduledDate) continue;

    const dtstart = buildDateTime(r.scheduledDate);
    const dtend = new Date(dtstart);
    dtend.setHours(23, 59, 0, 0);

    const assetNames = r.assets
      .map(
        (a) =>
          a.asset.customName || `${a.asset.model.name} (${a.asset.assetTag})`
      )
      .join(", ");

    const descLines = [
      `Maintenance: ${r.title}`,
      `Type: ${r.type.replace(/_/g, " ")}`,
      `Status: ${r.status.replace(/_/g, " ")}`,
    ];
    if (r.description) descLines.push(`Details: ${r.description}`);
    if (r.assignedTo?.name) descLines.push(`Assigned To: ${r.assignedTo.name}`);
    if (assetNames) descLines.push(`Assets: ${assetNames}`);

    events.push({
      uid: `maintenance-${r.id}@gearflow`,
      summary: `${r.title} — ${r.type.replace(/_/g, " ")}`,
      description: descLines.join("\n"),
      dtstart,
      dtend,
      status: r.status === "IN_PROGRESS" ? "CONFIRMED" : "TENTATIVE",
      categories: ["GearFlow", r.type.replace(/_/g, " ")],
    });

    // Add a separate event for nextDueDate if set
    if (r.nextDueDate) {
      const dueStart = buildDateTime(r.nextDueDate);
      const dueEnd = new Date(dueStart);
      dueEnd.setHours(23, 59, 0, 0);

      events.push({
        uid: `maintenance-due-${r.id}@gearflow`,
        summary: `[Due] ${r.title} — ${r.type.replace(/_/g, " ")}`,
        description: `Next due date for: ${r.title}\n${assetNames ? `Assets: ${assetNames}` : ""}`,
        dtstart: dueStart,
        dtend: dueEnd,
        status: "TENTATIVE",
        categories: ["GearFlow", "Maintenance Due"],
      });
    }
  }

  return generateVCalendar(`${orgName} — Maintenance`, events);
}

async function buildCrewOverviewFeed(
  orgId: string,
  orgName: string
): Promise<string> {
  const assignments = await prisma.crewAssignment.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["CONFIRMED", "ACCEPTED"] },
    },
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

  const events: ICalEvent[] = [];

  for (const a of assignments) {
    const crewName = `${a.crewMember.firstName} ${a.crewMember.lastName}`;
    const roleName = a.crewRole?.name || "Crew";
    const project = a.project;
    const location = [project.location?.name, project.location?.address]
      .filter(Boolean)
      .join(", ");

    const descLines = [
      `Crew: ${crewName}`,
      `Project: #${project.projectNumber} - ${project.name}`,
      `Role: ${roleName}`,
    ];
    if (a.phase) descLines.push(`Phase: ${a.phase}`);
    if (location) descLines.push(`Location: ${location}`);
    if (project.siteContactName) {
      descLines.push(
        `Site Contact: ${project.siteContactName}${project.siteContactPhone ? ` (${project.siteContactPhone})` : ""}`
      );
    }
    if (a.notes) descLines.push(`Notes: ${a.notes}`);

    if (a.shifts.length > 0) {
      for (const shift of a.shifts) {
        const dtstart = buildDateTime(shift.date, shift.callTime);
        const dtend = shift.endTime
          ? buildDateTime(shift.date, shift.endTime)
          : buildDateTime(shift.date, "23:59");

        events.push({
          uid: `crew-shift-${shift.id}@gearflow`,
          summary: `${crewName} — ${project.name} (${roleName})`,
          description: descLines.join("\n"),
          location: shift.location || location || undefined,
          dtstart,
          dtend,
          status: "CONFIRMED",
          categories: ["GearFlow", a.phase || ""].filter(Boolean),
        });
      }
    } else {
      const dtstart = buildDateTime(a.startDate || new Date(), a.startTime);
      const dtend = buildDateTime(
        a.endDate || a.startDate || new Date(),
        a.endTime || a.startTime || "23:59"
      );

      events.push({
        uid: `crew-assignment-${a.id}@gearflow`,
        summary: `${crewName} — ${project.name} (${roleName})`,
        description: descLines.join("\n"),
        location: location || undefined,
        dtstart,
        dtend,
        status: "CONFIRMED",
        categories: ["GearFlow", a.phase || ""].filter(Boolean),
      });
    }
  }

  return generateVCalendar(`${orgName} — Crew Overview`, events);
}

// ─── Route Handler ──────────────────────────────────────────────────────────

const FEED_BUILDERS: Record<
  FeedType,
  (orgId: string, orgName: string) => Promise<string>
> = {
  projects: buildProjectsFeed,
  services: buildServicesFeed,
  maintenance: buildMaintenanceFeed,
  crew: buildCrewOverviewFeed,
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; feed: string }> }
) {
  const { token, feed: rawFeed } = await params;

  // Strip .ics extension if present
  const cleanToken = token.replace(/\.ics$/, "");
  const feed = rawFeed.replace(/\.ics$/, "") as FeedType;

  if (!VALID_FEEDS.includes(feed)) {
    return NextResponse.json(
      { error: "Invalid feed. Valid feeds: projects, services, maintenance, crew" },
      { status: 400 }
    );
  }

  const org = await findOrgByToken(cleanToken);
  if (!org) {
    return NextResponse.json(
      { error: "Calendar feed not found or disabled" },
      { status: 404 }
    );
  }

  const icsContent = await FEED_BUILDERS[feed](org.id, org.name);

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${feed}.ics"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
