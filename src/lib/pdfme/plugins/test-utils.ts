/**
 * Test harness for pdfme plugin renderers.
 *
 * Wraps a real `@pdfme/pdf-lib` PDFDocument + PDFPage with capturing
 * proxies so plugin code (`page.drawText`, `page.drawRectangle`,
 * `page.drawLine`) records every call without producing a PDF on
 * disk. Real PDFFont objects come from `pdfDoc.embedFont(...)` so
 * `font.name`, `font.widthOfTextAtSize(...)` and other contract
 * methods behave exactly as they do in production.
 *
 * Use `font.name` to assert bold vs regular (e.g.
 * `Helvetica-Bold` vs `Helvetica`).
 */
import { PDFDocument } from "@pdfme/pdf-lib";
import * as pdfLib from "@pdfme/pdf-lib";
import gearflowTable from "./gearflow-table";
import type { DocumentLineItem, TablePluginConfig } from "../types";

export interface DrawTextCall {
  text: string;
  x: number;
  y: number;
  size: number;
  fontName: string;
}

export interface DrawRectCall {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawLineCall {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface RendererCalls {
  drawText: DrawTextCall[];
  drawRect: DrawRectCall[];
  drawLine: DrawLineCall[];
}

const DEFAULT_CONFIG: TablePluginConfig = {
  documentType: "packing-list",
  documentColor: "#0d4f4f",
  showGroupHeaders: true,
  showKitChildren: true,
  showCheckboxes: true,
  showConditionColumns: false,
  showPricing: false,
  showBadges: true,
  showNotes: false,
  showPerUnitCheckboxes: false,
  showAssetTags: true,
  showCategories: true,
  showRowNumbers: false,
  filterOptional: false,
  filterByStatus: null,
};

/**
 * Run the gearflowTable plugin against synthetic items and return every
 * draw call the renderer issued. The page is real (so layout math is
 * correct) but its draw methods are intercepted before they hit the
 * pdf-lib content stream — nothing is written.
 */
export async function runTablePlugin(
  items: DocumentLineItem[],
  configOverrides: Partial<TablePluginConfig> = {},
): Promise<RendererCalls> {
  const pdfDoc = await PDFDocument.create();
  // A4 portrait — matches the default packing-list layout.
  const page = pdfDoc.addPage([595, 842]);

  const calls: RendererCalls = {
    drawText: [],
    drawRect: [],
    drawLine: [],
  };

  // Wrap the page's draw methods so we record without rendering. We
  // overwrite the methods in place because the plugin keeps its own
  // reference to `page`; a proxy would be invisible to bound methods.
  page.drawText = ((text: string, opts: Record<string, unknown>) => {
    calls.drawText.push({
      text,
      x: opts.x as number,
      y: opts.y as number,
      size: opts.size as number,
      fontName: (opts.font as { name: string }).name,
    });
  }) as typeof page.drawText;

  page.drawRectangle = ((opts: Record<string, unknown>) => {
    calls.drawRect.push({
      x: opts.x as number,
      y: opts.y as number,
      width: opts.width as number,
      height: opts.height as number,
    });
  }) as typeof page.drawRectangle;

  page.drawLine = ((opts: { start: { x: number; y: number }; end: { x: number; y: number } }) => {
    calls.drawLine.push({
      startX: opts.start.x,
      startY: opts.start.y,
      endX: opts.end.x,
      endY: opts.end.y,
    });
  }) as typeof page.drawLine;

  // The plugin doesn't use these but pdf-lib's add-line still triggers
  // some internal validation; the no-op stubs above are enough.

  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const value = JSON.stringify({ items, config });

  const schema = {
    name: "table",
    type: "gearflowTable" as const,
    position: { x: 0, y: 0 },
    width: 210, // A4 width in mm
    height: 280, // most of A4 height in mm
  };

  await gearflowTable.pdf({
    schema,
    page,
    pdfLib,
    pdfDoc,
    value,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _cache: new Map<string | number, unknown>(),
    // Other PDFRenderProps fields the plugin doesn't read.
    options: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return calls;
}

/**
 * Build a minimal DocumentLineItem with sensible defaults. Overrides
 * win. Used by the harness tests to keep fixtures terse.
 */
export function makeLineItem(
  overrides: Partial<DocumentLineItem>,
): DocumentLineItem {
  return {
    id: overrides.id ?? "li-default",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}
