"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { useSupplierCounts } from "@/hooks/use-supplier-counts";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn, focusRing } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupplier = Record<string, any>;

const columns: ColumnDef<AnySupplier>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    alwaysVisible: true,
    sortKey: "name",
    mobile: "title",
    cell: (row) => (
      <Link
        href={`/suppliers/${row.id}`}
        className={cn("rounded-sm font-medium text-ink hover:underline", focusRing)}
        onClick={(e) => e.stopPropagation()}
      >
        {row.name}
      </Link>
    ),
  },
  {
    id: "contactName",
    header: "Contact",
    accessorKey: "contactName",
    sortKey: "contactName",
    responsiveHide: "md",
    mobile: "subtitle",
    cell: (row) => (
      <span className="text-muted">{row.contactName || "\u2014"}</span>
    ),
  },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    sortKey: "email",
    responsiveHide: "md",
    mobile: "meta",
    cell: (row) => (
      <span className="text-muted">{row.email || "\u2014"}</span>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone",
    responsiveHide: "lg",
    mobile: "meta",
    cell: (row) => (
      <span className="text-muted">{row.phone || "\u2014"}</span>
    ),
  },
  {
    id: "accountNumber",
    header: "Account #",
    accessorKey: "accountNumber",
    responsiveHide: "lg",
    // Rarely scanned on a phone; keep the card to email/phone/counts.
    mobile: "hidden",
    cell: (row) => (
      <span className="t-mono text-muted">{row.accountNumber || "\u2014"}</span>
    ),
  },
  {
    id: "orders",
    header: "Orders",
    align: "right",
    responsiveHide: "md",
    mobile: "meta",
    cell: (row) => <span className="t-data">{row._count?.orders ?? 0}</span>,
  },
  {
    id: "assets",
    header: "Assets",
    align: "right",
    responsiveHide: "md",
    mobile: "meta",
    cell: (row) => <span className="t-data">{row._count?.assets ?? 0}</span>,
  },
  {
    id: "isActive",
    header: "Status",
    sortKey: "isActive",
    filterable: true,
    filterType: "enum",
    mobile: "badge",
    filterOptions: [
      { value: "true", label: "Active" },
      { value: "false", label: "Archived" },
    ],
    cell: (row) => (
      <Badge status={row.isActive ? "ok" : "overbooked"}>
        {row.isActive ? "Active" : "Archived"}
      </Badge>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    sortable: false,
    defaultVisible: true,
    responsiveHide: "lg",
    mobile: "hidden",
    cell: (row) => (
      <div className="flex flex-wrap gap-1">
        {row.tags?.map((tag: string) => (
          <Badge key={tag} status="neutral">
            {tag}
          </Badge>
        ))}
      </div>
    ),
  },
];

export function SupplierTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("suppliers", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // ONE server-side query (filter + sort done in Convex) instead of the
  // whole-org live subscription this used to mount (useSuppliers) and filter/
  // sort client-side. See docs/designs/perf-convex-efficiency-2026-06.md
  // Finding #1. Asset + order counts are a cross-domain aggregate that stays
  // a separate, non-reactive query merged in below — unchanged. Search is
  // debounced since each keystroke is now a real round-trip.
  const debouncedSearch = useDebouncedValue(search, 200);
  // Enum filter columns always store FilterValue as string[] (src/lib/table-utils.ts) —
  // unwrap to the first selected value, matching asset-table.tsx's pick(). Without this,
  // the array was cast straight into a Convex arg typed v.optional(v.string()), which
  // throws an ArgumentValidationError the moment this filter is applied.
  const activeFilter = Array.isArray(filters?.isActive) ? filters.isActive[0] : (filters?.isActive as string | undefined);
  const suppliersPage = useAuthedQuery(
    api.suppliers.listPage,
    orgId
      ? {
          orgId,
          search: debouncedSearch.trim() || undefined,
          isActive: activeFilter,
          page,
          pageSize,
          sortBy,
          sortOrder,
        }
      : "skip",
  );
  const { data: pagedSuppliers, total, isLoading } = usePaginatedTableResult(suppliersPage);
  const supplierCounts = useSupplierCounts(orgId);

  const suppliers = useMemo(
    () =>
      pagedSuppliers.map((s) => ({
        ...s,
        _count: {
          assets: supplierCounts?.[s.id]?.assets ?? 0,
          orders: supplierCounts?.[s.id]?.orders ?? 0,
        },
      })),
    [pagedSuppliers, supplierCounts],
  );

  const toolbarActions = (
    <CanDo resource="supplier" action="create">
      <Button asChild>
        <Link href="/suppliers/new">
          <Plus className="mr-2 h-4 w-4" />
          New supplier
        </Link>
      </Button>
    </CanDo>
  );

  return (
    <DataTable
      data={suppliers}
      columns={columns}
      totalRows={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      sortField={sortBy}
      sortDirection={sortOrder}
      onSortChange={handleSort}
      filters={filters}
      onFilterChange={setFilter}
      searchValue={search}
      onSearchChange={(v) => { setSearch(v); setPage(1); }}
      searchPlaceholder="Search by name, contact, account #..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      savedViews={{ tableId: "suppliers", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyPreset="suppliers"
      emptyTitle="No suppliers yet"
      emptyDescription="Add a supplier to track purchase orders, subhires, and lead times."
      toolbarActions={toolbarActions}
    />
  );
}
