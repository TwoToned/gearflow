/**
 * gearflowTable → react-pdf port (#1152). The full equipment/services table
 * for all 5 project doc types (quote, invoice, packing-list, return-sheet,
 * delivery-docket) — the shared component the #1151 spike's `LineItemsTable`
 * deliberately left unbuilt (it only exercised `clientFacingTable`'s
 * `showKitChildren: false` shape). This is the ~600-line kit/group/accessory
 * child+grandchild renderer, badges, checkboxes, condition columns, and
 * per-unit expansion gearflow-table.ts (`src/lib/pdfme/plugins/`) hand-rolls
 * with pdf-lib draw calls, expressed instead as nested `<View>`/`<Text>`.
 *
 * Structural pagination note (unchanged from the spike): NOTHING here
 * computes or reserves height by hand — no `calculateItemHeight`,
 * `calculatePartialFit`, or `calculateRemainingItemHeight` equivalent exists
 * anywhere in this file. The table header row is `fixed` but nested INSIDE
 * this component's own wrapping <View>, not at the <Page> level —
 * react-pdf's `fixed` repeats a node on every page produced by splitting ITS
 * OWN parent's children, so the header reprints on every page this table
 * spans and nowhere else. A group header row is an ordinary (non-fixed)
 * sibling, so it renders exactly once wherever it lands — the exact "don't
 * repeat a group header on a continuation page" behavior gearflow-table.ts
 * hand-rolls via `isContinuationOfEarlierPage` (2026-07-28) falls out of
 * react-pdf's default behavior for free. Orphan protection uses
 * `minPresenceAhead` instead of a hand-computed bounds check, and every
 * atomic row is `wrap={false}` so Yoga never splits a row's own content
 * across a page boundary.
 *
 * Pure decision logic (filtering/grouping/badges/column layout/cell text) is
 * factored into exported functions below, independent of any JSX — this is
 * what lets #1152's tests assert on structured data the same way
 * `gearflow-table.test.ts` does on captured draw calls, rather than needing
 * to parse rendered PDF bytes.
 */
import type { ReactNode } from "react";
import { Text, View } from "@react-pdf/renderer";
import type { DocumentLineItem, TablePluginConfig, DocumentType } from "@/lib/pdfme/types";
import { formatCurrency } from "@/lib/pdfme/plugins/helpers";
import { discountCellText, breakdownLabel, isSubhireIndicatorVisible, getAssetTag } from "@/lib/pdfme/plugins/gearflow-table";
import { COLORS, FONT_SIZE, CATEGORY_MUTED, BADGE_STYLES, lightenHex, type BadgeStyle } from "../styles";
import { RichText } from "./rich-text";
import { Checkbox } from "./checkbox";

const PRICING_LABELS: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  PER_HOUR: "/hr",
  FLAT: "flat",
  OPTIMIZED: "",
};

const PRICING_COLUMN_KEYS = new Set(["unitPrice", "discount", "total"]);
const CONDITION_LABELS = ["Good", "Dmg", "Missing"] as const;

// ─── Column layout ──────────────────────────────────────────────────────────

type ColumnKey =
  | "checkbox"
  | "rowNum"
  | "description"
  | "qty"
  | "unitPrice"
  | "discount"
  | "total"
  | "assetTag"
  | "category"
  | "condition"
  | "received"
  | "notes";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: `${number}%`;
  align: "left" | "center" | "right";
}

/** Column set per doc type — mirrors gearflow-table.ts's `getColumnsForDocType`.
 *  Widths are `%` of the table's own width (react-pdf supports percentage
 *  widths on flex children natively), chosen to preserve the same relative
 *  proportions as the original's pt-based fixed/flex widths against a
 *  ~516pt (182mm) reference content width — no hand-rolled `resolveFlexWidths`
 *  needed the way pdf-lib's pt-only schema forced. */
export function getColumnsForDocType(config: TablePluginConfig): ColumnDef[] {
  switch (config.documentType) {
    case "quote":
    case "invoice":
      return [
        { key: "description", label: "Description", width: "46%", align: "left" },
        { key: "qty", label: "Qty", width: "10%", align: "center" },
        { key: "unitPrice", label: config.documentType === "invoice" ? "Rate" : "Unit Price", width: "16%", align: "right" },
        { key: "discount", label: "Discount", width: "14%", align: "right" },
        { key: "total", label: config.documentType === "invoice" ? "Amount" : "Total", width: "14%", align: "right" },
      ];

    case "packing-list":
      return [
        { key: "checkbox", label: "", width: "4%", align: "center" },
        { key: "description", label: "Item", width: "61%", align: "left" },
        { key: "qty", label: "Qty", width: "6%", align: "center" },
        { key: "assetTag", label: "Asset Tag", width: "15%", align: "left" },
        { key: "category", label: "Category", width: "14%", align: "left" },
      ];

    case "return-sheet":
      return [
        { key: "checkbox", label: "Ret", width: "4%", align: "center" },
        { key: "description", label: "Item", width: "40%", align: "left" },
        { key: "qty", label: "Qty", width: "6%", align: "center" },
        { key: "assetTag", label: "Asset Tag", width: "15%", align: "left" },
        { key: "condition", label: "Condition", width: "16%", align: "center" },
        { key: "notes", label: "Notes", width: "19%", align: "left" },
      ];

    case "delivery-docket":
      return [
        { key: "rowNum", label: "#", width: "5%", align: "center" },
        { key: "description", label: "Description", width: "61%", align: "left" },
        { key: "qty", label: "Qty", width: "8%", align: "center" },
        { key: "assetTag", label: "Asset Tag", width: "15%", align: "left" },
        { key: "received", label: "Received", width: "11%", align: "center" },
      ];

    default:
      return [
        { key: "description", label: "Description", width: "76%", align: "left" },
        { key: "qty", label: "Qty", width: "24%", align: "center" },
      ];
  }
}

// ─── Filtering + grouping (pure — no JSX) ──────────────────────────────────

function isBulk(item: DocumentLineItem): boolean {
  return !!item.bulkAssetId || (!item.assetId && item.quantity > 1);
}

export function isKitParent(item: DocumentLineItem): boolean {
  return !!item.kitId && !item.isKitChild;
}

export function isGroupParentRow(item: DocumentLineItem): boolean {
  return !!item.isGroupRow && (item.childLineItems?.length ?? 0) > 0;
}

export function isAccessoryParentRow(item: DocumentLineItem): boolean {
  if (item.isKitChild || item.kitId || item.isGroupRow) return false;
  return item.childLineItems?.some((c) => c.childKind === "ACCESSORY") ?? false;
}

export interface GroupedTable {
  ungroupedKey: string;
  groups: Map<string, DocumentLineItem[]>;
}

/** Filter + group the raw line-item list exactly as gearflow-table.ts's
 *  `pdfRender` does before drawing — the SALE-line/bulk/status filtering,
 *  the doc-type-specific "ungrouped" bucket name, and delivery-docket's kit
 *  parent → CHECKED_OUT-children promotion into their own section. Pure so
 *  it's independently testable without rendering anything. */
export function filterAndGroupItems(items: DocumentLineItem[], config: TablePluginConfig): GroupedTable {
  let filtered = items.filter((i) => !i.isKitChild && !i.isContainerLineItem);

  if (config.filterOptional) {
    filtered = filtered.filter((i) => !i.isOptional);
  }

  if (config.filterByStatus) {
    const statuses = config.filterByStatus;
    // WS11 (#950) — SALE lines are goods handed over, never expected back:
    // excluded entirely from the return sheet (regardless of status), and
    // bypass the status filter everywhere else `filterByStatus` applies.
    const isReturnSheet = config.documentType === "return-sheet";
    filtered = filtered.filter((i) => {
      if (i.type === "SALE") return !isReturnSheet;
      if (isBulk(i)) return i.checkedOutQuantity > 0;
      // Synthetic Project Group row: its own status is meaningless (a
      // label, not a real line item) — pass through if ANY attached child
      // passes the filter, or the parent + all members silently drop.
      if (i.isGroupRow && (i.childLineItems?.length ?? 0) > 0) {
        return i.childLineItems!.some((c) => {
          if (c.type === "SALE") return !isReturnSheet;
          if (isBulk(c)) return c.checkedOutQuantity > 0;
          return statuses.includes(c.status);
        });
      }
      return statuses.includes(i.status);
    });
  }

  const ungroupedKey =
    config.documentType === "packing-list" ? "Ungrouped" : config.documentType === "delivery-docket" ? "General" : "_ungrouped";

  const groups = new Map<string, DocumentLineItem[]>();

  if (config.documentType === "delivery-docket") {
    // Kit parents promote their CHECKED_OUT children to be section rows
    // under the kit's name (client ticks each item off on receipt).
    // Non-kit items respect `groupName` like every other doc type.
    for (const item of filtered) {
      if (isKitParent(item)) {
        const kitName = item.kit?.name || item.description || "Kit";
        const children = (item.childLineItems || []).filter((c) => c.status === "CHECKED_OUT");
        if (children.length > 0) {
          const arr = groups.get(kitName) || [];
          arr.push(...children);
          groups.set(kitName, arr);
        }
      } else {
        const key = item.groupName || item.prepContainer || ungroupedKey;
        const arr = groups.get(key) || [];
        arr.push(item);
        groups.set(key, arr);
      }
    }
  } else {
    for (const item of filtered) {
      const key = item.groupName || item.prepContainer || ungroupedKey;
      const arr = groups.get(key) || [];
      arr.push(item);
      groups.set(key, arr);
    }
  }

  return { ungroupedKey, groups };
}

// ─── Row-kind / display derivation (pure) ──────────────────────────────────

function getItemName(item: DocumentLineItem, isKit: boolean): string {
  if (isKit) return item.description || item.kit?.name || "Kit";
  if (item.model) return item.model.modelNumber ? `${item.model.name} (${item.model.modelNumber})` : item.model.name;
  return item.description || "-";
}

export interface RowDisplay {
  isKit: boolean;
  isParentWithChildren: boolean;
  isItemized: boolean;
  bold: boolean;
  itemName: string;
  showSubhire: boolean;
  breakdown: string;
}

export function deriveRowDisplay(item: DocumentLineItem, config: TablePluginConfig): RowDisplay {
  const isKit = isKitParent(item);
  const isParentWithChildren = isKit || isGroupParentRow(item) || isAccessoryParentRow(item);
  return {
    isKit,
    isParentWithChildren,
    isItemized: isKit && item.pricingMode === "ITEMIZED",
    // Bold only when children will actually render below — otherwise
    // (showKitChildren off, e.g. quote/invoice) a bold row with nothing
    // under it just reads as unexplained emphasis (2026-07-28 fix).
    bold: isParentWithChildren && config.showKitChildren,
    itemName: getItemName(item, isKit),
    showSubhire: !!item.supplierName && isSubhireIndicatorVisible(item, config.documentType),
    breakdown: breakdownLabel(item, config),
  };
}

/** Badges for a top-level row — port of gearflow-table.ts's `getBadges`. */
export function getBadgesForItem(item: DocumentLineItem, documentType?: DocumentType): BadgeStyle[] {
  const badges: BadgeStyle[] = [];

  // WS11 (#950) — SALE badge, quote/invoice included (no "/day" suffix —
  // SALE lines are always pricingType FLAT, whose label is already "flat").
  if (item.type === "SALE") badges.push(BADGE_STYLES.sale);
  if (item.isOptional) badges.push(BADGE_STYLES.optional);

  if (item.isOverbooked && item.overbookedHasOverbooked && item.overbookedHasReduced) {
    badges.push(BADGE_STYLES.overbooked, BADGE_STYLES.reducedStock);
  } else if (item.isOverbooked) {
    if (item.overbookedReducedOnly) badges.push(BADGE_STYLES.reducedStock);
    else if (item.overbookedInherited) badges.push(BADGE_STYLES.overbookedInherited);
    else badges.push(BADGE_STYLES.overbooked);
  }

  if (isSubhireIndicatorVisible(item, documentType)) badges.push(BADGE_STYLES.subhire);

  return badges;
}

/** A kit/group child's own badge — only overbooked/reduced-stock ever shows
 *  at this tier (no optional/sale/subhire badges on children in the original). */
export function getChildBadge(child: DocumentLineItem): BadgeStyle | null {
  if (!child.isOverbooked) return null;
  return child.overbookedReducedOnly ? BADGE_STYLES.reducedStock : BADGE_STYLES.overbooked;
}

/** Qty cell text — port of gearflow-table.ts's inline qty-column switch,
 *  including the delivery-docket-specific kit/bulk branching. */
export function qtyCellText(item: DocumentLineItem, isKit: boolean, config: TablePluginConfig): string {
  if (isKit && config.showKitChildren) return String((item.childLineItems || []).length);
  if (config.documentType === "delivery-docket") {
    if (isKit) {
      const deployed = (item.childLineItems || []).filter((c) => c.status === "CHECKED_OUT");
      return String(deployed.length);
    }
    if (isBulk(item)) return String(item.checkedOutQuantity);
    return "1";
  }
  return String(item.quantity);
}

function priceCellText(item: DocumentLineItem, isItemized: boolean, hideSuffix: boolean | undefined): string {
  if (isItemized) return "-";
  if (item.unitPrice == null) return "-";
  const suffix = hideSuffix ? "" : PRICING_LABELS[item.pricingType] || "";
  return `${formatCurrency(item.unitPrice)}${suffix}`;
}

/** Text for the 3 pricing-gated columns, or null when `showPricing` is off
 *  (caller renders a blank cell). Shared by the parent-row switch so the
 *  pricing gate is checked once, not three times inline. */
function priceGatedCellText(col: ColumnDef, item: DocumentLineItem, config: TablePluginConfig, display: RowDisplay): string | null {
  if (!config.showPricing) return null;
  switch (col.key) {
    case "unitPrice":
      return priceCellText(item, display.isItemized, config.hidePricingPeriodSuffix);
    case "discount":
      return display.isItemized ? "-" : discountCellText(item);
    case "total":
      return display.isItemized ? "-" : formatCurrency(item.lineTotal);
    default:
      return null;
  }
}

export function isCheckedForDocType(item: DocumentLineItem, documentType?: DocumentType): boolean {
  return documentType === "packing-list" && item.status === "CHECKED_OUT";
}

/** Label for a per-unit checkbox sub-row — "Unit N — TAG" when the unit has
 *  a resolved asset tag, else a "{name} - N" fallback for legacy lines with
 *  no per-unit data yet. */
export function perUnitLabel(
  unit: { asset: { assetTag: string } | null; bulkAsset: { assetTag: string } | null } | undefined,
  index: number,
  fallbackName: string,
): { label: string; tagged: boolean } {
  const tag = unit?.asset?.assetTag ?? unit?.bulkAsset?.assetTag ?? null;
  return tag ? { label: `Unit ${index + 1} — ${tag}`, tagged: true } : { label: `${fallbackName} - ${index + 1}`, tagged: false };
}

// ─── Presentational primitives ─────────────────────────────────────────────

function Badge({ style }: { style: BadgeStyle }) {
  return (
    <View style={{ backgroundColor: style.bg, paddingHorizontal: "1mm", paddingVertical: "0.4mm", marginLeft: "1mm" }}>
      <Text style={{ fontSize: FONT_SIZE.badge, fontFamily: "Helvetica-Bold", color: style.text }}>{style.label}</Text>
    </View>
  );
}

function Cell({ col, color, fontSize, children }: { col: ColumnDef; color?: string; fontSize?: number; children: ReactNode }) {
  return (
    <View style={{ width: col.width, paddingHorizontal: "1.5mm" }}>
      <Text style={{ fontSize: fontSize ?? FONT_SIZE.base, color: color ?? COLORS.text, textAlign: col.align }}>{children}</Text>
    </View>
  );
}

function ConditionCell({ col, size, fontSize, color }: { col: ColumnDef; size: number; fontSize: number; color: string }) {
  return (
    <View style={{ width: col.width, flexDirection: "row", alignItems: "center", paddingHorizontal: "1.5mm" }}>
      {CONDITION_LABELS.map((label) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", marginRight: "1.5mm" }}>
          <Checkbox size={size} />
          <Text style={{ fontSize, color, marginLeft: "0.5mm" }}>{label}</Text>
        </View>
      ))}
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
          {c.label && (
            <Text style={{ fontSize: FONT_SIZE.headerLabel, fontFamily: "Helvetica-Bold", color: COLORS.label, textAlign: c.align }}>
              {c.label.toUpperCase()}
            </Text>
          )}
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

function PerUnitRow({
  unit,
  index,
  fallbackName,
  indent,
  size,
  checked,
}: {
  unit: { asset: { assetTag: string } | null; bulkAsset: { assetTag: string } | null } | undefined;
  index: number;
  fallbackName: string;
  indent: `${number}mm`;
  size: number;
  checked: boolean;
}) {
  const { label, tagged } = perUnitLabel(unit, index, fallbackName);
  return (
    <View wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingLeft: indent, paddingVertical: "0.6mm" }}>
      <Checkbox size={size} checked={checked} />
      <Text style={{ fontSize: 7, fontFamily: tagged ? "Courier" : "Helvetica", color: COLORS.label, marginLeft: "1.5mm" }}>
        {label}
      </Text>
    </View>
  );
}

// ─── Parent (top-level) row ─────────────────────────────────────────────────

function ParentDescriptionCell({
  col,
  item,
  config,
  display,
}: {
  col: ColumnDef;
  item: DocumentLineItem;
  config: TablePluginConfig;
  display: RowDisplay;
}) {
  // Kit prefix for packing list only. Group parents get bold but no prefix
  // — the category bucket already labels them.
  const displayName = config.documentType === "packing-list" && display.isKit ? `[Kit] ${display.itemName}` : display.itemName;
  const badges = config.showBadges ? getBadgesForItem(item, config.documentType) : [];

  return (
    <View style={{ width: col.width, paddingHorizontal: "1.5mm" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
        <Text style={{ fontSize: FONT_SIZE.base, fontFamily: display.bold ? "Helvetica-Bold" : "Helvetica", color: COLORS.text }}>
          {displayName}
        </Text>
        {badges.map((badge, i) => (
          <Badge key={`${badge.label}-${i}`} style={badge} />
        ))}
      </View>
      {display.showSubhire && (
        <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.note, marginTop: "0.5mm" }}>via {item.supplierName}</Text>
      )}
      {display.breakdown && <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.note, marginTop: "0.5mm" }}>{display.breakdown}</Text>}
      {item.notes && config.showNotes && <RichText text={item.notes} fontSize={FONT_SIZE.note} color={COLORS.note} />}
    </View>
  );
}

function renderParentCell(col: ColumnDef, item: DocumentLineItem, config: TablePluginConfig, display: RowDisplay) {
  switch (col.key) {
    case "checkbox":
      return renderCheckboxCell(col, 7, isCheckedForDocType(item, config.documentType));
    case "rowNum":
      // Row number is threaded in by the caller (LineItemsTable) since it
      // counts across ALL rendered top-level rows, not just this group —
      // see the `rowNum` prop on ItemRow.
      return null;
    case "description":
      return <ParentDescriptionCell key={col.key} col={col} item={item} config={config} display={display} />;
    case "qty":
      return (
        <Cell key={col.key} col={col}>
          {qtyCellText(item, display.isKit, config)}
        </Cell>
      );
    case "assetTag": {
      // Blank when per-unit sub-rows will list every tag below — cramming
      // "TAG1, TAG2 +N" into the parent too is noisy.
      const willListUnitsBelow = config.showPerUnitCheckboxes && !display.isKit && item.quantity > 1;
      const tag = willListUnitsBelow ? "" : getAssetTag(item, display.isKit);
      return (
        <Cell key={col.key} col={col} fontSize={8}>
          {tag}
        </Cell>
      );
    }
    case "category":
      return (
        <Cell key={col.key} col={col} fontSize={8} color={COLORS.note}>
          {item.model?.category?.name || "-"}
        </Cell>
      );
    case "condition":
      return <ConditionCell key={col.key} col={col} size={7} fontSize={7} color={COLORS.text} />;
    case "received":
      return renderCheckboxCell(col, 8, false);
    case "notes":
      return <Cell key={col.key} col={col}> </Cell>;
    default:
      if (PRICING_COLUMN_KEYS.has(col.key)) {
        const text = priceGatedCellText(col, item, config, display);
        return text == null ? (
          <View key={col.key} style={{ width: col.width }} />
        ) : (
          <Cell key={col.key} col={col} color={col.key === "discount" && !item.discount ? COLORS.muted : COLORS.text}>
            {text}
          </Cell>
        );
      }
      return null;
  }
}

function ItemRow({
  item,
  columns,
  config,
  altBg,
  rowNum,
}: {
  item: DocumentLineItem;
  columns: ColumnDef[];
  config: TablePluginConfig;
  altBg: boolean;
  rowNum: number;
}) {
  const display = deriveRowDisplay(item, config);

  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        backgroundColor: altBg ? COLORS.altRow : undefined,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
        borderBottomStyle: "solid",
        paddingVertical: "1.5mm",
      }}
    >
      {columns.map((col) =>
        col.key === "rowNum" ? (
          <Cell key={col.key} col={col} color={COLORS.muted}>
            {rowNum}
          </Cell>
        ) : (
          renderParentCell(col, item, config, display)
        ),
      )}
    </View>
  );
}

// ─── Kit / Group / Accessory children (level 2) ────────────────────────────

function ChildDescriptionCell({ col, child, isNestedKit }: { col: ColumnDef; child: DocumentLineItem; isNestedKit: boolean }) {
  const childName = child.model?.name || child.description || "-";
  const displayName = isNestedKit ? `[Kit] ${childName}` : childName;
  const badge = getChildBadge(child);

  return (
    <View style={{ width: col.width, paddingHorizontal: "1.5mm", paddingLeft: "13.5mm" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
        <Text style={{ fontSize: FONT_SIZE.child, fontFamily: isNestedKit ? "Helvetica-Bold" : "Helvetica", color: COLORS.childText }}>
          {displayName}
        </Text>
        {badge && <Badge style={badge} />}
      </View>
    </View>
  );
}

function renderBlankCell(col: ColumnDef) {
  return <View key={col.key} style={{ width: col.width }} />;
}

function renderCheckboxCell(col: ColumnDef, size: number, checked: boolean) {
  return (
    <View key={col.key} style={{ width: col.width, alignItems: "center" }}>
      <Checkbox size={size} checked={checked} />
    </View>
  );
}

/** unitPrice/discount/total for a child or grandchild row — identical shape
 *  at both tiers (only fontSize/color differ, threaded in by the caller),
 *  so this is the one place the `!config.showPricing` gate is checked for
 *  either tier instead of three times each. */
function renderTierPricingCell(col: ColumnDef, config: TablePluginConfig, fontSize: number, color: string, row: DocumentLineItem) {
  if (!config.showPricing) return renderBlankCell(col);
  const text =
    col.key === "unitPrice"
      ? row.unitPrice != null
        ? formatCurrency(row.unitPrice)
        : "-"
      : col.key === "discount"
        ? discountCellText(row)
        : formatCurrency(row.lineTotal);
  return (
    <Cell key={col.key} col={col} fontSize={fontSize} color={color}>
      {text}
    </Cell>
  );
}

function renderChildCell(col: ColumnDef, child: DocumentLineItem, config: TablePluginConfig, isNestedKit: boolean) {
  if (PRICING_COLUMN_KEYS.has(col.key)) {
    return renderTierPricingCell(col, config, FONT_SIZE.child, COLORS.childText, child);
  }
  switch (col.key) {
    case "checkbox":
      return renderCheckboxCell(col, config.documentType === "return-sheet" ? 6 : 7, child.status === "CHECKED_OUT");
    case "rowNum":
    case "notes":
      return renderBlankCell(col);
    case "description":
      return <ChildDescriptionCell key={col.key} col={col} child={child} isNestedKit={isNestedKit} />;
    case "qty":
      return (
        <Cell key={col.key} col={col} fontSize={FONT_SIZE.child} color={COLORS.childText}>
          {isNestedKit ? String((child.childLineItems || []).length) : String(child.quantity)}
        </Cell>
      );
    case "assetTag": {
      const willListUnitsBelow = config.showPerUnitCheckboxes && !isNestedKit && child.quantity > 1;
      const tag = willListUnitsBelow ? "" : isNestedKit ? child.kit?.assetTag || "-" : getAssetTag(child, false);
      return (
        <Cell key={col.key} col={col} fontSize={7} color={COLORS.childText}>
          {tag}
        </Cell>
      );
    }
    case "category":
      return (
        <Cell key={col.key} col={col} fontSize={7} color={CATEGORY_MUTED}>
          {child.model?.category?.name || ""}
        </Cell>
      );
    case "condition":
      return <ConditionCell key={col.key} col={col} size={6} fontSize={6} color={COLORS.text} />;
    case "received":
      return renderCheckboxCell(col, 8, false);
    default:
      return null;
  }
}

function ChildRow({ child, columns, config }: { child: DocumentLineItem; columns: ColumnDef[]; config: TablePluginConfig }) {
  const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
  return (
    <View
      wrap={false}
      style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.border, borderBottomStyle: "solid", paddingVertical: "1.5mm" }}
    >
      {columns.map((col) => renderChildCell(col, child, config, isNestedKit))}
    </View>
  );
}

// ─── Grandchildren (nested kit members / accessory-parent's own accessories) ──

function renderGrandchildCell(col: ColumnDef, nested: DocumentLineItem, config: TablePluginConfig) {
  if (PRICING_COLUMN_KEYS.has(col.key)) {
    return renderTierPricingCell(col, config, FONT_SIZE.grandchild, COLORS.grandchildText, nested);
  }
  switch (col.key) {
    case "checkbox":
      return renderCheckboxCell(col, 6, nested.status === "CHECKED_OUT");
    case "description":
      return (
        <View key={col.key} style={{ width: col.width, paddingHorizontal: "1.5mm", paddingLeft: "27mm" }}>
          <Text style={{ fontSize: FONT_SIZE.grandchild, color: COLORS.grandchildText }}>{nested.model?.name || nested.description || "-"}</Text>
        </View>
      );
    case "qty":
      return (
        <Cell key={col.key} col={col} fontSize={FONT_SIZE.grandchild} color={COLORS.grandchildText}>
          {String(nested.quantity)}
        </Cell>
      );
    case "assetTag":
      return (
        <Cell key={col.key} col={col} fontSize={7} color={COLORS.grandchildText}>
          {getAssetTag(nested, false)}
        </Cell>
      );
    case "category":
      return (
        <Cell key={col.key} col={col} fontSize={7} color={CATEGORY_MUTED}>
          {nested.model?.category?.name || ""}
        </Cell>
      );
    case "condition":
      return <ConditionCell key={col.key} col={col} size={6} fontSize={6} color={COLORS.text} />;
    case "received":
      return renderCheckboxCell(col, 8, false);
    case "rowNum":
    case "notes":
      return renderBlankCell(col);
    default:
      return null;
  }
}

function GrandchildRow({ nested, columns, config }: { nested: DocumentLineItem; columns: ColumnDef[]; config: TablePluginConfig }) {
  return (
    <View
      wrap={false}
      style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.border, borderBottomStyle: "solid", paddingVertical: "1.5mm" }}
    >
      {columns.map((col) => renderGrandchildCell(col, nested, config))}
    </View>
  );
}

// ─── Children block (level 2 + their per-unit rows + level 3) ─────────────

function ChildrenBlock({ item, columns, config }: { item: DocumentLineItem; columns: ColumnDef[]; config: TablePluginConfig }) {
  let children = item.childLineItems || [];
  if (config.filterByStatus) {
    children = children.filter((c) => config.filterByStatus!.includes(c.status));
  }

  return (
    <>
      {children.map((child) => {
        const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
        const childHasAccessories = !child.kitId && (child.childLineItems?.some((gc) => gc.childKind === "ACCESSORY") ?? false);
        const childName = child.model?.name || child.description || "-";

        let grandchildren = child.childLineItems || [];
        if (config.filterByStatus) {
          grandchildren = grandchildren.filter((gc) => config.filterByStatus!.includes(gc.status));
        }

        return (
          <View key={child.id}>
            <ChildRow child={child} columns={columns} config={config} />

            {config.showPerUnitCheckboxes && !isNestedKit && child.quantity > 1 && (
              <>
                {Array.from({ length: child.quantity }, (_, i) => (
                  <PerUnitRow
                    key={i}
                    unit={(child.units ?? [])[i]}
                    index={i}
                    fallbackName={childName}
                    indent="19mm"
                    size={7}
                    checked={i < (child.checkedOutQuantity || 0)}
                  />
                ))}
              </>
            )}

            {(isNestedKit || childHasAccessories) &&
              grandchildren.map((nested) => (
                <View key={nested.id}>
                  <GrandchildRow nested={nested} columns={columns} config={config} />
                  {config.showPerUnitCheckboxes && nested.childKind === "ACCESSORY" && nested.quantity > 1 && (
                    <>
                      {Array.from({ length: nested.quantity }, (_, i) => (
                        <PerUnitRow
                          key={i}
                          unit={(nested.units ?? [])[i]}
                          index={i}
                          fallbackName={nested.model?.name || nested.description || "-"}
                          indent="25mm"
                          size={6}
                          checked={i < (nested.checkedOutQuantity || 0)}
                        />
                      ))}
                    </>
                  )}
                </View>
              ))}
          </View>
        );
      })}
    </>
  );
}

// ─── Top-level export ───────────────────────────────────────────────────────

export function LineItemsTable({ items, config, docColor }: { items: DocumentLineItem[]; config: TablePluginConfig; docColor: string }) {
  const columns = getColumnsForDocType(config);
  const { ungroupedKey, groups } = filterAndGroupItems(items, config);

  let globalIdx = 0;

  return (
    <View>
      <TableHeader columns={columns} />
      {Array.from(groups.entries()).map(([groupName, groupItems]) => (
        <View key={groupName}>
          {groupName !== ungroupedKey && config.showGroupHeaders && <GroupHeaderRow name={groupName} docColor={docColor} />}
          {groupItems.map((item) => {
            globalIdx++;
            const idx = globalIdx;
            const display = deriveRowDisplay(item, config);
            const shouldRenderChildren = display.isParentWithChildren && config.showKitChildren;

            return (
              <View key={item.id}>
                <ItemRow item={item} columns={columns} config={config} altBg={idx % 2 === 0} rowNum={idx} />

                {config.showPerUnitCheckboxes && !display.isKit && item.quantity > 1 && (
                  <>
                    {Array.from({ length: item.quantity }, (_, i) => (
                      <PerUnitRow
                        key={i}
                        unit={(item.units ?? [])[i]}
                        index={i}
                        fallbackName={item.model?.name || item.description || "Item"}
                        indent="9mm"
                        size={7}
                        checked={i < (item.checkedOutQuantity || 0)}
                      />
                    ))}
                  </>
                )}

                {shouldRenderChildren && <ChildrenBlock item={item} columns={columns} config={config} />}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
