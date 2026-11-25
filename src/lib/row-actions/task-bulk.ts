import { CheckCircle2, Trash2 } from "lucide-react";

import type { BulkAction } from "@/lib/primitives/types";
import type { DueShortcut } from "@/lib/row-actions/task-row";

/**
 * The Tasks section's bulk verbs (UX Phase 10, spec §8c): Assign ▾ · Due ▾ · Mark
 * done · Delete, over the existing `bulkUpdateNative` / `bulkDeleteNative`. Every
 * label carries the count; Delete is last and danger, and asks nothing because its
 * toast offers an exact Undo (`restoreDeletedNative`). One `BulkBar` is the
 * only bulk surface.
 */
export interface Assignable {
  users: { id: string; name: string }[];
  crew: { id: string; firstName: string; lastName: string }[];
}

export type AssignTarget = { userId: string } | { crewId: string } | "none";

export interface TaskBulkHandlers {
  onAssign: (target: AssignTarget) => void;
  onDue: (when: DueShortcut) => void;
  onDone: () => void;
  onDelete: () => void;
}

function assignChildren(assignees: Assignable | undefined, onAssign: (t: AssignTarget) => void): BulkAction[] {
  const people: BulkAction[] = [
    ...(assignees?.users ?? []).map((u) => ({ key: `assign-u-${u.id}`, label: () => u.name, group: "edit" as const, onSelect: () => onAssign({ userId: u.id }) })),
    ...(assignees?.crew ?? []).map((c) => ({
      key: `assign-c-${c.id}`,
      label: () => `${c.firstName} ${c.lastName} (crew)`,
      group: "edit" as const,
      onSelect: () => onAssign({ crewId: c.id }),
    })),
  ];
  return [{ key: "assign-none", label: () => "Unassigned", group: "edit" as const, onSelect: () => onAssign("none") }, ...people];
}

export function buildTaskBulkActions(assignees: Assignable | undefined, h: TaskBulkHandlers): BulkAction[] {
  return [
    { key: "assign", label: (n) => `Assign ${n}`, group: "organise", onSelect: () => {}, children: assignChildren(assignees, h.onAssign) },
    {
      key: "due",
      label: (n) => `Due ${n}`,
      group: "organise",
      onSelect: () => {},
      children: [
        { key: "due-today", label: () => "Today", group: "edit", onSelect: () => h.onDue("today") },
        { key: "due-tomorrow", label: () => "Tomorrow", group: "edit", onSelect: () => h.onDue("tomorrow") },
        { key: "due-next-week", label: () => "Next week", group: "edit", onSelect: () => h.onDue("nextWeek") },
        { key: "due-clear", label: () => "No date", group: "edit", onSelect: () => h.onDue("clear") },
      ],
    },
    { key: "done", label: (n) => `Mark done ${n}`, group: "organise", icon: CheckCircle2, onSelect: h.onDone },
    { key: "delete", label: (n) => `Delete ${n}`, group: "danger", icon: Trash2, danger: true, onSelect: h.onDelete },
  ];
}
