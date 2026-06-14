"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { getClientProjectCounts } from "@/server/clients";
import { useServerQuery } from "@/hooks/use-server-query";
import { useClients } from "@/hooks/use-clients";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

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
      { value: "INDIVIDUAL", label: "Individual", color: "bg-blue-500" },
      { value: "VENUE", label: "Venue", color: "bg-amber-500" },
      { value: "PRODUCTION_COMPANY", label: "Production Company", color: "bg-green-500" },
    ],
    cell: (row) => (
      <StatusIndicator category="clientType" value={row.type} label={typeLabels[row.type] || row.type} variant="pill" />
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
    currentConfig, applyConfig,
  } = useTablePreferences("clients", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive client list straight from Convex (auto-updates on any client
  // create/update/archive). Project counts are cross-domain (projects still in
  // Prisma) so they come from a separate, non-reactive server query.
  const allClients = useClients(orgId);
  const { data: projectCounts } = useServerQuery({
    queryKey: ["client-project-counts", orgId],
    queryFn: () => getClientProjectCounts(),
    enabled: !!orgId,
  });

  // Filter / sort / paginate in the browser over the reactive list.
  const { clients, total } = useMemo(() => {
    const source = allClients ?? [];
    const q = search.trim().toLowerCase();
    const typeFilter = filters?.type as string | undefined;

    const filtered = source.filter((c) => {
      if ((c.isActive ?? true) !== true) return false;
      if (typeFilter && c.type !== typeFilter) return false;
      if (q) {
        const hit =
          c.name.toLowerCase().includes(q) ||
          (c.contactName?.toLowerCase().includes(q) ?? false) ||
          (c.contactEmail?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    filtered.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortBy];
      const bv = (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize).map((c) => ({
      ...c,
      _count: { projects: projectCounts?.[c.id] ?? 0 },
    }));
    return { clients: pageItems, total: filtered.length };
  }, [allClients, projectCounts, search, filters, sortBy, sortOrder, page, pageSize]);

  const isLoading = allClients === undefined;

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
      savedViews={{ tableId: "clients", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyPreset="clients"
      toolbarActions={toolbarActions}
    />
  );
}
