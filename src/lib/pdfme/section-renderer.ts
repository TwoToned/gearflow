/**
 * Section renderer — converts a TemplateSection[] list into a multi-page
 * pdfme Template + inputs. This is the core engine of the section-based
 * template builder.
 *
 * Pipeline:
 * 1. Filter visible sections (conditions + doc type)
 * 2. Group sections into rows (using layoutHint.rowId)
 * 3. Compute row heights (max of column heights) and page breaks
 * 4. Generate per-page pdfme schemas with correct X/Y positions
 * 5. Generate per-page inputs with resolved tokens + plugin configs
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
import type {
  TemplateSection,
  HeaderSectionSettings,
  ClientDetailsSectionSettings,
  ProjectDetailsSectionSettings,
  TableSectionSettings,
  TotalsSectionSettings,
  NotesSectionSettings,
  SignatureSectionSettings,
  CustomTextSectionSettings,
  CrewTableSectionSettings,
  CallSheetInfoSectionSettings,
  DayHeaderSectionSettings,
  SpacerSectionSettings,
} from "./section-types";
import {
  SECTION_HEIGHT_ESTIMATES,
  TABLE_ROW_HEIGHT_MM,
  CREW_ROW_HEIGHT_MM,
} from "./section-types";
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  FOOTER_HEIGHT,
  SECTION_GAP,
} from "./template-constants";
import type { BlockStyling } from "./section-types";
import type { RectConfig } from "./plugins/gearflow-rect";
import { filterVisibleSections } from "./condition-evaluator";
import { resolveTokensInText } from "./token-resolver";

// ─── Height Constants (match gearflow-table.ts plugin values) ────────────────

// All values in pt. 1mm ≈ 2.835pt
const PT_PER_MM = 2.835;
const PARENT_ROW_PT = 9 + 4 * 2;         // fontSize(9) + rowPadding(4)*2 = 17pt
const CHILD_ROW_PT = 8 + 4 * 2;          // childFontSize(8) + rowPadding(4)*2 = 16pt
const GRANDCHILD_ROW_PT = 7 + 4 * 2;     // grandchildFontSize(7) + rowPadding(4)*2 = 15pt
const PER_UNIT_ROW_PT = 10;              // puHeight = 10pt
const GROUP_HEADER_PT = 9 + 4 * 2;       // fontSize(9) + rowPadding(4)*2 = 17pt
const TABLE_HEADER_PT = 7 + 4 * 2 + 4;   // headerFontSize(7) + rowPadding(4)*2 + 4 = 19pt
// The plugin has no explicit padding — it draws from layout.y+layout.height down
// to layout.y. We add a small safety margin to avoid clipping at the boundary.
const TABLE_PADDING_TOP_MM = 0;
const TABLE_PADDING_BOTTOM_MM = 1;        // ~1mm safety margin at bottom

function ptToMm(pt: number): number { return pt / PT_PER_MM; }

/** Build group key — uses groupName (set to category name for structured projects) or prepContainer */
function getItemGroupKey(item: DocumentLineItem, ungrouped: string): string {
  return item.groupName || item.prepContainer || ungrouped;
}

/**
 * Build groups for delivery docket — must mirror gearflow-table.ts:237-275.
 *
 * Kit parents promote their CHECKED_OUT children to be section rows under
 * the kit's name. Non-kit items respect `groupName` so Project Groups and
 * Sub-Hire Groups get their own section headers. Items with no groupName
 * fall back to "General" at the bottom.
 *
 * Phase 3b will move kit promotion into the data layer and let the
 * generic `buildGroupedItems` path handle delivery docket like every
 * other doc type.
 */
function buildDeliveryDocketGroups(
  data: DocumentData,
  docType: DocumentType,
): { groupOrder: string[]; groups: Map<string, DocumentLineItem[]> } {
  const parentItems = getFilteredParentItems(data, docType);
  const groups = new Map<string, DocumentLineItem[]>();
  const groupOrder: string[] = [];

  for (const item of parentItems) {
    const isKitParent = !!item.kitId && !item.isKitChild;
    if (isKitParent) {
      const kitName = item.kit?.name || item.description || "Kit";
      const children = (item.childLineItems || []).filter(c => c.status === "CHECKED_OUT");
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

/**
 * Check if a parent item has splittable sub-items (per-unit checkboxes).
 * Returns the total sub-item count, or 0 if not splittable.
 */
function getSubItemCount(item: DocumentLineItem, settings: TableSectionSettings): number {
  const isKit = !!item.kitId;
  if (settings.showPerUnitCheckboxes && !isKit && item.quantity > 1) {
    return item.quantity;
  }
  return 0;
}

/**
 * Calculate how many sub-items fit in the available space when a parent item
 * partially fits on a page. Returns { fits, subItemsRendered }.
 */
function calculatePartialFit(
  item: DocumentLineItem,
  settings: TableSectionSettings,
  availableHeightMm: number,
  existingSubOffset: number = 0,
): { fits: boolean; subItemsRendered: number } {
  const parentRowMm = ptToMm(PARENT_ROW_PT);
  if (availableHeightMm < parentRowMm) {
    return { fits: false, subItemsRendered: 0 };
  }
  const totalSubItems = getSubItemCount(item, settings);
  if (totalSubItems <= existingSubOffset) {
    return { fits: false, subItemsRendered: 0 };
  }
  const perUnitMm = ptToMm(PER_UNIT_ROW_PT);
  const subItemsSpace = availableHeightMm - parentRowMm;
  const subItemsFit = Math.floor(subItemsSpace / perUnitMm);
  if (subItemsFit <= 0) {
    return { fits: false, subItemsRendered: 0 };
  }
  const remaining = totalSubItems - existingSubOffset;
  return { fits: true, subItemsRendered: Math.min(subItemsFit, remaining) };
}

/**
 * Calculate the height of an item on a continuation page where subItemOffset
 * sub-items have already been rendered. The parent row is re-drawn for context.
 */
function calculateRemainingItemHeight(
  item: DocumentLineItem,
  settings: TableSectionSettings,
  subItemOffset: number,
): number {
  // Parent row is NOT re-drawn on continuation pages (plugin skips it)
  let heightPt = 0;
  const isKit = !!item.kitId;
  if (settings.showPerUnitCheckboxes && !isKit && item.quantity > 1) {
    const remaining = Math.max(0, item.quantity - subItemOffset);
    heightPt += remaining * PER_UNIT_ROW_PT;
  }
  return ptToMm(heightPt);
}

// ─── Shared Helpers (must mirror gearflow-table.ts plugin logic exactly) ─────

/**
 * Returns the ungrouped key matching the plugin's per-docType convention.
 * Must stay in sync with gearflow-table.ts lines 197-199.
 */
export function getUngroupedKey(docType: DocumentType): string {
  switch (docType) {
    case "packing-list": return "Ungrouped";
    case "delivery-docket": return "General";
    default: return "_ungrouped";
  }
}

/** Check if item is a bulk asset (mirrors gearflow-table.ts isBulk) */
function isBulk(item: DocumentLineItem): boolean {
  return !!item.bulkAssetId || (!item.assetId && item.quantity > 1);
}

/**
 * Filter parent items using the same chain as the plugin:
 * 1. !isKitChild
 * 2. filterOptional (if set in settings — currently always false for section-based)
 * 3. filterByStatus based on docType
 * Must stay in sync with gearflow-table.ts lines 182-194.
 */
export function getFilteredParentItems(
  data: DocumentData,
  docType: DocumentType,
): DocumentLineItem[] {
  let items = data.line_items.filter((i) => !i.isKitChild && !i.isContainerLineItem);

  // filterOptional is currently always false for section-based templates,
  // but include it for correctness if it changes in the future
  // (section-based templates don't set filterOptional=true)

  const filterByStatus = getFilterByStatus(docType);
  if (filterByStatus) {
    const statuses = filterByStatus;
    items = items.filter((i) => {
      if (isBulk(i)) return i.checkedOutQuantity > 0;
      return statuses.includes(i.status);
    });
  }

  return items;
}

/**
 * Calculate the rendered height (in mm) for a single parent line item,
 * including all its sub-rows (per-unit checkboxes, kit children, grandchildren).
 */
function calculateItemHeight(
  item: DocumentLineItem,
  settings: TableSectionSettings,
): number {
  let heightPt = PARENT_ROW_PT;

  // Notes add extra height (multi-line with markdown support)
  if (item.notes && settings.showNotes) {
    const noteLineCount = item.notes.split("\n").length;
    const noteLinePt = 7 + 2; // noteFontSize(7) + 2
    heightPt += noteLineCount * noteLinePt;
  }

  const isKit = !!item.kitId;

  // Per-unit checkbox rows for bulk items (qty > 1, non-kit)
  if (settings.showPerUnitCheckboxes && !isKit && item.quantity > 1) {
    heightPt += item.quantity * PER_UNIT_ROW_PT;
  }

  // Kit children
  if (isKit && settings.showKitChildren) {
    const children = item.childLineItems || [];
    for (const child of children) {
      heightPt += CHILD_ROW_PT;
      const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;

      // Per-unit checkboxes for child items
      if (settings.showPerUnitCheckboxes && !isNestedKit && child.quantity > 1) {
        heightPt += child.quantity * PER_UNIT_ROW_PT;
      }

      // Grandchildren (nested kit members)
      if (isNestedKit) {
        heightPt += (child.childLineItems || []).length * GRANDCHILD_ROW_PT;
      }
    }
  }

  return ptToMm(heightPt);
}

/**
 * Calculate per-parent-item heights for accurate page break calculation.
 * Returns an array of { heightMm, isGroupHeader } entries in render order.
 */
function calculateTableItemHeights(
  data: DocumentData,
  settings: TableSectionSettings,
  docType: DocumentType,
): number[] {
  const ungrouped = getUngroupedKey(docType);
  const heights: number[] = [];

  // Delivery docket uses kit-based groups (must mirror gearflow-table.ts plugin logic)
  if (docType === "delivery-docket") {
    const { groupOrder, groups } = buildDeliveryDocketGroups(data, docType);
    for (const groupKey of groupOrder) {
      if (groupKey !== ungrouped && settings.showGroupHeaders) {
        heights.push(ptToMm(GROUP_HEADER_PT));
      }
      for (const item of groups.get(groupKey)!) {
        heights.push(calculateItemHeight(item, settings));
      }
    }
    return heights;
  }

  const parentItems = getFilteredParentItems(data, docType);

  // Group items by groupName (matching the plugin's rendering order)
  const groups = new Map<string, DocumentLineItem[]>();
  const groupOrder: string[] = [];
  for (const item of parentItems) {
    const key = getItemGroupKey(item, ungrouped);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(item);
  }

  for (const groupKey of groupOrder) {
    // Group header height (if applicable)
    if (groupKey !== ungrouped && settings.showGroupHeaders) {
      heights.push(ptToMm(GROUP_HEADER_PT));
    }

    const groupItems = groups.get(groupKey)!;
    for (const item of groupItems) {
      heights.push(calculateItemHeight(item, settings));
    }
  }

  return heights;
}

// ─── Height Estimation ───────────────────────────────────────────────────────

/**
 * Estimate the rendered height of a section given the document data.
 */
export function estimateSectionHeight(
  section: TemplateSection,
  data: DocumentData,
  docType: DocumentType = "quote",
): number {
  switch (section.type) {
    case "header": {
      const s = section.settings as HeaderSectionSettings;
      const base = 25;
      if (s.logoMode === "logo") return base + 22;
      return base;
    }

    case "client-details": {
      const s = section.settings as ClientDetailsSectionSettings;
      let lines = 0;
      if (s.showClientName && data.client_name) lines++;
      if (s.showClientContact && data.client_contact) lines++;
      if (s.showClientEmail && data.client_email) lines++;
      if (s.showClientAddress && data.client_billing_address) lines++;
      if (s.showClientTaxId && data.client_tax_id) lines++;
      // Custom fields add lines
      if (s.customFields) lines += s.customFields.length;
      return Math.max(lines * 4, 12);
    }

    case "project-details": {
      const s = section.settings as ProjectDetailsSectionSettings;
      let lines = 0;
      if (s.showProjectName) lines++;
      if (s.showVenue && data.venue_name) lines++;
      if (s.showRentalDates) lines++;
      if (s.showEventDates) lines++;
      if (s.showPaymentTerms && data.client_payment_terms) lines++;
      if (s.showSiteContact && data.site_contact_name) lines++;
      if (s.showDocumentDate) lines++;
      if (s.customFields) lines += s.customFields.length;
      return Math.max(lines * 4, 12);
    }

    case "table": {
      const ts = section.settings as TableSectionSettings;
      const itemHeights = calculateTableItemHeights(data, ts, docType);
      const contentHeight = itemHeights.reduce((sum, h) => sum + h, 0);
      return TABLE_PADDING_TOP_MM + ptToMm(TABLE_HEADER_PT) + contentHeight + TABLE_PADDING_BOTTOM_MM;
    }

    case "totals":
      return SECTION_HEIGHT_ESTIMATES.totals;

    case "notes": {
      const s = section.settings as NotesSectionSettings;
      let height = 0;
      if (s.showClientNotes && data.client_notes) height += 12;
      if (s.showCrewNotes && data.crew_notes) height += 12;
      return Math.max(height, 4);
    }

    case "signature":
      return SECTION_HEIGHT_ESTIMATES.signature;

    case "custom-text": {
      const content = section.content || "";
      const lines = content.split("\n").length;
      return Math.max(lines * 4 + 4, 8);
    }

    case "crew-table": {
      // Check for per-day crew data override
      let crewCount = (data.crew || []).length;
      if (section.content) {
        try {
          const override = JSON.parse(section.content);
          if (override.dayCrew) {
            crewCount = override.dayCrew.length;
          }
        } catch {
          // ignore
        }
      }
      return 8 + crewCount * CREW_ROW_HEIGHT_MM + 4;
    }

    case "call-sheet-info":
      return SECTION_HEIGHT_ESTIMATES["call-sheet-info"];

    case "day-header":
      return SECTION_HEIGHT_ESTIMATES["day-header"];

    case "spacer": {
      const s = section.settings as SpacerSectionSettings;
      return s.height || 10;
    }

    case "page-break":
      return 0;

    default:
      return SECTION_HEIGHT_ESTIMATES[section.type] || 10;
  }
}

// ─── Row Grouping ────────────────────────────────────────────────────────────

interface RowGroup {
  rowId: string;
  sections: TemplateSection[];
  /** Estimated height of this row (max of column heights) */
  height: number;
  /** Is this a page-break marker? */
  isPageBreak: boolean;
}

/**
 * Group flat sections into rows using layoutHint.rowId.
 * Sections without a layoutHint each become their own single-column row.
 */
function groupIntoRows(sections: TemplateSection[], data: DocumentData, docType: DocumentType = "quote"): RowGroup[] {
  const rows: RowGroup[] = [];
  const rowMap = new Map<string, TemplateSection[]>();
  const rowOrder: string[] = [];

  for (const section of sections) {
    if (section.type === "page-break") {
      // Page breaks are always their own row
      rows.push({
        rowId: `pagebreak_${section.id}`,
        sections: [section],
        height: 0,
        isPageBreak: true,
      });
      continue;
    }

    const rowId = section.layoutHint?.rowId || `solo_${section.id}`;
    if (!rowMap.has(rowId)) {
      rowMap.set(rowId, []);
      rowOrder.push(rowId);
    }
    rowMap.get(rowId)!.push(section);
  }

  // Process non-page-break rows in order
  for (const rowId of rowOrder) {
    const rowSections = rowMap.get(rowId)!;

    // Group sections by columnIndex to compute per-column heights
    const columnHeights = new Map<number, number>();
    for (const section of rowSections) {
      const colIdx = section.layoutHint?.columnIndex ?? 0;
      const sectionHeight = estimateSectionHeight(section, data, docType);
      const current = columnHeights.get(colIdx) || 0;
      columnHeights.set(colIdx, current + sectionHeight);
    }

    // Row height = max column height
    const maxHeight = Math.max(...columnHeights.values(), 0);

    // Insert at correct position (page breaks may have been added inline)
    // Find the insertion index based on the first section's order
    const firstOrder = rowSections[0].order;
    let insertIdx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].isPageBreak && rows[i].sections[0].order > firstOrder) {
        insertIdx = i;
        break;
      }
    }

    rows.splice(insertIdx, 0, {
      rowId,
      sections: rowSections,
      height: maxHeight,
      isPageBreak: false,
    });
  }

  // Re-sort by the minimum order of sections in each row
  rows.sort((a, b) => {
    const aOrder = Math.min(...a.sections.map((s) => s.order));
    const bOrder = Math.min(...b.sections.map((s) => s.order));
    return aOrder - bOrder;
  });

  return rows;
}

// ─── Page Layout ─────────────────────────────────────────────────────────────

interface PageEntry {
  section: TemplateSection;
  x: number; // mm from left edge
  y: number;
  width: number; // mm
  height: number;
  /** For table sections on continuation pages: skip items before this index */
  tableStartIndex?: number;
  /** For table sections: stop rendering after this parent item index (1-based, inclusive) */
  tableEndIndex?: number;
  /** For table sections: number of sub-items to skip on the first rendered parent item */
  tableSubIndex?: number;
}

interface PageLayout {
  entries: PageEntry[];
  isContinuation: boolean;
}

/**
 * Compute multi-page layout from visible sections.
 * Groups sections into rows (atomic units for page breaks),
 * handles table splitting, and reserves footer space.
 */
export function computePageLayout(
  sections: TemplateSection[],
  data: DocumentData,
  docType: DocumentType = "quote",
): PageLayout[] {
  const rows = groupIntoRows(sections, data, docType);
  const pages: PageLayout[] = [];
  let currentPage: PageLayout = { entries: [], isContinuation: false };
  let currentY = MARGIN;
  const maxY = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;

  const headerSection = sections.find((s) => s.type === "header");

  function startNewPage() {
    pages.push(currentPage);
    currentPage = { entries: [], isContinuation: true };
    currentY = MARGIN;

    if (headerSection) {
      const hHeight = estimateSectionHeight(headerSection, data, docType);
      currentPage.entries.push({
        section: headerSection,
        x: MARGIN,
        y: currentY,
        width: CONTENT_WIDTH,
        height: hHeight,
      });
      currentY += hHeight + SECTION_GAP;
    }
  }

  for (const row of rows) {
    if (row.isPageBreak) {
      startNewPage();
      continue;
    }

    const rowHeight = row.height;

    // Check if this row fits on the current page
    if (currentY + rowHeight > maxY && currentPage.entries.length > 0) {
      // Check if this is a table row that needs splitting
      const tableSections = row.sections.filter((s) => s.type === "table" || s.type === "crew-table");
      if (tableSections.length > 0 && row.sections.length === 1) {
        // Single table in this row — split across pages
        const section = row.sections[0];
        const availableHeight = maxY - currentY;
        const sectionX = getSectionX(section);
        const sectionW = getSectionWidth(section);

        const isCrewTable = section.type === "crew-table";
        const tableHeaderMm = ptToMm(TABLE_HEADER_PT);
        const continuationContentHeight = maxY - MARGIN - (headerSection ? estimateSectionHeight(headerSection, data, docType) + SECTION_GAP : 0);

        if (isCrewTable) {
          // Crew table: uniform row heights, simple calculation
          const crewCount = (data.crew || []).length;
          const rowsOnFirstPage = Math.max(1, Math.floor((availableHeight - TABLE_PADDING_TOP_MM - tableHeaderMm) / CREW_ROW_HEIGHT_MM));

          currentPage.entries.push({
            section, x: sectionX, y: currentY, width: sectionW,
            height: availableHeight, tableStartIndex: 0,
          });

          let currentStartIndex = rowsOnFirstPage;
          while (currentStartIndex < crewCount) {
            startNewPage();
            const rowsThisPage = Math.max(1, Math.floor((continuationContentHeight - TABLE_PADDING_TOP_MM - tableHeaderMm) / CREW_ROW_HEIGHT_MM));
            currentPage.entries.push({
              section, x: sectionX, y: currentY, width: sectionW,
              height: continuationContentHeight, tableStartIndex: currentStartIndex,
            });
            currentY += continuationContentHeight;
            currentStartIndex += rowsThisPage;
          }
        } else {
          // Equipment table: variable-height items — use per-item cumulative heights
          const ts = section.settings as TableSectionSettings;
          const itemHeights = calculateTableItemHeights(data, ts, docType);

          // Build mappings first — needed for partial fit calculations
          const ungrouped = getUngroupedKey(docType);
          const groups = new Map<string, DocumentLineItem[]>();
          const groupOrder: string[] = [];
          // parentItems: flat array of items (used by getItemAt for partial-fit calculations)
          let parentItems: DocumentLineItem[] = [];

          if (docType === "delivery-docket") {
            const docketGroups = buildDeliveryDocketGroups(data, docType);
            for (const key of docketGroups.groupOrder) {
              const items = docketGroups.groups.get(key)!;
              groups.set(key, items);
              groupOrder.push(key);
              parentItems.push(...items);
            }
          } else {
            parentItems = getFilteredParentItems(data, docType);
            for (const item of parentItems) {
              const key = getItemGroupKey(item, ungrouped);
              if (!groups.has(key)) { groups.set(key, []); groupOrder.push(key); }
              groups.get(key)!.push(item);
            }
          }

          // Build mappings: itemHeights index → parentItemIndex (for startIndex)
          // and itemHeights index → groupKey (for detecting group header re-draws)
          // Group headers don't count as parent items for startIndex purposes
          const heightToParentIdx: number[] = [];
          const entryGroupKey: string[] = [];
          let parentIdx = 0;
          for (const groupKey of groupOrder) {
            if (groupKey !== ungrouped && ts.showGroupHeaders) {
              heightToParentIdx.push(-1); // group header, not a parent item
              entryGroupKey.push(groupKey);
            }
            const groupItems = groups.get(groupKey)!;
            for (let gi = 0; gi < groupItems.length; gi++) {
              heightToParentIdx.push(parentIdx);
              entryGroupKey.push(groupKey);
              parentIdx++;
            }
          }

          // Track which group header indices exist for quick lookup
          const groupHeaderIdx = new Map<string, number>();
          for (let i = 0; i < heightToParentIdx.length; i++) {
            if (heightToParentIdx[i] === -1) {
              groupHeaderIdx.set(entryGroupKey[i], i);
            }
          }

          const groupHeaderMm = ptToMm(GROUP_HEADER_PT);

          // Helper: resolve parent item for a height entry
          const getItemAt = (idx: number): DocumentLineItem | null => {
            if (idx >= heightToParentIdx.length) return null;
            const pi = heightToParentIdx[idx];
            return pi >= 0 ? parentItems[pi] : null;
          };

          // Helper: calculate items that fit in a given content budget.
          // Returns { count, subIndex } where subIndex > 0 means the last
          // item was partially fit (subIndex sub-items rendered).
          const fitItems = (
            startIdx: number,
            budget: number,
            pendingSub: number,
          ): { count: number; subIndex: number } => {
            let cumulative = 0;
            let count = 0;
            let subIndex = 0;

            for (let i = startIdx; i < itemHeights.length; i++) {
              let h = itemHeights[i];

              // First item may have reduced height from prior partial render
              if (i === startIdx && pendingSub > 0) {
                const item = getItemAt(i);
                if (item) {
                  h = calculateRemainingItemHeight(item, ts, pendingSub);
                }
              }

              if (cumulative + h <= budget) {
                cumulative += h;
                count++;
                continue;
              }

              // Item doesn't fully fit
              if (count === 0) {
                // Must include at least one item even if oversized
                cumulative += h;
                count++;
                break;
              }

              // Try partial fit for items with splittable sub-items
              const item = getItemAt(i);
              if (item) {
                const remaining = budget - cumulative;
                const existingSub = (i === startIdx) ? pendingSub : 0;
                const partial = calculatePartialFit(item, ts, remaining, existingSub);
                if (partial.fits) {
                  count++;
                  subIndex = existingSub + partial.subItemsRendered;
                }
              }
              break;
            }

            return { count, subIndex };
          };

          // Calculate which items fit on the first page
          const firstPageContent = availableHeight - TABLE_PADDING_TOP_MM - tableHeaderMm - TABLE_PADDING_BOTTOM_MM;
          const firstFit = fitItems(0, firstPageContent, 0);
          const firstPageItems = firstFit.count;
          let pendingSubIndex = firstFit.subIndex;

          // Calculate endIndex for the first page
          let firstPageEndIndex: number | undefined;
          const firstHasMore = pendingSubIndex > 0 || firstPageItems < itemHeights.length;
          if (firstHasMore) {
            firstPageEndIndex = 0;
            for (let i = 0; i < firstPageItems && i < heightToParentIdx.length; i++) {
              if (heightToParentIdx[i] >= 0) {
                firstPageEndIndex = heightToParentIdx[i] + 1;
              }
            }
          }

          currentPage.entries.push({
            section, x: sectionX, y: currentY, width: sectionW,
            height: availableHeight, tableStartIndex: 0,
            tableEndIndex: firstPageEndIndex,
          });

          // Continuation pages
          let remainingIdx = pendingSubIndex > 0
            ? firstPageItems - 1  // Stay on partial item
            : firstPageItems;

          while (remainingIdx < itemHeights.length) {
            startNewPage();
            let pageContent = continuationContentHeight - TABLE_PADDING_TOP_MM - tableHeaderMm - TABLE_PADDING_BOTTOM_MM;

            // Account for group header re-draw
            if (ts.showGroupHeaders && remainingIdx < entryGroupKey.length) {
              const firstGroupOnPage = entryGroupKey[remainingIdx];
              const headerPos = groupHeaderIdx.get(firstGroupOnPage);
              if (headerPos !== undefined && headerPos < remainingIdx) {
                pageContent -= groupHeaderMm;
              }
            }

            const fit = fitItems(remainingIdx, pageContent, pendingSubIndex);
            const pageItems = fit.count;

            // Find the startIndex (parent item index) for this page
            let startParentIdx = 0;
            for (let i = 0; i < remainingIdx && i < heightToParentIdx.length; i++) {
              if (heightToParentIdx[i] >= 0) {
                startParentIdx = heightToParentIdx[i] + 1;
              }
            }

            // If continuing a partial item, startIndex points to that item
            // (the plugin's globalIdx skips items ≤ startIndex)
            if (pendingSubIndex > 0 && heightToParentIdx[remainingIdx] >= 0) {
              startParentIdx = heightToParentIdx[remainingIdx];
            }

            // Calculate endIndex — include all items on this page (including partial)
            const itemsEndIdx = remainingIdx + Math.max(1, pageItems);
            const isLastPage = !fit.subIndex && itemsEndIdx >= itemHeights.length;
            let pageEndIndex: number | undefined;
            if (!isLastPage) {
              pageEndIndex = 0;
              for (let i = 0; i < itemsEndIdx && i < heightToParentIdx.length; i++) {
                if (heightToParentIdx[i] >= 0) {
                  pageEndIndex = heightToParentIdx[i] + 1;
                }
              }
            }

            // On the last page, use actual content height so subsequent
            // sections (totals, custom text) can share this page
            let tableHeight = continuationContentHeight;
            if (isLastPage) {
              let actualContentMm = TABLE_PADDING_TOP_MM + tableHeaderMm + TABLE_PADDING_BOTTOM_MM;
              // Account for group header re-draw on this page
              if (ts.showGroupHeaders && remainingIdx < entryGroupKey.length) {
                const grp = entryGroupKey[remainingIdx];
                const hPos = groupHeaderIdx.get(grp);
                if (hPos !== undefined && hPos < remainingIdx) {
                  actualContentMm += groupHeaderMm;
                }
              }
              for (let i = remainingIdx; i < remainingIdx + pageItems && i < itemHeights.length; i++) {
                let h = itemHeights[i];
                if (i === remainingIdx && pendingSubIndex > 0) {
                  const item = getItemAt(i);
                  if (item) h = calculateRemainingItemHeight(item, ts, pendingSubIndex);
                }
                actualContentMm += h;
              }
              tableHeight = actualContentMm;
            }

            currentPage.entries.push({
              section, x: sectionX, y: currentY, width: sectionW,
              height: tableHeight,
              tableStartIndex: startParentIdx,
              tableEndIndex: pageEndIndex,
              tableSubIndex: pendingSubIndex > 0 ? pendingSubIndex : undefined,
            });
            currentY += tableHeight + SECTION_GAP;

            // Advance — if partial fit, stay on the same item
            if (fit.subIndex > 0) {
              remainingIdx = remainingIdx + pageItems - 1;
              pendingSubIndex = fit.subIndex;
            } else {
              remainingIdx += Math.max(1, pageItems);
              pendingSubIndex = 0;
            }
          }
        }
        continue;
      }

      // Non-table row that doesn't fit — start new page
      startNewPage();
    }

    // Place all sections in this row at the current Y
    for (const section of row.sections) {
      if (section.type === "header" && currentPage.isContinuation) {
        // Skip header sections in content rows on continuation pages
        // (header is already added by startNewPage)
        continue;
      }

      currentPage.entries.push({
        section,
        x: getSectionX(section),
        y: currentY,
        width: getSectionWidth(section),
        height: rowHeight,
      });
    }

    currentY += rowHeight + SECTION_GAP;
  }

  if (currentPage.entries.length > 0) {
    pages.push(currentPage);
  }


  return pages;
}

/** Calculate X position for a section based on its layoutHint */
function getSectionX(section: TemplateSection): number {
  if (!section.layoutHint || section.layoutHint.columnCount <= 1) {
    // Legacy: client-details on left half, project-details on right half
    if (section.type === "project-details") {
      return MARGIN + CONTENT_WIDTH / 2 + 4;
    }
    return MARGIN;
  }

  const { columnIndex, columnWidth, columnCount } = section.layoutHint;

  // Calculate X from preceding columns' widths
  // We need all columns' widths in this row, but we only have this section's info.
  // Use columnIndex and columnWidth to compute offset:
  // Each column before this one occupies its share of CONTENT_WIDTH.
  // Since we don't know other columns' exact widths, we compute from percentage positions.
  let xOffset = 0;
  // Approximate: assume columns before this one fill up to this column's start
  // We can compute from: all columns sum to 100%, this column starts at sum of widths before it
  // Since we only know this column's width, we use columnIndex * (avgWidth)
  // Better approach: total width / 100 * (percentage offset)
  // For that we need to know what percentage came before this column.
  // We can approximate: (100 - columnWidth * (columnCount - columnIndex)) / ... no.
  // Simplest correct approach: offset = CONTENT_WIDTH * (100 - columnWidth * remaining) / 100
  // Actually for equal splits, offset = columnIndex * (CONTENT_WIDTH / columnCount)
  // For unequal, we'd need all widths. Let's use the fact that the layoutHint was set
  // by flattenBlocks which sets each column's width. We just need each column's offset.
  // Since we don't have other columns' widths here, we calculate based on even distribution
  // when we can't determine precisely. In practice, we'll fix this in buildSectionSchema.

  // For now: use even column spacing based on columnIndex
  // This will be refined when we have the full row context
  if (columnCount > 1) {
    // Even split fallback — works for most cases
    // Real width comes from columnWidth percentage
    const colWidthMm = (CONTENT_WIDTH * columnWidth) / 100;
    // Offset: for column 0, x = MARGIN. For column 1, x = MARGIN + col0Width, etc.
    // Without knowing col0's width, approximate with even splits for offset
    const evenColWidth = CONTENT_WIDTH / columnCount;
    xOffset = columnIndex * evenColWidth;
  }

  return MARGIN + xOffset;
}

/** Calculate width for a section based on its layoutHint */
function getSectionWidth(section: TemplateSection): number {
  if (!section.layoutHint || section.layoutHint.columnCount <= 1) {
    // Legacy: client-details and project-details are half-width
    if (section.type === "client-details" || section.type === "project-details") {
      return CONTENT_WIDTH / 2 - 4;
    }
    return CONTENT_WIDTH;
  }

  return (CONTENT_WIDTH * section.layoutHint.columnWidth) / 100;
}

/**
 * Estimate page break positions (for the editor preview).
 * Returns Y-offsets (in mm from document start) where page breaks occur.
 */
export function estimatePageBreaks(
  sections: TemplateSection[],
  data: DocumentData,
  docType: DocumentType = "quote",
): number[] {
  const breaks: number[] = [];
  let cumulativeY = 0;
  const contentHeight = PAGE_HEIGHT - MARGIN * 2 - FOOTER_HEIGHT;

  // Group into rows for accurate row-level page breaks
  const rows = groupIntoRows(sections, data, docType);

  for (const row of rows) {
    if (row.isPageBreak) {
      breaks.push(cumulativeY);
      cumulativeY = 0;
      continue;
    }

    if (cumulativeY + row.height > contentHeight && cumulativeY > 0) {
      breaks.push(cumulativeY);
      cumulativeY = row.height + SECTION_GAP;
    } else {
      cumulativeY += row.height + SECTION_GAP;
    }
  }

  return breaks;
}

// ─── Schema & Input Generation ───────────────────────────────────────────────

/**
 * Build the pdfme schema entry for a section at a given position.
 */
function buildSectionSchema(
  entry: PageEntry,
  pageIndex: number,
): Schema & Record<string, unknown> {
  const { section, x, y, width, height } = entry;
  const uniqueName = `${section.type}_${section.id}_p${pageIndex}`;
  const base = {
    name: uniqueName,
    content: "",
    position: { x, y },
    width,
    height,
  };

  switch (section.type) {
    case "header":
      return { ...base, type: "gearflowPageHeader" };

    case "client-details": {
      const cs = section.settings as ClientDetailsSectionSettings;
      return {
        ...base,
        type: "text",
        fontSize: cs.styling?.fontSize || 9,
        fontColor: cs.styling?.textColor || "#1a1a1a",
      };
    }

    case "project-details": {
      const ps = section.settings as ProjectDetailsSectionSettings;
      return {
        ...base,
        type: "text",
        fontSize: ps.styling?.fontSize || 9,
        fontColor: ps.styling?.textColor || "#1a1a1a",
      };
    }

    case "table":
      return { ...base, type: "gearflowTable" };

    case "totals":
      return { ...base, type: "gearflowFinancialSummary" };

    case "notes":
      return {
        ...base,
        type: "text",
        fontSize: 8,
        fontColor: "#666666",
      };

    case "signature":
      return { ...base, type: "gearflowSignatureLine" };

    case "custom-text": {
      const s = section.settings as CustomTextSectionSettings;
      return {
        ...base,
        type: "text",
        fontSize: s.fontSize,
        fontColor: "#333333",
        fontWeight: s.fontWeight === "bold" ? "bold" : undefined,
        textAlign: s.alignment,
      };
    }

    case "crew-table":
      return { ...base, type: "gearflowCrewTable" };

    case "call-sheet-info":
      return { ...base, type: "gearflowCallSheetInfo" };

    case "day-header":
      return { ...base, type: "gearflowDayHeader" };

    case "spacer":
      return { ...base, type: "text", fontSize: 1, fontColor: "#ffffff" };

    default:
      return { ...base, type: "text" };
  }
}

/**
 * Build the pdfme input value for a section.
 */
function buildSectionInput(
  section: TemplateSection,
  data: DocumentData,
  docType: DocumentType,
  docColor: string,
  tableStartIndex?: number,
  tableEndIndex?: number,
  tableSubIndex?: number,
): string {
  switch (section.type) {
    case "header": {
      const s = section.settings as HeaderSectionSettings;
      const orgDetailParts: string[] = [];
      if (s.showOrgAddress && data.org_address) orgDetailParts.push(data.org_address);
      if (s.showOrgPhone && data.org_phone) orgDetailParts.push(data.org_phone);
      if (s.showOrgEmail && data.org_email) orgDetailParts.push(data.org_email);
      if (s.showOrgWebsite && data.org_website) orgDetailParts.push(data.org_website);

      const rawTitle = s.documentTitle || docType.toUpperCase();
      const resolvedTitle = resolveTokensInText(rawTitle, data);

      const config: PageHeaderConfig = {
        orgName: data.org_name || "",
        orgDetails: orgDetailParts.join("\n"),
        docTitle: resolvedTitle,
        docMeta: `${data.project_number || ""}\n${data.document_date || ""}`,
        logoData: data.org_logo,
        iconData: data.org_icon,
        documentLogoMode: s.logoMode,
        showOrgNameOnDocuments: s.showOrgName,
        documentColor: docColor,
      };
      return JSON.stringify(config);
    }

    case "client-details": {
      const s = section.settings as ClientDetailsSectionSettings;
      const labels = s.customLabels || {};
      const lines: string[] = [];
      if (s.showClientName && data.client_name) lines.push(data.client_name);
      if (s.showClientContact && data.client_contact) lines.push(`${labels.contact || "Attn"}: ${data.client_contact}`);
      if (s.showClientEmail && data.client_email) lines.push(data.client_email);
      if (s.showClientAddress && data.client_billing_address) lines.push(data.client_billing_address);
      if (s.showClientTaxId && data.client_tax_id) lines.push(`${labels.taxId || "ABN"}: ${data.client_tax_id}`);
      if (s.customFields) {
        for (const cf of s.customFields) {
          const resolvedValue = resolveTokensInText(cf.value, data);
          if (resolvedValue) lines.push(`${cf.label}: ${resolvedValue}`);
        }
      }
      if (section.content) {
        lines.push(resolveTokensInText(section.content, data));
      }
      return lines.length > 0 ? lines.join("\n") : "-";
    }

    case "project-details": {
      const s = section.settings as ProjectDetailsSectionSettings;
      const labels = s.customLabels || {};
      const lines: string[] = [];
      if (s.showProjectName) lines.push(data.project_name);
      if (s.showVenue && data.venue_name) lines.push(`${labels.venue || "Venue"}: ${data.venue_name}`);
      if (s.showRentalDates && data.rental_start && data.rental_start !== "-") {
        const end = data.rental_end && data.rental_end !== "-" ? ` - ${data.rental_end}` : "";
        lines.push(`${labels.rentalDates || "Rental"}: ${data.rental_start}${end}`);
      }
      if (s.showEventDates && data.event_start && data.event_start !== "-") {
        const end = data.event_end && data.event_end !== "-" ? ` - ${data.event_end}` : "";
        lines.push(`${labels.eventDates || "Event"}: ${data.event_start}${end}`);
      }
      if (s.showPaymentTerms && data.client_payment_terms) {
        lines.push(`${labels.paymentTerms || "Payment Terms"}: ${data.client_payment_terms}`);
      }
      if (s.showSiteContact && data.site_contact_name) {
        let contactLine = `${labels.siteContact || "Site Contact"}: ${data.site_contact_name}`;
        if (data.site_contact_phone) contactLine += ` | Ph: ${data.site_contact_phone}`;
        lines.push(contactLine);
      }
      if (s.showDocumentDate) lines.push(`${labels.documentDate || "Date"}: ${data.document_date}`);
      if (s.customFields) {
        for (const cf of s.customFields) {
          const resolvedValue = resolveTokensInText(cf.value, data);
          if (resolvedValue) lines.push(`${cf.label}: ${resolvedValue}`);
        }
      }
      if (section.content) {
        lines.push(resolveTokensInText(section.content, data));
      }
      return lines.length > 0 ? lines.join("\n") : "-";
    }

    case "table": {
      const s = section.settings as TableSectionSettings;
      const tableValue: {
        items: typeof data.line_items;
        config: TablePluginConfig;
        startIndex?: number;
        endIndex?: number;
        startSubIndex?: number;
      } = {
        items: data.line_items,
        config: {
          documentType: docType,
          documentColor: docColor,
          showGroupHeaders: s.showGroupHeaders,
          showKitChildren: s.showKitChildren,
          showCheckboxes: s.showCheckboxes,
          showConditionColumns: s.showConditionColumns,
          showPricing: s.showPricing,
          showBadges: s.showBadges,
          showNotes: s.showNotes,
          showPerUnitCheckboxes: s.showPerUnitCheckboxes,
          showAssetTags: s.showAssetTags,
          showCategories: s.showCategories,
          showRowNumbers: s.showRowNumbers,
          filterOptional: false,
          filterByStatus: getFilterByStatus(docType),
        },
      };
      if (tableStartIndex) {
        tableValue.startIndex = tableStartIndex;
      }
      if (tableEndIndex !== undefined) {
        tableValue.endIndex = tableEndIndex;
      }
      if (tableSubIndex) {
        tableValue.startSubIndex = tableSubIndex;
      }
      return JSON.stringify(tableValue);
    }

    case "totals": {
      const s = section.settings as TotalsSectionSettings;
      const config: FinancialSummaryConfig = {
        subtotal: s.showSubtotal ? data.subtotal : 0,
        discountPercent: s.showDiscount ? data.discount_percent : 0,
        discountAmount: s.showDiscount ? data.discount_amount : 0,
        taxLabel: data.tax_label,
        taxAmount: s.showTax ? data.tax_amount : 0,
        total: s.showTotal ? data.total : 0,
        depositPaid: s.showDeposit ? data.deposit_paid : 0,
        balanceDue: s.showBalance ? data.balance_due : 0,
        documentColor: docColor,
      };
      return JSON.stringify(config);
    }

    case "notes": {
      const s = section.settings as NotesSectionSettings;
      const parts: string[] = [];
      if (s.showClientNotes && data.client_notes) parts.push(data.client_notes);
      if (s.showCrewNotes && data.crew_notes) parts.push(data.crew_notes);
      return parts.join("\n\n");
    }

    case "signature": {
      const s = section.settings as SignatureSectionSettings;
      const config: SignatureLineConfig = {
        columns: s.labels.map((label) => ({ label })),
        orgName: data.org_name || "",
      };
      return JSON.stringify(config);
    }

    case "custom-text": {
      const content = section.content || "";
      return resolveTokensInText(content, data);
    }

    case "crew-table": {
      // Check for per-day crew data override (set during section expansion)
      let crewData = data.crew || [];
      if (section.content) {
        try {
          const override = JSON.parse(section.content);
          if (override.dayCrew) {
            crewData = override.dayCrew;
          }
        } catch {
          // Not a JSON override, ignore
        }
      }
      const crewConfig: { crew: typeof data.crew; documentColor: string; startIndex?: number } = {
        crew: crewData,
        documentColor: docColor,
      };
      if (tableStartIndex) {
        crewConfig.startIndex = tableStartIndex;
      }
      return JSON.stringify(crewConfig);
    }

    case "call-sheet-info": {
      const csi = section.settings as CallSheetInfoSectionSettings;
      const infoConfig = {
        pmName: data.pm_name || "",
        pmPhone: data.pm_phone || "",
        pmEmail: data.pm_email || "",
        clientName: data.client_name || "",
        clientContact: data.client_contact || "",
        venueName: data.venue_name || "",
        venueAddress: data.venue_address || "",
        loadInDate: data.load_in_date || "-",
        loadOutDate: data.load_out_date || "-",
        eventStart: data.event_start || "-",
        eventEnd: data.event_end || "-",
        equipmentSummary: data.equipment_summary || "No equipment assigned",
        documentColor: docColor,
        showPmContact: csi.showPmContact,
        showClientContact: csi.showClientContact,
        showVenueDetails: csi.showVenueDetails,
        showScheduleTimes: csi.showScheduleTimes,
        showEquipmentSummary: csi.showEquipmentSummary,
      };
      return JSON.stringify(infoConfig);
    }

    case "day-header": {
      // day-header sections get their data injected during section expansion
      // The content field holds JSON with dayLabel, phases, crewCount
      return section.content || "";
    }

    case "spacer":
      return "";

    default:
      return "";
  }
}

/** Check if a BlockStyling object has any visual properties set */
function hasStyling(styling: BlockStyling): boolean {
  return !!(styling.backgroundColor || styling.borderColor);
}

/** Get status filter for table items based on document type */
function getFilterByStatus(docType: DocumentType): string[] | null {
  switch (docType) {
    case "delivery-docket":
      return ["CHECKED_OUT"];
    case "return-sheet":
      return ["CHECKED_OUT", "RETURNED"];
    default:
      return null;
  }
}

// ─── Main Render Function ────────────────────────────────────────────────────

export interface RenderResult {
  template: Template;
  inputs: Record<string, string>[];
}

/**
 * Render a section-based template into a pdfme Template + inputs.
 * This is the main entry point for the section-based pipeline.
 *
 * Supports both flat sections (legacy) and column-aware sections (with layoutHint).
 */
export function renderSections(
  sections: TemplateSection[],
  data: DocumentData,
  docType: DocumentType,
  docColor: string,
  footerText?: string,
  footerSecondLine?: string,
): RenderResult {
  // 1. Filter visible sections
  const visibleSections = filterVisibleSections(sections, docType, data);

  if (visibleSections.length === 0) {
    return {
      template: {
        basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
        schemas: [[]],
      },
      inputs: [{}],
    };
  }

  // 2. Compute page layout (now column-aware via layoutHint)
  const pages = computePageLayout(visibleSections, data, docType);

  // 3. Build pdfme schemas and inputs per page
  const allSchemas: (Schema & Record<string, unknown>)[][] = [];
  const allInputs: Record<string, string>[] = [];

  const footerConfig: FooterConfig = {
    text: footerText || `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: footerSecondLine || "",
  };

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageSchemas: (Schema & Record<string, unknown>)[] = [];
    const pageInputs: Record<string, string> = {};

    for (const entry of page.entries) {
      // Insert background rect before content when styling is present
      const styling = entry.section.layoutHint?.styling;
      if (styling && hasStyling(styling)) {
        const rectName = `rect_${entry.section.id}_p${pageIdx}`;
        const padding = styling.padding || 0;
        pageSchemas.push({
          name: rectName,
          type: "gearflowRect",
          content: "",
          position: { x: entry.x - padding, y: entry.y - padding },
          width: entry.width + padding * 2,
          height: entry.height + padding * 2,
        });
        const rectConfig: RectConfig = {
          backgroundColor: styling.backgroundColor,
          borderColor: styling.borderColor,
          borderWidth: styling.borderWidth,
          padding: styling.padding,
        };
        pageInputs[rectName] = JSON.stringify(rectConfig);
      }

      const schema = buildSectionSchema(entry, pageIdx);
      const input = buildSectionInput(entry.section, data, docType, docColor, entry.tableStartIndex, entry.tableEndIndex, entry.tableSubIndex);
      pageSchemas.push(schema);
      pageInputs[schema.name] = input;
    }

    // Add footer to every page
    const footerName = `footer_p${pageIdx}`;
    pageSchemas.push({
      name: footerName,
      type: "gearflowPageFooter",
      content: "",
      position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT },
      width: CONTENT_WIDTH,
      height: FOOTER_HEIGHT,
    });
    pageInputs[footerName] = JSON.stringify(footerConfig);

    allSchemas.push(pageSchemas);
    allInputs.push(pageInputs);
  }

  // pdfme's generate() iterates: for each input × for each schema page → insertPage.
  // With N inputs and N schema pages, this produces N×N pages instead of N.
  // Fix: merge all per-page inputs into a single dict. Schema names are unique
  // per page (e.g. table_abc_p0, table_abc_p1), so there are no key collisions.
  const mergedInputs: Record<string, string> = {};
  for (const pageInputs of allInputs) {
    Object.assign(mergedInputs, pageInputs);
  }

  return {
    template: {
      basePdf: {
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        padding: [MARGIN, MARGIN, MARGIN, MARGIN],
      },
      schemas: allSchemas,
    },
    inputs: [mergedInputs],
  };
}
