/**
 * gearflowTable plugin — the core equipment table renderer.
 * Handles all 6 document types with configurable columns, kit hierarchies,
 * badges, checkboxes, condition columns, per-unit expansion.
 *
 * This is the most complex plugin — it replicates the line item rendering
 * from all 6 @react-pdf/renderer templates.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import type { PDFFont, PDFPage } from "@pdfme/pdf-lib";
import {
  getLayoutProps, hexToRgb, lightenHex, getHelveticaFonts,
  formatCurrency, stubUiRender, stubPropPanel,
  drawRichText, measureRichTextHeight,
} from "./helpers";
import type { DocumentLineItem, TablePluginConfig } from "../types";
import { parsePriceBreakdown, formatPriceBreakdown } from "@/lib/billing-derivation";
import { discountPercentOf, lineGrossAmount } from "@/lib/discount-mode";

/**
 * The Discount cell's text for one row (#1012) — the discount printed the way
 * the operator entered it: `-15%` for a line discounted by percentage, and
 * `-$40.00` for a flat amount. `"-"` when the row carries no discount.
 *
 * `discountMode` is the ENTRY shape; the percentage itself is derived here from
 * the stored dollar amount against the row's own gross, so the printed percent
 * and the printed line total can never contradict each other (see
 * `src/lib/discount-mode.ts`). A row with no stored mode — every row written
 * before #1012 — prints the dollar amount, exactly as it did before.
 *
 * Shared by all three renderers in this file (parent rows, kit/accessory
 * children, per-unit grandchildren) so the three can never drift apart.
 */
function discountCellText(item: DocumentLineItem): string {
  if (!item.discount) return "-";
  if (item.discountMode === "%") {
    const pct = discountPercentOf(item.discount, lineGrossAmount(item));
    // A $0-gross row has no meaningful percentage — fall back to the amount
    // rather than printing a nonsense "-0%" / "-Infinity%".
    if (pct != null) return `-${pct}%`;
  }
  return `-${formatCurrency(item.discount)}`;
}

/** Formatted breakdown label for a line, or "" when there's nothing to show
 *  (no stored breakdown, malformed JSON, or a manually-priced line). Shared by
 *  the row-height bounds check and the actual draw call so they can never
 *  disagree about whether this line reserves an extra text row. */
function breakdownLabel(item: DocumentLineItem, config: TablePluginConfig): string {
  if (!item.priceBreakdown || !config.showPricing) return "";
  const parsed = parsePriceBreakdown(item.priceBreakdown);
  return parsed ? formatPriceBreakdown(parsed) : "";
}

interface TableSchema extends Schema {
  type: "gearflowTable";
}

interface TableValue {
  items: DocumentLineItem[];
  config: TablePluginConfig;
  /** Index of the first parent item to render (for multi-page tables) */
  startIndex?: number;
  /** Number of sub-items (per-unit checkboxes / kit children) to skip
   *  within the first rendered parent item (for mid-item page breaks) */
  startSubIndex?: number;
  /** 1-based index of the last parent item to render (inclusive).
   *  Items with globalIdx > endIndex are not rendered on this page. */
  endIndex?: number;
}

/** Column definition for the table */
interface ColumnDef {
  key: string;
  label: string;
  width: number;    // in pt
  flex?: number;     // if flex, width is proportional
  align?: "left" | "center" | "right";
}

const PRICING_LABELS: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  PER_HOUR: "/hr",
  FLAT: "flat",
  OPTIMIZED: "",
};

const BADGE_STYLES = {
  optional: { bg: "#fef3c7", text: "#92400e", label: "OPTIONAL" },
  overbooked: { bg: "#fee2e2", text: "#dc2626", label: "OVERBOOKED" },
  overbookedInherited: { bg: "#fef3c7", text: "#d97706", label: "OVERBOOKED" },
  reducedStock: { bg: "#ede9fe", text: "#7c3aed", label: "REDUCED STOCK" },
  subhire: { bg: "#cffafe", text: "#0891b2", label: "SUBHIRE" },
  // WS11 (#950) — sale lines ride in their existing category/group (no
  // separate Sales bucket, spec decision) — the badge is what differentiates.
  sale: { bg: "#dcfce7", text: "#15803d", label: "SALE" },
};

function getColumnsForDocType(config: TablePluginConfig, totalWidth: number): ColumnDef[] {
  switch (config.documentType) {
    case "quote":
    case "invoice":
      return resolveFlexWidths([
        { key: "description", label: "Description", width: 0, flex: 3, align: "left" },
        { key: "qty", label: "Qty", width: 30, align: "center" },
        { key: "unitPrice", label: config.documentType === "invoice" ? "Rate" : "Unit Price", width: 55, align: "right" },
        { key: "discount", label: "Discount", width: 55, align: "right" },
        { key: "total", label: config.documentType === "invoice" ? "Amount" : "Total", width: 60, align: "right" },
      ], totalWidth);

    case "packing-list":
      return resolveFlexWidths([
        { key: "checkbox", label: "", width: 20, align: "center" },
        { key: "description", label: "Item", width: 0, flex: 3, align: "left" },
        { key: "qty", label: "Qty", width: 30, align: "center" },
        { key: "assetTag", label: "Asset Tag", width: 80, align: "left" },
        { key: "category", label: "Category", width: 70, align: "left" },
      ], totalWidth);

    case "return-sheet":
      return resolveFlexWidths([
        { key: "checkbox", label: "Ret", width: 20, align: "center" },
        { key: "description", label: "Item", width: 0, flex: 2, align: "left" },
        { key: "qty", label: "Qty", width: 30, align: "center" },
        { key: "assetTag", label: "Asset Tag", width: 80, align: "left" },
        { key: "condition", label: "Condition", width: 80, align: "center" },
        { key: "notes", label: "Notes", width: 0, flex: 1, align: "left" },
      ], totalWidth);

    case "delivery-docket":
      return resolveFlexWidths([
        { key: "rowNum", label: "#", width: 24, align: "center" },
        { key: "description", label: "Description", width: 0, flex: 3, align: "left" },
        { key: "qty", label: "Qty", width: 40, align: "center" },
        { key: "assetTag", label: "Asset Tag", width: 80, align: "left" },
        { key: "received", label: "Received", width: 50, align: "center" },
      ], totalWidth);

    default:
      return resolveFlexWidths([
        { key: "description", label: "Description", width: 0, flex: 3, align: "left" },
        { key: "qty", label: "Qty", width: 30, align: "center" },
      ], totalWidth);
  }
}

/** Resolve flex widths by distributing remaining space proportionally */
function resolveFlexWidths(cols: ColumnDef[], totalWidth: number): ColumnDef[] {
  const fixedWidth = cols.filter(c => !c.flex).reduce((sum, c) => sum + c.width, 0);
  const remaining = totalWidth - fixedWidth;
  const totalFlex = cols.filter(c => c.flex).reduce((sum, c) => sum + (c.flex || 0), 0);

  return cols.map(c => ({
    ...c,
    width: c.flex ? (remaining * (c.flex / totalFlex)) : c.width,
  }));
}

/** Check if item is a bulk asset */
function isBulk(item: DocumentLineItem): boolean {
  return !!item.bulkAssetId || (!item.assetId && item.quantity > 1);
}

/** Get the display name for a line item */
function getItemName(item: DocumentLineItem, isKit: boolean): string {
  if (isKit) {
    return item.description || item.kit?.name || "Kit";
  }
  if (item.model) {
    return item.model.modelNumber
      ? `${item.model.name} (${item.model.modelNumber})`
      : item.model.name;
  }
  return item.description || "-";
}

/**
 * Get asset tag display for a line. Preference order:
 *   1. Kit row → the kit's own tag
 *   2. Units present (post-cutover, multi-quantity deployed line) →
 *      dedupe tags first (bulk assets share one tag across many units,
 *      so a 10-unit bulk line has 10 identical unit tags, not 10 distinct
 *      ones), then join up to 2 distinct tags, "+N more" for extras. One
 *      distinct tag collapses to itself so single-asset lines and bulk
 *      lines both render one clean tag instead of duplicating it.
 *   3. Legacy line.asset (kit children, un-migrated splits)
 *   4. Bulk asset tag
 *   5. "-"
 *
 * The column is 80pt wide at courier-8 — two short tags fit. Anything
 * longer truncates visually but the data is still in the system; a
 * future docket revamp can render per-unit rows.
 */
export function getAssetTag(item: DocumentLineItem, isKit: boolean): string {
  if (isKit) {
    return item.kit?.assetTag || "-";
  }
  const unitTags = [...new Set(
    (item.units ?? [])
      .map((u) => u.asset?.assetTag ?? u.bulkAsset?.assetTag)
      .filter((t): t is string => !!t)
  )];
  if (unitTags.length > 0) {
    if (unitTags.length === 1) return unitTags[0];
    if (unitTags.length === 2) return unitTags.join(", ");
    return `${unitTags[0]}, ${unitTags[1]} +${unitTags.length - 2}`;
  }
  return item.asset?.assetTag || item.bulkAsset?.assetTag || "-";
}

async function pdfRender(arg: PDFRenderProps<TableSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const value = arg.value || '{"items":[],"config":{}}';
  const { items, config, startIndex: startIdx, startSubIndex: startSubIdx, endIndex: endIdx } = JSON.parse(value) as TableValue;
  const startIndex = startIdx || 0;
  const startSubIndex = startSubIdx || 0;
  const endIndex = endIdx; // undefined = render all remaining

  const pageHeight = page.getHeight();
  const layout = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const docColor = config.documentColor || "#0d4f4f";
  const docColorLight = lightenHex(docColor, 0.88);
  const columns = getColumnsForDocType(config, layout.width);

  // Colors
  const headerBg = hexToRgb("#f5f5f5", pdfLib);
  const headerBorder = hexToRgb("#dddddd", pdfLib);
  const rowBorder = hexToRgb("#eeeeee", pdfLib);
  const altRowBg = hexToRgb("#fafafa", pdfLib);
  const groupBg = hexToRgb(docColorLight, pdfLib);
  const groupBorder = hexToRgb("#dddddd", pdfLib);
  const groupTextColor = hexToRgb(docColor, pdfLib);
  const textColor = hexToRgb("#1a1a1a", pdfLib);
  const lightTextColor = hexToRgb("#666666", pdfLib);
  const mutedTextColor = hexToRgb("#999999", pdfLib);
  const childTextColor = hexToRgb("#555555", pdfLib);
  const grandchildTextColor = hexToRgb("#777777", pdfLib);
  const noteTextColor = hexToRgb("#888888", pdfLib);

  const rowPadding = 4;
  const cellPadding = 6;
  const fontSize = 9;
  const headerFontSize = 7;
  const childFontSize = 8;
  const grandchildFontSize = 7;
  const badgeFontSize = 6;
  const noteFontSize = 7;

  let currentY = layout.y + layout.height;
  const tableX = layout.x;
  const bottomBoundary = layout.y; // Stop drawing when currentY reaches this

  // === Filter items ===
  let filteredItems = items.filter(i => !i.isKitChild && !i.isContainerLineItem);

  if (config.filterOptional) {
    filteredItems = filteredItems.filter(i => !i.isOptional);
  }

  if (config.filterByStatus) {
    const statuses = config.filterByStatus;
    // WS11 (#950) — SALE lines are goods handed over, never expected back:
    // excluded entirely from the return sheet (regardless of status), and
    // bypass the status filter everywhere else `filterByStatus` applies
    // today (delivery docket) since a sale always "counts" for hand-over
    // purposes. Quote/invoice/packing-list have no `filterByStatus` at all
    // (document-layouts.ts), so a SALE line already flows through those
    // unfiltered — nothing to special-case there.
    const isReturnSheet = config.documentType === "return-sheet";
    filteredItems = filteredItems.filter(i => {
      if (i.type === "SALE") return !isReturnSheet;
      if (isBulk(i)) return i.checkedOutQuantity > 0;
      // Synthetic Project Group row: its own status field is meaningless
      // (it's a label, not a real line item). Pass through if ANY attached
      // child passes the filter — otherwise the parent + all members
      // would silently drop from delivery dockets / return sheets.
      if (i.isGroupRow && (i.childLineItems?.length ?? 0) > 0) {
        return i.childLineItems!.some(c => {
          if (c.type === "SALE") return !isReturnSheet;
          if (isBulk(c)) return c.checkedOutQuantity > 0;
          return statuses.includes(c.status);
        });
      }
      return statuses.includes(i.status);
    });
  }

  // === Group items ===
  // Delivery docket: kit parents promote their CHECKED_OUT children to be
  // section rows under the kit's name (so the client ticks each item off
  // on receipt). NON-kit items now respect `groupName` like every other
  // doc type — this is what unlocks Project Groups + Sub-Hire Groups on
  // the docket. Phase 3b will pull kit promotion into the data layer
  // and remove the remaining docType branch.
  // All other doc types: group by groupName / prepContainer.
  const ungroupedKey = config.documentType === "packing-list" ? "Ungrouped"
    : config.documentType === "delivery-docket" ? "General"
    : "_ungrouped";

  const groups = new Map<string, DocumentLineItem[]>();

  if (config.documentType === "delivery-docket") {
    for (const item of filteredItems) {
      const isKitParent = !!item.kitId && !item.isKitChild;
      if (isKitParent) {
        const kitName = item.kit?.name || item.description || "Kit";
        const children = (item.childLineItems || []).filter(c => c.status === "CHECKED_OUT");
        if (children.length > 0) {
          if (!groups.has(kitName)) {
            groups.set(kitName, []);
          }
          groups.get(kitName)!.push(...children);
        }
      } else {
        // Respect the structured groupName so Project Groups + Sub-Hire
        // Groups get their own section headers, not lumped under "General".
        const key = item.groupName || item.prepContainer || ungroupedKey;
        const arr = groups.get(key) || [];
        arr.push(item);
        groups.set(key, arr);
      }
    }
  } else {
    for (const item of filteredItems) {
      const key = item.groupName || item.prepContainer || ungroupedKey;
      const arr = groups.get(key) || [];
      arr.push(item);
      groups.set(key, arr);
    }
  }

  // === Draw table header ===
  const headerHeight = headerFontSize + rowPadding * 2 + 4;
  drawTableHeader(page, fonts, pdfLib, columns, tableX, currentY, layout.width, headerHeight, headerBg, headerBorder, headerFontSize);
  currentY -= headerHeight;

  // === Draw rows ===
  let rowNum = 0;
  let globalIdx = 0;
  let overflow = false; // Set when we run out of space
  let isFirstRenderedItem = true; // Track first item for startSubIndex

  for (const [groupName, groupItems] of groups) {
    if (overflow) break;

    // Check if any items in this group will actually be rendered
    // (skip group header if all items are before startIndex)
    const groupStartIdx = globalIdx;
    const groupEndIdx = groupStartIdx + groupItems.length;
    const hasVisibleItems = groupEndIdx > startIndex;
    // True when this group's first item already rendered on an earlier
    // page — this page is a continuation of it, not a fresh start. Every
    // page recomputes the full `groups` map and evaluates every group
    // against its own startIndex/endIndex slice, so without this check a
    // long group's header redraws at the top of every continuation page
    // it spans (2026-07-28) instead of only where the group begins.
    const isContinuationOfEarlierPage = groupStartIdx < startIndex;

    // Group header — only draw if this group has visible items on this
    // page AND is starting fresh here (not continuing from a prior page).
    if (groupName !== ungroupedKey && config.showGroupHeaders && hasVisibleItems && !isContinuationOfEarlierPage) {
      const ghHeight = fontSize + rowPadding * 2;
      // Orphan-check: reserve space for the header AND at least one body
      // row underneath, so headers never strand at a page bottom with
      // their items continuing onto the next page (Eng review finding).
      const minBodyRowHeight = fontSize + rowPadding * 2;
      if (currentY - (ghHeight + minBodyRowHeight) < bottomBoundary) {
        break;
      }
      page.drawRectangle({
        x: tableX,
        y: currentY - ghHeight,
        width: layout.width,
        height: ghHeight,
        color: groupBg,
      });
      page.drawLine({
        start: { x: tableX, y: currentY - ghHeight },
        end: { x: tableX + layout.width, y: currentY - ghHeight },
        thickness: 0.5,
        color: groupBorder,
      });
      page.drawText(groupName, {
        x: tableX + cellPadding,
        y: currentY - ghHeight + rowPadding,
        size: fontSize,
        font: fonts.bold,
        color: groupTextColor,
      });
      currentY -= ghHeight;
    }

    for (const item of groupItems) {
      rowNum++;
      globalIdx++;
      // Skip items before startIndex (for multi-page continuation)
      if (globalIdx <= startIndex) continue;
      // Stop rendering past endIndex (prevent overflow into next page's items)
      if (endIndex !== undefined && globalIdx > endIndex) { overflow = true; break; }
      const isKit = !!item.kitId && !item.isKitChild;
      // A synthetic Project Group row with attached members. Renders bold
      // like a kit parent and fans out indented members underneath via
      // the same childLineItems path as kits — no [Kit] prefix because
      // it isn't one.
      const isGroupParent =
        !!item.isGroupRow && (item.childLineItems?.length ?? 0) > 0;
      // A serialised asset with permanent accessories (child assets). Not a
      // kit (no kitId) — it renders as a normal asset row with its
      // accessories indented underneath, via the same childLineItems path.
      const isAccessoryParent =
        !item.isKitChild &&
        !item.kitId &&
        !item.isGroupRow &&
        (item.childLineItems?.some((c) => c.childKind === "ACCESSORY") ?? false);
      const isParentWithChildren = isKit || isGroupParent || isAccessoryParent;
      const isItemized = isKit && item.pricingMode === "ITEMIZED";
      const itemName = getItemName(item, isKit);

      // Skip parent row when continuing a partial item from previous page
      const isContinuation = isFirstRenderedItem && startSubIndex > 0;

      if (!isContinuation) {
        // Calculate row content height
        const noteLineHeight = noteFontSize + 2;
        let rowContentHeight = fontSize + rowPadding * 2;
        if (item.subHireId != null && item.supplierName) {
          rowContentHeight += fontSize + 1; // "via Supplier" line
        }
        if (breakdownLabel(item, config)) {
          rowContentHeight += noteLineHeight; // "2 wk @ $X + 3 d @ $Y" / "charged as N wk (capped)" line
        }
        if (item.notes && config.showNotes) {
          rowContentHeight += measureRichTextHeight(item.notes, noteLineHeight);
        }

        // Bounds check: stop if this row won't fit
        if (currentY - rowContentHeight < bottomBoundary) { overflow = true; break; }

        // Alternating row background
        if (globalIdx % 2 === 0) {
          page.drawRectangle({
            x: tableX,
            y: currentY - rowContentHeight,
            width: layout.width,
            height: rowContentHeight,
            color: altRowBg,
          });
        }

        // Bottom border
        page.drawLine({
          start: { x: tableX, y: currentY - rowContentHeight },
          end: { x: tableX + layout.width, y: currentY - rowContentHeight },
          thickness: 0.5,
          color: rowBorder,
        });

        // Draw cells
        let cellX = tableX + cellPadding;
        const textY = currentY - rowPadding - fontSize;

        for (const col of columns) {
        const colEndX = cellX + col.width;

        switch (col.key) {
          case "checkbox": {
            // Draw checkbox
            const cbSize = 7;
            const cbX = cellX + (col.width - cbSize) / 2 - cellPadding;
            const cbY = textY - 1;
            drawCheckbox(page, pdfLib, cbX, cbY, cbSize, isChecked(item, config));
            break;
          }

          case "rowNum": {
            const numStr = String(rowNum);
            const numWidth = fonts.regular.widthOfTextAtSize(numStr, fontSize);
            page.drawText(numStr, {
              x: cellX + (col.width - numWidth) / 2 - cellPadding,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: mutedTextColor,
            });
            break;
          }

          case "description": {
            const descX = cellX;

            // Kit prefix for packing list. Group parents get bold but
            // no prefix — the category bucket already labels them.
            const displayName = (config.documentType === "packing-list" && isKit)
              ? `[Kit] ${itemName}`
              : itemName;

            // Bold only when this row actually has visible children below
            // it — otherwise (showKitChildren off, e.g. quote/invoice) a
            // bold row with nothing under it just reads as an unexplained
            // random emphasis.
            const font = isParentWithChildren && config.showKitChildren ? fonts.bold : fonts.regular;
            page.drawText(displayName, {
              x: descX,
              y: textY,
              size: fontSize,
              font,
              color: textColor,
            });

            // Badges
            if (config.showBadges) {
              let badgeX = descX + font.widthOfTextAtSize(displayName, fontSize) + 4;
              const badges = getBadges(item, config.documentType);
              for (const badge of badges) {
                badgeX = drawBadge(page, fonts, pdfLib, badge, badgeX, textY, badgeFontSize);
              }
            }

            // "via Supplier" for sub-hire items on internal docs
            let supplierLineOffset = 0;
            if (item.subHireId != null && item.supplierName) {
              const viaText = `via ${item.supplierName}`;
              supplierLineOffset = fontSize + 1;
              page.drawText(viaText, {
                x: descX,
                y: textY - supplierLineOffset,
                size: noteFontSize,
                font: fonts.regular,
                color: noteTextColor,
              });
            }

            // Price breakdown (#943) — "2 wk @ $X + 3 d @ $Y" / "charged as N wk
            // (capped)" for an auto-priced line, or nothing for a manual price.
            let breakdownLineOffset = 0;
            const breakdown = breakdownLabel(item, config);
            if (breakdown) {
              breakdownLineOffset = noteFontSize + 2;
              page.drawText(breakdown, {
                x: descX,
                y: textY - fontSize - 1 - supplierLineOffset,
                size: noteFontSize,
                font: fonts.regular,
                color: noteTextColor,
              });
            }

            // Notes (with markdown support)
            if (item.notes && config.showNotes) {
              drawRichText(page, item.notes, {
                x: descX,
                y: textY - fontSize - 1 - supplierLineOffset - breakdownLineOffset,
                fontSize: noteFontSize,
                lineHeight: noteFontSize + 2,
                color: noteTextColor,
                fonts,
              });
            }
            break;
          }

          case "qty": {
            let qtyStr: string;
            if (isKit && config.showKitChildren) {
              qtyStr = String((item.childLineItems || []).length);
            } else if (config.documentType === "delivery-docket") {
              if (isKit) {
                const deployed = (item.childLineItems || []).filter(c => c.status === "CHECKED_OUT");
                qtyStr = String(deployed.length);
              } else if (isBulk(item)) {
                qtyStr = String(item.checkedOutQuantity);
              } else {
                qtyStr = "1";
              }
            } else {
              qtyStr = String(item.quantity);
            }
            const qtyWidth = fonts.regular.widthOfTextAtSize(qtyStr, fontSize);
            page.drawText(qtyStr, {
              x: cellX + (col.width - qtyWidth) / 2 - cellPadding,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: textColor,
            });
            break;
          }

          case "unitPrice": {
            if (!config.showPricing) break;
            const priceStr = isItemized ? "-"
              : item.unitPrice != null
                ? `${formatCurrency(item.unitPrice)}${config.hidePricingPeriodSuffix ? "" : PRICING_LABELS[item.pricingType] || ""}`
                : "-";
            const priceWidth = fonts.regular.widthOfTextAtSize(priceStr, fontSize);
            page.drawText(priceStr, {
              x: colEndX - priceWidth - cellPadding,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: textColor,
            });
            break;
          }

          case "discount": {
            if (!config.showPricing) break;
            const discStr = !isItemized ? discountCellText(item) : "-";
            const discWidth = fonts.regular.widthOfTextAtSize(discStr, fontSize);
            page.drawText(discStr, {
              x: colEndX - discWidth - cellPadding,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: item.discount ? textColor : mutedTextColor,
            });
            break;
          }

          case "total": {
            if (!config.showPricing) break;
            const totalStr = isItemized ? "-" : formatCurrency(item.lineTotal);
            const totalWidth = fonts.regular.widthOfTextAtSize(totalStr, fontSize);
            page.drawText(totalStr, {
              x: colEndX - totalWidth - cellPadding,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: textColor,
            });
            break;
          }

          case "assetTag": {
            // If per-unit sub-rows will render below this parent
            // (multi-quantity non-kit lines with showPerUnitCheckboxes
            // on), leave the parent cell blank — every tag is already
            // listed below, and cramming "TAG1, TAG2 +N" into the
            // parent is noisy. Single-asset rows + kits still render
            // their tag here.
            const willListUnitsBelow =
              config.showPerUnitCheckboxes && !isKit && item.quantity > 1;
            const tag = willListUnitsBelow ? "" : getAssetTag(item, isKit);
            if (tag) {
              page.drawText(tag, {
                x: cellX,
                y: textY,
                size: 8,
                font: fonts.courier,
                color: textColor,
              });
            }
            break;
          }

          case "category": {
            const cat = item.model?.category?.name || "-";
            page.drawText(cat, {
              x: cellX,
              y: textY,
              size: 8,
              font: fonts.regular,
              color: noteTextColor,
            });
            break;
          }

          case "condition": {
            // Draw 3 checkboxes: Good, Dmg, Missing
            let condX = cellX;
            const condSize = 7;
            for (const label of ["Good", "Dmg", "Missing"]) {
              drawCheckbox(page, pdfLib, condX, textY - 1, condSize, false);
              condX += condSize + 2;
              page.drawText(label, {
                x: condX,
                y: textY,
                size: 7,
                font: fonts.regular,
                color: textColor,
              });
              condX += fonts.regular.widthOfTextAtSize(label, 7) + 4;
            }
            break;
          }

          case "received": {
            // Draw single checkbox for received
            const rcvSize = 8;
            const rcvX = cellX + (col.width - rcvSize) / 2 - cellPadding;
            drawCheckbox(page, pdfLib, rcvX, textY - 1, rcvSize, false);
            break;
          }

          case "notes": {
            // Empty notes column for return sheet
            page.drawText(" ", {
              x: cellX,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: textColor,
            });
            break;
          }
        }

        cellX = colEndX;
        }

        currentY -= rowContentHeight;
      } // end if (!isContinuation)

      // === Per-unit checkboxes (packing list / docket / return-sheet) ===
      // Renders one sub-row per physical unit on a multi-quantity line,
      // labelled with the unit's actual asset tag (post-cutover, this is
      // the source of truth — `line.asset` is null on multi-quantity
      // serialised lines). Falls back to "Item - N" for legacy lines
      // that have no units yet.
      if (config.showPerUnitCheckboxes && !isKit && item.quantity > 1) {
        const shortName = item.model?.name || item.description || "Item";
        const checkedOut = item.checkedOutQuantity || 0;
        const units = item.units ?? [];
        // Skip already-rendered sub-items on continuation pages
        const subStart = (isFirstRenderedItem && startSubIndex > 0) ? startSubIndex : 0;
        for (let i = subStart; i < item.quantity; i++) {
          const puHeight = 10;
          if (currentY - puHeight < bottomBoundary) { overflow = true; break; }
          const puY = currentY - puHeight + 3;
          const indentX = tableX + 26;
          drawCheckbox(page, pdfLib, indentX, puY, 7, i < checkedOut);
          const unit = units[i];
          const tag =
            unit?.asset?.assetTag ??
            unit?.bulkAsset?.assetTag ??
            null;
          const label = tag
            ? `Unit ${i + 1} — ${tag}`
            : `${shortName} - ${i + 1}`;
          page.drawText(label, {
            x: indentX + 11,
            y: puY,
            size: 7,
            font: tag ? fonts.courier : fonts.regular,
            color: lightTextColor,
          });
          currentY -= puHeight;
        }
      }

      // === Kit children / Group members / Accessories ===
      // Same indented-children rendering for kit parents, synthetic Project
      // Group rows whose members were attached as childLineItems by
      // structureLineItems(), and serialised assets with permanent
      // accessories — all gated by the single `showKitChildren` knob.
      // Warehouse docs (packing-list/return-sheet/delivery-docket) leave it
      // on, so accessories still always render there (they're inseparable
      // from their parent for packing purposes). Client-facing docs
      // (quote/invoice) turn it off to keep the client's view to top-level
      // line items — see document-layouts.ts's `clientFacingTable`.
      if ((isKit || isGroupParent || isAccessoryParent) && config.showKitChildren) {
        let children = item.childLineItems || [];

        // Filter children by deployment status for return sheet / delivery docket
        if (config.filterByStatus) {
          children = children.filter(c => config.filterByStatus!.includes(c.status));
        }

        for (const child of children) {
          if (overflow) break;
          const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
          // A group member that is itself an accessory parent (no kitId, but
          // carries ACCESSORY children) — recurse into it so its accessories
          // render, e.g. an "IMX6A Headset" group member with a Micon adaptor.
          const childHasAccessories =
            !child.kitId && (child.childLineItems?.some((gc) => gc.childKind === "ACCESSORY") ?? false);
          const childName = child.model?.name || child.description || "-";
          const nestedChildren = child.childLineItems || [];

          // Child row
          const childRowHeight = childFontSize + rowPadding * 2;
          if (currentY - childRowHeight < bottomBoundary) { overflow = true; break; }
          page.drawLine({
            start: { x: tableX, y: currentY - childRowHeight },
            end: { x: tableX + layout.width, y: currentY - childRowHeight },
            thickness: 0.5,
            color: rowBorder,
          });

          let childCellX = tableX + cellPadding;
          const childTextY = currentY - rowPadding - childFontSize;

          for (const col of columns) {
            const colEndX = childCellX + col.width;

            switch (col.key) {
              case "checkbox": {
                const cbSize = config.documentType === "return-sheet" ? 6 : 7;
                const cbX = childCellX + (col.width - cbSize) / 2 - cellPadding;
                drawCheckbox(page, pdfLib, cbX, childTextY - 1, cbSize, child.status === "CHECKED_OUT");
                break;
              }

              case "rowNum":
                // No row number for children
                break;

              case "description": {
                const indent = 12;
                const displayName = isNestedKit ? `[Kit] ${childName}` : childName;
                const font = isNestedKit ? fonts.bold : fonts.regular;
                page.drawText(displayName, {
                  x: childCellX + indent,
                  y: childTextY,
                  size: childFontSize,
                  font,
                  color: childTextColor,
                });

                // Child badges
                if (config.showBadges && child.isOverbooked) {
                  const badgeStyle = child.overbookedReducedOnly ? BADGE_STYLES.reducedStock : BADGE_STYLES.overbooked;
                  const nameWidth = font.widthOfTextAtSize(displayName, childFontSize);
                  drawBadge(page, fonts, pdfLib, badgeStyle, childCellX + indent + nameWidth + 4, childTextY, badgeFontSize);
                }
                break;
              }

              case "qty": {
                const qtyStr = isNestedKit
                  ? String(nestedChildren.length)
                  : String(child.quantity);
                const qtyWidth = fonts.regular.widthOfTextAtSize(qtyStr, childFontSize);
                page.drawText(qtyStr, {
                  x: childCellX + (col.width - qtyWidth) / 2 - cellPadding,
                  y: childTextY,
                  size: childFontSize,
                  font: fonts.regular,
                  color: childTextColor,
                });
                break;
              }

              case "unitPrice": {
                if (!config.showPricing) break;
                const priceStr = child.unitPrice != null ? formatCurrency(child.unitPrice) : "-";
                const priceWidth = fonts.regular.widthOfTextAtSize(priceStr, childFontSize);
                page.drawText(priceStr, {
                  x: colEndX - priceWidth - cellPadding,
                  y: childTextY,
                  size: childFontSize,
                  font: fonts.regular,
                  color: childTextColor,
                });
                break;
              }

              case "discount": {
                if (!config.showPricing) break;
                const discStr = discountCellText(child);
                const discWidth = fonts.regular.widthOfTextAtSize(discStr, childFontSize);
                page.drawText(discStr, {
                  x: colEndX - discWidth - cellPadding,
                  y: childTextY,
                  size: childFontSize,
                  font: fonts.regular,
                  color: childTextColor,
                });
                break;
              }

              case "total": {
                if (!config.showPricing) break;
                const totalStr = formatCurrency(child.lineTotal);
                const totalWidth = fonts.regular.widthOfTextAtSize(totalStr, childFontSize);
                page.drawText(totalStr, {
                  x: colEndX - totalWidth - cellPadding,
                  y: childTextY,
                  size: childFontSize,
                  font: fonts.regular,
                  color: childTextColor,
                });
                break;
              }

              case "assetTag": {
                // Blank when per-unit sub-rows will list tags below
                // this kit child (same logic as top-level rows).
                const willListUnitsBelow =
                  config.showPerUnitCheckboxes &&
                  !isNestedKit &&
                  child.quantity > 1;
                const tag = willListUnitsBelow
                  ? ""
                  : isNestedKit
                    ? (child.kit?.assetTag || "-")
                    : getAssetTag(child, false);
                if (tag) {
                  page.drawText(tag, {
                    x: childCellX,
                    y: childTextY,
                    size: 7,
                    font: fonts.courier,
                    color: childTextColor,
                  });
                }
                break;
              }

              case "category": {
                page.drawText(child.model?.category?.name || "", {
                  x: childCellX,
                  y: childTextY,
                  size: 7,
                  font: fonts.regular,
                  color: hexToRgb("#aaaaaa", pdfLib),
                });
                break;
              }

              case "condition": {
                let condX = childCellX;
                for (const label of ["Good", "Dmg", "Missing"]) {
                  drawCheckbox(page, pdfLib, condX, childTextY - 1, 6, false);
                  condX += 8;
                  page.drawText(label, { x: condX, y: childTextY, size: 6, font: fonts.regular, color: textColor });
                  condX += fonts.regular.widthOfTextAtSize(label, 6) + 4;
                }
                break;
              }

              case "received": {
                drawCheckbox(page, pdfLib, childCellX + (col.width - 8) / 2 - cellPadding, childTextY - 1, 8, false);
                break;
              }
            }

            childCellX = colEndX;
          }

          currentY -= childRowHeight;

          // Per-unit checkboxes for child items (same unit-aware logic
          // as the top-level row).
          if (config.showPerUnitCheckboxes && !isNestedKit && child.quantity > 1) {
            const childCheckedOut = child.checkedOutQuantity || 0;
            const childUnits = child.units ?? [];
            for (let i = 0; i < child.quantity; i++) {
              const puHeight = 10;
              if (currentY - puHeight < bottomBoundary) { overflow = true; break; }
              const puY = currentY - puHeight + 3;
              const indentX = tableX + 38;
              drawCheckbox(page, pdfLib, indentX, puY, 7, i < childCheckedOut);
              const unit = childUnits[i];
              const tag = unit?.asset?.assetTag ?? unit?.bulkAsset?.assetTag ?? null;
              const label = tag
                ? `Unit ${i + 1} — ${tag}`
                : `${childName} - ${i + 1}`;
              page.drawText(label, {
                x: indentX + 11,
                y: puY,
                size: 7,
                font: tag ? fonts.courier : fonts.regular,
                color: lightTextColor,
              });
              currentY -= puHeight;
            }
          }

          // === Grandchildren (nested kit members) ===
          if (isNestedKit || childHasAccessories) {
            let grandchildren = nestedChildren;
            if (config.filterByStatus) {
              grandchildren = grandchildren.filter(gc => config.filterByStatus!.includes(gc.status));
            }

            for (const nested of grandchildren) {
              if (overflow) break;
              const nestedRowHeight = grandchildFontSize + rowPadding * 2;
              if (currentY - nestedRowHeight < bottomBoundary) { overflow = true; break; }
              page.drawLine({
                start: { x: tableX, y: currentY - nestedRowHeight },
                end: { x: tableX + layout.width, y: currentY - nestedRowHeight },
                thickness: 0.5,
                color: rowBorder,
              });

              let nestedCellX = tableX + cellPadding;
              const nestedTextY = currentY - rowPadding - grandchildFontSize;
              const nestedName = nested.model?.name || nested.description || "-";

              for (const col of columns) {
                const colEndX = nestedCellX + col.width;

                switch (col.key) {
                  case "checkbox": {
                    const cbSize = 6;
                    drawCheckbox(page, pdfLib, nestedCellX + (col.width - cbSize) / 2 - cellPadding, nestedTextY - 1, cbSize, nested.status === "CHECKED_OUT");
                    break;
                  }

                  case "description":
                    page.drawText(nestedName, {
                      x: nestedCellX + 24,
                      y: nestedTextY,
                      size: grandchildFontSize,
                      font: fonts.regular,
                      color: grandchildTextColor,
                    });
                    break;

                  case "qty": {
                    const qStr = String(nested.quantity);
                    const qW = fonts.regular.widthOfTextAtSize(qStr, grandchildFontSize);
                    page.drawText(qStr, {
                      x: nestedCellX + (col.width - qW) / 2 - cellPadding,
                      y: nestedTextY,
                      size: grandchildFontSize,
                      font: fonts.regular,
                      color: grandchildTextColor,
                    });
                    break;
                  }

                  case "unitPrice": {
                    if (!config.showPricing) break;
                    const pStr = nested.unitPrice != null ? formatCurrency(nested.unitPrice) : "-";
                    const pW = fonts.regular.widthOfTextAtSize(pStr, grandchildFontSize);
                    page.drawText(pStr, {
                      x: colEndX - pW - cellPadding,
                      y: nestedTextY,
                      size: grandchildFontSize,
                      font: fonts.regular,
                      color: grandchildTextColor,
                    });
                    break;
                  }

                  case "discount": {
                    if (!config.showPricing) break;
                    const dStr = discountCellText(nested);
                    const dW = fonts.regular.widthOfTextAtSize(dStr, grandchildFontSize);
                    page.drawText(dStr, {
                      x: colEndX - dW - cellPadding,
                      y: nestedTextY,
                      size: grandchildFontSize,
                      font: fonts.regular,
                      color: grandchildTextColor,
                    });
                    break;
                  }

                  case "total": {
                    if (!config.showPricing) break;
                    const tStr = formatCurrency(nested.lineTotal);
                    const tW = fonts.regular.widthOfTextAtSize(tStr, grandchildFontSize);
                    page.drawText(tStr, {
                      x: colEndX - tW - cellPadding,
                      y: nestedTextY,
                      size: grandchildFontSize,
                      font: fonts.regular,
                      color: grandchildTextColor,
                    });
                    break;
                  }

                  case "assetTag": {
                    // Nested-kit asset uses the same unit-aware logic.
                    const tag = getAssetTag(nested, false);
                    page.drawText(tag, {
                      x: nestedCellX,
                      y: nestedTextY,
                      size: 7,
                      font: fonts.courier,
                      color: grandchildTextColor,
                    });
                    break;
                  }

                  case "category":
                    page.drawText(nested.model?.category?.name || "", {
                      x: nestedCellX,
                      y: nestedTextY,
                      size: 7,
                      font: fonts.regular,
                      color: hexToRgb("#aaaaaa", pdfLib),
                    });
                    break;

                  case "condition": {
                    let condX = nestedCellX;
                    for (const label of ["Good", "Dmg", "Missing"]) {
                      drawCheckbox(page, pdfLib, condX, nestedTextY - 1, 6, false);
                      condX += 8;
                      page.drawText(label, { x: condX, y: nestedTextY, size: 6, font: fonts.regular, color: textColor });
                      condX += fonts.regular.widthOfTextAtSize(label, 6) + 4;
                    }
                    break;
                  }

                  case "received":
                    drawCheckbox(page, pdfLib, nestedCellX + (col.width - 8) / 2 - cellPadding, nestedTextY - 1, 8, false);
                    break;
                }

                nestedCellX = colEndX;
              }

              currentY -= nestedRowHeight;

              // Per-unit rows for an accessory grandchild. An accessory is just
              // an auto-added asset, so expand it per unit like a real asset row
              // (10 EW-DX each ship a battery → 10 battery lines to check off).
              if (config.showPerUnitCheckboxes && nested.childKind === "ACCESSORY" && nested.quantity > 1) {
                const nestedUnits = nested.units ?? [];
                const nestedCheckedOut = nested.checkedOutQuantity || 0;
                const nestedName = nested.model?.name || nested.description || "-";
                for (let i = 0; i < nested.quantity; i++) {
                  const puHeight = 10;
                  if (currentY - puHeight < bottomBoundary) { overflow = true; break; }
                  const puY = currentY - puHeight + 3;
                  const indentX = tableX + 50;
                  drawCheckbox(page, pdfLib, indentX, puY, 6, i < nestedCheckedOut);
                  const tag = nestedUnits[i]?.asset?.assetTag ?? nestedUnits[i]?.bulkAsset?.assetTag ?? null;
                  const label = tag ? `Unit ${i + 1} — ${tag}` : `${nestedName} - ${i + 1}`;
                  page.drawText(label, {
                    x: indentX + 10,
                    y: puY,
                    size: 6.5,
                    font: tag ? fonts.courier : fonts.regular,
                    color: grandchildTextColor,
                  });
                  currentY -= puHeight;
                }
              }
            }
          }
        }
      }

      isFirstRenderedItem = false;
    }
  }
}

// === Helper drawing functions ===

function drawTableHeader(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  pdfLib: typeof import("@pdfme/pdf-lib"),
  columns: ColumnDef[],
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: ReturnType<typeof import("@pdfme/pdf-lib").rgb>,
  borderColor: ReturnType<typeof import("@pdfme/pdf-lib").rgb>,
  fontSize: number
) {
  // Background
  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    color: bgColor,
  });

  // Bottom border
  page.drawLine({
    start: { x, y: y - height },
    end: { x: x + width, y: y - height },
    thickness: 1,
    color: borderColor,
  });

  // Header text
  const textColor = hexToRgb("#666666", pdfLib);
  let cellX = x + 6;
  const textY = y - height + 5;

  for (const col of columns) {
    if (col.key === "checkbox") {
      // Draw invisible header checkbox
      cellX += col.width;
      continue;
    }

    const label = col.label.toUpperCase();
    if (col.align === "right") {
      const tw = fonts.bold.widthOfTextAtSize(label, fontSize);
      page.drawText(label, {
        x: cellX + col.width - tw - 6,
        y: textY,
        size: fontSize,
        font: fonts.bold,
        color: textColor,
      });
    } else if (col.align === "center") {
      const tw = fonts.bold.widthOfTextAtSize(label, fontSize);
      page.drawText(label, {
        x: cellX + (col.width - tw) / 2 - 6,
        y: textY,
        size: fontSize,
        font: fonts.bold,
        color: textColor,
      });
    } else {
      page.drawText(label, {
        x: cellX,
        y: textY,
        size: fontSize,
        font: fonts.bold,
        color: textColor,
      });
    }

    cellX += col.width;
  }
}

function drawCheckbox(
  page: PDFPage,
  pdfLib: typeof import("@pdfme/pdf-lib"),
  x: number,
  y: number,
  size: number,
  checked: boolean
) {
  const borderColor = hexToRgb("#333333", pdfLib);

  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor,
    borderWidth: 0.75,
  });

  if (checked) {
    const lineColor = hexToRgb("#333333", pdfLib);
    page.drawLine({
      start: { x: x + size * 0.2, y: y + size * 0.5 },
      end: { x: x + size * 0.4, y: y + size * 0.2 },
      thickness: 1,
      color: lineColor,
    });
    page.drawLine({
      start: { x: x + size * 0.4, y: y + size * 0.2 },
      end: { x: x + size * 0.85, y: y + size * 0.75 },
      thickness: 1,
      color: lineColor,
    });
  }
}

function getBadges(item: DocumentLineItem, documentType?: string): typeof BADGE_STYLES[keyof typeof BADGE_STYLES][] {
  const badges: typeof BADGE_STYLES[keyof typeof BADGE_STYLES][] = [];

  // WS11 (#950) — SALE badge, quote/invoice included (no "/day" suffix — SALE
  // lines are always pricingType FLAT, whose label is already "flat").
  if (item.type === "SALE") {
    badges.push(BADGE_STYLES.sale);
  }

  if (item.isOptional) {
    badges.push(BADGE_STYLES.optional);
  }

  if (item.isOverbooked && item.overbookedHasOverbooked && item.overbookedHasReduced) {
    badges.push(BADGE_STYLES.overbooked);
    badges.push(BADGE_STYLES.reducedStock);
  } else if (item.isOverbooked) {
    if (item.overbookedReducedOnly) {
      badges.push(BADGE_STYLES.reducedStock);
    } else if (item.overbookedInherited) {
      badges.push(BADGE_STYLES.overbookedInherited);
    } else {
      badges.push(BADGE_STYLES.overbooked);
    }
  }

  // Internal docs (packing-list, return-sheet, delivery-docket) always show subhire badge
  // Client-facing docs (quote, invoice) only show when showSubhireOnDocs is true
  const isInternalDoc = documentType === "packing-list" || documentType === "return-sheet" || documentType === "delivery-docket";
  if (item.subHireId != null && (isInternalDoc || item.showSubhireOnDocs)) {
    badges.push(BADGE_STYLES.subhire);
  }

  return badges;
}

function drawBadge(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  pdfLib: typeof import("@pdfme/pdf-lib"),
  style: { bg: string; text: string; label: string },
  x: number,
  y: number,
  fontSize: number
): number {
  const padding = 3;
  const textWidth = fonts.bold.widthOfTextAtSize(style.label, fontSize);
  const badgeWidth = textWidth + padding * 2;
  const badgeHeight = fontSize + 2;

  // Background
  page.drawRectangle({
    x,
    y: y - 1,
    width: badgeWidth,
    height: badgeHeight,
    color: hexToRgb(style.bg, pdfLib),
    borderWidth: 0,
  });

  // Text
  page.drawText(style.label, {
    x: x + padding,
    y: y,
    size: fontSize,
    font: fonts.bold,
    color: hexToRgb(style.text, pdfLib),
  });

  return x + badgeWidth + 4; // Return next X position
}

function isChecked(item: DocumentLineItem, config: TablePluginConfig): boolean {
  if (config.documentType === "packing-list") {
    return item.status === "CHECKED_OUT";
  }
  return false;
}

const gearflowTable: Plugin<TableSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowTable",
    position: { x: 0, y: 0 },
    width: 170,
    height: 200,
  }),
};

export default gearflowTable;
