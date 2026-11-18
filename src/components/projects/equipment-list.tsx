"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";

import { ConfirmDialog } from "@/components/ui/action-menu";
import { FooterTotals } from "@/components/ui/footer-totals";
import { LineRowList } from "@/components/ui/line-row";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DraggedRowClone, UseEquipmentDndResult } from "@/hooks/use-equipment-dnd";
import type { FactColumn, LineRowData, RowSelection, TotalLine } from "@/lib/primitives/types";
import type { DropHighlight } from "./equipment-row-types";
import { DragGrip, SortableWrap, UNCAT_ZONE_ID, UncatDropWrap } from "./equipment-list-dnd";
import type { EquipmentSections } from "./equipment-sections";
import { useRowHotkeys } from "./use-row-hotkeys";

/**
 * The Equipment list: `LineRowList` sections inside the one `DndContext`
 * (Job > Equipment on the shared primitives, UX unification §7.1). All drop
 * resolution is `useEquipmentDnd`'s; this only wires the primitive's slots
 * (`wrapRow` / `wrapSection` / `dragHandle`) to dnd-kit.
 */

/** Ring state for the row under the pointer; "invalid" is the Drop Matrix saying no. */
function dropHighlightFor(
  sortableId: string,
  hoveredOverId: string | null,
  invalidOverId: string | null,
): DropHighlight | undefined {
  if (hoveredOverId !== sortableId) return undefined;
  return invalidOverId === sortableId ? "invalid" : "valid";
}

/**
 * The floating drag preview: `use-equipment-dnd`'s deep clone of the real
 * row/card node, so it is pixel-identical. A `<tr>` clone is re-wrapped in its
 * own table (browsers refuse a bare `<tr>`); `cloneDragRow` already froze each
 * `<td>` width inline.
 */
function DragRowOverlayContent({ clone }: { clone: DraggedRowClone }) {
  const { node, width } = clone;
  const containerRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren(node);
    return () => container.replaceChildren();
  }, [node]);
  const isRow = node.tagName === "TR";
  return (
    <div className="cursor-grabbing overflow-hidden rounded-[var(--r)] shadow-[var(--sh-card)]" style={{ width }}>
      {isRow ? (
        <table className="w-full border-collapse bg-card">
          <tbody ref={containerRef as React.Ref<HTMLTableSectionElement>} />
        </table>
      ) : (
        <div ref={containerRef as React.Ref<HTMLDivElement>} className="bg-card" />
      )}
    </div>
  );
}

type SectionEl = React.ReactElement<{ "data-section-id"?: string }>;

export function EquipmentList({
  built,
  columns,
  selection,
  dnd,
  uncatIsEmpty,
  totals,
}: {
  built: EquipmentSections;
  columns: FactColumn[];
  selection: RowSelection;
  dnd: UseEquipmentDndResult;
  uncatIsEmpty: boolean;
  /** The stored project totals (never re-summed here); printed ONCE in the list footer. */
  totals?: TotalLine[];
}) {
  const isMobile = useIsMobile();
  const { rowMeta, sectionMeta, sections } = built;
  const hotkeys = useRowHotkeys(sections);
  const highlight = (id: string) => dropHighlightFor(id, dnd.hoveredOverId, dnd.invalidOverId);

  const wrapRow = (row: LineRowData, el: React.ReactElement) => {
    const meta = rowMeta.get(row.id);
    if (!meta) return el;
    return (
      <SortableWrap meta={meta} highlight={highlight(meta.sortableId)} holdAnywhere={isMobile}>
        {el}
      </SortableWrap>
    );
  };

  const wrapSection = (el: React.ReactElement) => {
    const id = (el as SectionEl).props["data-section-id"];
    if (id === UNCAT_ZONE_ID) {
      return (
        <UncatDropWrap highlight={highlight(UNCAT_ZONE_ID)} isEmpty={uncatIsEmpty} isMobile={isMobile} colSpan={columns.length + 3}>
          {el}
        </UncatDropWrap>
      );
    }
    const meta = id ? sectionMeta.get(id) : undefined;
    if (!meta) return el;
    return (
      <SortableWrap meta={meta} highlight={highlight(meta.sortableId)} holdAnywhere>
        {el}
      </SortableWrap>
    );
  };

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={closestCenter}
      modifiers={dnd.modifiers}
      onDragStart={dnd.handleDragStart}
      onDragOver={dnd.handleDragOver}
      onDragEnd={dnd.handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <div className={isMobile ? undefined : "overflow-x-auto rounded-[var(--r)] border border-line"} {...hotkeys.handlers}>
        <LineRowList
          sections={sections}
          columns={columns}
          selection={selection}
          wrapRow={wrapRow}
          wrapSection={wrapSection}
          dragHandle={isMobile ? undefined : () => <DragGrip />}
        />
      </div>
      {totals && totals.length > 0 && <FooterTotals lines={totals} className="mt-3" />}
      <ConfirmDialog item={hotkeys.pending} onClose={hotkeys.clearPending} />
      {/* Portalled to <body>: <DragOverlay> is `position: fixed` and the page's FadeIn
          wrapper leaves a transform on an ancestor, which would re-anchor it. */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay>{dnd.draggedRowClone ? <DragRowOverlayContent clone={dnd.draggedRowClone} /> : null}</DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
