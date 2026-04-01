/**
 * Shared constants for PDF template rendering.
 * Single source of truth for dimensions, font sizes, and spacing used by
 * both the height estimator (section-renderer.ts) and PDF plugins.
 */

// ─── Page Dimensions (mm) ───────────────────────────────────────────────────

/** A4 page width in mm */
export const PAGE_WIDTH = 210;

/** A4 page height in mm */
export const PAGE_HEIGHT = 297;

/** Page margin in mm */
export const MARGIN = 14;

/** Usable content width in mm (PAGE_WIDTH - 2 * MARGIN) */
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 182mm

/** Footer height in mm */
export const FOOTER_HEIGHT = 10;

/** Usable content height in mm (PAGE_HEIGHT - 2 * MARGIN - FOOTER_HEIGHT) */
export const PAGE_CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN * 2 - FOOTER_HEIGHT; // 259mm

/** Gap between sections in mm */
export const SECTION_GAP = 2;

// ─── Table Plugin Constants (pt) ────────────────────────────────────────────

/** Row padding inside table cells (pt) */
export const TABLE_ROW_PADDING = 4;

/** Default font size for table rows (pt) */
export const TABLE_FONT_SIZE = 9;

/** Font size for child items in kits (pt) */
export const TABLE_CHILD_FONT_SIZE = 8;

/** Font size for grandchild items in kits (pt) */
export const TABLE_GRANDCHILD_FONT_SIZE = 7;

/** Font size for badges (pt) */
export const TABLE_BADGE_FONT_SIZE = 6;

/** Table header row height (pt) */
export const TABLE_HEADER_HEIGHT_PT = 18;

/** Table data row height (pt) */
export const TABLE_ROW_HEIGHT_PT = 22;

/** Group header row height (pt) */
export const TABLE_GROUP_HEADER_HEIGHT_PT = 20;

// ─── Crew Table Plugin Constants (pt) ────────────────────────────────────────

/** Crew table font size (pt) */
export const CREW_FONT_SIZE = 8;

/** Crew table header font size (pt) */
export const CREW_HEADER_FONT_SIZE = 7;

/** Crew table row height (pt) */
export const CREW_ROW_HEIGHT_PT = 18;

/** Crew table header height (pt) */
export const CREW_HEADER_HEIGHT_PT = 16;

/** Crew table cell padding (pt) */
export const CREW_PADDING = 4;

// ─── Height Estimates (mm) — used by section-renderer ────────────────────────

/** Estimated height per table row in mm (for page break calculations) */
export const TABLE_ROW_HEIGHT_MM = 5;

/** Estimated height per crew row in mm (for page break calculations) */
export const CREW_ROW_HEIGHT_MM = 5;

/** Header/footer repeated on continuation pages (mm) */
export const CONTINUATION_OVERHEAD_MM = 20;

// ─── Section Type Min Widths (%) ─────────────────────────────────────────────

import type { SectionType } from "./section-types";

/**
 * Minimum column width percentage per section type.
 * Sections that require full width (tables, page breaks) are 100%.
 * Text-based sections can be narrower.
 */
export const SECTION_MIN_WIDTHS: Record<SectionType, number> = {
  table: 100,
  "crew-table": 100,
  "call-sheet-info": 100,
  "day-header": 100,
  "page-break": 100,
  totals: 50,
  header: 50,
  signature: 33,
  "client-details": 33,
  "project-details": 33,
  "custom-text": 25,
  notes: 25,
  spacer: 25,
};

/**
 * Approximate section heights in mm — used by the HTML preview for proportional sizing.
 * Not used for actual PDF pagination (that uses estimateSectionHeight with real data).
 */
export const SECTION_HEIGHT_ESTIMATES: Record<SectionType, number> = {
  header: 30,
  "client-details": 25,
  "project-details": 25,
  table: 80,
  totals: 20,
  notes: 15,
  signature: 20,
  "custom-text": 10,
  "crew-table": 60,
  "call-sheet-info": 35,
  "day-header": 14,
  spacer: 5,
  "page-break": 0,
};

/** Maximum number of columns per row */
export const MAX_COLUMNS_PER_ROW = 4;

/** Maximum nesting depth (rows -> columns -> content) */
export const MAX_BLOCK_DEPTH = 2;
