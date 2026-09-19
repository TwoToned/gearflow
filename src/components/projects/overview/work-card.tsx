"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useProjectReadiness } from "@/hooks/use-project-readiness";
import { useProjectConflicts } from "@/hooks/use-project-conflicts";
import { useProjectWorkData } from "@/hooks/use-project-work-data";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useCanDo } from "@/lib/use-permissions";
import { buildWorkDecisionRows, type WorkDecisionRow } from "@/lib/project-work-card";
import { summariseProjectWork } from "@/lib/project-work";
import type { ReadinessCheck } from "@/lib/project-readiness-checks";
import type { ReservationConflict } from "@/lib/reservation-conflicts-types";
import { ConflictRow } from "@/components/projects/conflict-row";
import { WorkComposer } from "@/components/work/work-composer";
import { Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Which project tab a check's action sends you to, or "labour"/"equipment"
 *  for the two deep links the old Readiness panel had. */
export type WorkCardTab = "overview" | "equipment" | "labour" | "finance" | "work" | "notes" | "files";

interface WorkCardProps {
  projectId: string;
  orgId: string | undefined;
  onNavigateTab: (tab: WorkCardTab) => void;
}

/** Where a decision row's action goes. Pure, so `RowAction` renders one of
 *  two shapes instead of carrying the whole routing table (R-3.6). */
function resolveRowAction(
  row: WorkDecisionRow,
  projectId: string,
): { kind: "href"; href: string } | { kind: "tab"; tab: WorkCardTab } | null {
  if (!row.actionLabel) return null;
  // The unowned summary goes to the Work tab, where the bulk bar fixes all of
  // them in one pass — assigning one at a time from here is the slowest path.
  if (row.id === "unowned") return { kind: "tab", tab: "work" };
  if (!row.checkId) return null;

  // A gear shortage is resolved on the org board — a project-local view can't
  // show what else is competing for the stock. A dateless project instead
  // needs the dates themselves.
  if (row.checkId === "gear") {
    return { kind: "href", href: row.severity === "unknown" ? `/projects/${projectId}/edit` : "/overbookings" };
  }
  if (row.checkId === "crew" || row.checkId === "services") return { kind: "tab", tab: "labour" };
  if (row.checkId === "pricing") return { kind: "tab", tab: "equipment" };
  return null;
}

function RowAction({
  row,
  projectId,
  onNavigateTab,
}: {
  row: WorkDecisionRow;
  projectId: string;
  onNavigateTab: (tab: WorkCardTab) => void;
}) {
  const action = resolveRowAction(row, projectId);
  if (!action) return null;
  if (action.kind === "href") {
    return (
      <Button variant="line" size="sm" className="h-7 shrink-0" asChild>
        <Link href={action.href}>{row.actionLabel}</Link>
      </Button>
    );
  }
  return (
    <Button variant="line" size="sm" className="h-7 shrink-0" onClick={() => onNavigateTab(action.tab)}>
      {row.actionLabel}
    </Button>
  );
}

/** The job's shape in one strip — six thin bars, one per stage that has work. */
function StageMeter({ segments }: { segments: ReturnType<typeof summariseProjectWork>["meter"] }) {
  if (segments.length === 0) return null;
  return (
    <div className="flex gap-1.5 px-4 pb-3 pt-1">
      {segments.map((seg) => (
        <div key={seg.stage} className="flex flex-1 flex-col gap-1.5">
          <span className="h-1 overflow-hidden rounded-full bg-line-2">
            <span
              className={cn("block h-full rounded-full", seg.pct === 100 ? "bg-ok" : "bg-blue")}
              style={{ width: `${seg.pct}%` }}
            />
          </span>
          <span className="t-micro truncate text-muted" title={`${seg.label} — ${seg.done} of ${seg.total}`}>
            {seg.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Overview → Work card (work-layer v2 §4.4).
 *
 * A SUMMARY, not a second Work tab. The rail carries the list on every
 * working tab and the Work tab owns the full view; Overview has no sidebar
 * (#1063), so this is work's counterpart there and it answers the one
 * question the others can't at a glance: is this job in trouble?
 *
 * Meter, the rows that need a decision, one line to capture, a link out.
 */
export function ProjectOverviewWorkCard({ projectId, orgId, onNavigateTab }: WorkCardProps) {
  const { checks, isLoading: readinessLoading } = useProjectReadiness(projectId, orgId);
  const { tasks, isLoading: tasksLoading, refetch, assignees } = useProjectWorkData(projectId);
  const { data: conflicts } = useProjectConflicts(projectId);
  const { timezone } = useDocumentDatesConfig();
  const canEdit = useCanDo("project", "update");
  const conflictList = (conflicts ?? []) as ReservationConflict[];
  const [conflictsExpanded, setConflictsExpanded] = useState(false);

  const nowMs = Date.now();
  const summary = useMemo(() => summariseProjectWork(tasks, nowMs, timezone), [tasks, nowMs, timezone]);
  const decisions = useMemo(
    () => buildWorkDecisionRows(checks, tasks, nowMs, timezone),
    [checks, tasks, nowMs, timezone],
  );

  // DESIGN.md's state matrix: skeleton rows in the card's own shape, not the
  // bare "Checking work…" line this card used to render.
  if (readinessLoading || tasksLoading) {
    return (
      <Panel padding="default" className="space-y-3 p-4" aria-busy>
        <Skeleton className="h-5 w-24 rounded-[var(--r)]" />
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-8 w-full rounded-[var(--r)]" />
      </Panel>
    );
  }

  const allClear = decisions.length === 0;

  return (
    <Panel padding="default" className="p-0">
      <WorkCardHeader summary={summary} allClear={allClear} onNavigateTab={onNavigateTab} />

      <StageMeter segments={summary.meter} />

      {decisions.length > 0 && (
        <div className="border-t border-line">
          <h3 className="t-overline px-4 pb-1 pt-2 text-muted">Needs a decision</h3>
          <div className="divide-y divide-line">
            {decisions.map((row) => (
              <WorkCardRowItem
                key={row.id}
                row={row}
                projectId={projectId}
                onNavigateTab={onNavigateTab}
                conflictList={conflictList}
                conflictsExpanded={conflictsExpanded}
                onToggleConflicts={() => setConflictsExpanded((v) => !v)}
              />
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="border-t border-line p-3">
          <WorkComposer
            projectId={projectId}
            assignees={assignees}
            onCreated={refetch}
            compact
            placeholder="Add work to this job…"
            className="border-dashed bg-transparent"
          />
        </div>
      )}

      {summary.openCount > 0 && (
        <Link
          href={`/projects/${projectId}?tab=work`}
          className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-caption font-medium text-muted hover:text-ink"
        >
          {summary.openCount} open · everything in the Work tab
          <ChevronRight className="size-3" aria-hidden />
        </Link>
      )}
    </Panel>
  );
}

/** One decision row, including the conflicts check's expandable swap list. */
function WorkCardRowItem({
  row,
  projectId,
  onNavigateTab,
  conflictList,
  conflictsExpanded,
  onToggleConflicts,
}: {
  row: WorkDecisionRow;
  projectId: string;
  onNavigateTab: (tab: WorkCardTab) => void;
  conflictList: ReservationConflict[];
  conflictsExpanded: boolean;
  onToggleConflicts: () => void;
}) {
  const isConflicts = row.checkId === "conflicts" && conflictList.length > 0;
  return (
    <div>
      <div className="flex items-start gap-2.5 px-4 py-2">
        {isConflicts && <ConflictsExpandButton expanded={conflictsExpanded} onToggle={onToggleConflicts} />}
        <WorkCardRowMark row={row} />
        <div className="min-w-0 flex-1">
          <p className="text-ui-text text-ink-2">
            {row.title}
            {row.system && (
              <Badge status="repair" className="ml-1.5 align-middle">
                auto
              </Badge>
            )}
            {row.lateLabel && (
              <Badge status="overbooked" className="ml-1.5 align-middle">
                {row.lateLabel}
              </Badge>
            )}
          </p>
          {row.detail && <p className="mt-0.5 text-caption text-muted">{row.detail}</p>}
        </div>
        <RowAction row={row} projectId={projectId} onNavigateTab={onNavigateTab} />
      </div>
      {isConflicts && conflictsExpanded && <ConflictsList conflictList={conflictList} projectId={projectId} />}
    </div>
  );
}

function ConflictsExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? "Hide conflicting items" : "Show conflicting items"}
      className="mt-px shrink-0 rounded-sm text-muted hover:text-ink"
    >
      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  );
}

function ConflictsList({ conflictList, projectId }: { conflictList: ReservationConflict[]; projectId: string }) {
  return (
    <div className="space-y-1.5 px-4 pb-3">
      {conflictList.map((c) => (
        <ConflictRow key={c.lineItemId} conflict={c} projectId={projectId} />
      ))}
    </div>
  );
}

/** The row mark — a derived signal (amber) or a real late task (problem red).
 *  Never a checkbox: a system row has nothing to tick, and a late row is
 *  ticked off in the rail or the tab where its full context lives. */
function WorkCardRowMark({ row }: { row: WorkDecisionRow }) {
  const fill = row.system ? "bg-warn-soft text-warn" : "bg-out-soft text-t-out";
  return (
    <span className={cn("mt-px grid size-[16px] shrink-0 place-items-center rounded-full", fill)} aria-hidden>
      {!row.system && <Check className="size-2.5 opacity-0" strokeWidth={3} />}
    </span>
  );
}

/** The card's header strip. Split out (R-3.6): the count, the overdue badge
 *  and the all-clear badge are three independent branches. */
function WorkCardHeader({
  summary,
  allClear,
  onNavigateTab,
}: {
  summary: ReturnType<typeof summariseProjectWork>;
  allClear: boolean;
  onNavigateTab: (tab: WorkCardTab) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <h2 className="text-card-title font-bold tracking-tight text-ink">Work</h2>
      {summary.totalCount > 0 && (
        <span className="t-mono text-muted">
          {summary.doneCount} of {summary.totalCount} done
        </span>
      )}
      {summary.lateCount > 0 && <Badge status="overbooked">{summary.lateCount} overdue</Badge>}
      {allClear && summary.totalCount > 0 && <Badge status="ok">All clear</Badge>}
      <span className="flex-1" />
      <Button variant="line" size="sm" className="h-7" onClick={() => onNavigateTab("work")}>
        Open Work tab
      </Button>
    </div>
  );
}
