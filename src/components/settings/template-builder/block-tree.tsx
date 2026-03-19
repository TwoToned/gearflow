"use client";

/**
 * Block tree — the main section list for the block editor.
 * Renders blocks as a sortable tree with @dnd-kit.
 * Supports: row reordering, content block drag between rows/columns,
 * and insert buttons between rows.
 */
import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import type { TemplateBlock, SectionType } from "@/lib/pdfme/section-types";
import { SECTION_TYPE_LABELS } from "@/lib/pdfme/section-types";
import { BlockCard, BlockCardOverlay } from "./block-card";
import { cn } from "@/lib/utils";

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface BlockTreeProps {
  blocks: TemplateBlock[];
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onReorderBlocks: (blocks: TemplateBlock[]) => void;
  onDuplicateBlock: (id: string) => void;
  onDeleteBlock: (id: string) => void;
  onInsertAt: (index: number) => void;
  onMoveContentToColumn: (
    contentId: string,
    targetRowId: string,
    targetColumnIndex: number,
  ) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BlockTree({
  blocks,
  selectedBlockId,
  onSelectBlock,
  onReorderBlocks,
  onDuplicateBlock,
  onDeleteBlock,
  onInsertAt,
  onMoveContentToColumn,
}: BlockTreeProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<"row" | "content" | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveDragId(id);

      // Determine if this is a row drag or a content block drag
      const isRow = blocks.some((b) => b.id === id);
      setActiveDragType(isRow ? "row" : "content");
    },
    [blocks],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      setActiveDragType(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Check if this is a row reorder
      const oldIndex = blocks.findIndex((b) => b.id === activeId);
      if (oldIndex !== -1) {
        const newIndex = blocks.findIndex((b) => b.id === overId);
        if (newIndex !== -1) {
          onReorderBlocks(arrayMove(blocks, oldIndex, newIndex));
          return;
        }
      }

      // Check if this is a content block being dropped on a column drop zone
      // Column drop zone IDs are formatted as "col-drop:{rowId}:{columnIndex}"
      if (overId.startsWith("col-drop:")) {
        const parts = overId.split(":");
        const targetRowId = parts[1];
        const targetColIdx = parseInt(parts[2], 10);
        onMoveContentToColumn(activeId, targetRowId, targetColIdx);
      }
    },
    [blocks, onReorderBlocks, onMoveContentToColumn],
  );

  const activeDragBlock = activeDragId
    ? findBlockAnywhere(blocks, activeDragId)
    : null;

  // Collect all sortable IDs (rows + content blocks inside rows)
  const allSortableIds = blocks.map((b) => b.id);

  return (
    <div className="flex-1 overflow-y-auto p-2" role="tree">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={activeDragType === "row" ? [restrictToVerticalAxis] : undefined}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={allSortableIds}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, index) => (
            <div key={block.id}>
              {/* Insert button before this block */}
              <InsertButton
                onClick={() => onInsertAt(index)}
                label={
                  index === 0
                    ? "Insert section at top"
                    : `Insert section after ${getBlockLabel(blocks[index - 1])}`
                }
              />

              <BlockCard
                block={block}
                isSelected={selectedBlockId === block.id}
                selectedBlockId={selectedBlockId}
                onSelect={() => onSelectBlock(block.id)}
                onSelectBlock={onSelectBlock}
                onAddToColumn={undefined}
                onDuplicate={() => onDuplicateBlock(block.id)}
                onDelete={() => onDeleteBlock(block.id)}
                isDraggingContent={activeDragType === "content"}
              />
            </div>
          ))}

          {/* Insert button after last block */}
          {blocks.length > 0 && (
            <InsertButton
              onClick={() => onInsertAt(blocks.length)}
              label="Insert section at end"
            />
          )}
        </SortableContext>

        <DragOverlay>
          {activeDragBlock && <BlockCardOverlay block={activeDragBlock} />}
        </DragOverlay>
      </DndContext>

      {blocks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-fg-3 mb-1">No sections yet</p>
          <p className="text-xs text-fg-4">
            Add sections to start building your template
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Column Drop Zone ────────────────────────────────────────────────────────

export function ColumnDropZone({
  rowId,
  columnIndex,
  children,
  isDraggingContent,
}: {
  rowId: string;
  columnIndex: number;
  children: React.ReactNode;
  isDraggingContent?: boolean;
}) {
  const dropId = `col-drop:${rowId}:${columnIndex}`;
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-colors rounded-md",
        isDraggingContent && "border border-dashed border-border/50 p-1",
        isOver && isDraggingContent && "border-primary/50 bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

// ─── Insert Button ───────────────────────────────────────────────────────────

function InsertButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <div className="group relative flex items-center justify-center py-0.5">
      {/* Line */}
      <div className="absolute inset-x-2 h-px bg-border/30 group-hover:bg-primary/30 transition-colors" />
      {/* Button */}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative z-10 flex h-4 w-4 items-center justify-center",
          "rounded-full bg-bg-surface border border-border/50",
          "text-fg-4 opacity-0 group-hover:opacity-100",
          "hover:border-primary/50 hover:text-primary hover:bg-primary/5",
          "transition-all duration-150",
        )}
        aria-label={label}
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBlockLabel(block: TemplateBlock): string {
  if (block.type === "row") {
    const cols = block.children?.length || 0;
    return `${cols}-column row`;
  }
  return block.type;
}

function findBlockAnywhere(
  blocks: TemplateBlock[],
  id: string,
): TemplateBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children) {
      const found = findBlockAnywhere(block.children, id);
      if (found) return found;
    }
  }
  return null;
}
