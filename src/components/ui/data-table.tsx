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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FilterValue, FilterType } from "@/lib/table-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

// ─── Column Definition ──────────────────────────────────────────────

export interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

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
  responsiveHide?: "sm" | "md" | "lg" | "xl";
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
        variant="outline"
        size="sm"
        className={cn(
          "h-8 gap-1.5 text-xs",
          hasFilter && "border-primary/50 bg-primary/5 text-primary"
        )}
        onClick={() => setOpen(!open)}
      >
        <ListFilter className="h-3.5 w-3.5" />
        {column.header}
        {hasFilter && (
          <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">
            {selectedValues.length}
          </Badge>
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
                className="text-[10px] text-fg-3 hover:text-fg"
                onClick={selectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[10px] text-fg-3 hover:text-fg"
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
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
                <p className="text-xs text-fg-3 px-2 py-1">No options found</p>
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
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
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
            <p className="text-xs font-medium text-fg-3 mb-1.5 px-1">Toggle columns</p>
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {columns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent",
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
                  className="w-full text-xs text-fg-3 hover:text-fg px-2 py-1 rounded hover:bg-accent text-left"
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
          <Badge key={key} variant="secondary" className="gap-1 text-xs pl-2 pr-1">
            <span className="font-medium">{col.header}:</span> {labels}
            <button
              type="button"
              className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
              onClick={() => onFilterChange(key, undefined)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
      <button
        type="button"
        className="text-xs text-fg-3 hover:text-fg"
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
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        {toolbarPrefix}
        {enableSearch && onSearchChange && (
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-fg-3" />
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

      {/* Table */}
      <div className="rounded-lg surface-ring overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {enableRowSelection && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected || false}
                    indeterminate={someSelected || false}
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
                        className="inline-flex items-center gap-1 hover:text-fg transition-colors -ml-1 px-1 py-0.5 rounded"
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
                    preset={emptyPreset as "assets" | "models" | "projects" | "clients" | "kits" | "search" | undefined}
                    heading={emptyTitle}
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
                      "group/row relative",
                      onRowClick && "cursor-pointer",
                      isSelected && "bg-teal-subtle",
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

      {/* Pagination */}
      {(onPageChange || onPageSizeChange) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onPageSizeChange && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-fg-3">Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="text-sm text-fg-3">per page</span>
              </div>
            )}
            <p className="text-sm text-fg-3">
              Page {page} of {totalPages} ({totalRows ?? data.length} total)
            </p>
          </div>
          {onPageChange && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
