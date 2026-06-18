"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { getSupplierCounts } from "@/server/suppliers";
import { useServerQuery } from "@/hooks/use-server-query";
import { useSuppliers } from "@/hooks/use-suppliers";
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
    cell: (row) => (
      <span className="text-muted">{row.email || "\u2014"}</span>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="text-muted">{row.phone || "\u2014"}</span>
    ),
  },
  {
    id: "accountNumber",
    header: "Account #",
    accessorKey: "accountNumber",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="t-mono text-muted">{row.accountNumber || "\u2014"}</span>
    ),
  },
  {
    id: "orders",
    header: "Orders",
    align: "right",
    responsiveHide: "md",
    cell: (row) => <span className="t-data">{row._count?.orders ?? 0}</span>,
  },
  {
    id: "assets",
    header: "Assets",
    align: "right",
    responsiveHide: "md",
    cell: (row) => <span className="t-data">{row._count?.assets ?? 0}</span>,
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

  // Reactive supplier list straight from Convex (auto-updates on any supplier
  // create/update/delete). Asset + order counts are a cross-domain aggregate
  // that nothing invalidates (no liveness need) so they come from a one-shot,
  // non-reactive server query (useServerQuery, not React Query).
  const allSuppliers = useSuppliers(orgId);
  const { data: supplierCounts } = useServerQuery({
    queryKey: ["supplier-counts", orgId],
    queryFn: () => getSupplierCounts(),
    enabled: !!orgId,
  });

  // Filter / sort / paginate in the browser over the reactive list (mirrors the
  // old getSuppliersPaginated where: isActive enum filter + name/contact/email/
  // account#/tags search).
  const { suppliers, total } = useMemo(() => {
    const source = allSuppliers ?? [];
    const q = search.trim().toLowerCase();
    const activeFilter = filters?.isActive as string | undefined;

    const filtered = source.filter((s) => {
      if (activeFilter === "true" && (s.isActive ?? true) !== true) return false;
      if (activeFilter === "false" && (s.isActive ?? true) !== false) return false;
      if (q) {
        const hit =
          s.name.toLowerCase().includes(q) ||
          (s.contactName?.toLowerCase().includes(q) ?? false) ||
          (s.email?.toLowerCase().includes(q) ?? false) ||
          (s.accountNumber?.toLowerCase().includes(q) ?? false) ||
          (s.tags?.some((t) => t.includes(q)) ?? false);
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
    const pageItems = filtered.slice(start, start + pageSize).map((s) => ({
      ...s,
      _count: {
        assets: supplierCounts?.[s.id]?.assets ?? 0,
        orders: supplierCounts?.[s.id]?.orders ?? 0,
      },
    }));
    return { suppliers: pageItems, total: filtered.length };
  }, [allSuppliers, supplierCounts, search, filters, sortBy, sortOrder, page, pageSize]);

  const isLoading = allSuppliers === undefined;

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
