"use client";
// use-client: interactive — collapse state, optimistic done toggles, composer

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useProjectWorkData } from "@/hooks/use-project-work-data";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useCanDo } from "@/lib/use-permissions";
import {
  WORK_RAIL_VISIBLE_LIMIT,
  isLateWork,
  isUnownedWork,
  sortOpenWork,
  summariseProjectWork,
} from "@/lib/project-work";
import type { ProjectTaskRow } from "@/lib/project-tasks";
import { WorkComposer } from "@/components/work/work-composer";
import { PersonAvatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui/section-header";
import { cn, focusRing } from "@/lib/utils";

/**
 * Work, in the project's context sidebar (work-layer v2 §4.3).
 *
 * Work is remembered while you are doing something else — pricing gear in
 * Equipment, reading Finance — so it belongs on a surface that is already on
 * screen, not behind two tab changes. This rides the same `DetailSidebar` that
 * carries Schedule/Location/Team/Activity, between Team and Activity: the
 * standing reference facts stay together above it, and the two "what is
 * happening" sections sit together at the bottom.
 *
 * It is a WORKING SET, not a list view. Five open rows, most pressing first,
 * then a link to the tab that owns the full list. If it ever needs a
 * scrollbar, the cut is wrong — see §8's open question about switching from a
 * fixed count to "overdue + due this week".
 *
 * Not rendered on the Work tab (that tab IS the list, and showing the same
 * rows twice on one screen is the duplication this program exists to remove)
 * or on Overview (which has no sidebar at all — #1063 composes that content
 * into peer cards, and §4.4's Work card is its counterpart there).
 */

/** Remembered per user, per browser. A convenience, not state anything reads
 *  back — so a private window or blocked storage just starts expanded. */
const COLLAPSE_KEY = "rvlt.work-rail.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    /* private window / blocked storage — the section just won't remember */
  }
}

function dueLabel(task: ProjectTaskRow, nowMs: number, timezone: string | undefined): string | null {
  if (!task.dueDate) return null;
  const ms = new Date(task.dueDate).getTime();
  if (!Number.isFinite(ms)) return null;
  if (isLateWork(task, nowMs, timezone)) {
    const days = Math.max(1, Math.round((nowMs - ms) / 86_400_000));
    return `${days}d late`;
  }
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function ProjectWorkRailSection({ projectId }: { projectId: string }) {
  const { tasks, isLoading, refetch, assignees } = useProjectWorkData(projectId);
  const writes = useProjectTaskWrites();
  const { timezone } = useDocumentDatesConfig();
  const canEdit = useCanDo("project", "update");

  const [collapsed, setCollapsed] = useState(readCollapsed);
  // A just-ticked row would vanish on the next refetch mid-glance; keep it
  // visible and struck through so undo is one click, exactly as Today does.
  const [justDone, setJustDone] = useState<Set<string>>(new Set());

  const nowMs = Date.now();
  const summary = useMemo(() => summariseProjectWork(tasks, nowMs, timezone), [tasks, nowMs, timezone]);
  const visible = useMemo(() => {
    const open = sortOpenWork(tasks);
    const stillShown = tasks.filter((t) => justDone.has(t.id) && t.status !== "DONE");
    return [...open, ...stillShown].slice(0, WORK_RAIL_VISIBLE_LIMIT);
  }, [tasks, justDone]);

  const toggleDone = useCallback(
    (task: ProjectTaskRow) => {
      const nextDone = task.status !== "DONE" && !justDone.has(task.id);
      setJustDone((prev) => {
        const next = new Set(prev);
        if (nextDone) next.add(task.id);
        else next.delete(task.id);
        return next;
      });
      writes
        .update(task.id, { status: nextDone ? "DONE" : "TODO" })
        .then(() => refetch())
        .catch((e: unknown) => {
          setJustDone((prev) => {
            const next = new Set(prev);
            if (nextDone) next.delete(task.id);
            else next.add(task.id);
            return next;
          });
          toast.error(e instanceof Error ? e.message : "Could not update the work");
        });
    },
    [writes, refetch, justDone],
  );

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      writeCollapsed(!v);
      return !v;
    });
  };

  return (
    <div className="space-y-2 border-b border-border pb-4">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className={cn("flex w-full items-center gap-2 text-left", focusRing)}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
        )}
        <SectionHeader label="Work" className="flex-1" />
        {/* Counts live in the header so the section stays glanceable collapsed. */}
        {!isLoading && summary.totalCount > 0 && (
          <span className="t-mono shrink-0 text-muted">
            {summary.doneCount} of {summary.totalCount}
          </span>
        )}
        {summary.lateCount > 0 && (
          <span className="shrink-0 rounded-full bg-out-soft px-2 py-0.5 text-badge font-semibold text-t-out">
            {summary.lateCount} late
          </span>
        )}
        {summary.unownedCount > 0 && (
          <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-badge font-semibold text-warn">
            {summary.unownedCount} unowned
          </span>
        )}
      </button>

      {!collapsed && (
        <>
          {isLoading ? (
            <div className="space-y-1.5" aria-busy>
              <Skeleton className="h-4 w-full rounded-full" />
              <Skeleton className="h-7 w-full rounded-[var(--r)]" />
              <Skeleton className="h-7 w-full rounded-[var(--r)]" />
            </div>
          ) : (
            <>
              {summary.meter.length > 0 && (
                <div className="flex gap-1" role="presentation">
                  {summary.meter.map((seg) => (
                    <span
                      key={seg.stage}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-elev"
                      title={`${seg.label} — ${seg.done} of ${seg.total}`}
                    >
                      <span
                        className={cn("block h-full rounded-full", seg.pct === 100 ? "bg-ok" : "bg-blue")}
                        style={{ width: `${seg.pct}%` }}
                      />
                    </span>
                  ))}
                </div>
              )}

              {visible.length === 0 ? (
                <p className="text-caption text-muted">
                  {summary.totalCount > 0 ? "All work on this job is done." : "No work on this job yet."}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {visible.map((task) => {
                    const done = task.status === "DONE" || justDone.has(task.id);
                    const due = dueLabel(task, nowMs, timezone);
                    const late = !done && isLateWork(task, nowMs, timezone);
                    // Unowned is the SHARED predicate, not "did the join
                    // resolve" — a row assigned to a since-deleted user has
                    // an id but no join row, and the header count (which uses
                    // the predicate) would then disagree with this marker.
                    const unowned = isUnownedWork(task);
                    const owner =
                      task.assigneeUser?.name ??
                      (task.assigneeCrew ? `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim() : null);
                    return (
                      <li
                        key={task.id}
                        className={cn(
                          "flex items-center gap-2 rounded-[var(--r)] py-1 pl-1.5 pr-1 hover:bg-paper-2",
                          late && "border-l-2 border-red",
                        )}
                      >
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => toggleDone(task)}
                          aria-label={done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-full border",
                            done ? "border-transparent bg-ok-soft text-ok" : "border-line-2 text-transparent",
                            canEdit ? "cursor-pointer" : "cursor-default",
                            focusRing,
                          )}
                        >
                          {done && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
                        </button>
                        {/* Truncate, never wrap: 340px minus the circle, due
                            and avatar leaves ~200px, and a wrapped title
                            breaks the row rhythm. The peek has the full text. */}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-table-cell",
                            done ? "text-muted line-through" : "text-ink-2",
                          )}
                          title={task.title}
                        >
                          {task.title}
                        </span>
                        {due && (
                          <span className={cn("t-mono shrink-0", late ? "text-t-out" : "text-muted")}>{due}</span>
                        )}
                        {!unowned ? (
                          <PersonAvatar name={owner ?? "Assigned"} className="size-[18px] shrink-0 text-[9px]" />
                        ) : (
                          <span
                            className="grid size-[18px] shrink-0 place-items-center rounded-full border border-dashed border-faint text-[9px] text-muted"
                            title="No owner — this is on the job, but on nobody's Today"
                            aria-label="No owner"
                          >
                            ?
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {canEdit && (
                <WorkComposer
                  projectId={projectId}
                  assignees={assignees}
                  onCreated={refetch}
                  compact
                  placeholder="Add work…"
                  className="border-dashed bg-transparent"
                />
              )}

              {summary.totalCount > visible.length && (
                <Link
                  href={`/projects/${projectId}?tab=work`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm text-caption font-medium text-muted hover:text-ink",
                    focusRing,
                  )}
                >
                  All {summary.totalCount} in the Work tab
                  <ChevronRight className="size-3" aria-hidden />
                </Link>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
