/**
 * Shared constants for PDF template rendering.
 * Single source of truth for dimensions, font sizes, and spacing used by
 * both the pagination engine (document-composer.ts) and PDF plugins.
 */
import type { PaperSize } from "@/lib/countries";

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

// ─── Paper size (I5, #1084) ─────────────────────────────────────────────────
// `PaperSize` itself is `@/lib/countries`'s (its `paperSize` column is the
// source of truth) — re-exported here so a `template-constants.ts` consumer
// doesn't also need to reach into `countries.ts` just to name it.
export type { PaperSize };

/** Everything `document-composer.ts`'s pagination math needs for one page —
 *  margin/footer stay fixed layout choices across both paper sizes; only
 *  width/height (and what they derive) actually differ. */
export interface PageGeometry {
  width: number;
  height: number;
  margin: number;
  contentWidth: number;
  contentHeight: number;
  footerHeight: number;
}

const LETTER_WIDTH = 216;
const LETTER_HEIGHT = 279;

/** Resolve the page geometry for a paper size. `getPageGeometry("A4")` (the
 *  default) is BYTE-IDENTICAL to the bare `PAGE_WIDTH`/`PAGE_HEIGHT`/
 *  `CONTENT_WIDTH`/`PAGE_CONTENT_HEIGHT` constants above — every caller that
 *  hasn't threaded a paper size through yet keeps rendering exactly as it
 *  always has. */
export function getPageGeometry(paperSize: PaperSize = "A4"): PageGeometry {
  const width = paperSize === "LETTER" ? LETTER_WIDTH : PAGE_WIDTH;
  const height = paperSize === "LETTER" ? LETTER_HEIGHT : PAGE_HEIGHT;
  return {
    width,
    height,
    margin: MARGIN,
    contentWidth: width - MARGIN * 2,
    contentHeight: height - MARGIN * 2 - FOOTER_HEIGHT,
    footerHeight: FOOTER_HEIGHT,
  };
}

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
