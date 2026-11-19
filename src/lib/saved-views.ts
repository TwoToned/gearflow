import type { FilterValue } from "@/lib/table-utils";

/**
 * The slice of table state a saved view captures. Mirrors the persisted
 * subset of `useTablePreferences` (filters, sort, column visibility, page
 * size). Search text is intentionally NOT captured — it's an ephemeral
 * lookup, not part of a reusable view.
 */
export interface SavedViewConfig {
  filters?: Record<string, FilterValue>;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  columnVisibility?: Record<string, boolean>;
  pageSize?: number;
  /**
   * URL-state lists (Jobs, Assets): the list's query string. When present it IS the
   * view; the fields above are the legacy shape, converted on read.
   */
  query?: string;
}

/** A saved view as returned to the client (dates serialised to strings). */
export interface SavedTableView {
  id: string;
  tableId: string;
  name: string;
  config: SavedViewConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
