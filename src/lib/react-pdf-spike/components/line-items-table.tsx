/**
 * #1151 spike — the equipment/services table for CLIENT-FACING docs (quote,
 * invoice): `clientFacingTable` (document-layouts.ts) turns `showKitChildren`
 * and `showBadges` off, so a kit/Project-Group/accessory parent collapses to
 * its OWN row with no indented children underneath — the "not kit/group
 * child expansion" scope note in #1151. Porting the full ~600-line
 * kit/group/accessory child+grandchild renderer from gearflow-table.ts is
 * explicitly OUT of scope here; it's invisible on quote/invoice and only
 * matters for issue #4 (packing-list/return-sheet/delivery-docket, which run
 * `defaultTable`'s `showKitChildren: true`). See the findings doc's LOC
 * comparison for why that matters to the issue 2-4 effort estimate.
 *
 * Structural pagination note: NOTHING here computes or reserves height by
 * hand. The table header row is `fixed` but nested INSIDE this component's
 * own wrapping <View>, not at the <Page> level — react-pdf's `fixed` repeats
 * a node on every page produced by splitting ITS OWN parent's children (see
 * @react-pdf/layout's `splitNodes`), so the header reprints on every page
 * this table spans and nowhere else (not on the totals/notes/T&Cs pages that
 * follow). A group header row is an ordinary (non-fixed) sibling, so it
 * renders exactly once, wherever it lands — the exact "don't repeat a group
 * header on a continuation page" behavior gearflow-table.ts hand-rolls via
 * `isContinuationOfEarlierPage` (document-composer.ts / gearflow-table.ts,
 * 2026-07-28) falls out of react-pdf's default behavior for free. Orphan
 * protection (never strand a group header alone at a page bottom) uses
 * `minPresenceAhead` instead of gearflow-table.ts's hand-computed
 * `currentY - (ghHeight + minBodyRowHeight) < bottomBoundary` check.
 */
import type { ReactNode } from "react";
import { Text, View } from "@react-pdf/renderer";
import type { DocumentLineItem, TablePluginConfig } from "@/lib/pdfme/types";
import { formatCurrency } from "@/lib/pdfme/plugins/helpers";
import { discountCellText, breakdownLabel, isSubhireIndicatorVisible } from "@/lib/pdfme/plugins/gearflow-table";
import { COLORS, FONT_SIZE, lightenHex } from "../styles";
import { RichText } from "./rich-text";

const PRICING_LABELS: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  PER_HOUR: "/hr",
  FLAT: "flat",
  OPTIMIZED: "",
};

interface ColumnDef {
  key: "description" | "qty" | "unitPrice" | "discount" | "total";
  label: string;
  width: string;
  align: "left" | "center" | "right";
}

/** Column set for quote/invoice — mirrors gearflow-table.ts's
 *  `getColumnsForDocType` quote/invoice case. Widths are `%` (react-pdf
 *  supports percentage widths on flex children natively — no hand-rolled
 *  `resolveFlexWidths` needed the way pdf-lib's pt-only schema forced). */
function getColumns(isInvoice: boolean): ColumnDef[] {
  return [
    { key: "description", label: "Description", width: "46%", align: "left" },
    { key: "qty", label: "Qty", width: "10%", align: "center" },
    { key: "unitPrice", label: isInvoice ? "Rate" : "Unit Price", width: "16%", align: "right" },
    { key: "discount", label: "Discount", width: "14%", align: "right" },
    { key: "total", label: isInvoice ? "Amount" : "Total", width: "14%", align: "right" },
  ];
}

function Cell({ col, children }: { col: ColumnDef; children: ReactNode }) {
  return (
    <View style={{ width: col.width, paddingHorizontal: "1.5mm" }}>
      <Text style={{ fontSize: FONT_SIZE.base, color: COLORS.text, textAlign: col.align }}>{children}</Text>
    </View>
  );
}

function TableHeader({ columns }: { columns: ColumnDef[] }) {
  return (
    <View
      fixed
      style={{
        flexDirection: "row",
        backgroundColor: COLORS.headerBg,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.headerBorder,
        borderBottomStyle: "solid",
        paddingVertical: "1.5mm",
      }}
    >
      {columns.map((c) => (
        <View key={c.key} style={{ width: c.width, paddingHorizontal: "1.5mm" }}>
          <Text style={{ fontSize: FONT_SIZE.headerLabel, fontFamily: "Helvetica-Bold", color: COLORS.label, textAlign: c.align }}>
            {c.label.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

function GroupHeaderRow({ name, docColor }: { name: string; docColor: string }) {
  return (
    <View
      // Reserve ~one item row's presence ahead so this header never strands
      // alone at the bottom of a page — the react-pdf equivalent of
      // gearflow-table.ts's hand-computed orphan-check bounds test.
      minPresenceAhead={17}
      wrap={false}
      style={{
        backgroundColor: lightenHex(docColor, 0.88),
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.headerBorder,
        borderBottomStyle: "solid",
        paddingVertical: "1.5mm",
        paddingHorizontal: "1.5mm",
      }}
    >
      <Text style={{ fontSize: FONT_SIZE.base, fontFamily: "Helvetica-Bold", color: docColor }}>{name}</Text>
    </View>
  );
}

function ItemRow({ item, columns, config, index }: { item: DocumentLineItem; columns: ColumnDef[]; config: TablePluginConfig; index: number }) {
  const isKit = !!item.kitId && !item.isKitChild;
  const isItemized = isKit && item.pricingMode === "ITEMIZED";
  const isGroupParent = !!item.isGroupRow && (item.childLineItems?.length ?? 0) > 0;
  const isAccessoryParent =
    !item.isKitChild && !item.kitId && !item.isGroupRow && (item.childLineItems?.some((c) => c.childKind === "ACCESSORY") ?? false);
  const isParentWithChildren = isKit || isGroupParent || isAccessoryParent;
  // Mirrors gearflow-table.ts: bold only when children will actually render
  // below — never true here since clientFacingTable.showKitChildren is off,
  // kept for parity with the shared logic when this component is reused by
  // a warehouse doc's config (issue #4).
  const bold = isParentWithChildren && config.showKitChildren;
  const itemName = item.model
    ? item.model.modelNumber
      ? `${item.model.name} (${item.model.modelNumber})`
      : item.model.name
    : item.description || "-";
  const showSubhire = !!item.supplierName && isSubhireIndicatorVisible(item, config.documentType);
  const breakdown = breakdownLabel(item, config);

  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        backgroundColor: index % 2 === 0 ? COLORS.altRow : undefined,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        borderBottomStyle: "solid",
        paddingVertical: "1.5mm",
      }}
    >
      {columns.map((col) => {
        switch (col.key) {
          case "description":
            return (
              <View key={col.key} style={{ width: col.width, paddingHorizontal: "1.5mm" }}>
                <Text style={{ fontSize: FONT_SIZE.base, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", color: COLORS.text }}>
                  {itemName}
                </Text>
                {showSubhire && (
                  <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.note, marginTop: "0.5mm" }}>via {item.supplierName}</Text>
                )}
                {breakdown && <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.note, marginTop: "0.5mm" }}>{breakdown}</Text>}
                {item.notes && config.showNotes && <RichText text={item.notes} fontSize={FONT_SIZE.note} color={COLORS.note} />}
              </View>
            );
          case "qty":
            return (
              <Cell key={col.key} col={col}>
                {isKit && config.showKitChildren ? String((item.childLineItems || []).length) : String(item.quantity)}
              </Cell>
            );
          case "unitPrice": {
            if (!config.showPricing) return <View key={col.key} style={{ width: col.width }} />;
            const priceStr = isItemized
              ? "-"
              : item.unitPrice != null
                ? `${formatCurrency(item.unitPrice)}${config.hidePricingPeriodSuffix ? "" : PRICING_LABELS[item.pricingType] || ""}`
                : "-";
            return <Cell key={col.key} col={col}>{priceStr}</Cell>;
          }
          case "discount":
            if (!config.showPricing) return <View key={col.key} style={{ width: col.width }} />;
            return <Cell key={col.key} col={col}>{!isItemized ? discountCellText(item) : "-"}</Cell>;
          case "total":
            if (!config.showPricing) return <View key={col.key} style={{ width: col.width }} />;
            return <Cell key={col.key} col={col}>{isItemized ? "-" : formatCurrency(item.lineTotal)}</Cell>;
          default:
            return null;
        }
      })}
    </View>
  );
}

export function LineItemsTable({ items, config, docColor }: { items: DocumentLineItem[]; config: TablePluginConfig; docColor: string }) {
  const columns = getColumns(config.documentType === "invoice");
  const ungroupedKey = "_ungrouped";

  const filtered = items.filter((i) => !i.isKitChild && !i.isContainerLineItem);
  const groups = new Map<string, DocumentLineItem[]>();
  for (const item of filtered) {
    const key = item.groupName || item.prepContainer || ungroupedKey;
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
  }

  let globalIdx = 0;

  return (
    <View>
      <TableHeader columns={columns} />
      {Array.from(groups.entries()).map(([groupName, groupItems]) => (
        <View key={groupName}>
          {groupName !== ungroupedKey && config.showGroupHeaders && <GroupHeaderRow name={groupName} docColor={docColor} />}
          {groupItems.map((item) => {
            const idx = globalIdx++;
            return <ItemRow key={item.id} item={item} columns={columns} config={config} index={idx} />;
          })}
        </View>
      ))}
    </View>
  );
}
