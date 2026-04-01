"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Copy,
  Eye,
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
  Info,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SECTION_TYPE_LABELS,
  SECTION_TYPE_DESCRIPTIONS,
  type SectionType,
  type TemplateSection,
} from "@/lib/pdfme/section-types";

const SECTION_ICONS: Record<SectionType, React.ElementType> = {
  header: LayoutTemplate,
  "client-details": Users,
  "project-details": FileText,
  table: Table2,
  totals: DollarSign,
  notes: StickyNote,
  signature: PenLine,
  "custom-text": Type,
  "crew-table": Users,
  "call-sheet-info": Info,
  "day-header": CalendarDays,
  spacer: SeparatorHorizontal,
  "page-break": Minus,
};

interface SectionCardProps {
  section: TemplateSection;
  isSelected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function SectionCard({
  section,
  isSelected,
  onSelect,
  onDuplicate,
  onDelete,
}: SectionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = SECTION_ICONS[section.type] || FileText;
  const hasVisibility =
    (section.visibility.docTypes && section.visibility.docTypes.length > 0) ||
    section.visibility.condition;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
        isDragging
          ? "border-primary/50 bg-primary/5 shadow-lg opacity-90 z-50"
          : isSelected
            ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
            : "border-border/50 bg-bg-surface hover:border-border hover:bg-bg-surface/80"
      }`}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none text-fg-3 opacity-0 group-hover:opacity-100 transition-opacity active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Icon */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Label + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-fg truncate">
            {SECTION_TYPE_LABELS[section.type]}
          </span>
          {hasVisibility && (
            <span title="Has visibility conditions">
              <EyeOff className="h-3 w-3 text-fg-3" />
            </span>
          )}
        </div>
        {section.type === "custom-text" && section.content && (
          <p className="text-[11px] text-fg-3 truncate mt-0.5">
            {section.content.slice(0, 60)}
          </p>
        )}
        {section.type === "spacer" && (
          <p className="text-[11px] text-fg-3 mt-0.5">
            {(section.settings as { height?: number }).height || 10}mm
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-fg-3 hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          title="Duplicate section"
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
          title="Remove section"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/** Non-interactive card for DragOverlay */
export function SectionCardOverlay({ section }: { section: TemplateSection }) {
  const Icon = SECTION_ICONS[section.type] || FileText;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/50 bg-bg-surface px-3 py-2.5 shadow-xl">
      <GripVertical className="h-4 w-4 text-fg-3" />
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-sm font-medium text-fg">
        {SECTION_TYPE_LABELS[section.type]}
      </span>
    </div>
  );
}
