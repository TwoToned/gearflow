"use client";

import * as React from "react";
import { Check, GripVertical } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { TaskLinkChips } from "@/components/projects/tasks-notes/task-link-chips";
import type { TaskLink } from "@/lib/task-links";
import { formatDateInTimezone } from "@/lib/formatters";
import type { ActionItem } from "@/lib/primitives/types";
import { isOpenTask } from "@/lib/project-task-groups";
import { TASK_PRIORITY_LABELS, type ProjectTaskRow } from "@/lib/project-tasks";
import type { Assignable, AssignTarget } from "@/lib/row-actions/task-bulk";
import { buildTaskRowActions, dueShortcutItems, type DueShortcut } from "@/lib/row-actions/task-row";
import { cn, focusRing } from "@/lib/utils";

/**
 * One task row (UX Phase 10, spec §8c): completion circle (a checkbox in Select
 * mode), title, `High`/`Low` tag, `In progress` only when it is, a one-line
 * description, the assignee and due date as muted words that ARE the menus, and ⋯.
 * Red only on `overdue`. Every write goes through the callbacks (one toast + Undo
 * in `useTaskActions`); the row owns no state.
 */

export interface TaskRowProps {
  task: ProjectTaskRow;
  overdue: boolean;
  assignees: Assignable | undefined;
  selectMode: boolean;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  /** Drag handle wiring (within-group reorder); absent = not draggable (a filter is on, or one task). */
  grip?: { setRef: (el: HTMLElement | null) => void; props: React.HTMLAttributes<HTMLElement> };
  onEdit: () => void;
  onToggleDone: () => void;
  onSetDue: (when: DueShortcut) => void;
  onAssign: (target: AssignTarget) => void;
  onDelete: () => void;
  /** This task's links (Slice E): chips under the assignee / due line. Absent = none shown. */
  links?: readonly TaskLink[];
  onOpenLink?: (link: TaskLink) => void;
}

const assigneeName = (t: ProjectTaskRow): string | null =>
  t.assigneeUser?.name ?? (t.assigneeCrew ? `${t.assigneeCrew.firstName} ${t.assigneeCrew.lastName}`.trim() : null);

function CompletionControl({ task, selectMode, selected, onSelectedChange, onToggleDone }: Pick<TaskRowProps, "task" | "selectMode" | "selected" | "onSelectedChange" | "onToggleDone">) {
  if (selectMode) {
    return <Checkbox checked={selected} onCheckedChange={(c) => onSelectedChange(c === true)} aria-label={`Select ${task.title}`} />;
  }
  const open = isOpenTask(task);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!open}
      aria-label={open ? `Complete ${task.title}` : `Reopen ${task.title}`}
      onClick={onToggleDone}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 [@media(pointer:coarse)]:size-6",
        open ? "border-line hover:border-ink-2" : "border-ok bg-ok text-paper",
        focusRing,
      )}
    >
      {!open && <Check className="size-3" aria-hidden="true" />}
    </button>
  );
}

function AssigneeMenu({ task, assignees, onAssign }: Pick<TaskRowProps, "task" | "assignees" | "onAssign">) {
  const name = assigneeName(task);
  const items: ActionItem[] = [
    { key: "none", label: "Unassigned", group: "edit", onSelect: () => onAssign("none") },
    ...(assignees?.users ?? []).map((u) => ({ key: `u-${u.id}`, label: u.name, group: "edit" as const, onSelect: () => onAssign({ userId: u.id }) })),
    ...(assignees?.crew ?? []).map((c) => ({ key: `c-${c.id}`, label: `${c.firstName} ${c.lastName} (crew)`, group: "edit" as const, onSelect: () => onAssign({ crewId: c.id }) })),
  ];
  return (
    <ActionMenu
      spec={{ items }}
      label={`Assignee of ${task.title}`}
      trigger={
        <button type="button" className={cn("rounded-sm text-caption text-muted hover:text-ink hover:underline", focusRing)} aria-label={`Assignee: ${name ?? "unassigned"}`}>
          {name ?? "Assign"}
          {task.assigneeCrew ? <span className="ml-1 text-fg-4">crew</span> : null}
        </button>
      }
    />
  );
}

function DueMenu({ task, overdue, onSetDue }: Pick<TaskRowProps, "task" | "overdue" | "onSetDue">) {
  // `dueDate` is stored as UTC midnight of the typed day, so it is DISPLAYED in UTC.
  const label = task.dueDate ? formatDateInTimezone(task.dueDate, "UTC") : null;
  return (
    <ActionMenu
      spec={{ items: dueShortcutItems(task.dueDate != null, onSetDue) }}
      label={`Due date of ${task.title}`}
      trigger={
        <button
          type="button"
          className={cn("rounded-sm text-caption hover:underline", overdue ? "font-medium text-error" : "text-muted hover:text-ink", focusRing)}
          aria-label={label ? `Due ${label}${overdue ? ", overdue" : ""}` : "Set a due date"}
        >
          {label ? `${overdue ? "overdue · " : ""}${label}` : "Due"}
        </button>
      }
    />
  );
}

export function TaskRow(p: TaskRowProps) {
  const { task } = p;
  const open = isOpenTask(task);
  return (
    <li className="group flex items-start gap-2 border-b border-line py-2 last:border-b-0">
      {p.grip ? (
        <button
          type="button"
          ref={p.grip.setRef}
          aria-label={`Drag to reorder ${task.title}`}
          className={cn("mt-0.5 cursor-grab touch-none rounded-sm text-fg-4 hover:text-ink", focusRing)}
          {...(p.grip.props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <div className="pt-0.5">
        <CompletionControl {...p} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button type="button" onClick={p.onEdit} className={cn("min-w-0 truncate text-left text-ui-text", open ? "text-ink" : "text-muted line-through", focusRing)}>
            {task.title}
          </button>
          {task.priority !== "NORMAL" && <span className="text-caption font-medium text-ink-2">{TASK_PRIORITY_LABELS[task.priority]}</span>}
          {task.status === "IN_PROGRESS" && <span className="text-caption text-muted">In progress</span>}
        </div>
        {task.description ? <p className="truncate text-caption text-muted">{task.description}</p> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <AssigneeMenu task={task} assignees={p.assignees} onAssign={p.onAssign} />
          <DueMenu task={task} overdue={p.overdue} onSetDue={p.onSetDue} />
        </div>
        <div className="mt-1">
          <TaskLinkChips links={p.links} onOpen={p.onOpenLink} />
        </div>
      </div>
      <ActionMenu
        spec={buildTaskRowActions(task, { onEdit: p.onEdit, onToggleDone: p.onToggleDone, onSetDue: p.onSetDue, onDelete: p.onDelete })}
        label={`${task.title} actions`}
      />
    </li>
  );
}
