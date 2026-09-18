"use client";

import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import type { Task } from "./tasks-panel";
import { TASK_PRIORITY_LABELS } from "@/lib/project-tasks";
import { PersonAvatar } from "@/components/ui/avatar";
import { cn, focusRing } from "@/lib/utils";

/**
 * Work tab — calendar view (#1244, design §8.3: "list / board / calendar
 * toggle over ONE query"). Read-only day-strip: every dated item grouped
 * under its own due date, chronological, with an "Undated" bucket last.
 * Deliberately not a full month grid — no calendar/date-grid library exists
 * in the tree (CLAUDE.md's charting/virtualisation rule applies the same
 * way to a calendar widget), and a day-strip already answers "what's due
 * when" for a single project's task list without introducing one.
 */

const UNDATED = "undated";

function dayKey(dueDate: string | null): string {
  if (!dueDate) return UNDATED;
  return dueDate.slice(0, 10);
}

function dayLabel(key: string): string {
  if (key === UNDATED) return "No due date";
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function WorkCalendarView({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const groups = useMemo(() => {
    const byDay = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = dayKey(t.dueDate);
      const list = byDay.get(key) ?? [];
      list.push(t);
      byDay.set(key, list);
    }
    const dated = [...byDay.keys()].filter((k) => k !== UNDATED).sort();
    const ordered = byDay.has(UNDATED) ? [...dated, UNDATED] : dated;
    return ordered.map((key) => ({ key, label: dayLabel(key), tasks: byDay.get(key) ?? [] }));
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-[var(--r-lg)] border-2 border-dashed border-line-2 py-10 text-center">
        <CalendarClock className="mx-auto h-8 w-8 text-muted" />
        <p className="mt-2 text-ui-text font-medium text-ink-2">Nothing on the calendar</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} className="space-y-1.5">
          <h4 className="flex items-center gap-2 t-overline text-muted">
            {group.label}
            {group.key !== UNDATED && group.key < today && (
              <span className="rounded-full bg-out-soft px-1.5 py-0.5 text-badge font-medium text-t-out">Overdue</span>
            )}
            <span className="text-faint">{group.tasks.length}</span>
          </h4>
          <div className="divide-y divide-line rounded-[var(--r)] border border-line">
            {group.tasks.map((task) => {
              const assigneeName =
                task.assigneeUser?.name ||
                (task.assigneeCrew && `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim()) ||
                null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpen(task)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-select/40", focusRing)}
                >
                  <span
                    className={cn(
                      "truncate flex-1 text-table-cell text-ink-2",
                      task.status === "DONE" && "text-muted line-through",
                    )}
                  >
                    {task.title}
                  </span>
                  {task.priority === "HIGH" && (
                    <span className="shrink-0 text-badge font-medium text-t-out">{TASK_PRIORITY_LABELS.HIGH}</span>
                  )}
                  {assigneeName && (
                    <PersonAvatar name={assigneeName} src={task.assigneeUser?.image ?? undefined} className="size-5 border-0 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
