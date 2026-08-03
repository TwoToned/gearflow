/**
 * Net-new pagination engine for the 5 project document types (quote, invoice,
 * packing-list, return-sheet, delivery-docket). Walks a fixed
 * `DocumentLayout` (document-layouts.ts) top-to-bottom, measuring each block
 * against remaining page height, and starts a new page when a block doesn't
 * fit. Table blocks split across pages via the plugin's existing
 * `startIndex`/`endIndex` support so long equipment lists never drop their
 * tail — the pagination invariants (atomic rows, header repetition, no
 * tail-drop) are ported from the deleted section-renderer.ts's test suite as
 * this engine's spec; the implementation is new and purpose-built for fixed
 * layouts only (no visibility conditions, no {token} text, no columns).
 * See docs/designs/pdf-system-redesign.md.
 */
import type { Template, Schema } from "@pdfme/common";
import { mm2pt } from "@pdfme/common";
import type {
  DocumentData,
  DocumentLineItem,
  DocumentType,
  TablePluginConfig,
  FinancialSummaryConfig,
  PageHeaderConfig,
  FooterConfig,
  SignatureLineConfig,
  DraftWatermarkConfig,
} from "./types";
import {
  getDocumentLayout,
  type DocumentLayout,
  type DocumentLayoutOptions,
  type LayoutBlock,
  type TableLayoutConfig,
  type ProjectDocumentType,
} from "./document-layouts";
import {
  SECTION_GAP,
  getPageGeometry,
  type PaperSize,
  type PageGeometry,
} from "./template-constants";
import { parsePriceBreakdown, formatPriceBreakdown } from "@/lib/billing-derivation";
import { wrapRichText, richTextLineHeight, truncateText, type RichLine, type RichTextFonts } from "./plugins/helpers";
import { isSubhireIndicatorVisible } from "./plugins/gearflow-table";

// ─── Height constants (pt) — must match gearflow-table.ts's actual draw sizes ─
// Derived from pdfme's own mm2pt (not a hand-typed inverse) so pt→mm can never
// drift from the library's real mm→pt factor — a second, slightly-off constant
// here was one contributor to the AX Head Technician tail-drop (a composer
// height estimate that didn't round-trip to exactly what gearflow-table.ts's
// real pt-native draw math produced). See TABLE_PADDING_BOTTOM_MM below for the
// other half of that fix.
const PT_PER_MM = mm2pt(1);
const PARENT_ROW_PT = 9 + 4 * 2; // fontSize(9) + rowPadding(4)*2
const CHILD_ROW_PT = 8 + 4 * 2;
const GRANDCHILD_ROW_PT = 7 + 4 * 2;
const PER_UNIT_ROW_PT = 10;
const GROUP_HEADER_PT = 9 + 4 * 2;
const TABLE_HEADER_PT = 7 + 4 * 2 + 4;
// Safety margin at the bottom of a table block. Doubles as a defensive buffer
// against composer-estimate vs. gearflow-table.ts-actual-draw divergence: it
// both (a) shrinks the fitItems() budget slightly, so a marginal item is more
// likely to be pushed to the next page instead of squeezed onto a tight last
// page, and (b) pads the allotted schema height on a page that DOES fit
// everything, giving the real draw loop's own bottomBoundary check headroom.
// Bumped from 1mm after a real-world tail-drop (AX Head Technician Day Rate,
// #1149): the composer believed a 5-service "Services" group fit entirely on
// a continuation page and told gearflowTable to render all of it (no further
// page scheduled), but the real draw loop's independently-computed row
// heights ran it out of room one row early, and its own overflow guard
// silently stopped — with no signal back to the composer that anything was
// dropped. This margin doesn't identify the specific per-row estimate that
// was off; it makes the whole class of small estimate/draw divergences
// non-fatal by leaving slack instead of cutting it to the pixel. See
// docs/designs/pdf-system-redesign.md's planned react-pdf migration for the
// structural fix (one shared layout pass, no separate estimate to diverge).
const TABLE_PADDING_BOTTOM_MM = 4;
// gearflowRichText's schema fontSize for both clientNotes and termsAndConditions
// (buildEntryFields) — shared here so the accurate estimate/split math can
// never drift from what's actually configured on the rendered schema.
const RICH_TEXT_FONT_SIZE = 8;

function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

/** Ungrouped-items bucket key, per docType's plugin convention. */
export function getUngroupedKey(docType: ProjectDocumentType): string {
  switch (docType) {
    case "packing-list":
      return "Ungrouped";
    case "delivery-docket":
      return "General";
    default:
      return "_ungrouped";
  }
}

function isBulk(item: DocumentLineItem): boolean {
  return !!item.bulkAssetId || (!item.assetId && item.quantity > 1);
}

/**
 * Sum of every visible (top-level) line's own `discount` field — matches
 * exactly what the table's new per-line "Discount" column renders, so the
 * totals block's "Item Discounts" rollup always reconciles with what the
 * client can add up themselves off the table above it. `data.line_items`
 * is already the structured (post `structureLineItems`) array quote/invoice
 * render, so a collapsed Project Group's dropped children are correctly
 * excluded — their discount, if any, only counts if it also ended up on
 * the group's own synthetic row.
 */
function computeItemDiscountTotal(data: DocumentData): number {
  return data.line_items.reduce((sum, li) => sum + (li.discount ?? 0), 0);
}

/**
 * Filter to parent (non-kit-child, non-container) items, then apply the
 * doc-type status filter. A synthetic Project Group row passes through if
 * ANY attached child passes — otherwise the whole group (and every member)
 * would vanish from a warehouse doc because of one filtered-out sibling.
 */
/**
 * `isReturnSheet` (WS11 #950, default false): must mirror gearflow-table.ts's
 * own filter block exactly — a SALE line always bypasses `filterByStatus`
 * (goods handed over, so it "counts" for delivery-docket purposes regardless
 * of status) EXCEPT on the return sheet, where it's excluded entirely (never
 * expected back). Quote/invoice/packing-list pass no `filterByStatus` at all
 * (document-layouts.ts), so a SALE line already flows through those
 * unfiltered — `isReturnSheet` only matters for the two doc types that DO
 * set `filterByStatus` (delivery-docket, return-sheet).
 */
export function getFilteredParentItems(
  data: DocumentData,
  filterByStatus: string[] | null,
  isReturnSheet = false,
): DocumentLineItem[] {
  let items = data.line_items.filter((i) => !i.isKitChild && !i.isContainerLineItem);

  if (filterByStatus) {
    const statuses = filterByStatus;
    items = items.filter((i) => {
      if (i.type === "SALE") return !isReturnSheet;
      if (isBulk(i)) return i.checkedOutQuantity > 0;
      if (i.isGroupRow && (i.childLineItems?.length ?? 0) > 0) {
        return i.childLineItems!.some((c) => {
          if (c.type === "SALE") return !isReturnSheet;
          return isBulk(c) ? c.checkedOutQuantity > 0 : statuses.includes(c.status);
        });
      }
      return statuses.includes(i.status);
    });
  }

  return items;
}

function getItemGroupKey(item: DocumentLineItem, ungrouped: string): string {
  return item.groupName || item.prepContainer || ungrouped;
}

/** Delivery-docket-only grouping — must mirror gearflow-table.ts's kit-promotion logic. */
function buildDeliveryDocketGroups(
  data: DocumentData,
  filterByStatus: string[] | null,
): { groupOrder: string[]; groups: Map<string, DocumentLineItem[]> } {
  const parentItems = getFilteredParentItems(data, filterByStatus);
  const groups = new Map<string, DocumentLineItem[]>();
  const groupOrder: string[] = [];

  for (const item of parentItems) {
    const isKitParent = !!item.kitId && !item.isKitChild;
    if (isKitParent) {
      const kitName = item.kit?.name || item.description || "Kit";
      const children = (item.childLineItems || []).filter((c) => c.status === "CHECKED_OUT");
      if (children.length > 0) {
        if (!groups.has(kitName)) {
          groupOrder.push(kitName);
          groups.set(kitName, []);
        }
        groups.get(kitName)!.push(...children);
      }
    } else {
      const key = item.groupName || item.prepContainer || "General";
      if (!groups.has(key)) {
        groupOrder.push(key);
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }
  }

  return { groupOrder, groups };
}

function getSubItemCount(item: DocumentLineItem, config: TableLayoutConfig): number {
  const isKit = !!item.kitId;
  if (config.showPerUnitCheckboxes && !isKit && item.quantity > 1) return item.quantity;
  return 0;
}

/** How many of a partially-visible item's sub-rows fit in the remaining space. */
function calculatePartialFit(
  item: DocumentLineItem,
  config: TableLayoutConfig,
  availableHeightMm: number,
  existingSubOffset = 0,
): { fits: boolean; subItemsRendered: number } {
  const parentRowMm = ptToMm(PARENT_ROW_PT);
  if (availableHeightMm < parentRowMm) return { fits: false, subItemsRendered: 0 };
  const totalSubItems = getSubItemCount(item, config);
  if (totalSubItems <= existingSubOffset) return { fits: false, subItemsRendered: 0 };
  const perUnitMm = ptToMm(PER_UNIT_ROW_PT);
  const subItemsFit = Math.floor((availableHeightMm - parentRowMm) / perUnitMm);
  if (subItemsFit <= 0) return { fits: false, subItemsRendered: 0 };
  return { fits: true, subItemsRendered: Math.min(subItemsFit, totalSubItems - existingSubOffset) };
}

/** Height of an item on a continuation page (parent row already drawn, skip it). */
function calculateRemainingItemHeight(item: DocumentLineItem, config: TableLayoutConfig, subItemOffset: number): number {
  let heightPt = 0;
  const isKit = !!item.kitId;
  if (config.showPerUnitCheckboxes && !isKit && item.quantity > 1) {
    heightPt += Math.max(0, item.quantity - subItemOffset) * PER_UNIT_ROW_PT;
  }
  return ptToMm(heightPt);
}

/** Rendered height (mm) of one parent item incl. all sub-rows (per-unit, kit/group/accessory children, grandchildren). */
export function calculateItemHeight(item: DocumentLineItem, config: TableLayoutConfig, documentType?: string): number {
  let heightPt = PARENT_ROW_PT;

  // Sub-hire "via <Supplier>" line — must match gearflow-table.ts's own
  // isSubhireIndicatorVisible() gate exactly (fontSize(9) + 1 = 10pt there),
  // or every sub-hire row's real rendered height silently diverges from what
  // was reserved for it. On a doc with many sub-hire lines this compounds
  // fast: document-composer.ts ends up believing a different number of items
  // fit on a page than actually do, the table's own render-time overflow
  // guard then quietly stops mid-page with no continuation page ever
  // scheduled — a silent tail-drop that can lose entire trailing categories,
  // not just one row (the exact class of bug the #790 redesign's
  // "no tail-drop" guarantee exists to prevent).
  if (item.supplierName && isSubhireIndicatorVisible(item, documentType)) {
    heightPt += 9 + 1;
  }

  // Price breakdown (#943) — must match gearflowTable.ts's own `breakdownLabel`
  // check exactly, or an auto-priced line's breakdown text silently drops off
  // the tail of a paginated table (the exact footgun this file's header comment
  // warns about for any DocumentLineItem shape change).
  if (item.priceBreakdown && config.showPricing) {
    const parsed = parsePriceBreakdown(item.priceBreakdown);
    if (parsed && formatPriceBreakdown(parsed)) heightPt += 7 + 2;
  }

  if (item.notes && config.showNotes) {
    heightPt += item.notes.split("\n").length * (7 + 2);
  }

  const isKit = !!item.kitId;
  const isGroupParent = !!item.isGroupRow && (item.childLineItems?.length ?? 0) > 0;
  const isAccessoryParent =
    !item.kitId && !item.isGroupRow && (item.childLineItems?.some((c) => c.childKind === "ACCESSORY") ?? false);

  if (config.showPerUnitCheckboxes && !isKit && !isGroupParent && !isAccessoryParent && item.quantity > 1) {
    heightPt += item.quantity * PER_UNIT_ROW_PT;
  }

  // Mirrors gearflow-table.ts's rendering gate exactly — all three
  // parent-with-children kinds (kit, group, accessory) are gated by the
  // same `showKitChildren` flag, or this height reservation silently
  // diverges from what actually gets drawn (tail-drop on quote/invoice,
  // wasted whitespace on warehouse docs).
  if ((isKit || isGroupParent || isAccessoryParent) && config.showKitChildren) {
    const children = item.childLineItems || [];
    for (const child of children) {
      heightPt += CHILD_ROW_PT;
      const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
      const childHasAccessories = !child.kitId && (child.childLineItems ?? []).some((gc) => gc.childKind === "ACCESSORY");

      if (config.showPerUnitCheckboxes && !isNestedKit && child.quantity > 1) {
        heightPt += child.quantity * PER_UNIT_ROW_PT;
      }

      if (isNestedKit || childHasAccessories) {
        const grandchildren = child.childLineItems || [];
        heightPt += grandchildren.length * GRANDCHILD_ROW_PT;
        if (config.showPerUnitCheckboxes) {
          for (const gc of grandchildren) {
            if (gc.childKind === "ACCESSORY" && gc.quantity > 1) heightPt += gc.quantity * PER_UNIT_ROW_PT;
          }
        }
      }
    }
  }

  return ptToMm(heightPt);
}

/** Per-parent-item heights in render order (group headers included), for page-break math. */
function calculateTableItemHeights(
  data: DocumentData,
  config: TableLayoutConfig,
  docType: ProjectDocumentType,
  filterByStatus: string[] | null,
): number[] {
  const ungrouped = getUngroupedKey(docType);
  const heights: number[] = [];

  const groupOrder: string[] = [];
  const groups = new Map<string, DocumentLineItem[]>();
  if (docType === "delivery-docket") {
    const docketGroups = buildDeliveryDocketGroups(data, filterByStatus);
    docketGroups.groupOrder.forEach((k) => groupOrder.push(k));
    docketGroups.groups.forEach((v, k) => groups.set(k, v));
  } else {
    for (const item of getFilteredParentItems(data, filterByStatus, docType === "return-sheet")) {
      const key = getItemGroupKey(item, ungrouped);
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push(item);
    }
  }

  for (const groupKey of groupOrder) {
    if (groupKey !== ungrouped && config.showGroupHeaders) heights.push(ptToMm(GROUP_HEADER_PT));
    for (const item of groups.get(groupKey)!) heights.push(calculateItemHeight(item, config, docType));
  }

  return heights;
}

// ─── Block height estimation ──────────────────────────────────────────────────

interface LayoutContext {
  docType: ProjectDocumentType;
  filterByStatus: string[] | null;
  /**
   * Real embedded Helvetica fonts, when the caller provided them (production
   * rendering via generate-pdf.ts). When present, clientNotes/
   * termsAndConditions measure their ACTUAL wrapped line count instead of
   * counting literal `\n`s — the previous heuristic silently under-reserved
   * space for any line that word-wraps, which could overflow past a page's
   * footer. Optional so composeDocument stays synchronous and every existing
   * caller/test that doesn't pass fonts keeps its exact prior behavior.
   */
  fonts?: RichTextFonts;
  /** I5 (#1084) — page dimensions, resolved once per `composeDocument` call
   *  from the org's country (A4 default). A wider page fits more per line, so
   *  this affects wrapped-line-count height estimates too, not just layout
   *  positions — never a hardcoded module constant. */
  geometry: PageGeometry;
}

/** Wrapped line count for a markdown-lite block, using real font metrics
 *  when available (see LayoutContext.fonts) — shared by the height estimate
 *  and the page-splitting logic so they can never disagree. `contentWidthMm`
 *  comes from the active `PageGeometry` (I5, #1084) — a wider Letter page
 *  wraps fewer lines than the same text on A4. */
function wrappedLineCount(text: string, fonts: RichTextFonts, contentWidthMm: number): number {
  return wrapRichText(text, { maxWidth: mm2pt(contentWidthMm), fontSize: RICH_TEXT_FONT_SIZE, fonts }).length;
}

function estimateBlockHeight(block: LayoutBlock, data: DocumentData, ctx: LayoutContext): number {
  switch (block.kind) {
    case "header": {
      // Measured against gearflow-page-header.ts's actual draw geometry
      // (rather than flat per-mode constants) so the reservation tracks what
      // gets drawn instead of padding every header with slack sized for the
      // worst case — that slack was the visible gap above the details row.
      const mode = data.org_branding?.documentLogoMode ?? "icon";
      const showOrgName = (data.org_branding?.showOrgNameOnDocuments ?? true) && !!data.org_name;

      // Org detail lines (address/phone/email/ABN/website), same fields and
      // order as buildEntryFields' orgDetailParts below.
      let orgDetailLines = 0;
      if (data.org_address) orgDetailLines++;
      if (data.org_phone) orgDetailLines++;
      if (data.org_email) orgDetailLines++;
      if (data.org_abn) orgDetailLines++;
      if (data.org_website) orgDetailLines++;

      // Left column: logo row (maxLogoH 50pt + 16pt clearance, logo mode
      // only) + org name row (18pt + spacing, if shown) + 12pt per detail line.
      const logoRowMm = mode === "logo" ? ptToMm(50 + 16) : 0;
      const orgNameRowMm = showOrgName ? ptToMm(28) : 0;
      const leftColumnMm = logoRowMm + orgNameRowMm + orgDetailLines * ptToMm(12);

      // Right column: title (22pt) + 14pt clearance + 13pt per meta line
      // (doc number + date, +expiry on quotes) + the bold "Due: <date>"
      // highlight line on invoices.
      const hasExpiryLine = ctx.docType === "quote" && !!data.quote_valid_until;
      const hasDueDateLine = ctx.docType === "invoice" && !!data.invoice_due_date;
      const metaLineCount = 2 + (hasExpiryLine ? 1 : 0);
      const rightColumnMm = ptToMm(22 + 14 + metaLineCount * 13 + (hasDueDateLine ? 11 : 0));

      // Icon mode's icon renders inline with the org name/details column
      // (up to 40pt tall) rather than its own row — floor the column so a
      // header with an icon but no org name/details still clears it.
      const iconFloorMm = mode === "icon" ? ptToMm(40) : 0;

      const PADDING_MM = 4; // breathing room below the taller column
      return Math.max(leftColumnMm, rightColumnMm, iconFloorMm) + PADDING_MM;
    }

    case "detailsRow": {
      let clientLines = 0;
      if (block.client.showClientName && data.client_name) clientLines++;
      if (block.client.showClientContact && data.client_contact) clientLines++;
      if (block.client.showClientEmail && data.client_email) clientLines++;
      if (block.client.showClientAddress && data.client_billing_address) clientLines++;
      if (block.client.showClientTaxId && data.client_tax_id) clientLines++;

      let projectLines = 1; // project name always shown
      if (block.project.showVenue && data.venue_name) projectLines++;
      if (block.project.showRentalDates && data.rental_start && data.rental_start !== "-") projectLines++;
      if (block.project.showEventDates && data.event_start && data.event_start !== "-") projectLines++;
      if (block.project.showPaymentTerms && data.client_payment_terms) projectLines++;
      if (block.project.showSiteContact && data.site_contact_name) projectLines++;
      if (block.project.showDocumentDate) projectLines++;
      if (block.project.showInvoiceNumber && data.invoice_number) projectLines++;

      return Math.max(clientLines, projectLines, 3) * 4;
    }

    case "table": {
      const itemHeights = calculateTableItemHeights(data, block.config, ctx.docType, ctx.filterByStatus);
      const contentHeight = itemHeights.reduce((sum, h) => sum + h, 0);
      return ptToMm(TABLE_HEADER_PT) + contentHeight + TABLE_PADDING_BOTTOM_MM;
    }

    case "totals": {
      // 34 (base: top padding + wide divider clearance around Total, see
      // gearflow-financial-summary.ts) + 2 extra rows (~10mm) when any line
      // carries its own discount ("Subtotal (before discounts)" + "Item
      // Discounts", drawn above the existing net Subtotal row).
      const hasItemDiscounts = computeItemDiscountTotal(data) > 0;
      let height = hasItemDiscounts ? 44 : 34;
      // + 1 row (~5mm) for the bold "Due Date" row at the bottom, invoice only.
      if (block.config.showDueDate && data.invoice_due_date) height += 5;
      return height;
    }

    case "clientNotes": {
      if (!data.client_notes) return 4;
      if (ctx.fonts) {
        return Math.max(ptToMm(wrappedLineCount(data.client_notes, ctx.fonts, ctx.geometry.contentWidth) * richTextLineHeight(RICH_TEXT_FONT_SIZE)), 4);
      }
      return 12; // fallback heuristic — unchanged when no fonts are provided
    }

    case "totalItemsNote":
      return 8;

    // Title (14pt ≈ 5mm) + subtitle (7.5pt ≈ 2.6mm) + the banner's own padding,
    // matching gearflow-draft-watermark.ts's draw sizes. Reserved like any other
    // block — an unreserved overlay is exactly how the v0.8.1.1 tail-drop
    // happened, and this one repeats on every page.
    case "draftWatermark":
      return 14;

    case "termsAndConditions": {
      // Optional — collapses to zero height (and is skipped entirely by the
      // page-layout walk) when the org hasn't set any T&Cs text (or, on the
      // invoice, when showTermsAndConditionsOnInvoice is off — see
      // build-document-data.ts, which resolves that gate into this same field).
      if (!data.terms_and_conditions) return 0;
      if (ctx.fonts) {
        return Math.max(
          ptToMm(wrappedLineCount(data.terms_and_conditions, ctx.fonts, ctx.geometry.contentWidth) * richTextLineHeight(RICH_TEXT_FONT_SIZE)),
          8,
        );
      }
      const lines = data.terms_and_conditions.split("\n").length;
      return Math.max(lines * 4 + 4, 8);
    }

    case "paymentDetails": {
      // Same optional-collapse convention as termsAndConditions — empty
      // (no bank details configured, or non-invoice doc type) means zero
      // height, no schema.
      if (!data.payment_details) return 0;
      if (ctx.fonts) {
        return Math.max(
          ptToMm(wrappedLineCount(data.payment_details, ctx.fonts, ctx.geometry.contentWidth) * richTextLineHeight(RICH_TEXT_FONT_SIZE)),
          8,
        );
      }
      const lines = data.payment_details.split("\n").length;
      return Math.max(lines * 4 + 4, 8);
    }

    case "signature":
      return 20;
  }
}

// ─── Page layout ───────────────────────────────────────────────────────────────

interface PageEntry {
  block: LayoutBlock;
  y: number;
  height: number;
  tableStartIndex?: number;
  tableEndIndex?: number;
  tableSubIndex?: number;
  /** Pre-wrapped slice of a clientNotes/termsAndConditions block for THIS
   *  page (see splitRichTextBlock). Only set when the caller provided real
   *  fonts — buildEntryFields falls back to raw text otherwise. */
  textLines?: RichLine[];
}

interface Page {
  entries: PageEntry[];
}

/**
 * Page FURNITURE — the blocks repeated on EVERY page rather than flowing with
 * the body: the header, and (preview renders only) the draft watermark. A
 * "DRAFT PREVIEW — NOT SENT" banner that appeared only on page 1 of a 4-page
 * quote would not be a warning, so it lives here alongside the header rather
 * than in the body walk (#987).
 */
function isPageFurniture(block: LayoutBlock): boolean {
  return block.kind === "header" || block.kind === "draftWatermark";
}

/** Furniture blocks with their measured heights, plus the vertical space they
 *  consume at the top of every page (each block + its trailing section gap). */
function measurePageFurniture(
  layout: DocumentLayout,
  data: DocumentData,
  ctx: LayoutContext,
): { blocks: { block: LayoutBlock; height: number }[]; totalHeight: number } {
  const blocks = layout.blocks
    .filter(isPageFurniture)
    .map((block) => ({ block, height: estimateBlockHeight(block, data, ctx) }));
  return { blocks, totalHeight: blocks.reduce((sum, b) => sum + b.height + SECTION_GAP, 0) };
}

/**
 * Compute the multi-page layout for one document: walk the layout's blocks
 * top-to-bottom, starting a new page when a block doesn't fit. Table blocks
 * split across pages (per-item cumulative heights) instead of moving whole —
 * this is the tail-drop fix. clientNotes/termsAndConditions split the same
 * way, by wrapped line, whenever real fonts are available (see
 * splitRichTextBlock) — a long T&Cs block no longer has to fit on a single
 * page (or silently overflow into the footer trying to). All mutable
 * page/cursor state lives in this function's closure so the split branches
 * can push finished pages and open new ones without a separate state object
 * to keep in sync.
 */
function computePages(
  layout: DocumentLayout,
  data: DocumentData,
  docType: ProjectDocumentType,
  geometry: PageGeometry,
  fonts?: RichTextFonts,
): Page[] {
  const ctx: LayoutContext = { docType, filterByStatus: layout.filterByStatus, fonts, geometry };
  const furniture = measurePageFurniture(layout, data, ctx);
  const bodyBlocks = layout.blocks.filter((b) => !isPageFurniture(b));

  const maxY = geometry.height - geometry.margin - geometry.footerHeight;
  const continuationContentHeight = maxY - geometry.margin - furniture.totalHeight;
  const tableHeaderMm = ptToMm(TABLE_HEADER_PT);

  const pages: Page[] = [];
  let currentPage: Page = { entries: [] };
  let currentY = geometry.margin;

  function placePageFurniture() {
    for (const { block, height } of furniture.blocks) {
      currentPage.entries.push({ block, y: currentY, height });
      currentY += height + SECTION_GAP;
    }
  }

  function startNewPage() {
    pages.push(currentPage);
    currentPage = { entries: [] };
    currentY = geometry.margin;
    placePageFurniture();
  }

  /** Split a table block across pages using per-item cumulative heights. */
  function splitTable(block: Extract<LayoutBlock, { kind: "table" }>) {
    const { config } = block;
    const itemHeights = calculateTableItemHeights(data, config, docType, ctx.filterByStatus);
    const ungrouped = getUngroupedKey(docType);

    const groupOrder: string[] = [];
    const groups = new Map<string, DocumentLineItem[]>();
    let parentItems: DocumentLineItem[] = [];
    if (docType === "delivery-docket") {
      const docketGroups = buildDeliveryDocketGroups(data, ctx.filterByStatus);
      for (const key of docketGroups.groupOrder) {
        const items = docketGroups.groups.get(key)!;
        groups.set(key, items);
        groupOrder.push(key);
        parentItems.push(...items);
      }
    } else {
      parentItems = getFilteredParentItems(data, ctx.filterByStatus, docType === "return-sheet");
      for (const item of parentItems) {
        const key = getItemGroupKey(item, ungrouped);
        if (!groups.has(key)) {
          groups.set(key, []);
          groupOrder.push(key);
        }
        groups.get(key)!.push(item);
      }
    }

    // heightToParentIdx[i] maps a height-array entry to a parent-item index,
    // or -1 for a group header (not a startIndex-addressable item).
    const heightToParentIdx: number[] = [];
    let parentIdx = 0;
    for (const groupKey of groupOrder) {
      if (groupKey !== ungrouped && config.showGroupHeaders) {
        heightToParentIdx.push(-1);
      }
      for (let gi = 0; gi < groups.get(groupKey)!.length; gi++) {
        heightToParentIdx.push(parentIdx);
        parentIdx++;
      }
    }

    const getItemAt = (idx: number): DocumentLineItem | null => {
      if (idx >= heightToParentIdx.length) return null;
      const pi = heightToParentIdx[idx];
      return pi >= 0 ? parentItems[pi] : null;
    };

    const fitItems = (startIdx: number, budget: number, pendingSub: number): { count: number; subIndex: number } => {
      let cumulative = 0;
      let count = 0;
      let subIndex = 0;

      for (let i = startIdx; i < itemHeights.length; i++) {
        let h = itemHeights[i];
        if (i === startIdx && pendingSub > 0) {
          const item = getItemAt(i);
          if (item) h = calculateRemainingItemHeight(item, config, pendingSub);
        }

        if (cumulative + h <= budget) {
          cumulative += h;
          count++;
          continue;
        }

        if (count === 0) {
          // Always render at least one item, even oversized.
          count++;
          break;
        }

        const item = getItemAt(i);
        if (item) {
          const existingSub = i === startIdx ? pendingSub : 0;
          const partial = calculatePartialFit(item, config, budget - cumulative, existingSub);
          if (partial.fits) {
            count++;
            subIndex = existingSub + partial.subItemsRendered;
          }
        }
        break;
      }

      return { count, subIndex };
    };

    const availableHeight = maxY - currentY;
    const firstPageContent = availableHeight - tableHeaderMm - TABLE_PADDING_BOTTOM_MM;
    const firstFit = fitItems(0, firstPageContent, 0);
    const firstPageItems = firstFit.count;
    let pendingSubIndex = firstFit.subIndex;
    const firstHasMore = pendingSubIndex > 0 || firstPageItems < itemHeights.length;

    let firstPageEndIndex: number | undefined;
    if (firstHasMore) {
      firstPageEndIndex = 0;
      for (let i = 0; i < firstPageItems && i < heightToParentIdx.length; i++) {
        if (heightToParentIdx[i] >= 0) firstPageEndIndex = heightToParentIdx[i] + 1;
      }
    }

    // If everything actually fit, use the real content height (not the full
    // available height) so the next block can share this page — fixes a
    // latent edge case in the ported algorithm where the Y cursor never
    // advanced when the split branch was entered but every item still fit.
    let firstPageHeight = availableHeight;
    if (!firstHasMore) {
      firstPageHeight = tableHeaderMm + TABLE_PADDING_BOTTOM_MM + itemHeights.slice(0, firstPageItems).reduce((s, h) => s + h, 0);
    }

    currentPage.entries.push({
      block,
      y: currentY,
      height: firstPageHeight,
      tableStartIndex: 0,
      tableEndIndex: firstPageEndIndex,
    });

    if (!firstHasMore) {
      currentY += firstPageHeight + SECTION_GAP;
      return;
    }

    let remainingIdx = pendingSubIndex > 0 ? firstPageItems - 1 : firstPageItems;

    while (remainingIdx < itemHeights.length) {
      startNewPage();

      // No extra reservation for a group header repeating on this
      // continuation page — gearflow-table.ts only draws a group's header
      // where it *starts* (2026-07-28), never again on pages that merely
      // continue it.
      const pageContent = continuationContentHeight - tableHeaderMm - TABLE_PADDING_BOTTOM_MM;

      const fit = fitItems(remainingIdx, pageContent, pendingSubIndex);
      const pageItems = fit.count;

      let startParentIdx = 0;
      for (let i = 0; i < remainingIdx && i < heightToParentIdx.length; i++) {
        if (heightToParentIdx[i] >= 0) startParentIdx = heightToParentIdx[i] + 1;
      }
      if (pendingSubIndex > 0 && heightToParentIdx[remainingIdx] >= 0) {
        startParentIdx = heightToParentIdx[remainingIdx];
      }

      const itemsEndIdx = remainingIdx + Math.max(1, pageItems);
      const isLastPage = !fit.subIndex && itemsEndIdx >= itemHeights.length;
      let pageEndIndex: number | undefined;
      if (!isLastPage) {
        pageEndIndex = 0;
        for (let i = 0; i < itemsEndIdx && i < heightToParentIdx.length; i++) {
          if (heightToParentIdx[i] >= 0) pageEndIndex = heightToParentIdx[i] + 1;
        }
      }

      let tableHeight = continuationContentHeight;
      if (isLastPage) {
        // Same no-repeat-header accounting as the pageContent budget above.
        let actualMm = tableHeaderMm + TABLE_PADDING_BOTTOM_MM;
        for (let i = remainingIdx; i < remainingIdx + pageItems && i < itemHeights.length; i++) {
          let h = itemHeights[i];
          if (i === remainingIdx && pendingSubIndex > 0) {
            const item = getItemAt(i);
            if (item) h = calculateRemainingItemHeight(item, config, pendingSubIndex);
          }
          actualMm += h;
        }
        tableHeight = actualMm;
      }

      currentPage.entries.push({
        block,
        y: currentY,
        height: tableHeight,
        tableStartIndex: startParentIdx,
        tableEndIndex: pageEndIndex,
        tableSubIndex: pendingSubIndex > 0 ? pendingSubIndex : undefined,
      });
      currentY += tableHeight + SECTION_GAP;

      if (fit.subIndex > 0) {
        remainingIdx = remainingIdx + pageItems - 1;
        pendingSubIndex = fit.subIndex;
      } else {
        remainingIdx += Math.max(1, pageItems);
        pendingSubIndex = 0;
      }
    }
  }

  /**
   * Split a clientNotes/termsAndConditions/paymentDetails block across pages
   * by wrapped line — mirrors splitTable's per-item fill loop, but lines are
   * uniform height and atomic (no sub-items/children to worry about), so the
   * loop is a straight "how many whole lines fit in what's left" fill. Wraps
   * ONCE up front with real font metrics (the same call estimateBlockHeight
   * used to decide this block needed splitting in the first place) so the
   * line breaks placed on the page are identical to what was measured.
   */
  function splitRichTextBlock(block: Extract<LayoutBlock, { kind: "clientNotes" | "termsAndConditions" | "paymentDetails" }>, text: string, fonts: RichTextFonts) {
    const lineHeightMm = ptToMm(richTextLineHeight(RICH_TEXT_FONT_SIZE));
    const allLines = wrapRichText(text, { maxWidth: mm2pt(geometry.contentWidth), fontSize: RICH_TEXT_FONT_SIZE, fonts });

    let idx = 0;
    while (idx < allLines.length) {
      let available = maxY - currentY;
      if (available < lineHeightMm) {
        startNewPage();
        available = maxY - currentY;
      }
      // Always place at least one line, even if it doesn't fit — matches
      // splitTable's "always render at least one item" invariant, so a
      // single oversized line can never cause an infinite loop.
      const count = Math.max(1, Math.min(allLines.length - idx, Math.floor(available / lineHeightMm)));
      const slice = allLines.slice(idx, idx + count);
      const blockHeight = count * lineHeightMm;

      currentPage.entries.push({ block, y: currentY, height: blockHeight, textLines: slice });
      currentY += blockHeight + SECTION_GAP;
      idx += count;
    }
  }

  /**
   * Try to split a block that doesn't fit on the current page instead of
   * moving it whole. Returns whether it actually split (the caller falls
   * back to startNewPage() when it didn't). Pulled out of the main loop
   * body to keep computePages's own branch count down (R-3.6) — the
   * table/richText special-casing lives here instead.
   */
  function trySplitAcrossPages(block: LayoutBlock): boolean {
    if (block.kind === "table") {
      splitTable(block);
      return true;
    }
    if ((block.kind === "clientNotes" || block.kind === "termsAndConditions" || block.kind === "paymentDetails") && ctx.fonts) {
      const text =
        block.kind === "clientNotes"
          ? data.client_notes || ""
          : block.kind === "termsAndConditions"
            ? data.terms_and_conditions
            : data.payment_details;
      splitRichTextBlock(block, text, ctx.fonts);
      return true;
    }
    return false;
  }

  /** A `forceNewPage` block (currently just termsAndConditions) always
   *  starts fresh rather than sharing whatever's left on the page above it
   *  — unless it's already the first thing on a page (nothing to break
   *  away from). "First thing" means nothing beyond the page furniture
   *  (header, and on a preview render the draft watermark). */
  function needsForcedPageBreak(block: LayoutBlock): boolean {
    if (block.kind !== "termsAndConditions" || !block.forceNewPage) return false;
    const isFreshPage = currentPage.entries.length <= furniture.blocks.length;
    return !isFreshPage;
  }

  placePageFurniture();

  for (const block of bodyBlocks) {
    const height = estimateBlockHeight(block, data, ctx);
    // Optional content blocks (e.g. termsAndConditions with no text set)
    // collapse to zero height and are omitted entirely — no schema, no gap.
    if (height <= 0) continue;

    if (needsForcedPageBreak(block)) startNewPage();

    if (currentY + height > maxY && currentPage.entries.length > 0) {
      if (trySplitAcrossPages(block)) continue;
      startNewPage();
    }

    currentPage.entries.push({ block, y: currentY, height });
    currentY += height + SECTION_GAP;
  }

  if (currentPage.entries.length > 0) pages.push(currentPage);
  return pages;
}

// ─── Schema / input generation ─────────────────────────────────────────────────

interface RenderedField {
  schema: Schema & Record<string, unknown>;
  input: string;
}

function buildEntryFields(
  entry: PageEntry,
  data: DocumentData,
  docType: DocumentType,
  docColor: string,
  filterByStatus: string[] | null,
  name: string,
  geometry: PageGeometry,
  fonts?: RichTextFonts,
): RenderedField[] {
  const { block, y, height } = entry;

  switch (block.kind) {
    case "header": {
      const orgDetailParts: string[] = [];
      if (data.org_address) orgDetailParts.push(data.org_address);
      if (data.org_phone) orgDetailParts.push(data.org_phone);
      if (data.org_email) orgDetailParts.push(data.org_email);
      // Business registration id, shown wherever the org address/phone/email
      // block renders — every doc type, not just Tax Invoices (AU Tax
      // Invoices require it, but there's no reason to hide it elsewhere).
      // Placed under the address/email lines already above it. Label is
      // country-derived (I4, #1083) — "ABN" is Australian, not global.
      if (data.org_abn) orgDetailParts.push(`${data.org_business_number_label}: ${data.org_abn}`);
      if (data.org_website) orgDetailParts.push(data.org_website);

      // Quote expiry moves from its own bottom-of-document line into the
      // header meta (with the doc number/date) — a simple "Expiry: <date>"
      // read right where the client is already looking, not a standalone
      // sentence buried at the end of a possibly multi-page document.
      // #1080/#1097 — `project_number` can carry a quote's version/label suffix
      // (`v2 · Budget option`, stamped by `finance-documents.ts` only when
      // `labelOnDocument` is set) — user-entered text, so it gets the SAME
      // measured shrink-to-fit treatment `docTitle` already has, rather than
      // trusting it to fit. `fonts` is optional (some composeDocument callers
      // render without real font metrics) — skip the cap rather than guess.
      const projectNumberLine = fonts
        ? truncateText(data.project_number || "", fonts.regular, 9, geometry.contentWidth * 0.55)
        : data.project_number || "";
      const docMetaLines = [projectNumberLine, data.document_date || ""];
      if (docType === "quote" && data.quote_valid_until) docMetaLines.push(`Expiry: ${data.quote_valid_until}`);

      // I4 (#1083) — "TAX INVOICE" is an AU/NZ legal term, not a global one.
      // Only the invoice layout's static block.title needs a country-derived
      // override; every other doc type's heading (QUOTE, PULL SLIP, …) is a
      // generic business term that doesn't vary per country.
      const docTitle = docType === "invoice" ? data.org_invoice_heading || block.title : block.title;

      const config: PageHeaderConfig = {
        orgName: data.org_name || "",
        orgDetails: orgDetailParts.join("\n"),
        docTitle,
        docMeta: docMetaLines.join("\n"),
        logoData: data.org_logo,
        iconData: data.org_icon,
        documentLogoMode: data.org_branding?.documentLogoMode ?? "icon",
        showOrgNameOnDocuments: data.org_branding?.showOrgNameOnDocuments ?? true,
        documentColor: docColor,
        // Bold, document-coloured — impossible to miss at the top of the
        // invoice, right next to the doc number/date the client is already
        // reading. Repeated (plain, not bold) at the bottom of the totals
        // block via FinancialSummaryConfig.dueDate — see the "totals" case.
        highlightMeta: docType === "invoice" && data.invoice_due_date ? `Due: ${data.invoice_due_date}` : undefined,
      };
      return [
        {
          schema: { name, type: "gearflowPageHeader", content: "", position: { x: geometry.margin, y }, width: geometry.contentWidth, height },
          input: JSON.stringify(config),
        },
      ];
    }

    case "draftWatermark": {
      const config: DraftWatermarkConfig = { title: block.title, subtitle: block.subtitle };
      return [
        {
          schema: { name, type: "gearflowDraftWatermark", content: "", position: { x: geometry.margin, y }, width: geometry.contentWidth, height },
          input: JSON.stringify(config),
        },
      ];
    }

    case "detailsRow": {
      const clientLines: string[] = [];
      // Bolded the same way the project column's leading line is — via
      // gearflowRichText's markdown-lite convention, not a separate
      // bold-only mechanism.
      if (block.client.showClientName && data.client_name) clientLines.push(`**${data.client_name}**`);
      if (block.client.showClientContact && data.client_contact) clientLines.push(`Attn: ${data.client_contact}`);
      if (block.client.showClientEmail && data.client_email) clientLines.push(data.client_email);
      if (block.client.showClientAddress && data.client_billing_address) clientLines.push(data.client_billing_address);
      // Same country-derived label as the org's own number above (I4,
      // #1083) — it names the org's home-jurisdiction registration-number
      // format, not a per-party thing.
      if (block.client.showClientTaxId && data.client_tax_id) {
        clientLines.push(`${data.org_business_number_label}: ${data.client_tax_id}`);
      }

      // The event/project name leads the column — bolded via the shared
      // markdown-lite renderer (gearflowRichText) rather than a separate
      // bold-only mechanism.
      const projectLines: string[] = [`**${data.project_name}**`];
      if (block.project.showVenue && data.venue_name) projectLines.push(`Venue: ${data.venue_name}`);
      if (block.project.showRentalDates && data.rental_start && data.rental_start !== "-") {
        const end = data.rental_end && data.rental_end !== "-" ? ` - ${data.rental_end}` : "";
        projectLines.push(`Rental: ${data.rental_start}${end}`);
      }
      if (block.project.showEventDates && data.event_start && data.event_start !== "-") {
        const end = data.event_end && data.event_end !== "-" ? ` - ${data.event_end}` : "";
        projectLines.push(`Event: ${data.event_start}${end}`);
      }
      if (block.project.showPaymentTerms && data.client_payment_terms) {
        projectLines.push(`Payment Terms: ${data.client_payment_terms}`);
      }
      if (block.project.showSiteContact && data.site_contact_name) {
        let contactLine = `Site Contact: ${data.site_contact_name}`;
        if (data.site_contact_phone) contactLine += ` | Ph: ${data.site_contact_phone}`;
        projectLines.push(contactLine);
      }
      if (block.project.showDocumentDate) projectLines.push(`Date: ${data.document_date}`);
      // WS1 (#940) — only renders once the invoice has actually been ISSUED
      // (build-document-data.ts resolves this to "" for a DRAFT-only project,
      // and the guard here matches every other conditional line above).
      if (block.project.showInvoiceNumber && data.invoice_number) {
        projectLines.push(`Invoice #: ${data.invoice_number}`);
      }

      const colWidth = geometry.contentWidth / 2 - 4;
      return [
        {
          schema: {
            name: `${name}_client`,
            type: "gearflowRichText",
            content: "",
            position: { x: geometry.margin, y },
            width: colWidth,
            height,
            fontSize: 9,
            fontColor: "#1a1a1a",
          },
          input: clientLines.length > 0 ? clientLines.join("\n") : "-",
        },
        {
          schema: {
            name: `${name}_project`,
            type: "gearflowRichText",
            content: "",
            position: { x: geometry.margin + geometry.contentWidth / 2 + 4, y },
            width: colWidth,
            height,
            fontSize: 9,
            fontColor: "#1a1a1a",
          },
          input: projectLines.join("\n"),
        },
      ];
    }

    case "table": {
      const tableValue: {
        items: DocumentLineItem[];
        config: TablePluginConfig;
        startIndex?: number;
        endIndex?: number;
        startSubIndex?: number;
      } = {
        items: data.line_items,
        config: {
          documentType: docType,
          documentColor: docColor,
          showGroupHeaders: block.config.showGroupHeaders,
          showKitChildren: block.config.showKitChildren,
          showCheckboxes: block.config.showCheckboxes,
          showConditionColumns: block.config.showConditionColumns,
          showPricing: block.config.showPricing,
          showBadges: block.config.showBadges,
          showNotes: block.config.showNotes,
          showPerUnitCheckboxes: block.config.showPerUnitCheckboxes,
          showAssetTags: block.config.showAssetTags,
          showCategories: block.config.showCategories,
          showRowNumbers: block.config.showRowNumbers,
          filterOptional: false,
          filterByStatus,
          hidePricingPeriodSuffix: block.config.hidePricingPeriodSuffix ?? false,
        },
      };
      if (entry.tableStartIndex) tableValue.startIndex = entry.tableStartIndex;
      if (entry.tableEndIndex !== undefined) tableValue.endIndex = entry.tableEndIndex;
      if (entry.tableSubIndex) tableValue.startSubIndex = entry.tableSubIndex;

      return [
        {
          schema: { name, type: "gearflowTable", content: "", position: { x: geometry.margin, y }, width: geometry.contentWidth, height },
          input: JSON.stringify(tableValue),
        },
      ];
    }

    case "totals": {
      const config: FinancialSummaryConfig = {
        subtotal: block.config.showSubtotal ? data.subtotal : 0,
        itemDiscountTotal: block.config.showSubtotal ? computeItemDiscountTotal(data) : 0,
        discountPercent: block.config.showDiscount ? data.discount_percent : 0,
        discountAmount: block.config.showDiscount ? data.discount_amount : 0,
        taxLabel: data.tax_label,
        taxAmount: block.config.showTax ? data.tax_amount : 0,
        total: block.config.showTotal ? data.total : 0,
        depositPaid: block.config.showDeposit ? data.deposit_paid : 0,
        balanceDue: block.config.showBalance ? data.balance_due : 0,
        documentColor: docColor,
        dueDate: block.config.showDueDate && data.invoice_due_date ? data.invoice_due_date : undefined,
      };
      return [
        {
          schema: { name, type: "gearflowFinancialSummary", content: "", position: { x: geometry.margin, y }, width: geometry.contentWidth, height },
          input: JSON.stringify(config),
        },
      ];
    }

    case "clientNotes":
      return [
        {
          schema: {
            name,
            type: "gearflowRichText",
            content: "",
            position: { x: geometry.margin, y },
            width: geometry.contentWidth,
            height,
            fontSize: RICH_TEXT_FONT_SIZE,
            fontColor: "#666666",
          },
          // Pre-wrapped slice (see splitRichTextBlock) when this page's
          // entry carries one — the exact line breakdown that drove the
          // page-break math, so estimate and render can't disagree. Falls
          // back to raw text (the plugin wraps it itself) when composeDocument
          // was called without fonts.
          input: entry.textLines ? JSON.stringify({ lines: entry.textLines }) : data.client_notes || "",
        },
      ];

    case "totalItemsNote":
      return [
        {
          schema: {
            name,
            type: "gearflowRichText",
            content: "",
            position: { x: geometry.margin, y },
            width: geometry.contentWidth,
            height,
            fontSize: 8,
            fontColor: "#333333",
          },
          input: `Total items: ${data.total_items}`,
        },
      ];

    // Org-authored free text (`/settings/branding`'s "Documents" card) —
    // markdown-lite friendly, same convention as line-item notes: `**bold**`,
    // `*italic*`, `- `/`* ` bullets (gearflowRichText / parseRichText).
    case "termsAndConditions":
      return [
        {
          schema: {
            name,
            type: "gearflowRichText",
            content: "",
            position: { x: geometry.margin, y },
            width: geometry.contentWidth,
            height,
            fontSize: RICH_TEXT_FONT_SIZE,
            fontColor: "#666666",
          },
          input: entry.textLines ? JSON.stringify({ lines: entry.textLines }) : data.terms_and_conditions,
        },
      ];

    // Same free-text convention as termsAndConditions — bank name, BSB,
    // account number, reference, etc. Invoice only (data.payment_details is
    // "" for every other doc type — see build-document-data.ts).
    case "paymentDetails":
      return [
        {
          schema: {
            name,
            type: "gearflowRichText",
            content: "",
            position: { x: geometry.margin, y },
            width: geometry.contentWidth,
            height,
            fontSize: RICH_TEXT_FONT_SIZE,
            fontColor: "#666666",
          },
          input: entry.textLines ? JSON.stringify({ lines: entry.textLines }) : data.payment_details,
        },
      ];

    case "signature": {
      const config: SignatureLineConfig = {
        columns: block.labels.map((label) => ({ label })),
        orgName: data.org_name || "",
      };
      return [
        {
          schema: { name, type: "gearflowSignatureLine", content: "", position: { x: geometry.margin, y }, width: geometry.contentWidth, height },
          input: JSON.stringify(config),
        },
      ];
    }
  }
}

export interface ComposeResult {
  template: Template;
  inputs: Record<string, string>[];
}

/**
 * Compose a fixed-layout document into a multi-page pdfme Template + inputs.
 * This is the sole entry point for the 5 project document types. Footer text
 * comes from `data.document_footer_text`/`document_footer_second_line` (org
 * "documents" settings — see org-settings-types.ts); empty falls back to an
 * auto-generated "{org} | {email} | {phone}" line.
 *
 * `fonts` (optional): real embedded Helvetica fonts (see
 * `getComposerFonts`/`generate-pdf.ts`). When supplied, clientNotes/
 * termsAndConditions get an accurate, real-wrap-aware height estimate and
 * split across pages by line instead of only ever moving as one whole block
 * (which could either overflow into the footer if underestimated, or strand
 * a short trailing block alone on a near-empty page). Stays optional, and
 * `composeDocument` stays synchronous, so no existing caller/test needs to
 * change — the accurate path is additive.
 *
 * `options.draftPreview` (#987) splices the "DRAFT PREVIEW — NOT SENT" banner in
 * as page furniture. Only the preview route sets it; the stored artifact is
 * always rendered without it.
 *
 * `paperSize` (I5, #1084, default `"A4"`): resolved once into a `PageGeometry`
 * and threaded through every pagination/layout calculation below — never a
 * hardcoded module constant, so an existing caller that hasn't threaded a
 * paper size through yet keeps rendering A4 exactly as it always has.
 */
export function composeDocument(
  docType: ProjectDocumentType,
  data: DocumentData,
  docColor: string,
  fonts?: RichTextFonts,
  options?: DocumentLayoutOptions,
  paperSize?: PaperSize,
): ComposeResult {
  const geometry = getPageGeometry(paperSize);
  const layout = getDocumentLayout(docType, options);
  const pages = computePages(layout, data, docType, geometry, fonts);

  const allSchemas: (Schema & Record<string, unknown>)[][] = [];
  const mergedInputs: Record<string, string> = {};
  const footerConfig: FooterConfig = {
    text: data.document_footer_text || `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: data.document_footer_second_line || "",
  };

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageSchemas: (Schema & Record<string, unknown>)[] = [];

    pages[pageIdx].entries.forEach((entry, blockIdx) => {
      const name = `${entry.block.kind}_${blockIdx}_p${pageIdx}`;
      const fields = buildEntryFields(entry, data, docType, docColor, layout.filterByStatus, name, geometry, fonts);
      for (const field of fields) {
        pageSchemas.push(field.schema);
        mergedInputs[field.schema.name as string] = field.input;
      }
    });

    const footerName = `footer_p${pageIdx}`;
    pageSchemas.push({
      name: footerName,
      type: "gearflowPageFooter",
      content: "",
      position: { x: geometry.margin, y: geometry.height - geometry.margin - geometry.footerHeight },
      width: geometry.contentWidth,
      height: geometry.footerHeight,
    });
    mergedInputs[footerName] = JSON.stringify({
      ...footerConfig,
      pageNumber: pages.length > 1 ? `Page ${pageIdx + 1} of ${pages.length}` : undefined,
    } satisfies FooterConfig);

    allSchemas.push(pageSchemas);
  }

  return {
    template: {
      basePdf: {
        width: geometry.width,
        height: geometry.height,
        padding: [geometry.margin, geometry.margin, geometry.margin, geometry.margin],
      },
      schemas: allSchemas,
    },
    // pdfme's generate() iterates inputs × schema-pages; a single merged
    // dict (unique schema names per page) avoids an N×N page explosion.
    inputs: [mergedInputs],
  };
}
