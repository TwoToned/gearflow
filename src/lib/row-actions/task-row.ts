import { CalendarDays, CheckCircle2, Pencil, RotateCcw, Trash2 } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import { isOpenTask } from "@/lib/project-task-groups";
import type { ProjectTaskRow } from "@/lib/project-tasks";

/**
 * A task row's ⋯ (UX Phase 10, spec §8c): Edit… · Mark done / Reopen · Due ▸ ·
 * Delete. An action that does not apply is ABSENT. Delete asks nothing: it toasts
 * with an exact Undo (`restoreDeletedNative`), so it carries no confirm.
 */
export type DueShortcut = "today" | "tomorrow" | "nextWeek" | "clear";

export interface TaskRowHandlers {
  onEdit: () => void;
  onToggleDone: () => void;
  onSetDue: (when: DueShortcut) => void;
  onDelete: () => void;
}

/** The shared due shortcuts (used by the row's date menu as well), `Clear` only when a date is set. */
export function dueShortcutItems(hasDue: boolean, onSetDue: (when: DueShortcut) => void): ActionItem[] {
  const items: ActionItem[] = [
    { key: "due-today", label: "Today", group: "edit", onSelect: () => onSetDue("today") },
    { key: "due-tomorrow", label: "Tomorrow", group: "edit", onSelect: () => onSetDue("tomorrow") },
    { key: "due-next-week", label: "Next week", group: "edit", onSelect: () => onSetDue("nextWeek") },
  ];
  if (hasDue) items.push({ key: "due-clear", label: "No date", group: "edit", onSelect: () => onSetDue("clear") });
  return items;
}

export function buildTaskRowActions(task: Pick<ProjectTaskRow, "status" | "dueDate">, h: TaskRowHandlers): ActionMenuSpec {
  const open = isOpenTask(task);
  const items: ActionItem[] = [
    { key: "edit", label: "Edit…", group: "edit", icon: Pencil, kbd: "E", onSelect: h.onEdit },
    open
      ? { key: "done", label: "Mark done", group: "organise", icon: CheckCircle2, onSelect: h.onToggleDone }
      : { key: "reopen", label: "Reopen", group: "organise", icon: RotateCcw, onSelect: h.onToggleDone },
    { key: "due", label: "Due", group: "organise", icon: CalendarDays, onSelect: () => {}, children: dueShortcutItems(task.dueDate != null, h.onSetDue) },
    { key: "delete", label: "Delete", group: "danger", icon: Trash2, danger: true, onSelect: h.onDelete },
  ];
  return { items };
}
