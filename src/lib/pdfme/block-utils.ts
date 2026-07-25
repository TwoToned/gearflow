/**
 * Block ↔ Section converters for the block editor.
 *
 * The block tree (TemplateBlock[]) is an editor-only concept.
 * For rendering and storage, blocks are flattened to TemplateSection[] with
 * layoutHint metadata that tells the renderer how to position columns.
 *
 * Conversion flow:
 *   Editor: TemplateBlock[] → flattenBlocks() → TemplateSection[] → renderer/storage
 *   Load:   TemplateSection[] → sectionsToBlocks() → TemplateBlock[] → editor
 */
import type {
  TemplateBlock,
  TemplateSection,
  SectionType,
  LayoutHint,
  BlockStyling,
} from "./section-types";
import { SECTION_TYPES } from "./section-types";
import { SECTION_MIN_WIDTHS, MAX_COLUMNS_PER_ROW } from "./template-constants";

// ─── Block → Section (flatten) ───────────────────────────────────────────────

/**
 * Flatten a block tree into a flat TemplateSection[] with layoutHint metadata.
 * This is the primary conversion for rendering and saving.
 *
 * Row/column structural blocks are consumed; only content blocks survive
 * as TemplateSection entries with layoutHint attached.
 */
export function flattenBlocks(blocks: TemplateBlock[]): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let order = 0;

  for (const block of blocks) {
    if (block.type === "row") {
      const columns = block.children || [];
      const widths = block.columnWidths || columns.map(() => 100 / columns.length);

      for (let colIdx = 0; colIdx < columns.length; colIdx++) {
        const column = columns[colIdx];
        const contentBlocks = column.children || [];

        for (const content of contentBlocks) {
          const layoutHint: LayoutHint = {
            rowId: block.id,
            columnIndex: colIdx,
            columnWidth: widths[colIdx],
            columnCount: columns.length,
            styling: content.styling,
          };

          sections.push({
            id: content.id,
            type: content.type as SectionType,
            settings: content.settings || {},
            visibility: content.visibility || {},
            content: content.content,
            order: order++,
            layoutHint,
          });
        }
      }
    } else if (isContentType(block.type)) {
      // Top-level content block (no row wrapper) — treat as single-column row
      sections.push({
        id: block.id,
        type: block.type as SectionType,
        settings: block.settings || {},
        visibility: block.visibility || {},
        content: block.content,
        order: order++,
        layoutHint: {
          rowId: `auto_row_${block.id}`,
          columnIndex: 0,
          columnWidth: 100,
          columnCount: 1,
          styling: block.styling,
        },
      });
    }
    // Skip 'column' blocks at top level (invalid structure)
  }

  return sections;
}

/** Alias for flattenBlocks */
export const blocksToSections = flattenBlocks;

// ─── Section → Block (lazy migration) ────────────────────────────────────────

/**
 * Convert a flat TemplateSection[] into a TemplateBlock[] tree.
 * Used for lazy migration: old flat-format templates are wrapped into
 * the block model when opened in the editor.
 *
 * Sections with layoutHint are grouped by rowId into multi-column rows.
 * Sections without layoutHint each become a single-column row.
 */
export function sectionsToBlocks(sections: TemplateSection[]): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];

  // Group sections by rowId (or generate unique ones for ungrouped)
  const rowGroups = new Map<string, TemplateSection[]>();
  const rowOrder: string[] = [];

  for (const section of sections) {
    const rowId = section.layoutHint?.rowId || `migrated_row_${section.id}`;

    if (!rowGroups.has(rowId)) {
      rowGroups.set(rowId, []);
      rowOrder.push(rowId);
    }
    rowGroups.get(rowId)!.push(section);
  }

  for (const rowId of rowOrder) {
    const rowSections = rowGroups.get(rowId)!;

    // Determine column structure
    const columnMap = new Map<number, TemplateSection[]>();
    const columnWidths: number[] = [];

    for (const section of rowSections) {
      const colIdx = section.layoutHint?.columnIndex ?? 0;
      if (!columnMap.has(colIdx)) {
        columnMap.set(colIdx, []);
        columnWidths.push(section.layoutHint?.columnWidth ?? 100);
      }
      columnMap.get(colIdx)!.push(section);
    }

    // Sort columns by index
    const sortedColIndices = [...columnMap.keys()].sort((a, b) => a - b);

    const columns: TemplateBlock[] = sortedColIndices.map((colIdx) => {
      const colSections = columnMap.get(colIdx)!;
      return {
        id: `col_${rowId}_${colIdx}`,
        type: "column" as const,
        children: colSections.map((s) => sectionToContentBlock(s)),
      };
    });

    // Build sorted column widths
    const sortedWidths = sortedColIndices.map((colIdx) => {
      const section = columnMap.get(colIdx)![0];
      return section.layoutHint?.columnWidth ?? 100;
    });

    blocks.push({
      id: rowId,
      type: "row",
      columnWidths: sortedWidths,
      children: columns,
    });
  }

  return blocks;
}

/** Convert a TemplateSection to a content TemplateBlock (leaf node) */
function sectionToContentBlock(section: TemplateSection): TemplateBlock {
  return {
    id: section.id,
    type: section.type,
    settings: section.settings,
    visibility: section.visibility,
    content: section.content,
    styling: section.layoutHint?.styling,
  };
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

/** Check if a block type is a content (section) type, not a structural type */
export function isContentType(type: string): type is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(type);
}

/** Check if a section type can fit in a column of the given width */
export function canFitInColumn(type: SectionType, columnWidthPercent: number): boolean {
  const minWidth = SECTION_MIN_WIDTHS[type];
  return columnWidthPercent >= minWidth;
}

/**
 * Validate a block tree structure.
 * Returns an array of error messages (empty = valid).
 */
export function validateBlockTree(blocks: TemplateBlock[]): string[] {
  const errors: string[] = [];

  for (const block of blocks) {
    validateBlock(block, 0, errors);
  }

  return errors;
}

function validateBlock(
  block: TemplateBlock,
  depth: number,
  errors: string[],
): void {
  if (depth > 2) {
    errors.push(`Block "${block.id}" exceeds maximum nesting depth of 2`);
    return;
  }

  if (block.type === "row") {
    const columns = block.children || [];
    if (columns.length > MAX_COLUMNS_PER_ROW) {
      errors.push(
        `Row "${block.id}" has ${columns.length} columns (max ${MAX_COLUMNS_PER_ROW})`
      );
    }

    // Validate column widths sum to ~100
    const widths = block.columnWidths || [];
    if (widths.length > 0 && widths.length !== columns.length) {
      errors.push(
        `Row "${block.id}" has ${widths.length} width values but ${columns.length} columns`
      );
    }
    if (widths.length > 0) {
      const sum = widths.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 1) {
        errors.push(
          `Row "${block.id}" column widths sum to ${sum}% (should be 100%)`
        );
      }
    }

    // Validate each column
    for (const col of columns) {
      if (col.type !== "column") {
        errors.push(`Row "${block.id}" child "${col.id}" must be type "column", got "${col.type}"`);
      }
      validateBlock(col, depth + 1, errors);
    }
  } else if (block.type === "column") {
    // Columns should contain content blocks only
    for (const child of block.children || []) {
      if (child.type === "row" || child.type === "column") {
        errors.push(
          `Column "${block.id}" contains structural block "${child.id}" (type "${child.type}"). Columns can only contain content blocks.`
        );
      }
      validateBlock(child, depth + 1, errors);
    }
  }
  // Content blocks have no children to validate
}

// ─── Block Manipulation Helpers ──────────────────────────────────────────────

/** Generate a unique block ID */
export function generateBlockId(prefix: string = "blk"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Wrap a single content block in a row → column structure */
export function wrapInRow(contentBlock: TemplateBlock): TemplateBlock {
  const rowId = generateBlockId("row");
  const colId = generateBlockId("col");
  return {
    id: rowId,
    type: "row",
    columnWidths: [100],
    children: [
      {
        id: colId,
        type: "column",
        children: [contentBlock],
      },
    ],
  };
}

/** Create a new content block with default settings for a section type */
export function createContentBlock(type: SectionType): TemplateBlock {
  return {
    id: generateBlockId("sec"),
    type,
    settings: {},
    visibility: {},
  };
}
