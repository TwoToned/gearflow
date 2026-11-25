"use client";

import * as React from "react";

import { BulkBar } from "@/components/ui/bulk-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskAddRow } from "@/components/projects/tasks-notes/task-add-row";
import { TaskGroupList } from "@/components/projects/tasks-notes/task-group";
import { TaskSheet } from "@/components/projects/tasks-notes/task-sheet";
import { useSession } from "@/lib/auth-client";
import { useTaskActions } from "@/hooks/use-task-actions";
import { useTaskDueClock } from "@/hooks/use-task-due-clock";
import { useProjectTaskList } from "@/hooks/use-project-task-list";
import {
  TASK_FILTERS,
  doneGroupLabel,
  dueShortcutDate,
  groupTasks,
  reorderWithinGroup,
  type TaskFilter,
} from "@/lib/project-task-groups";
import type { ProjectTaskRow } from "@/lib/project-tasks";
import { assignLabel, assignPatch, buildTaskBulkActions, type AssignTarget } from "@/lib/row-actions/task-bulk";
import type { DueShortcut } from "@/lib/row-actions/task-row";
import { isTaskOverdue } from "../../../../convex/lib/taskDue";
import { cn, focusRing } from "@/lib/utils";

/**
 * The Tasks section (UX Phase 10, spec §8c): tasks grouped by WHEN, chips
 * `Open · Mine · Done · All` and a search, an add row at the top, a Select mode with
 * the one `BulkBar`, drag to reorder within a group, and a task sheet. Every write
 * is `useTaskActions`: one toast with an exact, ids-only Undo. Overdue is the ONE
 * rule (`convex/lib/taskDue.ts`, the org's timezone); until the org's settings have
 * loaded nothing is flagged overdue (never a guess in the wrong zone).
 * Mount with `key={orgId}`: an org switch must drop the selection.
 */

const dueLabel: Record<DueShortcut, string> = { today: "Due today", tomorrow: "Due tomorrow", nextWeek: "Due next week", clear: "Cleared the date" };

function Toolbar(p: {
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  search: string;
  onSearch: (s: string) => void;
  selectMode: boolean;
  onToggleSelect: () => void;
  canSelect: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div role="group" aria-label="Show tasks" className="flex items-center gap-3">
        {TASK_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={p.filter === f.value}
            onClick={() => p.onFilter(f.value)}
            className={cn("rounded-sm text-ui-text [@media(pointer:coarse)]:min-h-11", p.filter === f.value ? "font-medium text-ink underline underline-offset-4" : "text-muted hover:text-ink", focusRing)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        value={p.search}
        onChange={(e) => p.onSearch(e.target.value)}
        placeholder="Search tasks"
        aria-label="Search tasks"
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-base text-ink outline-none placeholder:text-muted md:text-ui-text"
      />
      {p.canSelect && (
        <button type="button" onClick={p.onToggleSelect} className={cn("rounded-sm text-ui-text text-muted hover:text-ink", focusRing)}>
          {p.selectMode ? "Done selecting" : "Select"}
        </button>
      )}
    </div>
  );
}

export function TasksSection({ projectId }: { projectId: string }) {
  const { tasks, isLoading, refetch, assignees } = useProjectTaskList(projectId);
  const actions = useTaskActions(projectId, refetch);
  const { now, timezone, ready } = useTaskDueClock();
  const { data: session } = useSession();
  const userId = session?.user.id;

  const [filter, setFilter] = React.useState<TaskFilter>("open");
  const [search, setSearch] = React.useState("");
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = React.useState<ProjectTaskRow | null>(null);
  const [doneOpen, setDoneOpen] = React.useState(false);

  const groups = React.useMemo(() => groupTasks(tasks, { filter, search, userId, now, timezone }), [tasks, filter, search, userId, now, timezone]);
  const byId = React.useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const allOrdered = React.useMemo(() => tasks.map((t) => t.id), [tasks]); // the read is already in sortOrder

  const overdue = (id: string) => {
    const t = byId.get(id);
    return ready && !!t && isTaskOverdue({ status: t.status, dueDate: t.dueDate ? new Date(t.dueDate).getTime() : null }, now, timezone);
  };
  const clearSelection = () => setSelected(new Set());
  const exitSelect = () => {
    setSelectMode(false);
    clearSelection();
  };

  const assigneesForMenus = assignees ? { users: assignees.users, crew: assignees.crew } : undefined;
  const setDue = (task: ProjectTaskRow, when: DueShortcut) =>
    actions.patch(task, { dueDate: dueShortcutDate(when, now, timezone) }, `${dueLabel[when]} · “${task.title}”`, `Put the date back on “${task.title}”`);
  const assign = (task: ProjectTaskRow, target: AssignTarget) =>
    actions.patch(task, assignPatch(target), `${assignLabel(target, assigneesForMenus)} · “${task.title}”`, `Put the assignee back on “${task.title}”`);
  const bulk = async (run: () => Promise<void>) => {
    await run();
    clearSelection();
  };

  const bulkActions = buildTaskBulkActions(assigneesForMenus, {
    onAssign: (t) => bulk(() => actions.bulkPatch([...selected], assignPatch(t), `Assigned ${assignLabel(t, assigneesForMenus)}`)),
    onDue: (when) => bulk(() => actions.bulkPatch([...selected], { dueDate: dueShortcutDate(when, now, timezone) }, dueLabel[when])),
    onDone: () => bulk(() => actions.bulkPatch([...selected], { status: "DONE" }, "Done")),
    onDelete: () => bulk(() => actions.bulkRemove([...selected])),
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />;

  return (
    <div className="space-y-3">
      <Toolbar
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        selectMode={selectMode}
        onToggleSelect={() => (selectMode ? exitSelect() : setSelectMode(true))}
        canSelect={tasks.length > 0}
      />
      <TaskAddRow assignees={assigneesForMenus} now={now} timezone={timezone} onAdd={(title, extra) => void actions.create(title, extra)} />

      {tasks.length === 0 ? (
        <p className="t-micro text-muted">No tasks yet.</p>
      ) : groups.length === 0 ? (
        <p className="t-micro text-muted">Nothing matches.</p>
      ) : (
        groups.map((group) => {
          const isDone = group.key === "DONE";
          const collapsed = isDone && !doneOpen && filter !== "done";
          return (
            <section key={group.key} aria-label={group.label}>
              <h3 className="mb-1 flex items-center gap-2 text-overline uppercase tracking-wide">
                {isDone ? (
                  <button type="button" aria-expanded={!collapsed} onClick={() => setDoneOpen((o) => !o)} className={cn("text-muted hover:text-ink", focusRing)}>
                    {doneGroupLabel(group.tasks)}
                  </button>
                ) : (
                  <span className={group.key === "OVERDUE" ? "text-error" : group.key === "TODAY" ? "text-warn" : "text-muted"}>
                    {group.label} <span className="text-muted">{group.tasks.length}</span>
                  </span>
                )}
              </h3>
              {!collapsed && (
                <TaskGroupList
                  group={group}
                  reorderable={!selectMode}
                  onReorder={(activeId, overId, groupIds) => {
                    const next = reorderWithinGroup(allOrdered, groupIds, activeId, overId);
                    if (next) void actions.reorder(next);
                  }}
                  isOverdue={overdue}
                  isSelected={(id) => selected.has(id)}
                  rowProps={{ assignees: assigneesForMenus, selectMode }}
                  rowHandlers={(task) => ({
                    onSelectedChange: (checked) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(task.id);
                        else next.delete(task.id);
                        return next;
                      }),
                    onEdit: () => setEditing(task),
                    onToggleDone: () => void actions.toggleDone(task),
                    onSetDue: (when) => void setDue(task, when),
                    onAssign: (target) => void assign(task, target),
                    onDelete: () => void actions.remove(task),
                  })}
                />
              )}
            </section>
          );
        })
      )}

      {selectMode && selected.size > 0 && <BulkBar selection={{ count: selected.size, clear: clearSelection }} actions={bulkActions} noun="task" />}

      {editing && (
        <TaskSheet
          task={editing}
          assignees={assigneesForMenus}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            const task = editing;
            setEditing(null);
            void actions.patch(task, data, `Saved “${data.title ?? task.title}”`, `Put “${task.title}” back`);
          }}
          onDelete={() => {
            const task = editing;
            setEditing(null);
            void actions.remove(task);
          }}
        />
      )}
    </div>
  );
}
