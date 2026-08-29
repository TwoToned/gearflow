"use client";

import Link from "next/link";
import { ArrowRight, Boxes, CalendarClock, ShieldAlert, AtSign, CheckCircle2, FolderOpen, Circle, CircleDot } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { StaggerList, StaggerItem } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { getStatusColor } from "@/lib/status-colors";
import { useFormatters } from "@/components/providers/format-provider";

const projectStatusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry", QUOTING: "Quoting", QUOTED: "Quoted", CONFIRMED: "Confirmed",
  PREPPING: "Prepping", CHECKED_OUT: "Deployed", ON_SITE: "On site", RETURNED: "Returned",
  COMPLETED: "Completed", INVOICED: "Invoiced", CANCELLED: "Cancelled",
};

type Project = Record<string, unknown>;
type Blocker = Record<string, unknown>;
type TaskDue = Record<string, unknown>;

const TASKS_DUE_SHOWN = 5;

/** Compact due-date label for the tasks-due block (no "d MMM" year clutter).
 *  `formatDateDayMonth` is the org-locale-bound role (I3, #1082) — replaces
 *  a bare `toLocaleDateString(undefined, …)`, which rendered the VIEWER's
 *  browser locale rather than the org's configured one. */
function taskDueLabel(
  task: TaskDue,
  formatDateDayMonth: (date: Date) => string,
): { text: string; overdue: boolean } | null {
  const due = task.dueDate as number | null | undefined;
  if (due == null) return null;
  return {
    text: formatDateDayMonth(new Date(due)),
    overdue: !!task.overdue,
  };
}

const DAY = 24 * 60 * 60 * 1000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** Status-aware date line for a project card. */
function projectDateLine(
  p: Project,
  formatDateDayMonth: (date: Date) => string,
): { text: string; tone: "error" | "warning" | "muted" } | null {
  const status = p.status as string;
  const now = startOfDay(new Date());
  const start = p.rentalStartDate ? startOfDay(new Date(p.rentalStartDate as string)) : null;
  const end = p.rentalEndDate ? startOfDay(new Date(p.rentalEndDate as string)) : null;
  const started = !!start && start.getTime() <= now.getTime();
  const out = status === "CHECKED_OUT" || status === "ON_SITE" || (status === "PREPPING" && started);
  if (out && end) {
    const days = Math.round((end.getTime() - now.getTime()) / DAY);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "error" };
    if (days === 0) return { text: "Back today", tone: "warning" };
    if (days <= 3) return { text: `Back in ${days}d`, tone: "warning" };
    return { text: `Back ${formatDateDayMonth(end)}`, tone: "muted" };
  }
  if (start) {
    const days = Math.round((start.getTime() - now.getTime()) / DAY);
    if (days < 0) return { text: `Started ${formatDateDayMonth(start)}`, tone: "muted" };
    if (days === 0) return { text: "Starts today", tone: "warning" };
    if (days <= 7) return { text: `Starts in ${days}d`, tone: days <= 2 ? "warning" : "muted" };
    return { text: `Starts ${formatDateDayMonth(start)}`, tone: "muted" };
  }
  return null;
}

const toneText = { error: "text-t-out", warning: "text-warn", muted: "text-muted" } as const;

export function MyWorkSection({
  projects,
  blockers = [],
  tasks = [],
}: {
  projects: Project[];
  blockers?: Blocker[];
  /** Top N of projectTasks.myOpenTasks (already sorted overdue → due asc → priority). */
  tasks?: TaskDue[];
}) {
  const { formatDateDayMonth } = useFormatters();
  // Group blockers by project so each card can flag its own issues.
  const blockersByProject = new Map<string, Blocker[]>();
  for (const b of blockers) {
    const pid = b.projectId as string;
    if (!pid) continue;
    const arr = blockersByProject.get(pid) ?? [];
    arr.push(b);
    blockersByProject.set(pid, arr);
  }

  const shownTasks = tasks.slice(0, TASKS_DUE_SHOWN);
  const moreTasks = tasks.length - shownTasks.length;

  return (
    <section className="space-y-4 rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionHeader label="My work" />
          {projects.length > 0 && (
            <p className="t-micro mt-0.5 text-muted">
              {projects.length} you manage{blockers.length > 0 ? <> · <span className="text-t-out">{blockers.length} need a decision</span></> : null}
            </p>
          )}
        </div>
        <Link href="/projects" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-red hover:underline">
          All projects <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {shownTasks.length > 0 && (
        <TasksDueBlock tasks={shownTasks} moreCount={moreTasks} formatDateDayMonth={formatDateDayMonth} />
      )}

      {projects.length === 0 ? (
        <div className="rounded-[var(--r-lg)] border border-dashed border-line py-8 text-center">
          <FolderOpen className="mx-auto h-7 w-7 text-faint" />
          <p className="mt-2 text-[14px] font-medium text-ink">No projects on you</p>
          <p className="t-micro text-muted">Projects where you&rsquo;re the manager land here. Set yourself as manager to see them.</p>
        </div>
      ) : (
        <StaggerList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.slice(0, 9).map((p) => {
            const status = p.status as string;
            const pill = getStatusColor("project", status);
            const client = p.client as { name?: string } | null;
            const equip = (p._count as { lineItems?: number } | undefined)?.lineItems ?? 0;
            const dateLine = projectDateLine(p, formatDateDayMonth);
            const pBlockers = blockersByProject.get(p.id as string) ?? [];
            const latest = pBlockers[0];
            return (
              <StaggerItem key={p.id as string}>
                <Link
                  href={`/projects/${p.id as string}`}
                  className={cn(
                    "group flex h-full flex-col rounded-[var(--r-lg)] border bg-paper-2/40 p-4 shadow-[var(--sh-card)] transition-all motion-safe:hover:-translate-y-0.5 hover:bg-paper-2 hover:shadow-[var(--sh-hover)]",
                    focusRing,
                    pBlockers.length > 0 ? "border-t-out/40" : "border-line",
                  )}
                >
                  {/* status + urgency */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", pill.pill)}>
                      {projectStatusLabels[status] || status}
                    </span>
                    {dateLine && (
                      <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", toneText[dateLine.tone])}>
                        <CalendarClock className="h-3 w-3" /> {dateLine.text}
                      </span>
                    )}
                  </div>

                  {/* title */}
                  <p className="mt-2.5 truncate text-[15px] font-semibold text-ink">{p.name as string}</p>
                  <p className="t-micro truncate text-muted">
                    <span className="font-mono">{p.projectNumber as string}</span>
                    {client?.name ? <> · {client.name}</> : null}
                  </p>


                  {/* footer: gear + blockers */}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className="inline-flex items-center gap-1 t-micro text-muted">
                      <Boxes className="h-3.5 w-3.5" /> {equip} item{equip === 1 ? "" : "s"}
                    </span>
                    {pBlockers.length > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-out-soft px-2 py-0.5 text-[11px] font-medium text-t-out">
                        <ShieldAlert className="h-3 w-3" /> {pBlockers.length} blocker{pBlockers.length > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 t-micro text-ok">
                        <CheckCircle2 className="h-3 w-3" /> on track
                      </span>
                    )}
                  </div>

                  {/* latest blocker snippet */}
                  {latest && (
                    <div className="mt-2 rounded-[var(--r)] bg-out-soft px-2.5 py-1.5">
                      <p className="flex items-center gap-1 truncate text-[11px] text-t-out">
                        {latest.reason === "mention" && <AtSign className="h-2.5 w-2.5 shrink-0" />}
                        <span className="truncate">{(latest.snippet as string) || "Needs a decision"}</span>
                      </p>
                    </div>
                  )}
                </Link>
              </StaggerItem>
            );
          })}
        </StaggerList>
      )}
    </section>
  );
}

// ─── Tasks-due block ────────────────────────────────────────────

const TASK_STATUS_ICON: Record<string, typeof Circle> = {
  DONE: CheckCircle2,
  IN_PROGRESS: CircleDot,
  TODO: Circle,
};
const TASK_STATUS_ICON_TEXT: Record<string, string> = {
  DONE: "text-primary",
  IN_PROGRESS: "text-blue",
  TODO: "text-muted",
};

function TasksDueBlock({
  tasks,
  moreCount,
  formatDateDayMonth,
}: {
  tasks: TaskDue[];
  moreCount: number;
  formatDateDayMonth: (date: Date) => string;
}) {
  return (
    <div className="space-y-1.5 border-b border-line pb-4">
      <div className="flex items-center justify-between gap-2">
        <span className="t-overline text-muted">Tasks due</span>
        {moreCount > 0 && (
          <Link
            href="/my-tasks"
            className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-red hover:underline", focusRing)}
          >
            {moreCount} more <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="space-y-0.5">
        {tasks.map((t) => (
          <TaskDueRow key={t.id as string} task={t} formatDateDayMonth={formatDateDayMonth} />
        ))}
      </div>
    </div>
  );
}

function TaskDueRow({ task, formatDateDayMonth }: { task: TaskDue; formatDateDayMonth: (date: Date) => string }) {
  const due = taskDueLabel(task, formatDateDayMonth);
  const status = task.status as string;
  const StatusIcon = TASK_STATUS_ICON[status] ?? Circle;
  return (
    <Link
      href={`/projects/${task.projectId as string}`}
      className={cn(
        "group flex items-center justify-between gap-2 rounded-[var(--r)] px-2 py-1.5 transition-colors hover:bg-elev",
        focusRing,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", TASK_STATUS_ICON_TEXT[status] ?? "text-muted")} />
        <span className="truncate text-[13px] text-ink-2">{task.title as string}</span>
      </span>
      {due && (
        <span className={cn("shrink-0 text-[11px] font-medium", due.overdue ? "text-t-out" : "text-muted")}>
          {due.text}
        </span>
      )}
    </Link>
  );
}
