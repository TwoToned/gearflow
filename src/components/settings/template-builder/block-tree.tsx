"use client";

/**
 * Block tree — the main section list for the block editor.
 * Renders blocks as a sortable tree with @dnd-kit, insert buttons between rows,
 * and a section library at the bottom.
 *
 * Structure: row → column → content. Supports drag-to-reorder at the row level.
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
}: BlockTreeProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      onReorderBlocks(arrayMove(blocks, oldIndex, newIndex));
    },
    [blocks, onReorderBlocks],
  );

  const activeDragBlock = activeDragId
    ? blocks.find((b) => b.id === activeDragId)
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-2" role="tree">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((b) => b.id)}
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
                onDuplicate={() => onDuplicateBlock(block.id)}
                onDelete={() => onDeleteBlock(block.id)}
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
