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
 * The decision logic (filtering/grouping, column layout, row display, cell
 * text, section headers, which children render) lives in the pure
 * `../line-items-table-model.ts`; this file renders the model it builds. The
 * names this file's tests and callers already import are re-exported below.
 * Badges, per-unit labels and the checkbox decision stay here: only the
 * renderer reads them.
 */
import type { ReactNode } from "react";
import { Text, View } from "@react-pdf/renderer";
import type { DocumentLineItem, TablePluginConfig, DocumentType } from "@/lib/pdfme/types";
import { formatCurrency } from "@/lib/pdfme/plugins/helpers";
import { discountCellText, isSubhireIndicatorVisible, getAssetTag } from "@/lib/pdfme/line-item-format";
import { COLORS, FONT_SIZE, CATEGORY_MUTED, BADGE_STYLES, lightenHex, type BadgeStyle } from "../styles";
import { ROLLUP_SUBTOTAL_LABEL } from "@/lib/category-pricing-display";
import {
  PRICING_COLUMN_KEYS,
  buildLineItemsTableModel,
  childItemName,
  childQtyText,
  priceGatedCellText,
  qtyCellText,
  type ColumnDef,
  type RowDisplay,
  type TableModelChild,
} from "../line-items-table-model";
import { RichText } from "./rich-text";
import { Checkbox } from "./checkbox";

export {
  filterAndGroupItems,
  deriveRowDisplay,
  qtyCellText,
  getColumnsForDocType,
  isKitParent,
  isGroupParentRow,
  isAccessoryParentRow,
  rollupAmountForBucket,
} from "../line-items-table-model";

const CONDITION_LABELS = ["Good", "Dmg", "Missing"] as const;

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

function GroupHeaderRow({
  name,
  docColor,
  rollupAmount,
}: {
  name: string;
  docColor: string;
  /** Category price rollup — the section's one price, already formatted. When
   *  set, the header becomes the only place this section's money appears; its
   *  rows print blank money cells. Labelled rather than bare, because a
   *  revealed row inside the section shows its own price and an unlabelled
   *  figure beside it would read as double counting
   *  (src/lib/category-pricing-display.ts). */
  rollupAmount?: string | null;
}) {
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
        flexDirection: "row",
        alignItems: "baseline",
      }}
    >
      <Text style={{ flexGrow: 1, fontSize: FONT_SIZE.base, fontFamily: "Helvetica-Bold", color: docColor }}>{name}</Text>
      {rollupAmount != null && (
        <Text style={{ fontSize: FONT_SIZE.base, fontFamily: "Helvetica-Bold", color: docColor }}>
          {`${ROLLUP_SUBTOTAL_LABEL}  ${rollupAmount}`}
        </Text>
      )}
    </View>
  );
}

/** `container.label (tag) — N items` — the container header band's title
 *  line. Split out of `ContainerHeaderRow` so the JSX stays a flat template
 *  (R-3.6). */
function containerHeaderTitle(item: DocumentLineItem): string {
  const tag = item.containerTag ? ` (${item.containerTag})` : "";
  const count = item.containerItemCount != null ? ` — ${item.containerItemCount} item${item.containerItemCount === 1 ? "" : "s"}` : "";
  return `${item.description ?? "Container"}${tag}${count}`;
}

/** #1296 build plan phase 3b — the manifest/docket/return-sheet container
 *  section header: a `structureLineItemsByContainer` synthetic row
 *  (`isContainerRow: true`), one per container (top-level or nested,
 *  indented by `containerDepth`). Replaces the generic `GroupHeaderRow` for
 *  `byContainer`-mode tables — see `TablePluginConfig.byContainer`'s doc
 *  comment for why the two aren't both drawn. */
function ContainerHeaderRow({
  item,
  docColor,
  showReturnCheckbox,
}: {
  item: DocumentLineItem;
  docColor: string;
  /** #1296 phase 3c (D10) — return-sheet's "case returned" box, top-level
   *  containers only (a nested tub returns with its parent case). */
  showReturnCheckbox?: boolean;
}) {
  const depth = item.containerDepth ?? 0;
  return (
    <View
      minPresenceAhead={17}
      wrap={false}
      style={{
        backgroundColor: depth === 0 ? lightenHex(docColor, 0.88) : lightenHex(docColor, 0.94),
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.headerBorder,
        borderBottomStyle: "solid",
        paddingVertical: "1.5mm",
        paddingHorizontal: "1.5mm",
        paddingLeft: `${1.5 + depth * 4}mm`,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View>
        <Text style={{ fontSize: FONT_SIZE.base, fontFamily: "Helvetica-Bold", color: docColor }}>
          {containerHeaderTitle(item)}
        </Text>
        {item.containerDescription && (
          <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.muted, marginTop: "0.5mm" }}>
            {item.containerDescription}
          </Text>
        )}
      </View>
      {showReturnCheckbox && depth === 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: "1.5mm" }}>
          <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.text }}>Case returned</Text>
          <Checkbox size={9} />
        </View>
      )}
    </View>
  );
}

/** Per-unit sub-rows print for checkbox docs AND tag-only docs (delivery docket). */
function listsUnits(config: TablePluginConfig): boolean {
  return config.showPerUnitCheckboxes || config.showPerUnitTags === true;
}

function PerUnitRow({
  unit,
  index,
  fallbackName,
  indent,
  size,
  checked,
  showCheckbox,
}: {
  unit: { asset: { assetTag: string } | null; bulkAsset: { assetTag: string } | null } | undefined;
  index: number;
  fallbackName: string;
  indent: `${number}mm`;
  size: number;
  checked: boolean;
  showCheckbox: boolean;
}) {
  const { label, tagged } = perUnitLabel(unit, index, fallbackName);
  return (
    <View wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingLeft: indent, paddingVertical: "0.6mm" }}>
      {showCheckbox && <Checkbox size={size} checked={checked} />}
      <Text style={{ fontSize: 7, fontFamily: tagged ? "Courier" : "Helvetica", color: COLORS.label, marginLeft: showCheckbox ? "1.5mm" : 0 }}>
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
      {item.fromKitName && (
        <Text style={{ fontSize: FONT_SIZE.note, color: COLORS.note, marginTop: "0.5mm" }}>accessory of {item.fromKitName}</Text>
      )}
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
      const willListUnitsBelow = listsUnits(config) && !display.isKit && item.quantity > 1;
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
  display,
  columns,
  config,
  altBg,
  rowNum,
}: {
  item: DocumentLineItem;
  display: RowDisplay;
  columns: ColumnDef[];
  config: TablePluginConfig;
  altBg: boolean;
  rowNum: number;
}) {
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
  const childName = childItemName(child);
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
  // Defensive: child rows only render on warehouse docs, which never set
  // `showPricing`, so a rolled-up child can't reach here today. Kept so a
  // future client-facing doc that DOES expand children can't leak a price the
  // section header has already rolled up.
  if (row.priceHidden) return renderBlankCell(col);
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

function renderChildCell(col: ColumnDef, entry: TableModelChild, config: TablePluginConfig) {
  const { item: child, isNestedKit } = entry;
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
          {childQtyText(entry)}
        </Cell>
      );
    case "assetTag": {
      const willListUnitsBelow = listsUnits(config) && !isNestedKit && child.quantity > 1;
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
    default:
      return null;
  }
}

function ChildRow({ entry, columns, config }: { entry: TableModelChild; columns: ColumnDef[]; config: TablePluginConfig }) {
  return (
    <View
      wrap={false}
      style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.border, borderBottomStyle: "solid", paddingVertical: "1.5mm" }}
    >
      {columns.map((col) => renderChildCell(col, entry, config))}
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
          <Text style={{ fontSize: FONT_SIZE.grandchild, color: COLORS.grandchildText }}>{childItemName(nested)}</Text>
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

/** `levelTwo` is the model's status-filtered level-2 rows and the level-3
 *  rows under each (`TableModelItemRow.children`). */
function ChildrenBlock({ levelTwo, columns, config }: { levelTwo: TableModelChild[]; columns: ColumnDef[]; config: TablePluginConfig }) {
  return (
    <>
      {levelTwo.map((entry) => {
        const { item: child, isNestedKit, grandchildren } = entry;
        const childName = childItemName(child);

        return (
          <View key={child.id}>
            <ChildRow entry={entry} columns={columns} config={config} />

            {listsUnits(config) && !isNestedKit && child.quantity > 1 && (
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
                    showCheckbox={config.showPerUnitCheckboxes}
                  />
                ))}
              </>
            )}

            {grandchildren.map((nested) => (
                <View key={nested.id}>
                  <GrandchildRow nested={nested} columns={columns} config={config} />
                  {listsUnits(config) && nested.childKind === "ACCESSORY" && nested.quantity > 1 && (
                    <>
                      {Array.from({ length: nested.quantity }, (_, i) => (
                        <PerUnitRow
                          key={i}
                          unit={(nested.units ?? [])[i]}
                          index={i}
                          fallbackName={childItemName(nested)}
                          indent="25mm"
                          size={6}
                          checked={i < (nested.checkedOutQuantity || 0)}
                          showCheckbox={config.showPerUnitCheckboxes}
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
  // Every decision (sections, headers, rollup price, row numbers, which
  // children render) comes from the pure model; this only draws it.
  const { columns, sections } = buildLineItemsTableModel(items, config);

  return (
    <View>
      <TableHeader columns={columns} />
      {sections.map((section) => (
        <View key={section.key}>
          {section.header && (
            <GroupHeaderRow
              name={section.header.name}
              docColor={docColor}
              rollupAmount={section.header.rollupAmount == null ? null : formatCurrency(section.header.rollupAmount)}
            />
          )}
          {section.rows.map((row) => {
            const item = row.item;
            if (row.kind === "container") {
              return (
                <ContainerHeaderRow
                  key={item.id}
                  item={item}
                  docColor={docColor}
                  showReturnCheckbox={config.showContainerReturnCheckbox}
                />
              );
            }
            const { display, rowNum: idx } = row;

            return (
              <View key={item.id}>
                <ItemRow item={item} display={display} columns={columns} config={config} altBg={idx % 2 === 0} rowNum={idx} />

                {listsUnits(config) && !display.isKit && item.quantity > 1 && (
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
                        showCheckbox={config.showPerUnitCheckboxes}
                      />
                    ))}
                  </>
                )}

                {row.children && <ChildrenBlock levelTwo={row.children} columns={columns} config={config} />}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
