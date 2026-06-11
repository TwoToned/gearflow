"use client";

import { useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { Plus } from "lucide-react";

import { getStocktakes } from "@/server/stocktake";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

const statusColors: Record<string, string> = {
  DRAFT: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
  IN_PROGRESS: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  REVIEWING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  COMPLETED: "bg-green-500/10 text-green-500 border-green-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
};

const statusLabels: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  REVIEWING: "Reviewing",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const scopeLabels: Record<string, string> = {
  FULL: "Full",
  CATEGORY: "Category",
  SPOT_CHECK: "Spot Check",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStocktake = Record<string, any>;

const columns: ColumnDef<AnyStocktake>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    alwaysVisible: true,
    sortKey: "name",
    cell: (row) => (
      <Link
        href={`/warehouse/stocktake/${row.id}`}
        className="font-medium hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.name}
      </Link>
    ),
  },
  {
    id: "location",
    header: "Location",
    sortKey: "locationId",
    cell: (row) => row.location?.name ?? "\u2014",
  },
  {
    id: "scope",
    header: "Scope",
    accessorKey: "scope",
    cell: (row) => scopeLabels[row.scope] ?? row.scope,
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortKey: "status",
    filterable: true,
    filterType: "enum",
    filterOptions: [
      { value: "DRAFT", label: "Draft", color: "bg-zinc-500" },
      { value: "IN_PROGRESS", label: "In Progress", color: "bg-blue-500" },
      { value: "REVIEWING", label: "Reviewing", color: "bg-amber-500" },
      { value: "COMPLETED", label: "Completed", color: "bg-green-500" },
      { value: "CANCELLED", label: "Cancelled", color: "bg-red-500" },
    ],
    cell: (row) => (
      <Badge variant="outline" className={statusColors[row.status] ?? ""}>
        {statusLabels[row.status] ?? row.status}
      </Badge>
    ),
  },
  {
    id: "progress",
    header: "Progress",
    sortable: false,
    cell: (row) => (
      <span className="text-muted-foreground text-sm">
        {row.foundCount}/{row.expectedCount}
      </span>
    ),
  },
  {
    id: "discrepancies",
    header: "Discrepancies",
    sortKey: "discrepancyCount",
    responsiveHide: "md",
    cell: (row) =>
      row.discrepancyCount > 0 ? (
        <Badge variant="destructive">{row.discrepancyCount}</Badge>
      ) : (
        <span className="text-muted-foreground">\u2014</span>
      ),
  },
  {
    id: "createdAt",
    header: "Created",
    sortKey: "createdAt",
    responsiveHide: "md",
    cell: (row) =>
      new Date(row.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
  },
];

export function StocktakeTable() {
  const {
    sortBy,
    sortOrder,
    pageSize,
    page,
    setPage,
    setPageSize,
    handleSort,
    columnVisibility,
    toggleColumnVisibility,
    resetPreferences,
    filters,
    setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("stocktakes", {
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const statusFilter = filters.status as string | undefined;

  // No liveness: not in the SSE map, never polled, never invalidated (create
  // navigates to the detail page) → a plain one-shot read, data-identical to RQ.
  const { data, isLoading } = useServerQuery({
    queryKey: [
      "stocktakes",
      orgId,
      { search, status: statusFilter, page, pageSize, sortBy, sortOrder },
    ],
    queryFn: () =>
      getStocktakes({
        search: search || undefined,
        status: statusFilter,
        page,
        pageSize,
        sortField: sortBy,
        sortDirection: sortOrder,
      }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const toolbarActions = (
    <CanDo resource="stocktake" action="create">
      <Button render={<Link href="/warehouse/stocktake/new" />}>
        <Plus className="mr-2 h-4 w-4" />
        New Stocktake
      </Button>
    </CanDo>
  );

  return (
    <DataTable
      data={items}
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
      onSearchChange={(v) => {
        setSearch(v);
        setPage(1);
      }}
      searchPlaceholder="Search stocktakes..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      savedViews={{ tableId: "stocktakes", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyTitle="No stocktakes found"
      toolbarActions={toolbarActions}
    />
  );
}
