"use client";

import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import type { Task } from "./tasks-panel";
import { TASK_PRIORITY_LABELS } from "@/lib/project-tasks";
import { spanDays, spanCaption, type SpanPosition } from "@/lib/work-calendar-spans";
import { formatCalendarDate } from "@/lib/work-due-dates";
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
 *
 * **A span (#tae40e) appears on every day it runs**, not only on its due date.
 * With no grid to draw a bar across, repetition IS the bar: the row shows up
 * under each day from its start to its deadline, marked start / middle / end
 * and captioned "day 2 of 3", so the strip reads as one continuous thing
 * rather than three items that happen to share a name. `spanDays` owns that
 * arithmetic (and its unit tests); this file only draws the result.
 */

const UNDATED = "undated";

function dayLabel(key: string): string {
  if (key === UNDATED) return "No due date";
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * One row on one day.
 *
 * The left rail is what makes a repeated row read as a continuous run instead
 * of three separate items: a middle day gets a full-height line, an end gets a
 * half one, and a point gets nothing at all. It is the only "bar" a day-strip
 * can honestly draw.
 */
function CalendarRow({
  task,
  day,
  position,
  today,
  onOpen,
}: {
  task: Task;
  day: string;
  position: SpanPosition;
  today: string;
  onOpen: (task: Task) => void;
}) {
  const assigneeName =
    task.assigneeUser?.name ||
    (task.assigneeCrew && `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim()) ||
    null;
  const caption = spanCaption(task, day, (d) => formatCalendarDate(d, today));

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-select/40", focusRing)}
    >
      {position !== "point" && (
        <span className="flex h-6 w-1 shrink-0 items-center" aria-hidden>
          <span
            className={cn(
              "w-1 rounded-full bg-blue",
              position === "start" && "h-3 self-end",
              position === "middle" && "h-6",
              position === "end" && "h-3 self-start",
            )}
          />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-table-cell text-ink-2",
            task.status === "DONE" && "text-muted line-through",
          )}
        >
          {task.title}
        </span>
        {caption && <span className="block truncate text-[10px] text-faint">{caption}</span>}
      </span>
      {task.priority === "HIGH" && (
        <span className="shrink-0 text-badge font-medium text-t-out">{TASK_PRIORITY_LABELS.HIGH}</span>
      )}
      {assigneeName && (
        <PersonAvatar name={assigneeName} src={task.assigneeUser?.image ?? undefined} className="size-5 border-0 shrink-0" />
      )}
    </button>
  );
}

export function WorkCalendarView({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const groups = useMemo(() => {
    const byDay = new Map<string, { task: Task; position: SpanPosition }[]>();
    const push = (key: string, entry: { task: Task; position: SpanPosition }) => {
      const list = byDay.get(key) ?? [];
      list.push(entry);
      byDay.set(key, list);
    };
    for (const task of tasks) {
      const days = spanDays(task);
      // No date at all — the one case `spanDays` places nowhere, because
      // "nowhere" on a calendar is its own bucket rather than a day.
      if (days.length === 0) {
        push(UNDATED, { task, position: "point" });
        continue;
      }
      for (const { day, position } of days) push(day, { task, position });
    }
    const dated = [...byDay.keys()].filter((k) => k !== UNDATED).sort();
    const ordered = byDay.has(UNDATED) ? [...dated, UNDATED] : dated;
    return ordered.map((key) => ({ key, label: dayLabel(key), entries: byDay.get(key) ?? [] }));
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
            <span className="text-faint">{group.entries.length}</span>
          </h4>
          <div className="divide-y divide-line rounded-[var(--r)] border border-line">
            {group.entries.map(({ task, position }) => (
              <CalendarRow
                key={`${task.id}:${group.key}`}
                task={task}
                day={group.key}
                position={position}
                today={today}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
