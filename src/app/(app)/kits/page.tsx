"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { useMemo, useState } from "react";
import Link from "next/link";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn, focusRing } from "@/lib/utils";

import { useKitCounts } from "@/hooks/use-kit-counts";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { api } from "../../../../convex/_generated/api";
import { useCategories } from "@/hooks/use-categories";
import { useLocations } from "@/hooks/use-locations";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
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
import { getStatusColor } from "@/lib/status-colors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKit = Record<string, any>;

function useKitColumns(
  locations: Array<{ id: string; name: string }>,
  categories: Array<{ id: string; name: string }>,
): ColumnDef<AnyKit>[] {
  return [
    {
      id: "assetTag",
      header: "Asset tag",
      accessorKey: "assetTag",
      alwaysVisible: true,
      sortKey: "assetTag",
      mobile: "subtitle", // tag + thumbnail under the kit name

      cell: (row) => (
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl}
            alt={row.assetTag}
            size={32}
          />
          <Link href={`/kits/${row.id}`} className={cn("t-mono font-medium text-table-cell text-ink hover:underline rounded-sm", focusRing)} onClick={(e) => e.stopPropagation()}>
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
      mobile: "title",
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      id: "categoryId",
      header: "Category",
      sortKey: "category",
      filterable: true,
      filterType: "enum",
      filterOptions: categories.map((c) => ({ value: c.id, label: c.name })),
      cell: (row) => <span className="text-muted">{row.category?.name || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      mobile: "badge",
      filterOptions: [
        { value: "AVAILABLE", label: "Available", color: getStatusColor("kit", "AVAILABLE").dot },
        { value: "CHECKED_OUT", label: "Deployed", color: getStatusColor("kit", "CHECKED_OUT").dot },
        { value: "IN_MAINTENANCE", label: "In maintenance", color: getStatusColor("kit", "IN_MAINTENANCE").dot },
        { value: "RETIRED", label: "Retired", color: getStatusColor("kit", "RETIRED").dot },
        { value: "INCOMPLETE", label: "Incomplete", color: getStatusColor("kit", "INCOMPLETE").dot },
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
      mobile: "badge",
      filterOptions: [
        { value: "NEW", label: "New", color: getStatusColor("condition", "NEW").dot },
        { value: "GOOD", label: "Good", color: getStatusColor("condition", "GOOD").dot },
        { value: "FAIR", label: "Fair", color: getStatusColor("condition", "FAIR").dot },
        { value: "POOR", label: "Poor", color: getStatusColor("condition", "POOR").dot },
        { value: "DAMAGED", label: "Damaged", color: getStatusColor("condition", "DAMAGED").dot },
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
      cell: (row) => <span className="text-muted">{row.location?.name || "—"}</span>,
    },
    {
      id: "items",
      header: "Items",
      sortable: false,
      align: "right",
      cell: (row) => (
        <span className="t-mono t-data text-muted">
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
      mobile: "hidden", // low-signal chips; keeps the card to status + 3 meta
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
}

export default function KitsPage() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("kits", { sortBy: "assetTag", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkForceReturnOpen, setBulkForceReturnOpen] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const warehouseWrites = useWarehouseWrites();

  const forceReturnMutation = useServerMutation({
    mutationFn: async () => {
      // Bulk single-call: ONE array mutation (partial-success) instead of a
      // per-kit server round-trip. Returns the count actually force-returned.
      const res = await warehouseWrites.forceReturnKits(Array.from(selectedIds));
      return res.count;
    },
    onSuccess: (count) => {
      toast.success(`Force returned ${count} kits to available`);
      setSelectedIds(new Set());
      // Kit list is Convex-reactive (kits.listPage via useAuthedQuery); the server
      // action dual-writes, so the WS push refreshes it. No cache to invalidate.
    },
    onError: (e) => toast.error(e.message),
  });

  // Reactive locations (Convex) → {id,name}, default-first then alphabetical.
  const locationsDocs = useLocations(orgId);
  const locations = useMemo(
    () =>
      [...(locationsDocs ?? [])]
        .sort(
          (a, b) =>
            Number(b.isDefault ?? false) - Number(a.isDefault ?? false) ||
            a.name.localeCompare(b.name),
        )
        .map((l) => ({ id: l.id, name: l.name })),
    [locationsDocs],
  );

  // Reactive categories (Convex) → {id,name}, sorted by sortOrder then name.
  const categoriesDocs = useCategories(orgId);
  const categories = useMemo(
    () =>
      [...(categoriesDocs ?? [])]
        .sort((a, b) => {
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          return so !== 0 ? so : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        })
        .map((c) => ({ id: c.id, name: c.name })),
    [categoriesDocs],
  );

  const columns = useKitColumns(locations, categories);

  // ONE server-side query (filter + sort + category/location joins all done
  // in Convex) instead of the 3 whole-org live subscriptions this used to
  // mount (kits/categories/locations) and join/filter/sort client-side. See
  // docs/designs/perf-convex-efficiency-2026-06.md Finding #1. Member-item
  // counts + primary photo stay a separate cross-domain merge (kit media
  // still lives in Prisma) — unchanged. Search is debounced since each
  // keystroke is now a real round-trip.
  const kitCounts = useKitCounts(orgId);
  const debouncedSearch = useDebouncedValue(search, 200);
  // Enum filter columns always store FilterValue as string[] (src/lib/table-utils.ts) —
  // unwrap to the first selected value, matching asset-table.tsx's pick(). Without this,
  // the array was cast straight into a Convex arg typed v.optional(v.string()), which
  // throws an ArgumentValidationError the moment any of these filters is applied.
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const statusFilter = pick(filters?.status as string | string[] | undefined);
  const conditionFilter = pick(filters?.condition as string | string[] | undefined);
  const locationFilter = pick(filters?.locationId as string | string[] | undefined);
  const categoryFilter = pick(filters?.categoryId as string | string[] | undefined);
  const tagsFilter = Array.isArray(filters?.tags) ? (filters.tags as string[]) : undefined;
  const kitsPage = useAuthedQuery(
    api.kits.listPage,
    orgId
      ? {
          orgId,
          search: debouncedSearch.trim() || undefined,
          status: statusFilter,
          condition: conditionFilter,
          locationId: locationFilter,
          categoryId: categoryFilter,
          tagsHasSome: tagsFilter,
          page,
          pageSize,
          sortBy,
          sortOrder,
        }
      : "skip",
  );
  const { data: pagedKits, total, isLoading: kitsLoading } = usePaginatedTableResult(kitsPage);

  const kits = useMemo(
    () =>
      pagedKits.map((k) => {
        const meta = kitCounts?.[k.id];
        return {
          ...k,
          _count: { serializedItems: meta?.serializedItems ?? 0, bulkItems: meta?.bulkItems ?? 0 },
          media: meta?.media ? [{ file: meta.media }] : [],
        };
      }),
    [pagedKits, kitCounts],
  );

  const isLoading = kitsLoading;

  return (
    <FadeIn>
      <RequirePermission resource="kit" action="read">
        <div className="space-y-4">
        <PageHeader
          title="Kits"
          description="Bundled sets of gear that always travel together."
        />

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-[var(--r)] border border-line bg-paper-2 px-4 py-2">
            <span className="text-ui-text font-medium text-ink">{selectedIds.size} selected</span>
            <CanDo resource="warehouse" action="check_in">
              <Button
                size="sm"
                variant="line"
                className="border-warn/40 text-warn hover:bg-warn-soft hover:border-warn"
                loading={forceReturnMutation.isPending}
                onClick={() => setBulkForceReturnOpen(true)}
              >
                <RotateCcw className="h-4 w-4" />
                Force return
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
          emptyTitle="No kits yet"
          emptyDescription="Bundle gear that always travels together. Create your first kit with New kit."
          enableRowSelection
          selectedRows={selectedIds}
          onSelectionChange={setSelectedIds}
          toolbarActions={
            <CanDo resource="kit" action="create">
              <Button size="sm" asChild>
                <Link href="/kits/new">
                  <Plus className="h-4 w-4" />
                  New kit
                </Link>
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
