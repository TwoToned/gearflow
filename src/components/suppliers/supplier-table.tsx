"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { getSuppliersPaginated } from "@/server/suppliers";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupplier = Record<string, any>;

const columns: ColumnDef<AnySupplier>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    alwaysVisible: true,
    sortKey: "name",
    cell: (row) => (
      <Link href={`/suppliers/${row.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
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
    cell: (row) => (
      <span className="text-muted-foreground">{row.contactName || "\u2014"}</span>
    ),
  },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    sortKey: "email",
    responsiveHide: "md",
    cell: (row) => (
      <span className="text-muted-foreground">{row.email || "\u2014"}</span>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="text-muted-foreground">{row.phone || "\u2014"}</span>
    ),
  },
  {
    id: "accountNumber",
    header: "Account #",
    accessorKey: "accountNumber",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="font-mono text-sm text-muted-foreground">{row.accountNumber || "\u2014"}</span>
    ),
  },
  {
    id: "orders",
    header: "Orders",
    align: "right",
    responsiveHide: "md",
    cell: (row) => row._count?.orders ?? 0,
  },
  {
    id: "assets",
    header: "Assets",
    align: "right",
    responsiveHide: "md",
    cell: (row) => row._count?.assets ?? 0,
  },
  {
    id: "isActive",
    header: "Status",
    sortKey: "isActive",
    filterable: true,
    filterType: "enum",
    filterOptions: [
      { value: "true", label: "Active" },
      { value: "false", label: "Archived" },
    ],
    cell: (row) => (
      <Badge variant={row.isActive ? "default" : "destructive"}>
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
    cell: (row) => (
      <div className="flex flex-wrap gap-1">
        {row.tags?.map((tag: string) => (
          <Badge key={tag} variant="secondary" className="text-xs">
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
  } = useTablePreferences("suppliers", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () => getSuppliersPaginated({
      search: search || undefined,
      filters,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
  });

  const suppliers = data?.suppliers || [];
  const total = data?.total || 0;

  const toolbarActions = (
    <CanDo resource="supplier" action="create">
      <Button render={<Link href="/suppliers/new" />}>
        <Plus className="mr-2 h-4 w-4" />
        New Supplier
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
      isLoading={isLoading}
      emptyPreset="suppliers"
      toolbarActions={toolbarActions}
    />
  );
}
