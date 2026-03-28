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
};

const BADGE_STYLES = {
  optional: { bg: "#fef3c7", text: "#92400e", label: "OPTIONAL" },
  overbooked: { bg: "#fee2e2", text: "#dc2626", label: "OVERBOOKED" },
  overbookedInherited: { bg: "#fef3c7", text: "#d97706", label: "OVERBOOKED" },
  reducedStock: { bg: "#ede9fe", text: "#7c3aed", label: "REDUCED STOCK" },
  subhire: { bg: "#cffafe", text: "#0891b2", label: "SUBHIRE" },
};

function getColumnsForDocType(config: TablePluginConfig, totalWidth: number): ColumnDef[] {
  switch (config.documentType) {
    case "quote":
    case "invoice":
      return resolveFlexWidths([
        { key: "description", label: "Description", width: 0, flex: 3, align: "left" },
        { key: "qty", label: "Qty", width: 30, align: "center" },
        { key: "unitPrice", label: config.documentType === "invoice" ? "Rate" : "Unit Price", width: 60, align: "right" },
        { key: "days", label: "Days", width: 30, align: "center" },
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

/** Get asset tag display */
function getAssetTag(item: DocumentLineItem, isKit: boolean): string {
  if (isKit) {
    return item.kit?.assetTag || "-";
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
    filteredItems = filteredItems.filter(i => {
      if (isBulk(i)) return i.checkedOutQuantity > 0;
      return statuses.includes(i.status);
    });
  }

  // === Group items by category (via groupName) falling back to prepContainer ===
  const ungroupedKey = config.documentType === "packing-list" ? "Ungrouped"
    : config.documentType === "delivery-docket" ? "General"
    : "_ungrouped";

  const groups = new Map<string, DocumentLineItem[]>();
  for (const item of filteredItems) {
    const key = item.groupName || item.prepContainer || ungroupedKey;
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
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
    const groupStartIdx = globalIdx + 1;
    const groupEndIdx = globalIdx + groupItems.length;
    const hasVisibleItems = groupEndIdx > startIndex;

    // Group header — only draw if this group has visible items on this page
    if (groupName !== ungroupedKey && config.showGroupHeaders && hasVisibleItems) {
      const ghHeight = fontSize + rowPadding * 2;
      if (currentY - ghHeight < bottomBoundary) { overflow = true; break; }
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
      const isItemized = isKit && item.pricingMode === "ITEMIZED";
      const itemName = getItemName(item, isKit);

      // Skip parent row when continuing a partial item from previous page
      const isContinuation = isFirstRenderedItem && startSubIndex > 0;

      if (!isContinuation) {
        // Calculate row content height
        const noteLineHeight = noteFontSize + 2;
        let rowContentHeight = fontSize + rowPadding * 2;
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

            // Kit prefix for packing list
            const displayName = (config.documentType === "packing-list" && isKit)
              ? `[Kit] ${itemName}`
              : itemName;

            const font = isKit ? fonts.bold : fonts.regular;
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
              const badges = getBadges(item);
              for (const badge of badges) {
                badgeX = drawBadge(page, fonts, pdfLib, badge, badgeX, textY, badgeFontSize);
              }
            }

            // Notes (with markdown support)
            if (item.notes && config.showNotes) {
              drawRichText(page, item.notes, {
                x: descX,
                y: textY - fontSize - 1,
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
                ? `${formatCurrency(item.unitPrice)}${PRICING_LABELS[item.pricingType] || ""}`
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

          case "days": {
            const dayStr = String(item.duration);
            const dayWidth = fonts.regular.widthOfTextAtSize(dayStr, fontSize);
            page.drawText(dayStr, {
              x: cellX + (col.width - dayWidth) / 2 - cellPadding,
              y: textY,
              size: fontSize,
              font: fonts.regular,
              color: textColor,
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
            const tag = getAssetTag(item, isKit);
            page.drawText(tag, {
              x: cellX,
              y: textY,
              size: 8,
              font: fonts.courier,
              color: textColor,
            });
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

      // === Per-unit checkboxes (packing list, qty > 1, non-kit) ===
      if (config.showPerUnitCheckboxes && !isKit && item.quantity > 1) {
        const shortName = item.model?.name || item.description || "Item";
        const checkedOut = item.checkedOutQuantity || 0;
        // Skip already-rendered sub-items on continuation pages
        const subStart = (isFirstRenderedItem && startSubIndex > 0) ? startSubIndex : 0;
        for (let i = subStart; i < item.quantity; i++) {
          const puHeight = 10;
          if (currentY - puHeight < bottomBoundary) { overflow = true; break; }
          const puY = currentY - puHeight + 3;
          const indentX = tableX + 26;
          drawCheckbox(page, pdfLib, indentX, puY, 7, i < checkedOut);
          page.drawText(`${shortName} - ${i + 1}`, {
            x: indentX + 11,
            y: puY,
            size: 7,
            font: fonts.regular,
            color: lightTextColor,
          });
          currentY -= puHeight;
        }
      }

      // === Kit children ===
      if (isKit && config.showKitChildren) {
        let children = item.childLineItems || [];

        // Filter children by deployment status for return sheet / delivery docket
        if (config.filterByStatus) {
          children = children.filter(c => config.filterByStatus!.includes(c.status));
        }

        for (const child of children) {
          if (overflow) break;
          const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
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
                  const badgeLabel = child.overbookedReducedOnly ? "REDUCED STOCK" : "OVERBOOKED";
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

              case "days": {
                const dayStr = String(child.duration);
                const dayWidth = fonts.regular.widthOfTextAtSize(dayStr, childFontSize);
                page.drawText(dayStr, {
                  x: childCellX + (col.width - dayWidth) / 2 - cellPadding,
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
                const tag = child.asset?.assetTag || child.bulkAsset?.assetTag
                  || (isNestedKit ? (child.kit?.assetTag || "-") : "-");
                page.drawText(tag, {
                  x: childCellX,
                  y: childTextY,
                  size: 7,
                  font: fonts.courier,
                  color: childTextColor,
                });
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

          // Per-unit checkboxes for child items
          if (config.showPerUnitCheckboxes && !isNestedKit && child.quantity > 1) {
            const childCheckedOut = child.checkedOutQuantity || 0;
            for (let i = 0; i < child.quantity; i++) {
              const puHeight = 10;
              if (currentY - puHeight < bottomBoundary) { overflow = true; break; }
              const puY = currentY - puHeight + 3;
              const indentX = tableX + 38;
              drawCheckbox(page, pdfLib, indentX, puY, 7, i < childCheckedOut);
              page.drawText(`${childName} - ${i + 1}`, {
                x: indentX + 11,
                y: puY,
                size: 7,
                font: fonts.regular,
                color: lightTextColor,
              });
              currentY -= puHeight;
            }
          }

          // === Grandchildren (nested kit members) ===
          if (isNestedKit) {
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

                  case "days": {
                    const dStr = String(nested.duration);
                    const dW = fonts.regular.widthOfTextAtSize(dStr, grandchildFontSize);
                    page.drawText(dStr, {
                      x: nestedCellX + (col.width - dW) / 2 - cellPadding,
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
                    const tag = nested.asset?.assetTag || nested.bulkAsset?.assetTag || "-";
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

function getBadges(item: DocumentLineItem): typeof BADGE_STYLES[keyof typeof BADGE_STYLES][] {
  const badges: typeof BADGE_STYLES[keyof typeof BADGE_STYLES][] = [];

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

  if (item.isSubhire && item.showSubhireOnDocs) {
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
