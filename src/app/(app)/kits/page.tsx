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
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";

import { kitStatusLabels, conditionLabels, formatLabel } from "@/lib/status-labels";

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
      cell: (row) => <span className="text-fg-3">{row.category?.name || "—"}</span>,
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
        <StatusIndicator category="kit" value={row.status} label={kitStatusLabels[row.status] || formatLabel(row.status)} variant="pill" />
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
        <StatusIndicator category="condition" value={row.condition} label={conditionLabels[row.condition] || formatLabel(row.condition)} variant="pill" />
      ),
    },
    {
      id: "locationId",
      header: "Location",
      sortKey: "location",
      filterable: true,
      filterType: "enum",
      filterOptions: locations.map((loc) => ({ value: loc.id, label: loc.name })),
      cell: (row) => <span className="text-fg-3">{row.location?.name || "—"}</span>,
    },
    {
      id: "items",
      header: "Items",
      sortable: false,
      align: "right",
      cell: (row) => (
        <span className="text-fg-3">
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
    currentConfig, applyConfig,
  } = useTablePreferences("kits", { sortBy: "assetTag", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkForceReturnOpen, setBulkForceReturnOpen] = useState(false);
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
    <FadeIn>
      <RequirePermission resource="kit" action="read">
        <div className="space-y-4">
        <PageHeader
          title="Kits"
          description="Bundled sets of gear that always travel together."
        />

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-md border bg-bg-inset/50 px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <CanDo resource="warehouse" action="check_in">
              <Button
                size="sm"
                variant="outline"
                className="text-amber-500"
                disabled={forceReturnMutation.isPending}
                onClick={() => setBulkForceReturnOpen(true)}
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
          savedViews={{ tableId: "kits", currentConfig, applyConfig }}
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
    <DeleteDialog
      open={bulkForceReturnOpen}
      onOpenChange={setBulkForceReturnOpen}
      title={`Force return ${selectedIds.size} kit${selectedIds.size === 1 ? "" : "s"}?`}
      description="Project assignments for the selected kits and their contents will be marked as returned. Use when scanning isn't possible."
      confirmLabel={`Force return ${selectedIds.size}`}
      onConfirm={() => {
        forceReturnMutation.mutate();
        setBulkForceReturnOpen(false);
      }}
      pending={forceReturnMutation.isPending}
    />
    </FadeIn>
  );
}
