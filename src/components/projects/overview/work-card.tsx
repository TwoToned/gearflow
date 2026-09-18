"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useProjectReadiness } from "@/hooks/use-project-readiness";
import { useProjectConflicts } from "@/hooks/use-project-conflicts";
import { useProjectWorkData } from "@/hooks/use-project-work-data";
import { buildWorkCardStages, summariseWorkCard, type WorkCardRow } from "@/lib/project-work-card";
import type { ReadinessCheck } from "@/lib/project-readiness-checks";
import type { ReservationConflict } from "@/lib/reservation-conflicts-types";
import { ConflictRow } from "@/components/projects/conflict-row";
import { Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Which project tab a check's action sends you to, or "labour"/"equipment"
 *  for the two deep links the old Readiness panel had — mirrors that panel's
 *  own `CheckAction` exactly (the panel is deleted; this is its replacement,
 *  design §8.3: "keeps the existing 'Open labour / Open equipment' deep-link
 *  the readiness panel has today"). */
export type WorkCardTab = "overview" | "equipment" | "labour" | "finance" | "work" | "notes" | "files";

interface WorkCardProps {
  projectId: string;
  orgId: string | undefined;
  onNavigateTab: (tab: WorkCardTab) => void;
}

function RowAction({
  row,
  projectId,
  onNavigateTab,
}: {
  row: WorkCardRow;
  projectId: string;
  onNavigateTab: (tab: WorkCardTab) => void;
}) {
  if (!row.actionLabel || !row.checkId) return null;
  const checkId = row.checkId as ReadinessCheck["id"];

  // A gear shortage is resolved on the org board — a project-local view can't
  // show what else is competing for the stock. A dateless project instead
  // needs the dates themselves. Mirrors project-readiness-panel.tsx's own
  // CheckAction (deleted alongside the standalone panel).
  const href = checkId === "gear" ? (row.severity === "unknown" ? `/projects/${projectId}/edit` : "/overbookings") : null;
  if (href) {
    return (
      <Button variant="line" size="sm" className="h-7 shrink-0" asChild>
        <Link href={href}>{row.actionLabel}</Link>
      </Button>
    );
  }

  const tab: WorkCardTab | null =
    checkId === "crew" || checkId === "services" ? "labour" : checkId === "pricing" ? "equipment" : null;
  if (!tab) return null;
  return (
    <Button variant="line" size="sm" className="h-7 shrink-0" onClick={() => onNavigateTab(tab)}>
      {row.actionLabel}
    </Button>
  );
}

function StageProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line-2">
        <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-ok" : "bg-blue")} style={{ width: `${pct}%` }} />
      </div>
      <span className="t-micro shrink-0 text-muted">
        {done}/{total}
      </span>
    </div>
  );
}

/**
 * Overview → Work card (#1244, design §8.3). REPLACES the standalone
 * Readiness panel — the pure check logic in `project-readiness-checks.ts` is
 * unchanged, it's just one signal source among the card's rows now (§9's
 * "a readiness failure renders as a system row" rule).
 */
export function ProjectOverviewWorkCard({ projectId, orgId, onNavigateTab }: WorkCardProps) {
  const { checks, isLoading: readinessLoading } = useProjectReadiness(projectId, orgId);
  const { tasks, isLoading: tasksLoading } = useProjectWorkData(projectId);
  const { data: conflicts } = useProjectConflicts(projectId);
  const conflictList = (conflicts ?? []) as ReservationConflict[];
  const [conflictsExpanded, setConflictsExpanded] = useState(false);

  if (readinessLoading || tasksLoading) {
    return (
      <Panel padding="default" className="p-4">
        <p className="text-caption text-muted">Checking work…</p>
      </Panel>
    );
  }

  const stages = buildWorkCardStages(
    checks,
    tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, stage: t.stage ?? null })),
  );
  const summary = summariseWorkCard(stages);
  const allClear = stages.every((s) => s.rows.every((r) => r.done));

  if (stages.length === 0) {
    return (
      <Panel padding="default" className="flex items-center gap-2.5 p-3.5">
        <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-ok-soft text-ok" aria-hidden>
          <Check className="size-3" strokeWidth={3} />
        </span>
        <p className="min-w-0 flex-1 text-ui-text">
          <span className="font-semibold text-ink">Nothing to do yet</span>
          <span className="text-muted"> — checks pass and no work is on this project.</span>
        </p>
        <Button variant="line" size="sm" className="h-7 shrink-0" onClick={() => onNavigateTab("work")}>
          Open Work
        </Button>
      </Panel>
    );
  }

  return (
    <Panel padding="default" className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-card-title font-bold tracking-tight text-ink">Work</h2>
        <div className="flex items-center gap-1.5">
          {allClear ? (
            <Badge status="ok">All clear</Badge>
          ) : (
            <span className="t-micro text-muted">
              {summary.done} of {summary.total} done
            </span>
          )}
          <Button variant="line" size="sm" className="h-7" onClick={() => onNavigateTab("work")}>
            Open Work
          </Button>
        </div>
      </div>

      {stages.map((stage) => (
        <div key={stage.stage} className="border-t border-line first:border-t-0">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <h3 className="t-overline text-muted">{stage.label}</h3>
            <StageProgress done={stage.doneCount} total={stage.totalCount} />
          </div>
          <div className="divide-y divide-line">
            {stage.rows.map((row) => (
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
      ))}
    </Panel>
  );
}

/** Split out of ProjectOverviewWorkCard (R-3.6) purely to keep that
 *  function's own complexity down — one row's rendering, including the
 *  conflicts check's expandable per-asset swap list. */
function WorkCardRowItem({
  row,
  projectId,
  onNavigateTab,
  conflictList,
  conflictsExpanded,
  onToggleConflicts,
}: {
  row: WorkCardRow;
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
        {isConflicts && (
          <ConflictsExpandButton expanded={conflictsExpanded} onToggle={onToggleConflicts} />
        )}
        <WorkCardRowMark row={row} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-ui-text", row.done ? "text-muted line-through" : "text-ink-2")}>
            {row.title}
            {row.system && (
              <Badge status="repair" className="ml-1.5 align-middle">
                auto
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

/** Split out of WorkCardRowItem (R-3.6). */
function ConflictsExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
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

/** The status circle — done / system-auto / plain. Split out of
 *  WorkCardRowItem (R-3.6). */
function WorkCardRowMark({ row }: { row: WorkCardRow }) {
  const fill = row.done ? "bg-ok-soft text-ok" : row.system ? "bg-warn-soft text-warn" : "bg-paper-2 text-faint";
  return (
    <span className={cn("mt-px grid size-[16px] shrink-0 place-items-center rounded-full", fill)} aria-hidden>
      {row.done && <Check className="size-2.5" strokeWidth={3} />}
    </span>
  );
}
