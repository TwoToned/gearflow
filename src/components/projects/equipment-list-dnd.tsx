"use client";

import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { dropHighlightClass, type DropHighlight } from "./equipment-row-types";

/**
 * The dnd-kit side of the Equipment list. `LineRowList` is library-free, so it
 * exposes `wrapRow` / `wrapSection` / `dragHandle`; this file is what plugs the
 * four sortable kinds (`cat-`, `grp-`, `shg-`, `li-`) and the `uncat-zone`
 * droppable into those slots. Drop RESOLUTION still lives in
 * `use-equipment-dnd.ts` (it reads ids + `data.containerId`), so nothing here
 * decides where a drop lands.
 *
 * Each wrapped element gets its OWN `SortableContext` carrying its container's
 * full id list: the rows render inside the primitive's single `<tbody>`, so a
 * context cannot wrap a container's rows, and `useSortable` only needs the
 * items list (not a shared wrapper) to slide neighbours out of the way.
 */

export interface SortableMeta {
  sortableId: string;
  containerId: string;
  /** Every sortable id in this container, in display order. */
  items: string[];
  disabled: boolean;
}

interface RowDragValue {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
  setActivatorNodeRef: (el: HTMLElement | null) => void;
}

const RowDragContext = React.createContext<RowDragValue | null>(null);

type Cloneable = React.ReactElement<{ style?: React.CSSProperties; className?: string }>;

function SortableInner({
  meta,
  highlight,
  holdAnywhere,
  children,
}: {
  meta: SortableMeta;
  highlight?: DropHighlight;
  /** Section heads and phone cards have no grip: press-and-hold anywhere starts the drag. */
  holdAnywhere: boolean;
  children: Cloneable;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: meta.sortableId,
    data: { containerId: meta.containerId },
    disabled: meta.disabled,
  });
  const el = React.cloneElement(children, {
    ref: setNodeRef,
    "data-drag-row": "",
    style: { ...children.props.style, transform: CSS.Transform.toString(transform), transition },
    className: cn(children.props.className, isDragging && "opacity-40", dropHighlightClass(highlight)),
    ...(holdAnywhere ? listeners : {}),
  } as Record<string, unknown>);
  return (
    <RowDragContext.Provider
      value={{ attributes: attributes as unknown as RowDragValue["attributes"], listeners, setActivatorNodeRef }}
    >
      {el}
    </RowDragContext.Provider>
  );
}

/** Makes a row/section element sortable. `children` is the `<tr>` (desktop) or card/head (phone). */
export function SortableWrap(props: {
  meta: SortableMeta;
  highlight?: DropHighlight;
  holdAnywhere: boolean;
  children: Cloneable;
}) {
  return (
    <SortableContext items={props.meta.items} strategy={verticalListSortingStrategy}>
      <SortableInner {...props} />
    </SortableContext>
  );
}

/** The grip in a row's select cell (desktop). Blank space for rows that cannot be dragged. */
export function DragGrip() {
  const ctx = React.useContext(RowDragContext);
  if (!ctx) return <span aria-hidden="true" className="inline-block size-6" />;
  return (
    <button
      type="button"
      ref={ctx.setActivatorNodeRef}
      {...ctx.attributes}
      {...(ctx.listeners as React.HTMLAttributes<HTMLButtonElement>)}
      aria-label="Drag to reorder"
      className="grid size-6 shrink-0 cursor-grab touch-none place-items-center text-muted hover:text-ink"
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}

export const UNCAT_ZONE_ID = "uncat-zone";
const UNCAT_HINT = "Drag items or groups here to remove them from a category.";

/** Makes the Uncategorised head the `uncat-zone` landing zone, with the empty-state hint under it. */
export function UncatDropWrap({
  highlight,
  isEmpty,
  isMobile,
  colSpan,
  children,
}: {
  highlight?: DropHighlight;
  isEmpty: boolean;
  isMobile: boolean;
  colSpan: number;
  children: Cloneable;
}) {
  const { setNodeRef } = useDroppable({ id: UNCAT_ZONE_ID });
  const el = React.cloneElement(children, {
    ref: setNodeRef,
    className: cn(children.props.className, dropHighlightClass(highlight)),
  } as Record<string, unknown>);
  if (!isEmpty) return el;
  return (
    <>
      {el}
      {isMobile ? (
        <p className="px-3 py-2 text-caption text-muted">{UNCAT_HINT}</p>
      ) : (
        <tr>
          <td colSpan={colSpan} className="py-3 text-center text-caption text-muted">
            {UNCAT_HINT}
          </td>
        </tr>
      )}
    </>
  );
}
