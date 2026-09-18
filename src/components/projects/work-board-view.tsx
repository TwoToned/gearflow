"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, GripVertical } from "lucide-react";
import { TASK_STAGES, TASK_STAGE_LABELS, TASK_PRIORITY_LABELS, type ProjectTaskStage } from "@/lib/project-tasks";
import type { Task } from "./tasks-panel";
import { PersonAvatar } from "@/components/ui/avatar";
import { cn, focusRing } from "@/lib/utils";

/**
 * Work tab — board view (#1244, design §8.3): one column per stage, drag
 * within a column to reorder, drag across columns to change stage. Same
 * dnd-kit setup as the Equipment tab's own drag-reorder
 * (`use-equipment-dnd.ts`) — ONE PointerSensor with a delay-based
 * `activationConstraint` (covers mouse/touch/pen without a second sensor
 * racing it) plus a KeyboardSensor with `sortableKeyboardCoordinates` — kept
 * self-contained here rather than importing that hook, which is deeply
 * specialised to line items/groups/categories' own container shapes.
 *
 * A stageless task gets its own trailing "No stage" column so a click-drag
 * never has to find a task with nowhere to land.
 */

const NO_STAGE = "none" as const;
type ColumnId = ProjectTaskStage | typeof NO_STAGE;
const COLUMN_IDS: ColumnId[] = [...TASK_STAGES, NO_STAGE];
const COLUMN_LABELS: Record<ColumnId, string> = { ...TASK_STAGE_LABELS, [NO_STAGE]: "No stage" };

function columnOf(task: Task): ColumnId {
  return (task.stage as ProjectTaskStage | undefined) ?? NO_STAGE;
}

function buildColumns(tasks: Task[]): Record<ColumnId, string[]> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const cols = Object.fromEntries(COLUMN_IDS.map((c) => [c, [] as string[]])) as Record<ColumnId, string[]>;
  for (const t of tasks) cols[columnOf(t)].push(t.id);
  // stable order within a column: existing sortOrder, then createdAt-ish (id) fallback
  for (const c of COLUMN_IDS) {
    cols[c].sort((a, b) => (byId.get(a)?.dueDate ?? "").localeCompare(byId.get(b)?.dueDate ?? "") || a.localeCompare(b));
  }
  return cols;
}

/** Which column a drop landed on — the target `over.id` is either a column
 *  itself (an empty column's own droppable) or a card inside one. Split out
 *  of `handleDragEnd` (R-3.6) so that handler stays a thin dispatcher. */
function resolveDropColumn(overId: string, columnFor: (id: string) => ColumnId | null): ColumnId | null {
  return (COLUMN_IDS as string[]).includes(overId) ? (overId as ColumnId) : columnFor(overId);
}

/** Same-column drag: the new order for that one column, or `null` for a
 *  no-op drop (index unchanged / ids not found). Pure — unit-testable
 *  without mounting dnd-kit. */
export function reorderWithinColumn(list: string[], activeId: string, overId: string, col: ColumnId): string[] | null {
  const oldIndex = list.indexOf(activeId);
  const newIndex = overId === col ? list.length - 1 : list.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null;
  return arrayMove(list, oldIndex, newIndex);
}

/** Cross-column drag: the source column with the item removed, and the
 *  destination column with it inserted at the dropped position. Pure —
 *  unit-testable without mounting dnd-kit. */
export function moveAcrossColumns(
  sourceList: string[],
  destList: string[],
  activeId: string,
  overId: string,
  toCol: ColumnId,
): { sourceList: string[]; destList: string[] } {
  const nextSource = sourceList.filter((id) => id !== activeId);
  const nextDest = destList.filter((id) => id !== activeId);
  const insertAt = overId === toCol ? nextDest.length : Math.max(0, nextDest.indexOf(overId));
  nextDest.splice(insertAt, 0, activeId);
  return { sourceList: nextSource, destList: nextDest };
}

export interface WorkBoardViewProps {
  tasks: Task[];
  onOpen: (task: Task) => void;
  /** Persist a column's new order (siblings within that ONE column only). */
  onReorderColumn: (orderedIds: string[]) => void | Promise<void>;
  /** Persist a task's new stage after a cross-column drop. */
  onMoveStage: (taskId: string, stage: ProjectTaskStage | null) => void | Promise<void>;
}

export function WorkBoardView({ tasks, onOpen, onReorderColumn, onMoveStage }: WorkBoardViewProps) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [columns, setColumns] = useState<Record<ColumnId, string[]>>(() => buildColumns(tasks));
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync from the live query whenever the task SET changes (create/delete/
  // external edit) — but not on every render, so an in-flight drag's local
  // reorder isn't stomped by the same subscription tick that's about to
  // carry the write's own result back anyway.
  const fingerprint = tasks.map((t) => `${t.id}:${t.stage ?? ""}`).sort().join("|");
  useEffect(() => {
    setColumns(buildColumns(tasks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  function columnFor(id: string): ColumnId | null {
    for (const c of COLUMN_IDS) if (columns[c].includes(id)) return c;
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    const fromCol = columnFor(activeIdStr);
    if (!fromCol) return;
    const toCol = resolveDropColumn(overIdStr, columnFor);
    if (!toCol) return;

    if (fromCol === toCol) {
      const next = reorderWithinColumn(columns[fromCol], activeIdStr, overIdStr, toCol);
      if (!next) return;
      setColumns((prev) => ({ ...prev, [fromCol]: next }));
      void onReorderColumn(next);
      return;
    }

    const moved = moveAcrossColumns(columns[fromCol], columns[toCol], activeIdStr, overIdStr, toCol);
    setColumns((prev) => ({ ...prev, [fromCol]: moved.sourceList, [toCol]: moved.destList }));
    void onMoveStage(activeIdStr, toCol === NO_STAGE ? null : toCol);
    void onReorderColumn(moved.destList);
  }

  const activeTask = activeId ? byId.get(activeId) ?? null : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMN_IDS.map((col) => (
          <BoardColumn key={col} id={col} label={COLUMN_LABELS[col]} taskIds={columns[col]} byId={byId} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <BoardCard task={activeTask} onOpen={() => {}} dragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  id,
  label,
  taskIds,
  byId,
  onOpen,
}: {
  id: ColumnId;
  label: string;
  taskIds: string[];
  byId: Map<string, Task>;
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-table-cell font-semibold text-ink">{label}</span>
        <span className="t-micro text-muted">{taskIds.length}</span>
      </div>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-16 flex-col gap-2 rounded-[var(--r-lg)] p-1 transition-colors",
            isOver && "bg-select/40",
          )}
        >
          {taskIds.length === 0 ? (
            <div className="rounded-[var(--r-lg)] border border-dashed border-line/60 py-6 text-center">
              <p className="t-micro text-faint">Empty</p>
            </div>
          ) : (
            taskIds.map((id) => {
              const task = byId.get(id);
              if (!task) return null;
              return <BoardCard key={id} task={task} onOpen={() => onOpen(task)} />;
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function assigneeNameOf(task: Task): string | null {
  return (
    task.assigneeUser?.name ||
    (task.assigneeCrew && `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim()) ||
    null
  );
}

function isOverdue(task: Task): boolean {
  return task.dueDate != null && new Date(task.dueDate) < new Date() && task.status !== "DONE";
}

/** Split out of BoardCard (R-3.6) — the priority/due/assignee meta row. */
function BoardCardMeta({ task }: { task: Task }) {
  const overdue = isOverdue(task);
  const assigneeName = assigneeNameOf(task);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {task.priority !== "NORMAL" && (
        <span className="text-badge font-medium text-faint">{TASK_PRIORITY_LABELS[task.priority]}</span>
      )}
      {task.dueDate && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-badge font-medium",
            overdue ? "bg-out-soft text-t-out" : "bg-paper-2 text-muted",
          )}
        >
          <CalendarClock className="h-3 w-3" />
          {new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
      {assigneeName && <PersonAvatar name={assigneeName} src={task.assigneeUser?.image ?? undefined} className="size-5 border-0" />}
    </div>
  );
}

function BoardCard({ task, onOpen, dragOverlay }: { task: Task; onOpen: () => void; dragOverlay?: boolean }) {
  // Destructured immediately — matches equipment-tab.tsx's per-row
  // `useSortable()` pattern, which avoids `react-hooks/refs` heuristically
  // flagging property reads off a hook-returned object as a ref access.
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: task.id, disabled: dragOverlay });
  const style = dragOverlay ? undefined : { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={dragOverlay ? undefined : setNodeRef}
      style={style}
      className={cn(
        "group flex items-start gap-2 rounded-[var(--r-lg)] border border-line bg-card p-2.5 shadow-[var(--sh-card)]",
        isDragging && "opacity-40",
        dragOverlay && "shadow-[var(--sh-hover)]",
      )}
    >
      <button
        type="button"
        className={cn("mt-0.5 shrink-0 cursor-grab touch-none rounded-sm text-faint hover:text-muted active:cursor-grabbing", focusRing)}
        {...(dragOverlay ? {} : attributes)}
        {...(dragOverlay ? {} : listeners)}
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-3.5" />
      </button>
      <button type="button" onClick={onOpen} className={cn("min-w-0 flex-1 text-left", focusRing, "rounded-sm")}>
        <p className={cn("truncate text-ui-text text-ink-2", task.status === "DONE" && "text-muted line-through")}>
          {task.title}
        </p>
        <BoardCardMeta task={task} />
      </button>
    </div>
  );
}
