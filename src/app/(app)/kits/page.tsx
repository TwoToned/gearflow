"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getKits } from "@/server/kits";
import { getLocations } from "@/server/locations";
import { getCategories } from "@/server/categories";
import { forceReturnKit } from "@/server/warehouse";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

const statusColors: Record<string, string> = {
  AVAILABLE: "bg-green-500/10 text-green-500 border-green-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  IN_MAINTENANCE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  RETIRED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  INCOMPLETE: "bg-red-500/10 text-red-500 border-red-500/20",
};

import { kitStatusLabels, conditionLabels, formatLabel } from "@/lib/status-labels";

const conditionColors: Record<string, string> = {
  NEW: "bg-green-500/10 text-green-500 border-green-500/20",
  GOOD: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  FAIR: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  POOR: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  DAMAGED: "bg-red-500/10 text-red-500 border-red-500/20",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKit = Record<string, any>;

function useKitColumns(
  locations: Array<{ id: string; name: string }>,
  categories: Array<{ id: string; name: string }>,
): ColumnDef<AnyKit>[] {
  return [
    {
      id: "assetTag",
      header: "Asset Tag",
      accessorKey: "assetTag",
      alwaysVisible: true,
      sortKey: "assetTag",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl}
            alt={row.assetTag}
            size={32}
          />
          <Link href={`/kits/${row.id}`} className="font-mono font-medium text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.assetTag}
          </Link>
        </div>
      ),
    },
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      sortKey: "name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: "categoryId",
      header: "Category",
      sortKey: "category",
      filterable: true,
      filterType: "enum",
      filterOptions: categories.map((c) => ({ value: c.id, label: c.name })),
      cell: (row) => <span className="text-muted-foreground">{row.category?.name || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "AVAILABLE", label: "Available", color: "bg-green-500" },
        { value: "CHECKED_OUT", label: "Deployed", color: "bg-purple-500" },
        { value: "IN_MAINTENANCE", label: "In Maintenance", color: "bg-amber-500" },
        { value: "RETIRED", label: "Retired", color: "bg-gray-500" },
        { value: "INCOMPLETE", label: "Incomplete", color: "bg-red-500" },
      ],
      cell: (row) => (
        <Badge variant="outline" className={statusColors[row.status] || ""}>
          {kitStatusLabels[row.status] || formatLabel(row.status)}
        </Badge>
      ),
    },
    {
      id: "condition",
      header: "Condition",
      accessorKey: "condition",
      sortKey: "condition",
      filterable: true,
      filterType: "enum",
      defaultVisible: false,
      filterOptions: [
        { value: "NEW", label: "New", color: "bg-green-500" },
        { value: "GOOD", label: "Good", color: "bg-blue-500" },
        { value: "FAIR", label: "Fair", color: "bg-amber-500" },
        { value: "POOR", label: "Poor", color: "bg-orange-500" },
        { value: "DAMAGED", label: "Damaged", color: "bg-red-500" },
      ],
      cell: (row) => (
        <Badge variant="outline" className={conditionColors[row.condition] || ""}>
          {conditionLabels[row.condition] || formatLabel(row.condition)}
        </Badge>
      ),
    },
    {
      id: "locationId",
      header: "Location",
      sortKey: "location",
      filterable: true,
      filterType: "enum",
      filterOptions: locations.map((loc) => ({ value: loc.id, label: loc.name })),
      cell: (row) => <span className="text-muted-foreground">{row.location?.name || "—"}</span>,
    },
    {
      id: "items",
      header: "Items",
      sortable: false,
      align: "right",
      cell: (row) => (
        <span className="text-muted-foreground">
          {(row._count?.serializedItems || 0) + (row._count?.bulkItems || 0)}
        </span>
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
}

export default function KitsPage() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter, clearFilters,
  } = useTablePreferences("kits", { sortBy: "assetTag", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const forceReturnMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds);
      let count = 0;
      for (const id of ids) {
        try {
          await forceReturnKit(id);
          count++;
        } catch {
          // skip kits that are already available
        }
      }
      return count;
    },
    onSuccess: (count) => {
      toast.success(`Force returned ${count} kits to available`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["kits"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations", orgId],
    queryFn: () => getLocations({ pageSize: 100 }),
  });
  const locations = (locationsData?.locations || []) as Array<{ id: string; name: string }>;

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: () => getCategories(),
  });
  const categories = (categoriesData || []) as Array<{ id: string; name: string }>;

  const columns = useKitColumns(locations, categories);

  const { data, isLoading } = useQuery({
    queryKey: ["kits", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () =>
      getKits({
        search: search || undefined,
        filters,
        page,
        pageSize,
        sortBy,
        sortOrder,
      }),
  });

  const kits = data?.kits || [];
  const total = data?.total || 0;

  return (
    <RequirePermission resource="kit" action="read">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="t-title text-fg">Kits</h1>
            <p className="text-[13px] text-fg-3">
              Bundled sets of gear that always travel together.
            </p>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <CanDo resource="warehouse" action="check_in">
              <Button
                size="sm"
                variant="outline"
                className="text-amber-500"
                disabled={forceReturnMutation.isPending}
                onClick={() => {
                  if (confirm(`Force return ${selectedIds.size} selected kits and all their contents to available?`))
                    forceReturnMutation.mutate();
                }}
              >
                {forceReturnMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-2 h-3 w-3" />}
                Force Return
              </Button>
            </CanDo>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        )}

        <DataTable
          data={kits}
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
          searchPlaceholder="Search by tag or name..."
          columnVisibility={columnVisibility}
          onToggleColumnVisibility={toggleColumnVisibility}
          onResetPreferences={resetPreferences}
          isLoading={isLoading}
          emptyPreset="kits"
          enableRowSelection
          selectedRows={selectedIds}
          onSelectionChange={setSelectedIds}
          toolbarActions={
            <CanDo resource="kit" action="create">
              <Button size="sm" className="h-8" render={<Link href="/kits/new" />}>
                <Plus className="mr-2 h-4 w-4" />
                New Kit
              </Button>
            </CanDo>
          }
        />
      </div>
    </RequirePermission>
  );
}
