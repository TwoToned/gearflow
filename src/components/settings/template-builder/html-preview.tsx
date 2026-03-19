"use client";

/**
 * HTML preview — instant approximation of the block tree layout.
 * Shows section ordering, column layouts, and approximate sizing.
 * Not pixel-perfect PDF fidelity, but updates instantly on edit.
 *
 * Uses shared constants for relative sizing and respects BlockStyling.
 */
import { useMemo } from "react";
import type { TemplateBlock } from "@/lib/pdfme/section-types";
import { SECTION_TYPE_LABELS, type SectionType } from "@/lib/pdfme/section-types";
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  SECTION_GAP,
  SECTION_HEIGHT_ESTIMATES,
} from "@/lib/pdfme/template-constants";
import { cn } from "@/lib/utils";

// ─── Section type icons (simple text labels for now) ─────────────────────────

const SECTION_ICONS: Record<string, string> = {
  header: "H",
  "client-details": "C",
  "project-details": "P",
  table: "T",
  totals: "$",
  notes: "N",
  signature: "S",
  "custom-text": "Tx",
  "crew-table": "CT",
  spacer: "—",
  "page-break": "//",
};

// ─── Component ───────────────────────────────────────────────────────────────

interface HtmlPreviewProps {
  blocks: TemplateBlock[];
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
  className?: string;
}

export function HtmlPreview({
  blocks,
  selectedBlockId,
  onSelectBlock,
  className,
}: HtmlPreviewProps) {
  // Scale factor: map PDF mm to preview px
  const scale = useMemo(() => {
    // Target ~400px width for the preview panel
    return 400 / PAGE_WIDTH;
  }, []);

  const pageWidthPx = PAGE_WIDTH * scale;
  const pageHeightPx = PAGE_HEIGHT * scale;
  const marginPx = MARGIN * scale;
  const contentWidthPx = CONTENT_WIDTH * scale;
  const gapPx = SECTION_GAP * scale;

  return (
    <div className={cn("flex flex-col items-center gap-4 p-4", className)}>
      {/* Page container */}
      <div
        className="relative bg-white shadow-md border border-border/50"
        style={{
          width: pageWidthPx,
          minHeight: pageHeightPx,
          padding: marginPx,
        }}
      >
        <div className="flex flex-col" style={{ gap: gapPx }}>
          {blocks.map((block) => (
            <PreviewBlock
              key={block.id}
              block={block}
              scale={scale}
              contentWidth={contentWidthPx}
              selectedBlockId={selectedBlockId}
              onSelectBlock={onSelectBlock}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Block renderers ─────────────────────────────────────────────────────────

interface PreviewBlockProps {
  block: TemplateBlock;
  scale: number;
  contentWidth: number;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
}

function PreviewBlock({
  block,
  scale,
  contentWidth,
  selectedBlockId,
  onSelectBlock,
}: PreviewBlockProps) {
  if (block.type === "row") {
    return (
      <PreviewRow
        block={block}
        scale={scale}
        contentWidth={contentWidth}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
      />
    );
  }

  // Top-level content block (shouldn't normally happen in valid tree, but handle it)
  return (
    <PreviewSection
      block={block}
      scale={scale}
      width={contentWidth}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
    />
  );
}

function PreviewRow({
  block,
  scale,
  contentWidth,
  selectedBlockId,
  onSelectBlock,
}: PreviewBlockProps) {
  const columns = block.children || [];
  const widths = block.columnWidths || columns.map(() => 100 / columns.length);
  const gapPx = 2 * scale;

  return (
    <div className="flex" style={{ gap: gapPx }}>
      {columns.map((col, colIdx) => {
        const colWidthPx = (contentWidth * (widths[colIdx] || 50)) / 100 - gapPx * (columns.length - 1) / columns.length;
        const contentBlocks = col.children || [];

        return (
          <div key={col.id} className="flex flex-col" style={{ width: colWidthPx, gap: gapPx / 2 }}>
            {contentBlocks.map((content) => (
              <PreviewSection
                key={content.id}
                block={content}
                scale={scale}
                width={colWidthPx}
                selectedBlockId={selectedBlockId}
                onSelectBlock={onSelectBlock}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface PreviewSectionProps {
  block: TemplateBlock;
  scale: number;
  width: number;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
}

function PreviewSection({
  block,
  scale,
  width,
  selectedBlockId,
  onSelectBlock,
}: PreviewSectionProps) {
  const type = block.type as SectionType;
  const heightEstimate = SECTION_HEIGHT_ESTIMATES[type] || 10;
  const heightPx = Math.max(heightEstimate * scale, 16);
  const isSelected = block.id === selectedBlockId;
  const styling = block.styling;

  if (type === "page-break") {
    return (
      <div
        className="flex items-center justify-center border-t border-dashed border-fg-4/40 py-0.5"
        style={{ width }}
      >
        <span className="text-[8px] text-fg-4 bg-white px-1">PAGE BREAK</span>
      </div>
    );
  }

  if (type === "spacer") {
    return (
      <div
        className="bg-inset/30 border border-dashed border-border/30"
        style={{ width, height: heightPx }}
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 rounded-sm border text-left transition-colors",
        "hover:border-primary/30",
        isSelected
          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
          : "border-border/40 bg-surface/50",
      )}
      style={{
        width,
        minHeight: heightPx,
        backgroundColor: styling?.backgroundColor || undefined,
        borderColor: isSelected ? undefined : styling?.borderColor || undefined,
        borderWidth: styling?.borderWidth ? `${styling.borderWidth}px` : undefined,
        padding: styling?.padding ? `${styling.padding * scale}px` : "2px 4px",
      }}
      onClick={() => onSelectBlock?.(block.id)}
    >
      <span className="flex-none w-4 h-4 rounded-sm bg-primary/10 text-primary text-[8px] font-bold flex items-center justify-center">
        {SECTION_ICONS[type] || "?"}
      </span>
      <span className="text-[9px] text-fg-3 truncate">
        {SECTION_TYPE_LABELS[type] || type}
      </span>
    </button>
  );
}
