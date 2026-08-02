"use client";
// use-client: interactive — expand/collapse state (R-8.1.1)

import { useState } from "react";
import Link from "next/link";
import { Check, AlertTriangle, CircleAlert, CircleHelp, ChevronDown, ChevronRight } from "lucide-react";

import { useProjectReadiness } from "@/hooks/use-project-readiness";
import { useProjectConflicts } from "@/hooks/use-project-conflicts";
import { ConflictRow } from "@/components/projects/conflict-row";
import type { ReadinessCheck, ReadinessSeverity } from "@/lib/project-readiness-checks";
import type { ReservationConflict } from "@/lib/reservation-conflicts-types";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, focusRing } from "@/lib/utils";

/** Which project tab a check's action sends you to, when it sends you anywhere. */
export type ProjectTab = "overview" | "equipment" | "labour" | "finance" | "tasks" | "notes" | "files";

interface ProjectReadinessPanelProps {
  projectId: string;
  orgId: string | undefined;
  /** Switches the project's active tab — the checklist reports, the tab fixes. */
  onNavigateTab: (tab: ProjectTab) => void;
}

const SEVERITY_ICON: Record<ReadinessSeverity, typeof Check> = {
  blocking: CircleAlert,
  warning: AlertTriangle,
  pass: Check,
  unknown: CircleHelp,
};

/** Colour AND an icon AND a text label — never colour alone (DESIGN.md §3.3). */
const SEVERITY_MARK: Record<ReadinessSeverity, string> = {
  blocking: "bg-out-soft text-t-out",
  warning: "bg-warn-soft text-warn",
  pass: "bg-ok-soft text-ok",
  unknown: "bg-rep-soft text-rep",
};

function CheckMark({ severity }: { severity: ReadinessSeverity }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span
      className={cn("mt-px grid size-[18px] shrink-0 place-items-center rounded-full", SEVERITY_MARK[severity])}
      aria-hidden
    >
      <Icon className="size-3" strokeWidth={3} />
    </span>
  );
}

/**
 * One checklist row. A passing row stays visible but drops to a quieter weight
 * — a clean project should read as VERIFIED, not as a panel that failed to
 * load, which is the whole reason this isn't a hide-when-clean banner.
 */
function CheckRow({
  check,
  action,
  expandable,
  expanded,
  onToggle,
  children,
}: {
  check: ReadinessCheck;
  action?: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  const passing = check.severity === "pass";
  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={cn("mt-px shrink-0 rounded-sm text-muted hover:text-ink", focusRing)}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : null}
        <CheckMark severity={check.severity} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-ui-text", passing ? "text-ink-2" : "font-semibold text-ink")}>{check.title}</p>
          {check.detail && <p className="mt-0.5 text-caption text-muted">{check.detail}</p>}
        </div>
        {action}
      </div>
      {expanded && children && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/**
 * The action a failing check offers. Conflicts deliberately have none — they
 * resolve inline via the row's expander, where the swap picker lives.
 */
function CheckAction({
  check,
  projectId,
  onNavigateTab,
}: {
  check: ReadinessCheck;
  projectId: string;
  onNavigateTab: (tab: ProjectTab) => void;
}) {
  if (!check.actionLabel) return null;

  // A gear shortage is resolved on the org board (sub-hire, swap, or move the
  // dates) — a project-local view can't show what else is competing for the
  // stock. A dateless project instead needs the dates themselves.
  const href =
    check.id === "gear" ? (check.severity === "unknown" ? `/projects/${projectId}/edit` : "/overbookings") : null;
  if (href) {
    return (
      <Button variant="line" size="sm" className="h-7 shrink-0" asChild>
        <Link href={href}>{check.actionLabel}</Link>
      </Button>
    );
  }

  // Crew and services both live on Labour & logistics; pricing on Equipment.
  const tab: ProjectTab | null =
    check.id === "crew" || check.id === "services" ? "labour" : check.id === "pricing" ? "equipment" : null;
  if (!tab) return null;
  return (
    <Button variant="line" size="sm" className="h-7 shrink-0" onClick={() => onNavigateTab(tab)}>
      {check.actionLabel}
    </Button>
  );
}

const CHECK_LABEL: Record<ReadinessCheck["id"], string> = {
  gear: "gear",
  conflicts: "conflicts",
  services: "services",
  crew: "crew",
  pricing: "pricing",
};

/**
 * Every applicable check ran and passed — one line, not five green ticks.
 * Named from the actual `checks` list (not a hardcoded string) because
 * `services`/`crew` may not be present at all for this project.
 */
function AllClearPanel({ checks, onShowAll }: { checks: ReadinessCheck[]; onShowAll: () => void }) {
  return (
    <Panel padding="default" className="flex items-center gap-2.5 p-3.5">
      <CheckMark severity="pass" />
      <p className="min-w-0 flex-1 text-ui-text">
        <span className="font-semibold text-ink">Ready — all {checks.length} checks pass</span>
        <span className="text-muted"> · {checks.map((c) => CHECK_LABEL[c.id]).join(", ")}</span>
      </p>
      <Button variant="line" size="sm" className="h-7 shrink-0" onClick={onShowAll}>
        Show checks
      </Button>
    </Panel>
  );
}

/**
 * The project's readiness checklist — the lead section of the Overview tab
 * (#1061).
 *
 * Renders every check that APPLIES to this project, passing ones included —
 * a deliberate departure from the hide-when-clean banner it replaces
 * (`ProjectConflictsBanner`): that gave zero noise but also zero reassurance,
 * and a banner that appears and disappears makes the page jump. A checklist
 * that says "checked, all good" is worth the row — and when everything
 * passes it collapses to one line anyway.
 *
 * "Applies" is narrower than "ran": `crew`/`services` drop out entirely
 * (not even as a pass) when the project has no crew assigned or no services
 * scheduled — see `project-readiness-checks.ts`. Unlike a hide-when-clean
 * banner, this isn't ambiguous with "not checked yet", because the row never
 * existed for a project with nothing to check there.
 *
 * Severity, wording and ordering come from `project-readiness-checks.ts` (a
 * plain, unit-tested module); this component only renders them and attaches the
 * action each check needs. Ordering is fixed rather than severity-sorted so
 * rows don't reshuffle under the cursor as problems resolve.
 */
export function ProjectReadinessPanel({ projectId, orgId, onNavigateTab }: ProjectReadinessPanelProps) {
  const { checks, summary, isLoading } = useProjectReadiness(projectId, orgId);
  const { data: conflicts } = useProjectConflicts(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <Panel padding="default" className="p-4">
        <p className="text-caption text-muted">Checking readiness…</p>
      </Panel>
    );
  }

  if (summary.allClear && !showAll) {
    return <AllClearPanel checks={checks} onShowAll={() => setShowAll(true)} />;
  }

  const conflictList = (conflicts ?? []) as ReservationConflict[];

  return (
    <Panel padding="default" className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-card-title font-bold tracking-tight text-ink">Readiness</h2>
        <div className="flex items-center gap-1.5">
          {summary.blocking > 0 && <Badge status="overbooked">{summary.blocking} blocking</Badge>}
          {summary.warning > 0 && <Badge status="warn">{summary.warning} to check</Badge>}
          {summary.unknown > 0 && <Badge status="repair">{summary.unknown} not checked</Badge>}
          {summary.allClear && <Badge status="ok">All clear</Badge>}
        </div>
      </div>

      {checks.map((check) => {
        const isConflicts = check.id === "conflicts" && conflictList.length > 0;
        return (
          <CheckRow
            key={check.id}
            check={check}
            action={<CheckAction check={check} projectId={projectId} onNavigateTab={onNavigateTab} />}
            expandable={isConflicts}
            expanded={isConflicts && expandedId === check.id}
            onToggle={() => setExpandedId((cur) => (cur === check.id ? null : check.id))}
          >
            {isConflicts && (
              <div className="space-y-1.5">
                {conflictList.map((c) => (
                  <ConflictRow key={c.lineItemId} conflict={c} projectId={projectId} />
                ))}
              </div>
            )}
          </CheckRow>
        );
      })}
    </Panel>
  );
}
