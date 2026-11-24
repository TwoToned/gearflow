/**
 * The Sales stock list as data (UX unification §9g, Phase 14, D41). Pure. The stock figures are
 * derived on the server by `convex/lib/saleStockFacts.ts`; this module only names and prints them.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, RowFlag } from "@/lib/primitives/types";

const SEGMENT_DEFS = [
  { key: "all", label: "All" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
] as const;

export const SALES_STOCK_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["cat"],
  sorts: ["name", "category", "available", "salePrice", "reorderLevel"],
  defaultSort: "available:asc",
};

export function salesStockSegments(counts: Record<string, number> | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));
}

export function salesStockFilters(categories: { id: string; name: string }[]): ListFilterDef[] {
  return [{ key: "cat", label: "Category", options: categories.map((c) => ({ value: c.id, label: c.name })) }];
}

export const SALES_STOCK_ITEM_HEADER = "Item";
export const SALES_STOCK_ITEM_SORT_KEY = "name";

export const SALES_STOCK_COLUMNS: FactColumn[] = [
  { id: "onHand", header: "On hand", align: "end" },
  { id: "reserved", header: "Reserved", align: "end" },
  { id: "available", header: "Available", align: "end", sortKey: "available" },
  { id: "reorderAt", header: "Reorder at", align: "end", sortKey: "reorderLevel" },
  { id: "price", header: "Price", align: "end", sortKey: "salePrice" },
];

export function salesStockQueryArgs(state: ListUrlState) {
  return {
    search: state.q.trim() || undefined,
    categoryIdIn: state.filters.cat?.length ? state.filters.cat : undefined,
    segment: state.seg === "all" ? undefined : state.seg,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

export interface SaleStockSource {
  id: string;
  name: string;
  manufacturer?: string | null;
  sku?: string | null;
  salePrice?: number | null;
  reorderLevel?: number | null;
  category?: { name: string } | null;
  onHand: number;
  reserved: number;
  available: number;
  state: "OK" | "LOW" | "OUT";
}

/** `Out of stock` / `Low stock` print inline after the name as dot-words; an oversold pool says so. */
export function saleStockFlags(s: Pick<SaleStockSource, "state" | "available">): RowFlag[] {
  if (s.state === "OUT") return [{ label: s.available < 0 ? `Oversold ${-s.available}` : "Out of stock", tone: "error" }];
  if (s.state === "LOW") return [{ label: "Low stock", tone: "warning" }];
  return [];
}

export function saleStockRowOf(s: SaleStockSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = {
    onHand: { kind: "qty", value: s.onHand },
    reserved: { kind: "qty", value: s.reserved },
    available: { kind: "qty", value: s.available },
    reorderAt: s.reorderLevel != null ? { kind: "qty", value: s.reorderLevel } : { kind: "text", label: "—" },
    price: { kind: "money", amount: s.salePrice ?? null },
  };
  return {
    id: s.id,
    kind: "sale",
    title: s.name,
    subtitle: [s.sku, s.category?.name].filter(Boolean).join(" · ") || undefined,
    flags: saleStockFlags(s),
    facts,
    menu,
  };
}
