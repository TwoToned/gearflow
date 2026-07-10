"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  X,
  SlidersHorizontal,
  ListFilter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { FadeIn } from "@/components/ui/motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FilterValue, FilterType } from "@/lib/table-utils";
import type { SavedViewConfig } from "@/lib/saved-views";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SavedViewsMenu } from "@/components/ui/saved-views-menu";

// ─── Column Definition ──────────────────────────────────────────────

export interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

/**
 * The slot a column occupies in the mobile card layout (DESIGN.md §15 — mobile
 * uses card lists, not data tables).
 *
 * - `title`    — primary identifier, one per card
 * - `subtitle` — secondary line under the title, one per card
 * - `badge`    — status pill(s), right-aligned next to the title
 * - `meta`     — label/value pair in the 2-column meta grid (the default)
 * - `actions`  — trailing control (e.g. an overflow menu)
 * - `hidden`   — omitted from the card entirely
 *
 * If no column on a table declares a role, the first visible column becomes the
 * `title` and the rest become `meta`.
 */
export type MobileRole =
  | "title"
  | "subtitle"
  | "badge"
  | "meta"
  | "actions"
  | "hidden";

export interface ColumnDef<TData> {
  id: string;
  header: string;
  accessorKey?: string;
  cell?: (row: TData) => React.ReactNode;
  sortable?: boolean;
  sortKey?: string;
  filterable?: boolean;
  filterType?: FilterType;
  filterOptions?: FilterOption[];
  filterKey?: string;
  defaultVisible?: boolean;
  alwaysVisible?: boolean;
  /** Hides the column below this breakpoint in the desktop table. No effect on cards. */
  responsiveHide?: "sm" | "md" | "lg" | "xl";
  /** Slot this column occupies in the mobile card. See {@link MobileRole}. */
  mobile?: MobileRole;
  width?: number | string;
  minWidth?: number;
  align?: "left" | "center" | "right";
  className?: string;
}

// ─── Props ────────────────────────────────────────────────────────────

export interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  totalRows?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  onSortChange?: (field: string) => void;
  filters?: Record<string, FilterValue>;
  onFiltersChange?: (filters: Record<string, FilterValue>) => void;
  onFilterChange?: (key: string, value: FilterValue | undefined) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  columnVisibility?: Record<string, boolean>;
  onColumnVisibilityChange?: (vis: Record<string, boolean>) => void;
  onToggleColumnVisibility?: (columnId: string) => void;
  onResetPreferences?: () => void;
  enableColumnVisibility?: boolean;
  enableFiltering?: boolean;
  enableSearch?: boolean;
  enableRowSelection?: boolean;
  selectedRows?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyPreset?: string;
  toolbarActions?: React.ReactNode;
  toolbarPrefix?: React.ReactNode;
  /**
   * Renders a card list instead of the table below `md` (DESIGN.md §15).
   * Opt out only for genuinely grid-shaped data (matrices, calendars) where a
   * horizontally scrolling table reads better than cards.
   */
  mobileCards?: boolean;
  /** Enables the Saved Views menu in the toolbar (per-user, org-scoped presets). */
  savedViews?: {
    tableId: string;
    currentConfig: SavedViewConfig;
    applyConfig: (config: SavedViewConfig) => void;
  };
}

// ─── Get Value from Dot-Path ──────────────────────────────────────────

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── Responsive Hide Class ───────────────────────────────────────────

function getResponsiveClass(hide?: "sm" | "md" | "lg" | "xl"): string {
  switch (hide) {
    case "sm": return "hidden sm:table-cell";
    case "md": return "hidden md:table-cell";
    case "lg": return "hidden lg:table-cell";
    case "xl": return "hidden xl:table-cell";
    default: return "";
  }
}

// ─── Cell Rendering ───────────────────────────────────────────────────

/** Renders a column's content for a row, falling back to the accessor value. */
function renderCell<TData>(col: ColumnDef<TData>, row: TData): React.ReactNode {
  if (col.cell) return col.cell(row);
  const value = col.accessorKey ? getNestedValue(row, col.accessorKey) : undefined;
  return value != null ? String(value) : "—";
}

/**
 * True when a column has nothing to show for this row. Only decidable for
 * accessor-driven columns — a custom `cell` renderer is always rendered, since
 * we can't inspect the ReactNode it returns without rendering it.
 */
function isCellEmpty<TData>(col: ColumnDef<TData>, row: TData): boolean {
  if (col.cell) return false;
  if (!col.accessorKey) return true;
  const value = getNestedValue(row, col.accessorKey);
  return value == null || value === "";
}

// ─── Mobile Card Column Roles ─────────────────────────────────────────

interface MobileLayout<TData> {
  title?: ColumnDef<TData>;
  subtitle?: ColumnDef<TData>;
  badges: ColumnDef<TData>[];
  meta: ColumnDef<TData>[];
  actions: ColumnDef<TData>[];
}

/**
 * Sorts visible columns into mobile card slots. When no column declares a
 * `mobile` role, falls back to "first column is the title, rest are meta" so
 * that a table gets a usable card layout without any per-consumer annotation.
 */
function getMobileLayout<TData>(columns: ColumnDef<TData>[]): MobileLayout<TData> {
  const layout: MobileLayout<TData> = { badges: [], meta: [], actions: [] };
  if (columns.length === 0) return layout;

  if (!columns.some((c) => c.mobile)) {
    const [first, ...rest] = columns;
    return { ...layout, title: first, meta: rest };
  }

  for (const col of columns) {
    switch (col.mobile ?? "meta") {
      case "title":
        layout.title ??= col;
        break;
      case "subtitle":
        layout.subtitle ??= col;
        break;
      case "badge":
        layout.badges.push(col);
        break;
      case "actions":
        layout.actions.push(col);
        break;
      case "hidden":
        break;
      default:
        layout.meta.push(col);
    }
  }
  // A table that annotates only badges/meta still needs a headline.
  layout.title ??= layout.meta.shift();
  return layout;
}

// ─── Mobile Card List ─────────────────────────────────────────────────

function DataTableCards<TData>({
  data,
  columns,
  getRowId,
  onRowClick,
  enableRowSelection,
  selectedRows,
  onToggleRow,
}: {
  data: TData[];
  columns: ColumnDef<TData>[];
  getRowId: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  enableRowSelection: boolean;
  selectedRows?: Set<string>;
  onToggleRow: (id: string) => void;
}) {
  const layout = getMobileLayout(columns);

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((row) => {
        const rowId = getRowId(row);
        const isSelected = enableRowSelection && selectedRows?.has(rowId);
        const meta = layout.meta.filter((col) => !isCellEmpty(col, row));

        return (
          <li key={rowId}>
            <Card
              interactive={!!onRowClick}
              className={cn("p-4", isSelected && "bg-select")}
              // §15: full-row tap in card mode — the whole card is the target.
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              <div className="flex items-start gap-3">
                {enableRowSelection && (
                  <span
                    className="touch-target -m-2 flex items-center p-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected || false}
                      onCheckedChange={() => onToggleRow(rowId)}
                      aria-label="Select row"
                    />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {layout.title && (
                        <div className="font-display text-[15px] font-bold leading-tight tracking-tight">
                          {renderCell(layout.title, row)}
                        </div>
                      )}
                      {layout.subtitle && !isCellEmpty(layout.subtitle, row) && (
                        <div className="mt-0.5 text-[13.5px] text-muted">
                          {renderCell(layout.subtitle, row)}
                        </div>
                      )}
                    </div>
                    {layout.badges.length > 0 && (
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {layout.badges.map((col) => (
                          <React.Fragment key={col.id}>{renderCell(col, row)}</React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>

                  {meta.length > 0 && (
                    // §15: max 2 columns on mobile, never 3+.
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                      {meta.map((col) => (
                        <div key={col.id} className="min-w-0">
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
                            {col.header}
                          </dt>
                          <dd className="mt-0.5 truncate text-[13.5px] text-ink">
                            {renderCell(col, row)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                {layout.actions.length > 0 && (
                  <span
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {layout.actions.map((col) => (
                      <React.Fragment key={col.id}>{renderCell(col, row)}</React.Fragment>
                    ))}
                  </span>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Filter Popover ──────────────────────────────────────────────────

function FilterPopover({
  column,
  value,
  onChange,
}: {
  column: ColumnDef<unknown>;
  value: FilterValue | undefined;
  onChange: (value: FilterValue | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedValues = Array.isArray(value) ? value : [];
  const hasFilter = selectedValues.length > 0;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const options = column.filterOptions || [];
  const filteredOptions = filterSearch
    ? options.filter((o) => o.label.toLowerCase().includes(filterSearch.toLowerCase()))
    : options;

  function toggleOption(optValue: string) {
    const next = selectedValues.includes(optValue)
      ? selectedValues.filter((v) => v !== optValue)
      : [...selectedValues, optValue];
    onChange(next.length > 0 ? next : undefined);
  }

  function selectAll() {
    onChange(options.map((o) => o.value));
  }

  function clearAll() {
    onChange(undefined);
  }

  // Calculate position
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="line"
        size="sm"
        className={cn(
          "h-11 gap-1.5 text-xs sm:h-8",
          hasFilter && "border-primary/50 bg-primary/5 text-primary"
        )}
        onClick={() => setOpen(!open)}
      >
        <ListFilter className="h-3.5 w-3.5" />
        {column.header}
        {hasFilter && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-medium text-white">
            {selectedValues.length}
          </span>
        )}
      </Button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 w-56 rounded-lg border bg-popover p-2 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {options.length > 6 && (
              <Input
                placeholder="Search..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="mb-2 h-7 text-xs"
                autoFocus
              />
            )}
            <div className="flex items-center justify-between mb-1 px-1">
              <button
                type="button"
                className="text-[10px] text-muted hover:text-ink"
                onClick={selectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[10px] text-muted hover:text-ink"
                onClick={clearAll}
              >
                Clear
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredOptions.map((opt) => {
                const isChecked = selectedValues.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-elev sm:min-h-0"
                    onClick={() => toggleOption(opt.value)}
                  >
                    <div className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                      isChecked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                    )}>
                      {isChecked && <Check className="h-2.5 w-2.5" />}
                    </div>
                    {opt.color && (
                      <span className={cn("h-2 w-2 rounded-full shrink-0", opt.color)} />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
              {filteredOptions.length === 0 && (
                <p className="text-xs text-muted px-2 py-1">No options found</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Column Visibility Popover ────────────────────────────────────────

function ColumnVisibilityPopover<TData>({
  columns,
  visibility,
  onToggle,
  onReset,
}: {
  columns: ColumnDef<TData>[];
  visibility: Record<string, boolean>;
  onToggle: (columnId: string) => void;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const [pos, setPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [open]);

  function isVisible(col: ColumnDef<TData>): boolean {
    if (col.alwaysVisible) return true;
    if (visibility[col.id] !== undefined) return visibility[col.id];
    return col.defaultVisible !== false;
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="line"
        size="sm"
        className="h-11 gap-1.5 text-xs sm:h-8"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Columns
      </Button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50 w-52 rounded-lg border bg-popover p-2 shadow-lg"
            style={{ top: pos.top, right: pos.right }}
          >
            <p className="text-xs font-medium text-muted mb-1.5 px-1">Toggle columns</p>
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {columns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-elev sm:min-h-0",
                    col.alwaysVisible && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={col.alwaysVisible}
                  onClick={() => !col.alwaysVisible && onToggle(col.id)}
                >
                  <div className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                    isVisible(col) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                  )}>
                    {isVisible(col) && <Check className="h-2.5 w-2.5" />}
                  </div>
                  <span className="truncate">{col.header}</span>
                </button>
              ))}
            </div>
            {onReset && (
              <>
                <div className="my-1.5 h-px bg-border" />
                <button
                  type="button"
                  className="w-full text-xs text-muted hover:text-ink px-2 py-1 rounded hover:bg-elev text-left"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                >
                  Reset to default
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Filter Chips ─────────────────────────────────────────────────────

function FilterChips<TData>({
  columns,
  filters,
  onFilterChange,
  onClearAll,
}: {
  columns: ColumnDef<TData>[];
  filters: Record<string, FilterValue>;
  onFilterChange: (key: string, value: FilterValue | undefined) => void;
  onClearAll: () => void;
}) {
  const activeFilters = Object.entries(filters).filter(([, v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null;
  });

  if (activeFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeFilters.map(([key, value]) => {
        const col = columns.find((c) => c.id === key);
        if (!col) return null;
        const labels = Array.isArray(value)
          ? value
              .map((v) => col.filterOptions?.find((o) => o.value === v)?.label || v)
              .join(", ")
          : String(value);
        return (
          <span key={key} className="inline-flex items-center gap-1 rounded-full bg-paper-2 py-0.5 pl-2 pr-1 text-xs text-muted">
            <span className="font-medium text-ink">{col.header}:</span> {labels}
            <button
              type="button"
              className="ml-0.5 rounded-sm hover:bg-elev p-0.5"
              onClick={() => onFilterChange(key, undefined)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        className="text-xs text-muted hover:text-ink"
        onClick={onClearAll}
      >
        Clear all
      </button>
    </div>
  );
}

// ─── DataTable ────────────────────────────────────────────────────────

export function DataTable<TData>({
  data,
  columns,
  totalRows,
  page = 1,
  pageSize = 25,
  onPageChange,
  onPageSizeChange,
  sortField,
  sortDirection = "asc",
  onSortChange,
  filters = {},
  onFiltersChange,
  onFilterChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  columnVisibility = {},
  onColumnVisibilityChange,
  onToggleColumnVisibility,
  onResetPreferences,
  enableColumnVisibility = true,
  enableFiltering = true,
  enableSearch = true,
  enableRowSelection = false,
  selectedRows,
  onSelectionChange,
  getRowId = (row) => (row as Record<string, unknown>).id as string,
  onRowClick,
  isLoading = false,
  emptyTitle = "No results found",
  emptyDescription,
  emptyPreset,
  toolbarActions,
  toolbarPrefix,
  mobileCards = true,
  savedViews,
}: DataTableProps<TData>) {
  const filterableColumns = columns.filter((c) => c.filterable && c.filterType === "enum" && c.filterOptions);

  function isColumnVisible(col: ColumnDef<TData>): boolean {
    if (col.alwaysVisible) return true;
    if (columnVisibility[col.id] !== undefined) return columnVisibility[col.id];
    return col.defaultVisible !== false;
  }

  const visibleColumns = columns.filter((col) => isColumnVisible(col));

  function handleSort(key: string) {
    if (!onSortChange) return;
    onSortChange(key);
  }

  function handleFilterChange(key: string, value: FilterValue | undefined) {
    if (onFilterChange) {
      onFilterChange(key, value);
    } else if (onFiltersChange) {
      const next = { ...filters };
      if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        delete next[key];
      } else {
        next[key] = value;
      }
      onFiltersChange(next);
    }
  }

  function handleClearFilters() {
    if (onFiltersChange) onFiltersChange({});
    if (onFilterChange) {
      Object.keys(filters).forEach((k) => onFilterChange(k, undefined));
    }
  }

  // Row selection
  const allIds = data.map((row) => getRowId(row));
  const allSelected = enableRowSelection && selectedRows && allIds.length > 0 && allIds.every((id) => selectedRows.has(id));
  const someSelected = enableRowSelection && selectedRows && allIds.some((id) => selectedRows.has(id)) && !allSelected;

  function toggleSelectAll() {
    if (!onSelectionChange || !selectedRows) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
    }
  }

  function toggleSelectRow(id: string) {
    if (!onSelectionChange || !selectedRows) return;
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  const totalPages = totalRows ? Math.ceil(totalRows / pageSize) : 1;
  const colSpan = visibleColumns.length + (enableRowSelection ? 1 : 0);

  const hasActiveFilters = Object.keys(filters).some((k) => {
    const v = filters[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  });

  return (
    <FadeIn className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        {toolbarPrefix}
        {enableSearch && onSearchChange && (
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <Input
              placeholder={searchPlaceholder}
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
        {enableFiltering && filterableColumns.map((col) => (
          <FilterPopover
            key={col.id}
            column={col as ColumnDef<unknown>}
            value={filters[col.id]}
            onChange={(v) => handleFilterChange(col.id, v)}
          />
        ))}
        <div className="flex items-center gap-2 ml-auto">
          {enableColumnVisibility && onToggleColumnVisibility && (
            <ColumnVisibilityPopover
              columns={columns}
              visibility={columnVisibility}
              onToggle={onToggleColumnVisibility}
              onReset={onResetPreferences}
            />
          )}
          {savedViews && (
            <SavedViewsMenu
              tableId={savedViews.tableId}
              currentConfig={savedViews.currentConfig}
              applyConfig={savedViews.applyConfig}
              onResetPreferences={onResetPreferences}
            />
          )}
          {toolbarActions}
        </div>
      </div>

      {/* Active filter chips */}
      {enableFiltering && hasActiveFilters && (
        <FilterChips
          columns={columns}
          filters={filters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearFilters}
        />
      )}

      {/* Table (desktop). Below `md` this is display:none, so its contents are
          not announced to screen readers and the card list below takes over. */}
      <div className={cn("overflow-hidden", mobileCards && "hidden md:block")}>
        <Table>
          <TableHeader>
            <TableRow>
              {enableRowSelection && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={someSelected ? "indeterminate" : (allSelected || false)}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
              )}
              {visibleColumns.map((col) => {
                const isSortable = col.sortable !== false && (col.sortKey || col.accessorKey);
                const sortKey = col.sortKey || col.accessorKey || col.id;
                const isActive = sortField === sortKey;
                const responsiveClass = getResponsiveClass(col.responsiveHide);
                const alignClass = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "";

                return (
                  <TableHead
                    key={col.id}
                    className={cn(responsiveClass, alignClass, col.className)}
                    style={col.width ? { width: typeof col.width === "number" ? `${col.width}px` : col.width } : undefined}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(sortKey)}
                        className="inline-flex items-center gap-1 hover:text-ink transition-colors -ml-1 px-1 py-0.5 rounded"
                      >
                        {col.header}
                        {isActive ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, r) => (
                <TableRow key={r}>
                  {Array.from({ length: colSpan }).map((_, c) => (
                    <TableCell key={c}>
                      <Skeleton className="h-3.5 rounded" style={{ width: `${50 + ((r * 7 + c * 13) % 60)}px` }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-auto border-0">
                  <EmptyState
                    title={emptyTitle ?? "Nothing here yet"}
                    description={emptyDescription}
                  />
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => {
                const rowId = getRowId(row);
                const isSelected = enableRowSelection && selectedRows?.has(rowId);
                return (
                  <TableRow
                    key={rowId}
                    className={cn(
                      // RVLT row hover. The left-edge red bar lives on the FIRST CELL,
                      // NOT a ::before on the <tr> — a pseudo-element on a table-row gets
                      // wrapped in an anonymous table-cell by the browser, which adds a
                      // phantom leading cell and shifts every column right by one.
                      "group/row transition-colors",
                      "[&>td:first-child]:relative [&>td:first-child]:before:pointer-events-none [&>td:first-child]:before:absolute [&>td:first-child]:before:inset-y-0 [&>td:first-child]:before:left-0 [&>td:first-child]:before:w-0.5 [&>td:first-child]:before:rounded-full [&>td:first-child]:before:bg-red [&>td:first-child]:before:opacity-0 [&>td:first-child]:before:transition-opacity hover:[&>td:first-child]:before:opacity-100",
                      onRowClick && "cursor-pointer",
                      isSelected && "bg-select",
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {enableRowSelection && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected || false}
                          onCheckedChange={() => toggleSelectRow(rowId)}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.map((col) => {
                      const responsiveClass = getResponsiveClass(col.responsiveHide);
                      const alignClass = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "";
                      const value = col.accessorKey
                        ? getNestedValue(row, col.accessorKey)
                        : undefined;

                      return (
                        <TableCell
                          key={col.id}
                          className={cn(responsiveClass, alignClass, col.className)}
                          style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                        >
                          {col.cell ? col.cell(row) : (value != null ? String(value) : "—")}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Card list (mobile) — DESIGN.md §15: mobile uses card lists, not tables. */}
      {mobileCards && (
        <div className="md:hidden">
          {isLoading ? (
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 5 }).map((_, r) => (
                <Card key={r} className="space-y-3 p-4">
                  <Skeleton className="h-4 w-1/2 rounded" />
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-3 w-3/4 rounded" />
                    <Skeleton className="h-3 w-2/3 rounded" />
                  </div>
                </Card>
              ))}
            </div>
          ) : data.length === 0 ? (
            <EmptyState
              title={emptyTitle ?? "Nothing here yet"}
              description={emptyDescription}
            />
          ) : (
            <DataTableCards
              data={data}
              columns={visibleColumns}
              getRowId={getRowId}
              onRowClick={onRowClick}
              enableRowSelection={!!enableRowSelection}
              selectedRows={selectedRows}
              onToggleRow={toggleSelectRow}
            />
          )}
        </div>
      )}

      {/* Pagination */}
      {(onPageChange || onPageSizeChange) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            {onPageSizeChange && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  aria-label="Rows per page"
                  className="flex h-11 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-8"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="text-sm text-muted">per page</span>
              </div>
            )}
            <p className="text-sm text-muted">
              Page {page} of {totalPages} ({totalRows ?? data.length} total)
            </p>
          </div>
          {onPageChange && (
            <div className="flex gap-2">
              <Button
                variant="line"
                size="sm"
                className="h-11 flex-1 sm:h-8 sm:flex-none"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="line"
                size="sm"
                className="h-11 flex-1 sm:h-8 sm:flex-none"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </FadeIn>
  );
}
