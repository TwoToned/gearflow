import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientMap } from "@/lib/clients-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getProjectServicesByOrg } from "@/lib/project-services-read";
import { getLocationsByOrg } from "@/lib/locations-read";
import { getModelMap } from "@/lib/models-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import { getMaintenanceRecordsByOrg } from "@/lib/maintenance-read";
import { getMaintenanceAssetLinksByRecordIds } from "@/lib/maintenance-record-asset-read";
import { getCrewMemberMap, getCrewRoleMap } from "@/lib/crew-read";
import {
  getAssignmentsByOrg,
  getShiftsByAssignmentIds,
} from "@/lib/crew-scheduling-read";
import {
  generateVCalendar,
  buildDateTime,
  type ICalEvent,
} from "@/lib/ical";
import { readOrgSettingsBlob, orgIdForIcalToken } from "@/lib/org-settings-read";

const VALID_FEEDS = ["projects", "services", "maintenance", "crew"] as const;
type FeedType = (typeof VALID_FEEDS)[number];

/**
 * Look up organization by iCal token. `icalToken` is a denormalised, indexed
 * lookup key on the Convex `orgSettings` table, SET ONLY while the feed is
 * enabled — so a hit means "valid + live" (no full-table scan). Org name stays
 * on the Better Auth org row (Postgres). Returns null if not found/disabled.
 * Includes the org's configured IANA timezone (default Australia/Sydney).
 */
async function findOrgByToken(token: string) {
  const orgId = await orgIdForIcalToken(token);
  if (!orgId) return null;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) return null;

  const settings = await readOrgSettingsBlob(orgId);
  return {
    id: org.id,
    name: org.name,
    tzid: settings.timezone || "Australia/Sydney",
  };
}

// ─── Feed Builders ──────────────────────────────────────────────────────────

async function buildProjectsFeed(
  orgId: string,
  orgName: string,
  tzid: string
): Promise<string> {
  const [allProjects, allLocations, clientMap] = await Promise.all([
    getProjectsByOrg(orgId),
    getLocationsByOrg(orgId),
    getClientMap(orgId),
  ]);

  const locationMap = new Map(allLocations.map((l) => [l.id, l]));

  const projects = allProjects
    .filter((p) => !p.isTemplate && p.status !== "ENQUIRY" && p.status !== "CANCELLED")
    .sort((a, b) => (b.createdAt as number) - (a.createdAt as number));

  // projectManager is a BetterAuth user — look up names via Prisma.
  const pmIds = [...new Set(projects.map((p) => p.projectManagerId).filter((id): id is string => !!id))];
  const pmUsers = pmIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: pmIds } }, select: { id: true, name: true } })
    : [];
  const pmMap = new Map(pmUsers.map((u) => [u.id, u.name]));

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

    // Convex dates are numbers (ms since epoch) — convert to Date for buildDateTime.
    const dtstart = buildDateTime(new Date(startDate as number), startTime, tzid);
    let dtend = buildDateTime(new Date((endDate || startDate) as number), endTime, tzid);
    // No times anywhere → treat as an all-day event in the org's tz.
    const allDay = !startTime && !endTime;

    // Ensure dtend >= dtstart (can happen when end date/time is missing)
    if (dtend.getTime() < dtstart.getTime()) {
      dtend = new Date(dtstart);
    }

    const loc = p.locationId ? locationMap.get(p.locationId) : null;
    const location = [loc?.name, loc?.address].filter(Boolean).join(", ");

    const descLines = [
      `Project: #${p.projectNumber} - ${p.name}`,
      `Status: ${(p.status ?? "").replace(/_/g, " ")}`,
    ];
    const clientName = p.clientId ? clientMap.get(p.clientId)?.name : null;
    if (clientName) descLines.push(`Client: ${clientName}`);
    const pmName = p.projectManagerId ? pmMap.get(p.projectManagerId) : null;
    if (pmName) descLines.push(`PM: ${pmName}`);
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
      allDay,
      status: icalStatus,
      categories: ["GearFlow", (p.status ?? "").replace(/_/g, " ")],
    });
  }

  return generateVCalendar(`${orgName} — Projects`, events, tzid);
}

async function buildServicesFeed(
  orgId: string,
  orgName: string,
  tzid: string
): Promise<string> {
  // projectService + project are dual-written to Convex. The relational
  // `where` on project (isTemplate / status) can't survive — read the org's
  // services + projects from Convex, resolve each service's project via a map,
  // and replicate the filter in JS: service status != CANCELLED && date != null,
  // project isTemplate === false && status != CANCELLED. Order by date desc.
  const [allServices, allProjects] = await Promise.all([
    getProjectServicesByOrg(orgId),
    getProjectsByOrg(orgId),
  ]);
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const services = allServices
    .flatMap((s) => {
      if (s.status === "CANCELLED" || s.date == null) return [];
      const project = projectMap.get(s.projectId);
      if (!project || project.isTemplate || project.status === "CANCELLED") return [];
      return [{ ...s, project: { name: project.name, projectNumber: project.projectNumber } }];
    })
    .sort((a, b) => (b.date as number) - (a.date as number));

  const events: ICalEvent[] = [];

  for (const s of services) {
    if (s.date == null) continue;

    // Convex stores date/endDate as epoch-ms — convert to Date for buildDateTime.
    const sDate = new Date(s.date);
    const sEndDate = s.endDate != null ? new Date(s.endDate) : null;
    const dtstart = buildDateTime(sDate, s.startTime || s.scheduledTime, tzid);
    const dtend = sEndDate
      ? buildDateTime(sEndDate, s.endTime, tzid)
      : s.endTime
        ? buildDateTime(sDate, s.endTime, tzid)
        : buildDateTime(
            sDate,
            s.startTime ? undefined : s.scheduledTime,
            tzid
          );

    // If dtend <= dtstart (no end info), make it 1 hour
    if (dtend.getTime() <= dtstart.getTime()) {
      dtend.setTime(dtstart.getTime() + 60 * 60 * 1000);
    }

    // status is optional on the Convex doc (Prisma-defaulted "PLANNED").
    const sStatus = s.status ?? "PLANNED";
    const descLines = [
      `Service: ${s.title}`,
      `Type: ${s.type.replace(/_/g, " ")}`,
      `Project: #${s.project.projectNumber} - ${s.project.name}`,
      `Status: ${sStatus.replace(/_/g, " ")}`,
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
      status: sStatus === "CONFIRMED" || sStatus === "IN_PROGRESS"
        ? "CONFIRMED"
        : "TENTATIVE",
      categories: ["GearFlow", s.type.replace(/_/g, " ")],
    });
  }

  return generateVCalendar(`${orgName} — Services`, events, tzid);
}

async function buildMaintenanceFeed(
  orgId: string,
  orgName: string,
  tzid: string
): Promise<string> {
  // maintenanceRecord is Convex-only (Phase C). Read the org's records from
  // Convex, replicate the old `where` (status in [SCHEDULED, IN_PROGRESS],
  // scheduledDate != null) + `orderBy: { scheduledDate: "asc" }` in JS.
  const allRecords = await getMaintenanceRecordsByOrg(orgId);
  const records = allRecords
    .filter(
      (r) =>
        (r.status === "SCHEDULED" || r.status === "IN_PROGRESS") &&
        r.scheduledDate != null,
    )
    .sort((a, b) => (a.scheduledDate!.getTime() - b.scheduledDate!.getTime()));

  // The maintenanceRecordAsset join + assets live in Convex; assignedTo is a
  // Better Auth User (Prisma). Resolve both, plus model names for the labels.
  const recordIds = records.map((r) => r.id);
  const [assetLinks, allAssets, modelMap] = await Promise.all([
    getMaintenanceAssetLinksByRecordIds(recordIds),
    getAssetsByOrg(orgId),
    getModelMap(orgId),
  ]);
  const assetMap = new Map(allAssets.map((a) => [a.id, a]));
  const linksByRecord = new Map<string, typeof assetLinks>();
  for (const l of assetLinks) {
    const arr = linksByRecord.get(l.maintenanceRecordId) ?? [];
    arr.push(l);
    linksByRecord.set(l.maintenanceRecordId, arr);
  }
  const assignedToIds = [
    ...new Set(records.map((r) => r.assignedToId).filter((id): id is string => !!id)),
  ];
  const assignedToUsers = assignedToIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: assignedToIds } }, select: { id: true, name: true } })
    : [];
  const assignedToNameMap = new Map(assignedToUsers.map((u) => [u.id, u.name]));

  const events: ICalEvent[] = [];

  for (const r of records) {
    if (!r.scheduledDate) continue;

    const dtstart = buildDateTime(r.scheduledDate, null, tzid);
    const dtend = new Date(dtstart); // Same day — flagged as all-day below

    const assetNames = (linksByRecord.get(r.id) ?? [])
      .flatMap((l) => {
        const asset = assetMap.get(l.assetId);
        if (!asset) return [];
        const modelName = asset.modelId
          ? modelMap.get(asset.modelId)?.name ?? ""
          : "";
        return [asset.customName || `${modelName} (${asset.assetTag})`];
      })
      .join(", ");

    const descLines = [
      `Maintenance: ${r.title}`,
      `Type: ${r.type.replace(/_/g, " ")}`,
      `Status: ${r.status.replace(/_/g, " ")}`,
    ];
    if (r.description) descLines.push(`Details: ${r.description}`);
    const assignedToName = r.assignedToId ? assignedToNameMap.get(r.assignedToId) : null;
    if (assignedToName) descLines.push(`Assigned To: ${assignedToName}`);
    if (assetNames) descLines.push(`Assets: ${assetNames}`);

    events.push({
      uid: `maintenance-${r.id}@gearflow`,
      summary: `${r.title} — ${r.type.replace(/_/g, " ")}`,
      description: descLines.join("\n"),
      dtstart,
      dtend,
      allDay: true,
      status: r.status === "IN_PROGRESS" ? "CONFIRMED" : "TENTATIVE",
      categories: ["GearFlow", r.type.replace(/_/g, " ")],
    });

    // Add a separate event for nextDueDate if set
    if (r.nextDueDate) {
      const dueStart = buildDateTime(r.nextDueDate, null, tzid);
      const dueEnd = new Date(dueStart);

      events.push({
        uid: `maintenance-due-${r.id}@gearflow`,
        summary: `[Due] ${r.title} — ${r.type.replace(/_/g, " ")}`,
        description: `Next due date for: ${r.title}\n${assetNames ? `Assets: ${assetNames}` : ""}`,
        dtstart: dueStart,
        dtend: dueEnd,
        allDay: true,
        status: "TENTATIVE",
        categories: ["GearFlow", "Maintenance Due"],
      });
    }
  }

  return generateVCalendar(`${orgName} — Maintenance`, events, tzid);
}

async function buildCrewOverviewFeed(
  orgId: string,
  orgName: string,
  tzid: string
): Promise<string> {
  const [allProjects, allLocations, allAssignments, crewMemberMap, crewRoleMap] =
    await Promise.all([
      getProjectsByOrg(orgId),
      getLocationsByOrg(orgId),
      getAssignmentsByOrg(orgId),
      getCrewMemberMap(orgId),
      getCrewRoleMap(orgId),
    ]);

  // Replicates the Prisma `status: { in: ["CONFIRMED", "ACCEPTED"] }` where.
  const assignments = allAssignments.filter(
    (a) => a.status === "CONFIRMED" || a.status === "ACCEPTED",
  );

  // Shifts for those assignments (status != CANCELLED, date asc), from Convex.
  const allShifts = await getShiftsByAssignmentIds(assignments.map((a) => a.id));
  const shiftsByAssignment = new Map<string, typeof allShifts>();
  for (const s of allShifts) {
    if (s.status === "CANCELLED") continue;
    const list = shiftsByAssignment.get(s.assignmentId) ?? [];
    list.push(s);
    shiftsByAssignment.set(s.assignmentId, list);
  }
  for (const list of shiftsByAssignment.values()) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const locationMap = new Map(allLocations.map((l) => [l.id, l]));

  const events: ICalEvent[] = [];

  for (const a of assignments) {
    const member = crewMemberMap.get(a.crewMemberId);
    const crewName = member ? `${member.firstName} ${member.lastName}` : "Crew";
    const roleName = (a.crewRoleId ? crewRoleMap.get(a.crewRoleId)?.name : null) || "Crew";
    const shifts = shiftsByAssignment.get(a.id) ?? [];
    const project = projectMap.get(a.projectId);
    if (!project) continue;
    const loc = project.locationId ? locationMap.get(project.locationId) : null;
    const location = [loc?.name, loc?.address]
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

    if (shifts.length > 0) {
      for (const shift of shifts) {
        const dtstart = buildDateTime(shift.date, shift.callTime, tzid);
        const dtend = shift.endTime
          ? buildDateTime(shift.date, shift.endTime, tzid)
          : buildDateTime(shift.date, "23:59", tzid);

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
      const dtstart = buildDateTime(
        a.startDate || new Date(),
        a.startTime,
        tzid
      );
      let dtend = buildDateTime(
        a.endDate || a.startDate || new Date(),
        a.endTime || a.startTime,
        tzid
      );

      // Ensure dtend >= dtstart
      if (dtend.getTime() <= dtstart.getTime()) {
        dtend = new Date(dtstart);
      }

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

  return generateVCalendar(`${orgName} — Crew Overview`, events, tzid);
}

// ─── Route Handler ──────────────────────────────────────────────────────────

const FEED_BUILDERS: Record<
  FeedType,
  (orgId: string, orgName: string, tzid: string) => Promise<string>
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

  const icsContent = await FEED_BUILDERS[feed](org.id, org.name, org.tzid);

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${feed}.ics"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
