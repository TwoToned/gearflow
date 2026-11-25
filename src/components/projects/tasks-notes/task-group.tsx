"use client";

import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { TaskRow, type TaskRowProps } from "@/components/projects/tasks-notes/task-row";
import type { TaskGroup as TaskGroupData } from "@/lib/project-task-groups";

/**
 * One group of tasks (Overdue, Today, ...). Rows drag within THEIR group only
 * (spec §8c: reorder uses the existing `reorderNative`; `sortOrder` is one value
 * per project, so a drag never moves a task across groups; the due menu changes the
 * day). The grip is absent while reordering makes no sense (Select mode, one task).
 */
type RowProps = Omit<TaskRowProps, "task" | "overdue" | "selected" | "grip" | "onSelectedChange" | "onEdit" | "onToggleDone" | "onSetDue" | "onAssign" | "onDelete">;

export interface TaskGroupProps {
  group: TaskGroupData;
  reorderable: boolean;
  onReorder: (activeId: string, overId: string, groupIds: string[]) => void;
  isOverdue: (taskId: string) => boolean;
  isSelected: (taskId: string) => boolean;
  rowHandlers: (task: TaskGroupData["tasks"][number]) => Pick<TaskRowProps, "onSelectedChange" | "onEdit" | "onToggleDone" | "onSetDue" | "onAssign" | "onDelete">;
  rowProps: RowProps;
}

function SortableTaskRow({ props, reorderable }: { props: TaskRowProps; reorderable: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    disabled: !reorderable,
  });
  const grip = reorderable ? { setRef: setActivatorNodeRef, props: { ...attributes, ...listeners } as React.HTMLAttributes<HTMLElement> } : undefined;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <ul>
        <TaskRow {...props} grip={grip} />
      </ul>
    </div>
  );
}

export function TaskGroupList({ group, reorderable, onReorder, isOverdue, isSelected, rowHandlers, rowProps }: TaskGroupProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = group.tasks.map((t) => t.id);
  const canDrag = reorderable && ids.length > 1;
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) onReorder(String(e.active.id), String(e.over.id), ids);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {group.tasks.map((task) => (
          <SortableTaskRow
            key={task.id}
            reorderable={canDrag}
            props={{ ...rowProps, ...rowHandlers(task), task, overdue: isOverdue(task.id), selected: isSelected(task.id) }}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
