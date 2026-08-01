"use client";

import Link from "next/link";
import { Navigation, Phone, Mail } from "lucide-react";

import { ProjectManagersPanel } from "@/components/projects/project-managers-panel";
import { ProjectActivityFeed } from "@/components/collaboration/activity-feed";
import { Panel } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import {
  projectScheduleRows,
  directionsHref,
  type ProjectContextProject,
} from "@/lib/project-context";
import { OverviewCardHeader, OverviewMetaList } from "./card-parts";

/**
 * Schedule · Location · Team · Activity, in the Overview tab's own card
 * language (#1063).
 *
 * Every other tab shows this content in the page sidebar
 * (`project-context-rail.tsx`). On Overview it is not context ALONGSIDE the
 * page — it IS part of the page, so it wears the same Panel-with-header
 * treatment as Readiness, Quote and Money rather than arriving as a visually
 * separate rail bolted to the side.
 *
 * Only the presentation differs: which schedule rows exist and whether there
 * are directions come from `@/lib/project-context`, shared with the sidebar,
 * so the two renderings can't disagree about the facts (R-3.1).
 */

export function OverviewScheduleCard({ project }: { project: ProjectContextProject }) {
  const rows = projectScheduleRows(project);
  return (
    <Panel className="p-0">
      <OverviewCardHeader title="Schedule" />
      <div className="px-4 py-3.5">
        <OverviewMetaList
          rows={[
            {
              label: "Rental",
              value: `${formatDate(project.rentalStartDate ?? null)} – ${formatDate(project.rentalEndDate ?? null)}`,
            },
            ...rows.map((r) => ({
              label: r.label,
              value: `${formatDate(r.date ?? null)}${r.time ? ` ${r.time}` : ""}`,
            })),
          ]}
        />
        {rows.length === 0 && (
          <p className="mt-2 text-caption text-faint">No project window set — same as the rental dates.</p>
        )}
      </div>
    </Panel>
  );
}

function SiteContact({ project }: { project: ProjectContextProject }) {
  if (!project.siteContactName) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-ui-text font-semibold text-ink">{project.siteContactName}</p>
      {project.siteContactPhone && (
        <p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
          <Phone className="size-3 shrink-0" />
          <span className="tabular-nums">{project.siteContactPhone}</span>
        </p>
      )}
      {project.siteContactEmail && (
        <p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
          <Mail className="size-3 shrink-0" />
          <span className="truncate">{project.siteContactEmail}</span>
        </p>
      )}
    </div>
  );
}

export function OverviewLocationCard({ project }: { project: ProjectContextProject }) {
  const loc = project.location;
  const directions = directionsHref(project);
  return (
    <Panel className="p-0">
      <OverviewCardHeader title="Location" />
      <div className="px-4 py-3.5">
        {loc ? (
          <>
            <p className="text-ui-text font-semibold text-ink">{loc.name}</p>
            {loc.address && <p className="mt-0.5 text-caption text-muted">{loc.address}</p>}
            {directions && (
              <a
                href={directions}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-2 inline-flex items-center gap-1.5 rounded-sm text-caption text-link hover:underline",
                  focusRing,
                )}
              >
                <Navigation className="size-3" />
                Get directions
              </a>
            )}
          </>
        ) : (
          <p className="text-caption text-faint">No location set</p>
        )}
        <SiteContact project={project} />
      </div>
    </Panel>
  );
}

export function OverviewTeamCard({
  projectId,
  project,
}: {
  projectId: string;
  project: ProjectContextProject;
}) {
  return (
    <Panel className="p-0">
      <OverviewCardHeader title="Team" />
      <div className="px-4 py-3.5">
        {project.client ? (
          <Link
            href={`/clients/${project.client.id}`}
            className={cn("text-ui-text font-semibold text-ink hover:text-link hover:underline rounded-sm", focusRing)}
          >
            {project.client.name}
          </Link>
        ) : (
          <p className="text-caption text-faint">No client</p>
        )}
        {/* Drop the panel's own trailing divider — the card border already
            closes the section. */}
        <div className="[&_>div:last-child]:border-b-0 [&_>div:last-child]:pb-0">
          <ProjectManagersPanel projectId={projectId} managers={project.projectManagers ?? []} />
        </div>
      </div>
    </Panel>
  );
}

export function OverviewActivityCard({ projectId, orgId }: { projectId: string; orgId: string }) {
  return (
    <Panel className="p-0">
      <OverviewCardHeader title="Activity" />
      <div className="px-4 py-3.5">
        <ProjectActivityFeed
          orgId={orgId}
          entityType="project"
          entityId={projectId}
          limit={20}
          emptyText="No collaboration activity yet."
        />
      </div>
    </Panel>
  );
}
