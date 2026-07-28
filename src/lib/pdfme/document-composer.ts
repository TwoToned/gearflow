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
import type {
  DocumentData,
  DocumentLineItem,
  DocumentType,
  TablePluginConfig,
  FinancialSummaryConfig,
  PageHeaderConfig,
  FooterConfig,
  SignatureLineConfig,
} from "./types";
import {
  getDocumentLayout,
  type DocumentLayout,
  type LayoutBlock,
  type TableLayoutConfig,
  type ProjectDocumentType,
} from "./document-layouts";
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  FOOTER_HEIGHT,
  SECTION_GAP,
} from "./template-constants";
import { parsePriceBreakdown, formatPriceBreakdown } from "@/lib/billing-derivation";

// ─── Height constants (pt) — must match gearflow-table.ts's actual draw sizes ─
const PT_PER_MM = 2.835;
const PARENT_ROW_PT = 9 + 4 * 2; // fontSize(9) + rowPadding(4)*2
const CHILD_ROW_PT = 8 + 4 * 2;
const GRANDCHILD_ROW_PT = 7 + 4 * 2;
const PER_UNIT_ROW_PT = 10;
const GROUP_HEADER_PT = 9 + 4 * 2;
const TABLE_HEADER_PT = 7 + 4 * 2 + 4;
const TABLE_PADDING_BOTTOM_MM = 1; // safety margin at the bottom of a table block

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
export function calculateItemHeight(item: DocumentLineItem, config: TableLayoutConfig): number {
  let heightPt = PARENT_ROW_PT;

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
    for (const item of groups.get(groupKey)!) heights.push(calculateItemHeight(item, config));
  }

  return heights;
}

// ─── Block height estimation ──────────────────────────────────────────────────

interface LayoutContext {
  docType: ProjectDocumentType;
  filterByStatus: string[] | null;
}

function estimateBlockHeight(block: LayoutBlock, data: DocumentData, ctx: LayoutContext): number {
  switch (block.kind) {
    case "header": {
      const mode = data.org_branding?.documentLogoMode ?? "icon";
      return mode === "logo" ? 25 + 22 : 25;
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
      return hasItemDiscounts ? 44 : 34;
    }

    case "clientNotes":
      return data.client_notes ? 12 : 4;

    case "totalItemsNote":
    case "quoteValidityNote":
      return 8;

    case "termsAndConditions": {
      // Optional — collapses to zero height (and is skipped entirely by the
      // page-layout walk) when the org hasn't set any T&Cs text.
      if (!data.quote_terms_and_conditions) return 0;
      const lines = data.quote_terms_and_conditions.split("\n").length;
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
}

interface Page {
  entries: PageEntry[];
}

/**
 * Compute the multi-page layout for one document: walk the layout's blocks
 * top-to-bottom, starting a new page when a block doesn't fit. Table blocks
 * split across pages (per-item cumulative heights) instead of moving whole —
 * this is the tail-drop fix. All mutable page/cursor state lives in this
 * function's closure so the table-split branch can push finished pages and
 * open new ones without a separate state object to keep in sync.
 */
function computePages(layout: DocumentLayout, data: DocumentData, docType: ProjectDocumentType): Page[] {
  const ctx: LayoutContext = { docType, filterByStatus: layout.filterByStatus };
  const headerBlock = layout.blocks.find((b) => b.kind === "header") as Extract<LayoutBlock, { kind: "header" }> | undefined;
  const bodyBlocks = layout.blocks.filter((b) => b.kind !== "header");

  const maxY = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;
  const headerHeight = headerBlock ? estimateBlockHeight(headerBlock, data, ctx) : 0;
  const continuationContentHeight = maxY - MARGIN - (headerBlock ? headerHeight + SECTION_GAP : 0);
  const tableHeaderMm = ptToMm(TABLE_HEADER_PT);
  const groupHeaderMm = ptToMm(GROUP_HEADER_PT);

  const pages: Page[] = [];
  let currentPage: Page = { entries: [] };
  let currentY = MARGIN;

  function placeHeader() {
    if (!headerBlock) return;
    currentPage.entries.push({ block: headerBlock, y: currentY, height: headerHeight });
    currentY += headerHeight + SECTION_GAP;
  }

  function startNewPage() {
    pages.push(currentPage);
    currentPage = { entries: [] };
    currentY = MARGIN;
    placeHeader();
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
    const entryGroupKey: string[] = [];
    let parentIdx = 0;
    for (const groupKey of groupOrder) {
      if (groupKey !== ungrouped && config.showGroupHeaders) {
        heightToParentIdx.push(-1);
        entryGroupKey.push(groupKey);
      }
      for (let gi = 0; gi < groups.get(groupKey)!.length; gi++) {
        heightToParentIdx.push(parentIdx);
        entryGroupKey.push(groupKey);
        parentIdx++;
      }
    }
    const groupHeaderIdx = new Map<string, number>();
    heightToParentIdx.forEach((pi, i) => {
      if (pi === -1) groupHeaderIdx.set(entryGroupKey[i], i);
    });

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

      let pageContent = continuationContentHeight - tableHeaderMm - TABLE_PADDING_BOTTOM_MM;
      if (config.showGroupHeaders && remainingIdx < entryGroupKey.length) {
        const firstGroupOnPage = entryGroupKey[remainingIdx];
        const headerPos = groupHeaderIdx.get(firstGroupOnPage);
        if (headerPos !== undefined && headerPos < remainingIdx) pageContent -= groupHeaderMm;
      }

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
        let actualMm = tableHeaderMm + TABLE_PADDING_BOTTOM_MM;
        if (config.showGroupHeaders && remainingIdx < entryGroupKey.length) {
          const grp = entryGroupKey[remainingIdx];
          const hPos = groupHeaderIdx.get(grp);
          if (hPos !== undefined && hPos < remainingIdx) actualMm += groupHeaderMm;
        }
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

  placeHeader();

  for (const block of bodyBlocks) {
    const height = estimateBlockHeight(block, data, ctx);
    // Optional content blocks (e.g. termsAndConditions with no text set)
    // collapse to zero height and are omitted entirely — no schema, no gap.
    if (height <= 0) continue;

    if (currentY + height > maxY && currentPage.entries.length > 0) {
      if (block.kind === "table") {
        splitTable(block);
        continue;
      }
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
): RenderedField[] {
  const { block, y, height } = entry;

  switch (block.kind) {
    case "header": {
      const orgDetailParts: string[] = [];
      if (data.org_address) orgDetailParts.push(data.org_address);
      if (data.org_phone) orgDetailParts.push(data.org_phone);
      if (data.org_email) orgDetailParts.push(data.org_email);
      if (data.org_website) orgDetailParts.push(data.org_website);

      const config: PageHeaderConfig = {
        orgName: data.org_name || "",
        orgDetails: orgDetailParts.join("\n"),
        docTitle: block.title,
        docMeta: `${data.project_number || ""}\n${data.document_date || ""}`,
        logoData: data.org_logo,
        iconData: data.org_icon,
        documentLogoMode: data.org_branding?.documentLogoMode ?? "icon",
        showOrgNameOnDocuments: data.org_branding?.showOrgNameOnDocuments ?? true,
        documentColor: docColor,
      };
      return [
        {
          schema: { name, type: "gearflowPageHeader", content: "", position: { x: MARGIN, y }, width: CONTENT_WIDTH, height },
          input: JSON.stringify(config),
        },
      ];
    }

    case "detailsRow": {
      const clientLines: string[] = [];
      if (block.client.showClientName && data.client_name) clientLines.push(data.client_name);
      if (block.client.showClientContact && data.client_contact) clientLines.push(`Attn: ${data.client_contact}`);
      if (block.client.showClientEmail && data.client_email) clientLines.push(data.client_email);
      if (block.client.showClientAddress && data.client_billing_address) clientLines.push(data.client_billing_address);
      if (block.client.showClientTaxId && data.client_tax_id) clientLines.push(`ABN: ${data.client_tax_id}`);

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

      const colWidth = CONTENT_WIDTH / 2 - 4;
      return [
        {
          schema: {
            name: `${name}_client`,
            type: "gearflowRichText",
            content: "",
            position: { x: MARGIN, y },
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
            position: { x: MARGIN + CONTENT_WIDTH / 2 + 4, y },
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
          schema: { name, type: "gearflowTable", content: "", position: { x: MARGIN, y }, width: CONTENT_WIDTH, height },
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
      };
      return [
        {
          schema: { name, type: "gearflowFinancialSummary", content: "", position: { x: MARGIN, y }, width: CONTENT_WIDTH, height },
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
            position: { x: MARGIN, y },
            width: CONTENT_WIDTH,
            height,
            fontSize: 8,
            fontColor: "#666666",
          },
          input: data.client_notes || "",
        },
      ];

    case "totalItemsNote":
      return [
        {
          schema: {
            name,
            type: "gearflowRichText",
            content: "",
            position: { x: MARGIN, y },
            width: CONTENT_WIDTH,
            height,
            fontSize: 8,
            fontColor: "#333333",
          },
          input: `Total items: ${data.total_items}`,
        },
      ];

    case "quoteValidityNote":
      return [
        {
          schema: {
            name,
            type: "gearflowRichText",
            content: "",
            position: { x: MARGIN, y },
            width: CONTENT_WIDTH,
            height,
            fontSize: 9,
            fontColor: "#333333",
          },
          input: `This quote is valid until ${data.quote_valid_until}.`,
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
            position: { x: MARGIN, y },
            width: CONTENT_WIDTH,
            height,
            fontSize: 8,
            fontColor: "#666666",
          },
          input: data.quote_terms_and_conditions,
        },
      ];

    case "signature": {
      const config: SignatureLineConfig = {
        columns: block.labels.map((label) => ({ label })),
        orgName: data.org_name || "",
      };
      return [
        {
          schema: { name, type: "gearflowSignatureLine", content: "", position: { x: MARGIN, y }, width: CONTENT_WIDTH, height },
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
 */
export function composeDocument(docType: ProjectDocumentType, data: DocumentData, docColor: string): ComposeResult {
  const layout = getDocumentLayout(docType);
  const pages = computePages(layout, data, docType);

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
      const fields = buildEntryFields(entry, data, docType, docColor, layout.filterByStatus, name);
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
      position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT },
      width: CONTENT_WIDTH,
      height: FOOTER_HEIGHT,
    });
    mergedInputs[footerName] = JSON.stringify({
      ...footerConfig,
      pageNumber: pages.length > 1 ? `Page ${pageIdx + 1} of ${pages.length}` : undefined,
    } satisfies FooterConfig);

    allSchemas.push(pageSchemas);
  }

  return {
    template: {
      basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
      schemas: allSchemas,
    },
    // pdfme's generate() iterates inputs × schema-pages; a single merged
    // dict (unique schema names per page) avoids an N×N page explosion.
    inputs: [mergedInputs],
  };
}
