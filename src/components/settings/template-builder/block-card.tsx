"use client";

/**
 * Block card — renders a single block in the block tree.
 * Supports content blocks (leaf nodes) and row blocks (with column indicators).
 * Uses @dnd-kit for sortable drag-and-drop.
 */
import { useSortable } from "@dnd-kit/sortable";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Copy,
  EyeOff,
  FileText,
  Users,
  Table2,
  DollarSign,
  StickyNote,
  PenLine,
  Type,
  SeparatorHorizontal,
  Minus,
  LayoutTemplate,
  Columns2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SECTION_TYPE_LABELS,
  type SectionType,
  type TemplateBlock,
} from "@/lib/pdfme/section-types";
import { cn } from "@/lib/utils";
import { ColumnDropZone } from "./block-tree";

// ─── Icons per section type ──────────────────────────────────────────────────

const SECTION_ICONS: Record<string, React.ElementType> = {
  header: LayoutTemplate,
  "client-details": Users,
  "project-details": FileText,
  table: Table2,
  totals: DollarSign,
  notes: StickyNote,
  signature: PenLine,
  "custom-text": Type,
  "crew-table": Users,
  spacer: SeparatorHorizontal,
  "page-break": Minus,
  row: Columns2,
};

// ─── Block Card ──────────────────────────────────────────────────────────────

interface BlockCardProps {
  block: TemplateBlock;
  isSelected: boolean;
  selectedBlockId: string | null;
  onSelect: () => void;
  onSelectBlock: (id: string) => void;
  onAddToColumn?: (rowId: string, columnIndex: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  isDraggingContent?: boolean;
}

export function BlockCard({
  block,
  isSelected,
  selectedBlockId,
  onSelect,
  onSelectBlock,
  onAddToColumn,
  onDuplicate,
  onDelete,
  isDraggingContent,
}: BlockCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (block.type === "row") {
    return (
      <RowBlockCard
        ref={setNodeRef}
        style={style}
        block={block}
        isSelected={isSelected}
        selectedBlockId={selectedBlockId}
        isDragging={isDragging}
        isDraggingContent={isDraggingContent}
        dragAttributes={attributes}
        dragListeners={listeners}
        onSelect={onSelect}
        onSelectBlock={onSelectBlock}
        onAddToColumn={onAddToColumn}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    );
  }

  return (
    <ContentBlockCard
      ref={setNodeRef}
      style={style}
      block={block}
      isSelected={isSelected}
      isDragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
      onSelect={onSelect}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
}

// ─── Row Block Card ──────────────────────────────────────────────────────────

import { forwardRef } from "react";

interface InnerCardProps {
  style: React.CSSProperties;
  block: TemplateBlock;
  isSelected: boolean;
  selectedBlockId?: string | null;
  isDragging: boolean;
  isDraggingContent?: boolean;
  dragAttributes: React.HTMLAttributes<HTMLElement>;
  dragListeners: Record<string, unknown> | undefined;
  onSelect: () => void;
  onSelectBlock?: (id: string) => void;
  onAddToColumn?: (rowId: string, columnIndex: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const RowBlockCard = forwardRef<HTMLDivElement, InnerCardProps>(
  function RowBlockCard(
    {
      style,
      block,
      isSelected,
      selectedBlockId,
      isDragging,
      dragAttributes,
      dragListeners,
      onSelect,
      onSelectBlock,
      onAddToColumn,
      isDraggingContent,
      onDuplicate,
      onDelete,
    },
    ref,
  ) {
    const columns = block.children || [];
    const widths = block.columnWidths || columns.map(() => 100 / columns.length);

    return (
      <div
        ref={ref}
        style={style}
        role="treeitem"
        className={cn(
          "group rounded-lg border transition-colors",
          isDragging
            ? "border-primary/50 bg-primary/5 shadow-lg opacity-90 z-50"
            : isSelected
              ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
              : "border-border/50 bg-bg-surface hover:border-border hover:bg-bg-surface/80",
        )}
      >
        {/* Row header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer"
          onClick={onSelect}
        >
          <button
            {...(dragAttributes as React.HTMLAttributes<HTMLButtonElement>)}
            {...(dragListeners as React.HTMLAttributes<HTMLButtonElement>)}
            className="shrink-0 cursor-grab touch-none text-fg-3 opacity-0 group-hover:opacity-100 transition-opacity active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Columns2 className="h-3.5 w-3.5" />
          </div>

          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-fg">
              {columns.length}-Column Row
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              {widths.map((w, i) => (
                <span
                  key={i}
                  className="text-[10px] text-fg-3 bg-inset rounded px-1 py-px"
                >
                  {Math.round(w)}%
                </span>
              ))}
            </div>
          </div>

          <CardActions onDuplicate={onDuplicate} onDelete={onDelete} />
        </div>

        {/* Column contents (nested) */}
        <div className="border-t border-border/30 px-3 py-1.5 space-y-1">
          {columns.map((col, colIdx) => (
            <div key={col.id} className="ml-6">
              <div className="text-[10px] text-fg-4 uppercase tracking-wider mb-0.5">
                Column {colIdx + 1} ({Math.round(widths[colIdx])}%)
              </div>
              <ColumnDropZone
                rowId={block.id}
                columnIndex={colIdx}
                isDraggingContent={isDraggingContent}
              >
                {(col.children || []).map((content) => (
                  <DraggableContentItem
                    key={content.id}
                    content={content}
                    isSelected={selectedBlockId === content.id}
                    onSelect={() => onSelectBlock?.(content.id)}
                  />
                ))}
                {(col.children || []).length === 0 && (
                  <div className="text-[10px] text-fg-4 italic py-1">
                    {isDraggingContent ? "Drop here" : "Empty column"}
                  </div>
                )}
              </ColumnDropZone>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

// ─── Draggable Content Item (inside row columns) ────────────────────────────

function DraggableContentItem({
  content,
  isSelected,
  onSelect,
}: {
  content: TemplateBlock;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: content.id,
  });

  const ContentIcon = SECTION_ICONS[content.type] || FileText;
  const hasVis =
    (content.visibility?.docTypes?.length ?? 0) > 0 ||
    content.visibility?.condition;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
        "hover:bg-primary/5 border border-transparent hover:border-border/30",
        isSelected && "bg-primary/10 border-primary/30",
        isDragging && "opacity-40",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <button
        {...(attributes as React.HTMLAttributes<HTMLButtonElement>)}
        {...(listeners as React.HTMLAttributes<HTMLButtonElement>)}
        className="shrink-0 cursor-grab touch-none text-fg-4 hover:text-fg-3 active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/8 text-primary">
        <ContentIcon className="h-3 w-3" />
      </div>
      <span className="text-xs text-fg-2 truncate">
        {SECTION_TYPE_LABELS[content.type as SectionType] || content.type}
      </span>
      {hasVis && <EyeOff className="h-2.5 w-2.5 text-fg-4 shrink-0" />}
    </div>
  );
}

// ─── Content Block Card ──────────────────────────────────────────────────────

const ContentBlockCard = forwardRef<HTMLDivElement, InnerCardProps>(
  function ContentBlockCard(
    {
      style,
      block,
      isSelected,
      isDragging,
      dragAttributes,
      dragListeners,
      onSelect,
      onDuplicate,
      onDelete,
    },
    ref,
  ) {
    const Icon = SECTION_ICONS[block.type] || FileText;
    const hasVisibility =
      (block.visibility?.docTypes?.length ?? 0) > 0 ||
      block.visibility?.condition;

    return (
      <div
        ref={ref}
        style={style}
        role="treeitem"
        className={cn(
          "group flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer",
          isDragging
            ? "border-primary/50 bg-primary/5 shadow-lg opacity-90 z-50"
            : isSelected
              ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
              : "border-border/50 bg-bg-surface hover:border-border hover:bg-bg-surface/80",
        )}
        onClick={onSelect}
      >
        <button
          {...(dragAttributes as React.HTMLAttributes<HTMLButtonElement>)}
          {...(dragListeners as React.HTMLAttributes<HTMLButtonElement>)}
          className="shrink-0 cursor-grab touch-none text-fg-3 opacity-0 group-hover:opacity-100 transition-opacity active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-fg truncate">
              {SECTION_TYPE_LABELS[block.type as SectionType] || block.type}
            </span>
            {hasVisibility && (
              <span title="Has visibility conditions">
                <EyeOff className="h-3 w-3 text-fg-3" />
              </span>
            )}
          </div>
          {block.type === "custom-text" && block.content && (
            <p className="text-[11px] text-fg-3 truncate mt-0.5">
              {block.content.slice(0, 60)}
            </p>
          )}
          {block.type === "spacer" && (
            <p className="text-[11px] text-fg-3 mt-0.5">
              {(block.settings as { height?: number } | undefined)?.height || 10}mm
            </p>
          )}
        </div>

        <CardActions onDuplicate={onDuplicate} onDelete={onDelete} />
      </div>
    );
  },
);

// ─── Shared actions ──────────────────────────────────────────────────────────

function CardActions({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-fg-3 hover:text-fg"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        title="Duplicate"
      >
        <Copy className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-fg-3 hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Remove"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ─── Overlay (for DragOverlay) ───────────────────────────────────────────────

export function BlockCardOverlay({ block }: { block: TemplateBlock }) {
  const Icon = SECTION_ICONS[block.type] || FileText;
  const label =
    block.type === "row"
      ? `${(block.children || []).length}-Column Row`
      : SECTION_TYPE_LABELS[block.type as SectionType] || block.type;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/50 bg-bg-surface px-3 py-2.5 shadow-xl">
      <GripVertical className="h-4 w-4 text-fg-3" />
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-sm font-medium text-fg">{label}</span>
    </div>
  );
}
