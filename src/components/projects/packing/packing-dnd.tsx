"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { resolveDrop, type DropPlan } from "@/lib/packing-tab";

/** A card a line can be dropped on. `id: null` is the Unplanned card. */
export interface DropTarget {
  id: string | null;
  label: string;
  sealed: boolean;
}

const UNPLANNED_DROP_ID = "case:__unplanned";
const dropIdFor = (caseId: string | null) => (caseId === null ? UNPLANNED_DROP_ID : `case:${caseId}`);

const DragCountContext = createContext(0);

/** `useSyncExternalStore` with a constant snapshot: `false` on the server and during hydration, `true` after. */
const subscribeNever = () => () => {};

/**
 * Drag a Packing row onto a case card (§7b.3). dnd-kit core only: the pointer
 * sensor waits 6 px so a click still ticks the row. A drop calls the ONE
 * `onDrop(plan)` (the caller routes `kind: "plan"` to `planInto`); a drop that
 * `resolveDrop` refuses (sealed target, packed line) never reaches the server,
 * it is handed back as `kind: "refused"` for a toast.
 */
export function PackingDndProvider({
  selected,
  canDrag,
  targets,
  onDrop,
  children,
}: {
  selected: ReadonlySet<string>;
  canDrag: (lineId: string) => boolean;
  targets: readonly DropTarget[];
  onDrop: (plan: DropPlan) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragCount, setDragCount] = useState(0);
  // The overlay portals to <body> (the page's enter animation leaves a transform that
  // would re-anchor a fixed overlay); render it only after mount so SSR and hydration agree.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setDragCount(selected.has(id) ? selected.size : 1);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragCount(0);
    if (!e.over) return;
    const overId = String(e.over.id);
    const target = targets.find((t) => dropIdFor(t.id) === overId);
    if (!target) return;
    onDrop(
      resolveDrop({
        activeId: String(e.active.id),
        selected,
        target: target.id === null ? null : { id: target.id, label: target.label, sealed: target.sealed },
        canDrag,
      }),
    );
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragCount(0)}>
      <DragCountContext.Provider value={dragCount}>{children}</DragCountContext.Provider>
      {mounted &&
        createPortal(
          <DragOverlay>
            {dragCount > 0 ? (
              <div className="rounded-[var(--r)] border border-line bg-paper px-3 py-1.5 text-ui-text font-medium text-ink shadow-md">
                {dragCount} {dragCount === 1 ? "line" : "lines"}
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

/** Make a line's grip draggable. `disabled` for packed lines and lines in a sealed case. */
export function useLineDrag(lineId: string, disabled: boolean) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lineId, disabled });
  return { setNodeRef, isDragging, gripProps: { ...attributes, ...listeners } };
}

/** Make a card a drop target. Sealed cards stay droppable so the drop can be REFUSED with a
 *  toast that names Unseal (a disabled target would swallow the drop silently). */
export function useCaseDrop(caseId: string | null) {
  const { setNodeRef, isOver } = useDroppable({ id: dropIdFor(caseId) });
  return { setNodeRef, isOver };
}

/** True while a line is being dragged (cards show their drop affordance). */
export function useIsDragging(): boolean {
  return useContext(DragCountContext) > 0;
}
