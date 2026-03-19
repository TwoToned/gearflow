"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { getClients } from "@/server/clients";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

const typeColors: Record<string, string> = {
  COMPANY: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  INDIVIDUAL: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  VENUE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  PRODUCTION_COMPANY: "bg-green-500/10 text-green-500 border-green-500/20",
};

const typeLabels: Record<string, string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual",
  VENUE: "Venue",
  PRODUCTION_COMPANY: "Production Co.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = Record<string, any>;

const columns: ColumnDef<AnyClient>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    alwaysVisible: true,
    sortKey: "name",
    cell: (row) => (
      <Link href={`/clients/${row.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
        {row.name}
      </Link>
    ),
  },
  {
    id: "type",
    header: "Type",
    accessorKey: "type",
    sortKey: "type",
    filterable: true,
    filterType: "enum",
    filterOptions: [
      { value: "COMPANY", label: "Company", color: "bg-blue-500" },
      { value: "INDIVIDUAL", label: "Individual", color: "bg-purple-500" },
      { value: "VENUE", label: "Venue", color: "bg-amber-500" },
      { value: "PRODUCTION_COMPANY", label: "Production Company", color: "bg-green-500" },
    ],
    cell: (row) => (
      <Badge variant="outline" className={typeColors[row.type] || ""}>
        {typeLabels[row.type] || row.type}
      </Badge>
    ),
  },
  {
    id: "contactName",
    header: "Contact",
    accessorKey: "contactName",
    sortKey: "contactName",
    responsiveHide: "md",
    cell: (row) => (
      <span className="text-fg-3">
        {row.contactName || "\u2014"}
      </span>
    ),
  },
  {
    id: "contactEmail",
    header: "Email",
    accessorKey: "contactEmail",
    sortKey: "contactEmail",
    responsiveHide: "md",
    cell: (row) => (
      <span className="text-fg-3">
        {row.contactEmail || "\u2014"}
      </span>
    ),
  },
  {
    id: "projects",
    header: "Projects",
    sortKey: "name",
    align: "right",
    cell: (row) => row._count?.projects ?? 0,
  },
  {
    id: "isActive",
    header: "Status",
    sortKey: "isActive",
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

export function ClientTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
  } = useTablePreferences("clients", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["clients", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () => getClients({
      search: search || undefined,
      filters,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
  });

  const clients = data?.clients || [];
  const total = data?.total || 0;

  const toolbarActions = (
    <CanDo resource="client" action="create">
      <Button render={<Link href="/clients/new" />}>
        <Plus className="mr-2 h-4 w-4" />
        New Client
      </Button>
    </CanDo>
  );

  return (
    <DataTable
      data={clients}
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
      searchPlaceholder="Search by name, contact, or email..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      isLoading={isLoading}
      emptyPreset="clients"
      toolbarActions={toolbarActions}
    />
  );
}
