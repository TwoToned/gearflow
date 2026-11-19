/**
 * The decision layer of the project-document line-items table: which rows a
 * document shows, how they bucket into sections, what each section header
 * prints (including a rolled-up category's one price), which children render
 * under a parent, and the text of every money/qty cell.
 *
 * Pure: no `@react-pdf/renderer`, no JSX. `LineItemsTable`
 * (`components/line-items-table.tsx`) renders the model this module builds,
 * and the Equipment tab's Client view (`src/lib/equipment-client-view.ts`)
 * maps the SAME model for the quote config, so "the Client view matches the
 * quote PDF" holds by construction rather than by a second copy of these
 * rules (R-3.1, UX unification §13). Every function here was moved verbatim
 * out of `line-items-table.tsx`; that file re-exports the ones its tests and
 * callers already import from it.
 */
import type { DocumentLineItem, TablePluginConfig } from "@/lib/pdfme/types";
import { formatCurrency } from "@/lib/pdfme/plugins/helpers";
import { discountCellText, breakdownLabel, isSubhireIndicatorVisible } from "@/lib/pdfme/line-item-format";
import { rollupSubtotal } from "@/lib/category-pricing-display";

/** The table's config minus the document colour, which only the renderer
 *  reads. Every decision here takes this, so a caller with no colour (the
 *  Client view) can pass `QUOTE_TABLE_CONFIG` as it is. */
export type TableModelConfig = Omit<TablePluginConfig, "documentColor">;

/**
 * What the quote document shows — the ONE definition, spread by
 * `QuoteDocument` (which adds its colour) and read by the Equipment tab's
 * Client view. Client-facing: no kit/accessory children, no badges, no
 * per-unit rows, no "/day" suffix.
 */
export const QUOTE_TABLE_CONFIG = {
  documentType: "quote",
  showGroupHeaders: true,
  showKitChildren: false,
  showCheckboxes: false,
  showConditionColumns: false,
  showPricing: true,
  showBadges: false,
  showNotes: true,
  showPerUnitCheckboxes: false,
  showAssetTags: false,
  showCategories: false,
  showRowNumbers: false,
  filterOptional: false,
  filterByStatus: null,
  hidePricingPeriodSuffix: true,
} as const satisfies TableModelConfig;

const PRICING_LABELS: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  PER_HOUR: "/hr",
  FLAT: "flat",
  OPTIMIZED: "",
};

export const PRICING_COLUMN_KEYS = new Set(["unitPrice", "discount", "total"]);

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
export function getColumnsForDocType(config: TableModelConfig): ColumnDef[] {
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
      // #1296 phase 3c (D7) — itemised, container order, no per-row Received
      // checkbox (one signature covers the whole delivery).
      return [
        { key: "rowNum", label: "#", width: "6%", align: "center" },
        { key: "description", label: "Item", width: "58%", align: "left" },
        { key: "qty", label: "Qty", width: "10%", align: "center" },
        { key: "assetTag", label: "Asset Tag", width: "26%", align: "left" },
      ];

    case "manifest":
      // Reference only (Q10 — no ticks): description, qty, asset tags inline.
      // No checkbox column — the docket is the sign-off, not this document.
      return [
        { key: "description", label: "Item", width: "50%", align: "left" },
        { key: "qty", label: "Qty", width: "10%", align: "center" },
        { key: "assetTag", label: "Asset Tags", width: "25%", align: "left" },
        { key: "category", label: "Category", width: "15%", align: "left" },
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
 *  `pdfRender` does before drawing — the SALE-line/bulk/status filtering and
 *  the doc-type-specific "ungrouped" bucket name. A kit parent is grouped
 *  like any other row (by `groupName`/container bucket); it keeps its own
 *  row and its CHECKED_OUT children render indented below it via
 *  `ChildrenBlock` (D7 — delivery-docket used to promote a kit's children
 *  into their own section and drop the kit row; #1296 phase 3c dropped that
 *  special case so the docket agrees with the manifest/return-sheet, which
 *  never did this). Pure so it's independently testable without rendering
 *  anything. */
export function filterAndGroupItems(items: DocumentLineItem[], config: TableModelConfig): GroupedTable {
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
    const passesStatus = (i: DocumentLineItem): boolean => {
      if (i.type === "SALE") return !isReturnSheet;
      if (isBulk(i)) return i.checkedOutQuantity > 0;
      return statuses.includes(i.status);
    };
    // #1296 — a container header row's own `status` is a best-effort derived
    // summary (structure-line-items-by-container.ts), not authoritative for
    // filtering — same "meaningless own status" shape isGroupRow gets below.
    // It passes iff ANY real row sharing its section (groupName) passes.
    const passingContainerSections = new Set(
      items
        .filter((i) => !i.isContainerRow && !i.isKitChild && !i.isContainerLineItem && i.groupName && passesStatus(i))
        .map((i) => i.groupName as string),
    );
    filtered = filtered.filter((i) => {
      if (i.isContainerRow) return !!i.groupName && passingContainerSections.has(i.groupName);
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
      return passesStatus(i);
    });
  }

  const ungroupedKey =
    config.documentType === "packing-list" ? "Ungrouped" : config.documentType === "delivery-docket" ? "General" : "_ungrouped";

  const groups = new Map<string, DocumentLineItem[]>();

  for (const item of filtered) {
    const key = item.groupName || item.prepContainer || ungroupedKey;
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
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

export function deriveRowDisplay(item: DocumentLineItem, config: TableModelConfig): RowDisplay {
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

/** Qty cell text — port of gearflow-table.ts's inline qty-column switch,
 *  including the delivery-docket-specific kit/bulk branching. */
export function qtyCellText(item: DocumentLineItem, isKit: boolean, config: TableModelConfig): string {
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
export function priceGatedCellText(
  col: Pick<ColumnDef, "key">,
  item: DocumentLineItem,
  config: TableModelConfig,
  display: RowDisplay,
): string | null {
  if (!config.showPricing) return null;
  // Category price rollup: this row's money lives in its section header's one
  // subtotal instead (src/lib/category-pricing-display.ts). Blank, deliberately
  // NOT the "-" a missing value prints — an empty cell reads as "not shown
  // here", a dash reads as "nothing to charge".
  if (item.priceHidden && PRICING_COLUMN_KEYS.has(col.key)) return "";
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

/**
 * Category price rollup — the amount a section header prints, or `null` when
 * this bucket isn't a rolled-up category (or the document prints no money at
 * all, like every warehouse doc).
 *
 * Pure, and exported, so the arithmetic is testable without rendering a PDF.
 * The sum covers EVERY row the section displays, revealed rows included: the
 * header is the category's total, not the hidden remainder — which is exactly
 * why it prints with a label (see `GroupHeaderRow`).
 *
 * Reads the rollup marker off the rows rather than taking it as a separate
 * argument because `filterAndGroupItems` buckets by the section's display name
 * and keeps no category metadata of its own; `structureLineItems` stamps every
 * row in a rolled-up section, so any one of them answers the question.
 */
export function rollupAmountForBucket(items: DocumentLineItem[], config: TableModelConfig): number | null {
  if (!config.showPricing) return null;
  if (!items.some((i) => i.rollupCategory)) return null;
  return rollupSubtotal(items);
}

// ─── The table model (what LineItemsTable renders) ─────────────────────────

/** A level-2 row (kit member, disclosed group member, accessory) and the
 *  level-3 rows under it. */
export interface TableModelChild {
  item: DocumentLineItem;
  /** A kit nested inside a kit: its own members print below it. */
  isNestedKit: boolean;
  /** Level-3 rows (a nested kit's members, or this child's own accessories),
   *  status-filtered; empty when none render. */
  grandchildren: DocumentLineItem[];
}

/** A top-level item row and what renders under it. */
export interface TableModelItemRow {
  kind: "item";
  item: DocumentLineItem;
  display: RowDisplay;
  /** 1-based across every rendered top-level row of the table, not per section. */
  rowNum: number;
  /** The level-2 rows to render below (status-filtered), or `null` for none. */
  children: TableModelChild[] | null;
}

/** A child or grandchild row's printed name. */
export function childItemName(child: DocumentLineItem): string {
  return child.model?.name || child.description || "-";
}

/** A level-2 row's qty cell: a nested kit prints its member count. */
export function childQtyText(child: TableModelChild): string {
  return child.isNestedKit ? String((child.item.childLineItems || []).length) : String(child.item.quantity);
}

/** A `byContainer` container band (`isContainerRow`). */
export interface TableModelContainerRow {
  kind: "container";
  item: DocumentLineItem;
}

export interface TableModelSection {
  key: string;
  /** The section's plain header band, or `null` when it prints none. */
  header: { name: string; rollupAmount: number | null } | null;
  rows: Array<TableModelItemRow | TableModelContainerRow>;
}

export interface LineItemsTableModel {
  columns: ColumnDef[];
  sections: TableModelSection[];
}

/** A section prints the plain header band unless it is the ungrouped bucket,
 *  headers are off, or a top-level (depth 0) container row already carries
 *  its title (label/tag/count) — printing both would repeat it. A section
 *  with no such row (a flat category/kit bucket, or the "Loose" bucket)
 *  still gets the plain header. */
function sectionHeader(
  key: string,
  items: DocumentLineItem[],
  ungroupedKey: string,
  config: TableModelConfig,
): TableModelSection["header"] {
  if (key === ungroupedKey || !config.showGroupHeaders) return null;
  if (items.some((item) => item.isContainerRow && (item.containerDepth ?? 0) === 0)) return null;
  return { name: key, rollupAmount: rollupAmountForBucket(items, config) };
}

/** The level-2 rows under a parent, or `null` when none render.
 *
 *  `showKitChildren` exists to stop a CLIENT-facing doc exploding kits and
 *  accessories into sub-rows the client didn't ask for. A Project Group row
 *  is different: in collapse mode `structureLineItems` attaches ONLY the
 *  members the operator deliberately disclosed
 *  (src/lib/group-child-disclosure.ts), so the presence of children IS the
 *  intent — gating them behind `showKitChildren` would make the toggle
 *  silently do nothing on exactly the documents it exists for. */
function renderedChildren(item: DocumentLineItem, display: RowDisplay, config: TableModelConfig): TableModelChild[] | null {
  const shouldRenderChildren = display.isParentWithChildren && (config.showKitChildren || item.isGroupRow === true);
  if (!shouldRenderChildren) return null;
  return byStatus(item.childLineItems || [], config).map((child) => {
    const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
    const childHasAccessories = !child.kitId && (child.childLineItems?.some((gc) => gc.childKind === "ACCESSORY") ?? false);
    return {
      item: child,
      isNestedKit,
      grandchildren: isNestedKit || childHasAccessories ? byStatus(child.childLineItems || [], config) : [],
    };
  });
}

function byStatus(rows: DocumentLineItem[], config: TableModelConfig): DocumentLineItem[] {
  return config.filterByStatus ? rows.filter((r) => config.filterByStatus!.includes(r.status)) : rows;
}

/**
 * Every decision `LineItemsTable` makes, as data: the columns, the sections in
 * order, each section's header (and rolled-up price), each row's display
 * facts and running row number, and the children that render under it.
 */
export function buildLineItemsTableModel(items: DocumentLineItem[], config: TableModelConfig): LineItemsTableModel {
  const { ungroupedKey, groups } = filterAndGroupItems(items, config);
  let globalIdx = 0;
  const sections = Array.from(groups.entries()).map(([key, groupItems]): TableModelSection => ({
    key,
    header: sectionHeader(key, groupItems, ungroupedKey, config),
    rows: groupItems.map((item) => {
      if (item.isContainerRow) return { kind: "container", item };
      globalIdx++;
      const display = deriveRowDisplay(item, config);
      return { kind: "item", item, display, rowNum: globalIdx, children: renderedChildren(item, display, config) };
    }),
  }));
  return { columns: getColumnsForDocType(config), sections };
}
