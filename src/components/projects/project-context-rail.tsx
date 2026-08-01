"use client";

import Link from "next/link";
import { CalendarDays, MapPin, Navigation, Phone, Mail } from "lucide-react";

import { SidebarSection } from "@/components/layout/page-layouts";
import { ProjectManagersPanel } from "@/components/projects/project-managers-panel";
import { ProjectActivityFeed } from "@/components/collaboration/activity-feed";
import { formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";

/**
 * The shape this rail reads off the project detail. Deliberately structural
 * rather than `Doc<"projects">` — the detail query returns a serialized,
 * relation-expanded row (dates as strings, `location`/`client` joined), which
 * is not the Convex document type.
 */
export interface ProjectContextRailProject {
  isTemplate?: boolean | null;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  projectStartTime?: string | null;
  projectEndTime?: string | null;
  loadInDate?: string | null;
  loadOutDate?: string | null;
  loadInTime?: string | null;
  loadOutTime?: string | null;
  location?: {
    name: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  siteContactEmail?: string | null;
  client?: { id: string; name: string } | null;
  projectManagers?: {
    userId: string;
    user: { id: string; name: string | null; email: string; image: string | null };
  }[];
}

function ScheduleSection({ project }: { project: ProjectContextRailProject }) {
  // WS2 (#941) — the PROJECT window rows render only when set (no stack of "—"
  // placeholders); loadIn/loadOut are the deprecated fallback for a project the
  // backfill hasn't reached yet. If nothing is set at all, show one faint line.
  const scheduleRows = [
    {
      label: "Project starts",
      date: project.projectStartDate ?? project.loadInDate,
      time: project.projectStartTime ?? project.loadInTime,
    },
    {
      label: "Project ends",
      date: project.projectEndDate ?? project.loadOutDate,
      time: project.projectEndTime ?? project.loadOutTime,
    },
  ].filter((r) => r.date != null);

  return (
    <SidebarSection title="Schedule">
      <div className="space-y-1 text-ui-text">
        <div className="flex justify-between gap-2">
          <span className="text-muted flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            Rental
          </span>
          <span className="font-medium text-ink-2 tabular-nums text-right">
            {formatDate(project.rentalStartDate ?? null)} &ndash; {formatDate(project.rentalEndDate ?? null)}
          </span>
        </div>
        {scheduleRows.length === 0 ? (
          <p className="text-caption text-faint">No project window set — same as rental</p>
        ) : (
          scheduleRows.map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <span className="text-muted">{r.label}</span>
              <span className="font-medium text-ink-2 tabular-nums text-right">
                {formatDate(r.date ?? null)}
                {r.time ? ` ${r.time}` : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </SidebarSection>
  );
}

function SiteContact({ project }: { project: ProjectContextRailProject }) {
  if (!project.siteContactName) return null;
  return (
    <div className="mt-2 pt-2 border-t border-line">
      <p className="font-medium text-ink-2">{project.siteContactName}</p>
      {project.siteContactPhone && (
        <div className="flex items-center gap-2 text-muted">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          <span>{project.siteContactPhone}</span>
        </div>
      )}
      {project.siteContactEmail && (
        <div className="flex items-center gap-2 text-muted">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span>{project.siteContactEmail}</span>
        </div>
      )}
    </div>
  );
}

function LocationSection({ project }: { project: ProjectContextRailProject }) {
  const loc = project.location;
  const hasCoords = loc?.latitude != null && loc?.longitude != null;
  return (
    <SidebarSection title="Location">
      <div className="space-y-1 text-ui-text">
        {loc ? (
          <>
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
              <span className="font-medium text-ink-2">{loc.name}</span>
            </div>
            {loc.address && <p className="text-muted pl-5.5">{loc.address}</p>}
            {hasCoords && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1.5 text-caption text-link hover:underline pl-5.5 rounded-sm",
                  focusRing,
                )}
              >
                <Navigation className="h-3 w-3" />
                Get directions
              </a>
            )}
          </>
        ) : (
          <p className="text-caption text-faint">No location set</p>
        )}
        <SiteContact project={project} />
      </div>
    </SidebarSection>
  );
}

/**
 * Schedule · Location · Team · Activity — the project's standing context
 * (#1061).
 *
 * This was the project detail's page-wide right sidebar, rendered alongside
 * EVERY tab. It now lives only in the Overview tab: on the home tab this
 * content IS the point, and on the Equipment tab it was a ~296px tax on the
 * one table that most needs the width. Extracted to its own component so the
 * move is a re-home rather than a rewrite — every section renders exactly what
 * it rendered in the sidebar.
 */
export function ProjectContextRail({
  projectId,
  orgId,
  project,
}: {
  projectId: string;
  orgId: string | undefined;
  project: ProjectContextRailProject;
}) {
  return (
    <>
      {!project.isTemplate && <ScheduleSection project={project} />}
      <LocationSection project={project} />

      {/* Team — client + project managers (drop the nested PM panel's
          own divider so only the section rule shows) */}
      <SidebarSection title="Team" className="[&_>div:last-child]:border-b-0 [&_>div:last-child]:pb-0">
        {project.client ? (
          <Link
            href={`/clients/${project.client.id}`}
            className={cn("font-medium text-ink hover:text-link hover:underline rounded-sm text-ui-text", focusRing)}
          >
            {project.client.name}
          </Link>
        ) : (
          <p className="text-caption text-faint">No client</p>
        )}
        <ProjectManagersPanel projectId={projectId} managers={project.projectManagers ?? []} />
      </SidebarSection>

      {/* Activity — realtime collaboration feed */}
      {orgId && !project.isTemplate && (
        <SidebarSection title="Activity" divider={false}>
          <ProjectActivityFeed
            orgId={orgId}
            entityType="project"
            entityId={projectId}
            limit={20}
            emptyText="No collaboration activity yet."
          />
        </SidebarSection>
      )}
    </>
  );
}
