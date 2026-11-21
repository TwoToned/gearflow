"use client";
// use-client: interactive — Convex subscriptions + the PM editor toggle (R-8.1.1)

import * as React from "react";
import Link from "next/link";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useNavItems } from "@/hooks/use-nav-items";
import { api } from "../../../../convex/_generated/api";
import { ProjectManagersPanel } from "@/components/projects/project-managers-panel";
import { formatDate } from "@/lib/formatters";
import { timeAgo } from "@/lib/collaboration-colors";
import { rentalDatesLabel } from "@/lib/job-header";
import { projectScheduleRows, directionsHref, type ProjectContextProject } from "@/lib/project-context";
import { OverviewLabel, OverviewLine, OverviewLinks, OverviewTextButton, OverviewTextLink } from "./overview-parts";

/**
 * When · Where · Who, then Recent — the Overview's facts columns (spec §6b,
 * UX Phase 7; were the #1063 Schedule/Location/Team/Activity cards).
 *
 * Every other tab shows the same facts in the page sidebar
 * (`project-context-rail.tsx`); which schedule rows exist and whether there
 * are directions come from `@/lib/project-context`, shared with the rail, so
 * the two renderings can't disagree about the facts (R-3.1). `Edit dates` and
 * Where's `Edit` go to the job edit page until Phase 9's sheets.
 */

const editHref = (projectId: string) => `/projects/${projectId}/edit`;

function scheduleLine(project: ProjectContextProject): string | null {
  const rows = projectScheduleRows(project);
  if (rows.length === 0) return null;
  return rows.map((r) => `${r.label} ${formatDate(r.date ?? null)}${r.time ? ` ${r.time}` : ""}`).join(" · ");
}

export function OverviewWhen({ projectId, project, onOpenLogistics }: { projectId: string; project: ProjectContextProject; onOpenLogistics: () => void }) {
  const rental = rentalDatesLabel(project.rentalStartDate, project.rentalEndDate);
  const jobWindow = scheduleLine(project);
  return (
    <div className="min-w-0">
      <OverviewLabel>When</OverviewLabel>
      {rental ? (
        <OverviewLine>
          Rental <b className="font-semibold">{rental}</b>
        </OverviewLine>
      ) : (
        <OverviewLine muted>No rental dates set</OverviewLine>
      )}
      <OverviewLine muted>{jobWindow ?? "No job window — same as the rental dates"}</OverviewLine>
      <OverviewLinks>
        <OverviewTextLink href={editHref(projectId)}>Edit dates</OverviewTextLink>
        <OverviewTextButton onClick={onOpenLogistics}>Logistics ›</OverviewTextButton>
      </OverviewLinks>
    </div>
  );
}

export function OverviewWhere({ projectId, project }: { projectId: string; project: ProjectContextProject }) {
  const loc = project.location;
  const directions = directionsHref(project);
  return (
    <div className="min-w-0">
      <OverviewLabel>Where</OverviewLabel>
      {loc ? (
        <>
          <OverviewLine>
            <b className="font-semibold">{loc.name}</b>
          </OverviewLine>
          {loc.address || directions ? (
            <OverviewLine muted>
              {loc.address}
              {loc.address && directions ? " · " : null}
              {directions ? (
                <OverviewTextLink href={directions} target="_blank" rel="noopener noreferrer">
                  directions
                </OverviewTextLink>
              ) : null}
            </OverviewLine>
          ) : null}
        </>
      ) : (
        <OverviewLine muted>No location set</OverviewLine>
      )}
      <OverviewLinks>
        <OverviewTextLink href={editHref(projectId)}>Edit</OverviewTextLink>
      </OverviewLinks>
    </div>
  );
}

/** Crew count from the readiness read the page already holds (same args → one subscription). */
function useCrewCounts(projectId: string, orgId: string | undefined, enabled: boolean) {
  const readiness = useAuthedQuery(api.projectReadiness.forProject, orgId && enabled ? { orgId, projectId } : "skip");
  return readiness ? { total: readiness.crew.activeCount, unconfirmed: readiness.crew.unconfirmedCount } : null;
}

function SiteContactLine({ project }: { project: ProjectContextProject }) {
  if (!project.siteContactName) return <OverviewLine muted>No site contact</OverviewLine>;
  return (
    <>
      <OverviewLine>
        <b className="font-semibold">{project.siteContactName}</b>
        {project.siteContactPhone ? (
          <span className="text-muted">
            {" "}· <a className="tap-area font-mono tabular-nums hover:underline" href={`tel:${project.siteContactPhone}`}>{project.siteContactPhone}</a>
          </span>
        ) : null}
      </OverviewLine>
      {project.siteContactEmail ? (
        <OverviewLine muted className="truncate">
          <a className="tap-area hover:underline" href={`mailto:${project.siteContactEmail}`}>{project.siteContactEmail}</a>
        </OverviewLine>
      ) : null}
    </>
  );
}

function CrewLine({ crew, onOpenLogistics }: { crew: { total: number; unconfirmed: number } | null; onOpenLogistics: () => void }) {
  if (!crew) return null;
  const state = crew.total === 0 ? "none assigned" : crew.unconfirmed > 0 ? null : "all confirmed";
  return (
    <OverviewLine muted>
      Crew {crew.total}
      {state ? ` · ${state}` : null}
      {crew.unconfirmed > 0 ? <span className="text-warn"> · {crew.unconfirmed} unconfirmed</span> : null} ·{" "}
      <OverviewTextButton onClick={onOpenLogistics}>Logistics ›</OverviewTextButton>
    </OverviewLine>
  );
}

export function OverviewWho({
  projectId,
  orgId,
  project,
  onOpenLogistics,
}: {
  projectId: string;
  orgId: string | undefined;
  project: ProjectContextProject;
  onOpenLogistics: () => void;
}) {
  const [editingPms, setEditingPms] = React.useState(false);
  const crew = useCrewCounts(projectId, orgId, !project.isTemplate);
  const pms = (project.projectManagers ?? []).map((pm) => pm.user.name ?? pm.user.email);
  return (
    <div className="min-w-0">
      <OverviewLabel>Who</OverviewLabel>
      <SiteContactLine project={project} />
      <OverviewLine muted>
        {project.client ? (
          <Link href={`/clients/${project.client.id}`} className="text-ink-2 hover:underline">
            {project.client.name}
          </Link>
        ) : (
          "No client"
        )}
      </OverviewLine>
      <OverviewLine muted>
        PM {pms.length ? pms.join(", ") : "none"}{" "}
        <OverviewTextButton aria-expanded={editingPms} onClick={() => setEditingPms((e) => !e)} aria-label="Edit job managers">
          {editingPms ? "Done" : "+"}
        </OverviewTextButton>
      </OverviewLine>
      {editingPms ? (
        <div className="mt-2 [&_>div:last-child]:border-b-0 [&_>div:last-child]:pb-0">
          <ProjectManagersPanel projectId={projectId} managers={project.projectManagers ?? []} />
        </div>
      ) : null}
      <CrewLine crew={crew} onOpenLogistics={onOpenLogistics} />
    </div>
  );
}

type LogRow = { id: string; userName?: string | null; summary?: string; createdAt: string | number };

/**
 * Recent: the AUDIT LOG (`activityLog.recentForProject`, bounded to four rows,
 * newest first) — not the sidebar's Activity, which is the collaboration feed.
 * `All activity ›` shows only when the user can open `/activity` (the NAV's own
 * gate, `useNavItems`), so it is never a dead link.
 */
export function OverviewRecent({
  projectId,
  orgId,
  onOpenDiscussion,
}: {
  projectId: string;
  orgId: string | undefined;
  onOpenDiscussion?: () => void;
}) {
  const data = useAuthedQuery(api.activityLog.recentForProject, orgId ? { orgId, projectId, limit: 4 } : "skip");
  const canOpenActivity = !!useNavItems().byKey("activity");
  const items = (data?.items ?? []) as LogRow[];
  const allHref = `/activity?entityType=project&entityId=${encodeURIComponent(projectId)}`;
  return (
    <div className="min-w-0">
      <OverviewLabel>Recent</OverviewLabel>
      {data === undefined ? (
        <OverviewLine muted>Loading activity…</OverviewLine>
      ) : items.length === 0 ? (
        <OverviewLine muted>Nothing has happened on this job yet.</OverviewLine>
      ) : (
        items.map((log) => (
          <OverviewLine key={log.id} muted>
            {log.userName ? <b className="font-semibold text-ink-2">{log.userName}</b> : null} {log.summary}{" "}
            <span className="text-faint">· {timeAgo(new Date(log.createdAt).getTime())}</span>
          </OverviewLine>
        ))
      )}
      <OverviewLinks>
        {canOpenActivity ? <OverviewTextLink href={allHref}>All activity ›</OverviewTextLink> : null}
        {onOpenDiscussion ? <OverviewTextButton onClick={onOpenDiscussion}>Discussion ›</OverviewTextButton> : null}
      </OverviewLinks>
    </div>
  );
}
