/**
 * The Equipment tab's Client view: the quote's own table model
 * (`buildLineItemsTableModel` with `QUOTE_TABLE_CONFIG`) mapped to the slim
 * shape the browser renders. Every cell is the PDF's own cell TEXT, produced
 * by the same functions `LineItemsTable` calls, so the view and the quote
 * cannot disagree about what prints (UX unification §13; R-3.1).
 *
 * Deliberately narrow: no asset, cost, margin or overbooking fields — only
 * what the client's document shows (R-8.12). Pure, so it is unit-tested
 * without a backend and shared by the server action and the parity test.
 */
import type { DocumentLineItem } from "@/lib/pdfme/types";
import {
  childItemName,
  childQtyText,
  priceGatedCellText,
  qtyCellText,
  type LineItemsTableModel,
  type TableModelChild,
  type TableModelConfig,
  type TableModelItemRow,
} from "@/lib/react-pdf/line-items-table-model";

export interface ClientViewChild {
  id: string;
  name: string;
  qty: string;
  /** Level 3: a disclosed member's own accessories, as the PDF prints them. */
  children: ClientViewChild[];
}

export interface ClientViewRow {
  id: string;
  name: string;
  /** `via Supplier · 3 days @ $50 · accessory of Kit`, the PDF's note lines. */
  subtitle: string | null;
  /** The line's notes, printed under it (markdown-lite source text). */
  notes: string | null;
  qty: string;
  unitPrice: string;
  discount: string;
  total: string;
  isOptional: boolean;
  /** Inside a rolled-up category: the money cells print blank. */
  priceHidden: boolean;
  /** Disclosed Project Group members (never kit members or accessories). */
  children: ClientViewChild[];
}

export interface ClientViewSection {
  key: string;
  /** `null` for the ungrouped bucket, which prints no header. */
  title: string | null;
  /** A rolled-up category's one price; `null` when itemised. */
  rollupAmount: number | null;
  rows: ClientViewRow[];
}

/** The quote's money, from the same source the quote prints its totals from. */
export interface ClientViewTotals {
  subtotal: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  total: number | null;
}

export interface EquipmentClientView {
  sections: ClientViewSection[];
  totals: ClientViewTotals;
}

function rowSubtitle(row: TableModelItemRow): string | null {
  const { item, display } = row;
  const parts = [
    display.showSubhire ? `via ${item.supplierName}` : "",
    display.breakdown,
    item.fromKitName ? `accessory of ${item.fromKitName}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function mapGrandchild(nested: DocumentLineItem): ClientViewChild {
  return { id: nested.id, name: childItemName(nested), qty: String(nested.quantity), children: [] };
}

function mapChild(entry: TableModelChild): ClientViewChild {
  return {
    id: entry.item.id,
    name: childItemName(entry.item),
    qty: childQtyText(entry),
    children: entry.grandchildren.map(mapGrandchild),
  };
}

function mapRow(row: TableModelItemRow, config: TableModelConfig): ClientViewRow {
  const { item, display } = row;
  const money = (key: "unitPrice" | "discount" | "total") => priceGatedCellText({ key }, item, config, display) ?? "";
  return {
    id: item.id,
    name: display.itemName,
    subtitle: rowSubtitle(row),
    notes: config.showNotes && item.notes ? item.notes : null,
    qty: qtyCellText(item, display.isKit, config),
    unitPrice: money("unitPrice"),
    discount: money("discount"),
    total: money("total"),
    isOptional: !!item.isOptional,
    priceHidden: !!item.priceHidden,
    children: (row.children ?? []).map(mapChild),
  };
}

/** The table model as the Client view's sections. Container bands never
 *  occur on a quote (it isn't `byContainer`); they're skipped, not mapped. */
export function toClientViewSections(model: LineItemsTableModel, config: TableModelConfig): ClientViewSection[] {
  return model.sections.map((section) => ({
    key: section.key,
    title: section.header?.name ?? null,
    rollupAmount: section.header?.rollupAmount ?? null,
    rows: section.rows.flatMap((r) => (r.kind === "item" ? [mapRow(r, config)] : [])),
  }));
}
