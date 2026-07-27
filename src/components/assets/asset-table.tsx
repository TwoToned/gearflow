"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";

import { Plus, Pencil, Download, Upload, RotateCcw, Tag } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing, disabledState } from "@/lib/utils";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { useLocations } from "@/hooks/use-locations";
import { useCategories } from "@/hooks/use-categories";
import { exportAssetsCSV, exportBulkAssetsCSV } from "@/server/csv";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { CanDo } from "@/components/auth/permission-gate";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { TagInput } from "@/components/ui/tag-input";
import { useOrgTags } from "@/hooks/use-org-tags";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { assetStatusLabels, bulkAssetStatusLabels, conditionLabels } from "@/lib/status-labels";
import { getStatusColor } from "@/lib/status-colors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAsset = Record<string, any>;

function useAssetColumns(
  locations: Array<{ id: string; name: string; type: string; parent?: { name: string } | null }>,
  categories: Array<{ id: string; name: string }>,
): ColumnDef<AnyAsset>[] {
  return [
    {
      id: "assetTag",
      header: "Asset Tag",
      accessorKey: "assetTag",
      alwaysVisible: true,
      sortKey: "assetTag",
      // Operators match on tag — strong secondary line under the model name.
      mobile: "subtitle",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url || row.model?.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl || row.model?.media?.[0]?.file?.thumbnailUrl}
            alt={row.assetTag}
            size={32}
          />
          <div>
            <Link href={`/assets/registry/${row.id}`} className={cn("t-mono text-muted hover:underline hover:text-ink", focusRing, "rounded-[var(--r)]")} onClick={(e) => e.stopPropagation()}>
              {row.assetTag}
            </Link>
            {row.customName && (
              <p className="text-caption text-muted truncate max-w-[180px]">{row.customName}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "model",
      header: "Model",
      sortKey: "model",
      mobile: "title",
      cell: (row) => (
        <div>
          <Link href={`/assets/models/${row.modelId}`} className={cn("text-table-cell hover:underline hover:text-ink rounded-[var(--r)]", focusRing)} onClick={(e) => e.stopPropagation()}>
            {row.model?.name}
          </Link>
          {row.model?.category && (
            <p className="text-caption text-muted">{row.model.category.name}</p>
          )}
        </div>
      ),
    },
    {
      id: "serialNumber",
      header: "Serial #",
      accessorKey: "serialNumber",
      sortKey: "serialNumber",
      defaultVisible: true,
      mobile: "meta",
      cell: (row) => (
        <span className="t-mono text-muted">
          {row.serialNumber || "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      mobile: "badge",
      // Dots derive from the status intent map (status-colors.ts) — the single
      // source of truth — instead of hardcoded palette swatches.
      filterOptions: [
        { value: "AVAILABLE", label: "Available", color: getStatusColor("asset", "AVAILABLE").dot },
        { value: "CHECKED_OUT", label: "Deployed", color: getStatusColor("asset", "CHECKED_OUT").dot },
        { value: "IN_MAINTENANCE", label: "In maintenance", color: getStatusColor("asset", "IN_MAINTENANCE").dot },
        { value: "RESERVED", label: "Reserved", color: getStatusColor("asset", "RESERVED").dot },
        { value: "RETIRED", label: "Retired", color: getStatusColor("asset", "RETIRED").dot },
        { value: "LOST", label: "Lost", color: getStatusColor("asset", "LOST").dot },
      ],
      cell: (row) => (
        <StatusIndicator category="asset" value={row.status} label={assetStatusLabels[row.status]} variant="pill" />
      ),
    },
    {
      id: "utilization",
      header: "Utilization",
      sortable: false,
      defaultVisible: true,
      responsiveHide: "md",
      // Redundant on a card — just re-derives the status badge above.
      mobile: "hidden",
      cell: (row) => {
        // Text colour derives from the status intent map (status-colors.ts).
        if (row.status === "CHECKED_OUT") {
          return <span className={cn("text-caption font-medium", getStatusColor("asset", "CHECKED_OUT").text)}>Deployed</span>;
        }
        if (row.status === "RESERVED") {
          return <span className={cn("text-caption font-medium", getStatusColor("asset", "RESERVED").text)}>Reserved</span>;
        }
        if (row.status === "IN_MAINTENANCE") {
          return <span className={cn("text-caption font-medium", getStatusColor("asset", "IN_MAINTENANCE").text)}>Maintenance</span>;
        }
        if (row.status === "SOLD") {
          return <span className={cn("text-caption font-medium", getStatusColor("asset", "SOLD").text)}>Sold</span>;
        }
        if (row.status === "RETIRED" || row.status === "LOST") {
          return <span className="text-caption text-faint">&mdash;</span>;
        }
        return <span className="text-caption text-muted">Available</span>;
      },
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
      // Dots derive from the condition intent map (status-colors.ts).
      filterOptions: [
        { value: "NEW", label: "New", color: getStatusColor("condition", "NEW").dot },
        { value: "GOOD", label: "Good", color: getStatusColor("condition", "GOOD").dot },
        { value: "FAIR", label: "Fair", color: getStatusColor("condition", "FAIR").dot },
        { value: "POOR", label: "Poor", color: getStatusColor("condition", "POOR").dot },
        { value: "DAMAGED", label: "Damaged", color: getStatusColor("condition", "DAMAGED").dot },
      ],
      cell: (row) => (
        <StatusIndicator category="condition" value={row.condition} label={conditionLabels[row.condition]} variant="pill" />
      ),
    },
    {
      id: "locationId",
      header: "Location",
      sortKey: "location",
      filterable: true,
      filterType: "enum",
      filterOptions: locations.map((loc) => ({
        value: loc.id,
        label: loc.parent ? `${loc.parent.name} > ${loc.name}` : loc.name,
      })),
      responsiveHide: "md",
      mobile: "meta",
      cell: (row) => (
        <span className="text-muted">{row.location?.name || "—"}</span>
      ),
    },
    {
      id: "categoryId",
      header: "Category",
      filterable: true,
      filterType: "enum",
      filterOptions: categories.map((c) => ({ value: c.id, label: c.name })),
      defaultVisible: false,
      responsiveHide: "lg",
      // The model cell already prints the category beneath the model name.
      mobile: "hidden",
      cell: (row) => (
        <span className="text-muted">{row.model?.category?.name || "—"}</span>
      ),
    },
    {
      id: "tags",
      header: "Tags",
      filterable: false,
      defaultVisible: true,
      responsiveHide: "lg",
      sortable: false,
      // Long tag lists blow out the card — noise on a phone.
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
}

function useBulkAssetColumns(
  locations: Array<{ id: string; name: string; type: string; parent?: { name: string } | null }>,
): ColumnDef<AnyAsset>[] {
  return [
    {
      id: "assetTag",
      header: "Asset Tag",
      accessorKey: "assetTag",
      alwaysVisible: true,
      sortKey: "assetTag",
      mobile: "subtitle",
      cell: (row) => (
        <Link href={`/assets/registry/${row.id}?type=bulk`} className={cn("t-mono text-muted hover:underline hover:text-ink rounded-[var(--r)]", focusRing)} onClick={(e) => e.stopPropagation()}>
          {row.assetTag}
        </Link>
      ),
    },
    {
      id: "model",
      header: "Model",
      sortKey: "model",
      mobile: "title",
      cell: (row) => (
        <div>
          <Link href={`/assets/models/${row.modelId}`} className={cn("text-table-cell hover:underline hover:text-ink rounded-[var(--r)]", focusRing)} onClick={(e) => e.stopPropagation()}>
            {row.model?.name}
          </Link>
          {row.model?.category && (
            <p className="text-caption text-muted">{row.model.category.name}</p>
          )}
        </div>
      ),
    },
    {
      id: "availableQuantity",
      header: "Available",
      accessorKey: "availableQuantity",
      sortKey: "availableQuantity",
      align: "right",
      mobile: "meta",
      // The cell coalesces null to 0 and still renders the deployment bar, so the
      // card must keep this pair even when the accessor itself is null.
      mobileEmpty: () => false,
      cell: (row) => {
        const avail = row.availableQuantity ?? 0;
        const total = row.totalQuantity ?? 0;
        const deployed = total - avail;
        const pct = total > 0 ? Math.round((deployed / total) * 100) : 0;
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="t-data font-medium tabular-nums text-ink">{avail}</span>
            {total > 0 && (
              <div className="w-12 h-1.5 rounded-full bg-line-2 overflow-hidden" title={`${pct}% deployed`}>
                <div
                  className={cn(
                    "h-full rounded-full motion-safe:transition-all",
                    pct === 0 ? "bg-ok" : pct >= 80 ? "bg-warn" : "bg-red",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "totalQuantity",
      header: "Total",
      accessorKey: "totalQuantity",
      sortKey: "totalQuantity",
      align: "right",
      mobile: "meta",
      cell: (row) => <span className="t-data text-muted tabular-nums">{row.totalQuantity}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      mobile: "badge",
      // Dots derive from the bulk-asset intent map (status-colors.ts).
      filterOptions: [
        { value: "ACTIVE", label: "Active", color: getStatusColor("bulkAsset", "ACTIVE").dot },
        { value: "LOW_STOCK", label: "Low stock", color: getStatusColor("bulkAsset", "LOW_STOCK").dot },
        { value: "OUT_OF_STOCK", label: "Out of stock", color: getStatusColor("bulkAsset", "OUT_OF_STOCK").dot },
        { value: "RETIRED", label: "Retired", color: getStatusColor("bulkAsset", "RETIRED").dot },
      ],
      cell: (row) => (
        <StatusIndicator category="bulkAsset" value={row.status} label={bulkAssetStatusLabels[row.status]} variant="pill" />
      ),
    },
    {
      id: "locationId",
      header: "Location",
      sortKey: "location",
      filterable: true,
      filterType: "enum",
      filterOptions: locations.map((loc) => ({
        value: loc.id,
        label: loc.parent ? `${loc.parent.name} > ${loc.name}` : loc.name,
      })),
      mobile: "meta",
      cell: (row) => (
        <span className="text-muted">{row.location?.name || "—"}</span>
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
}

export function AssetTable() {
  const {
    sortBy, sortOrder, pageSize, view, page,
    setPage, setPageSize, setView, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter, clearFilters,
    currentConfig, applyConfig,
  } = useTablePreferences("assets", { sortBy: "assetTag", sortOrder: "asc", view: "serialized" });

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkForceReturnOpen, setBulkForceReturnOpen] = useState(false);

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const warehouseWrites = useWarehouseWrites();

  // Reactive locations (Convex). Org-scoped list returns all rows; rebuild the
  // {id,name,type,parent} shape the columns need (parent name resolved from the
  // flat list — the sanctioned hierarchy pattern), default-first then alphabetical.
  const locationsDocs = useLocations(orgId);
  const locations = useMemo(() => {
    const list = locationsDocs ?? [];
    const nameById = new Map(list.map((l) => [l.id, l.name]));
    return [...list]
      .sort(
        (a, b) =>
          Number(b.isDefault ?? false) - Number(a.isDefault ?? false) ||
          a.name.localeCompare(b.name),
      )
      .map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type ?? "",
        parent: l.parentId ? { name: nameById.get(l.parentId) ?? "" } : null,
      }));
  }, [locationsDocs]);

  // Reactive categories (Convex) → {id,name} for the filter dropdown, sorted by
  // sortOrder then name to match the old getCategories() order.
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

  const serializedColumns = useAssetColumns(locations, categories);
  const bulkColumns = useBulkAssetColumns(locations);

  // Reactive asset + bulk PAGES straight from Convex — one filtered/paginated
  // query per view instead of 5 whole-org live subscriptions re-pushing the
  // entire table to every open tab on any single check-in/out anywhere (Phase 0
  // baseline: this was the #1 driver of "heaps of calls on every action" —
  // Finding #1, docs/designs/perf-convex-efficiency-2026-06.md).
  // assets.listPage / bulkAssets.listPage already mirror this table's exact
  // filter/sort/paginate logic server-side (built for the T&T-new picker) —
  // reuse them instead of re-deriving locally over a whole-org `.collect()`.
  // Search is debounced: unlike the old client-side filter, each change is now
  // a real Convex round-trip.
  const debouncedSearch = useDebouncedValue(search, 200);
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const statusF = pick(filters?.status as string | string[] | undefined);
  const conditionF = pick(filters?.condition as string | string[] | undefined);
  const locationF = pick(filters?.locationId as string | string[] | undefined);
  const categoryF = pick(filters?.categoryId as string | string[] | undefined);
  const tagsF = Array.isArray(filters?.tags) ? (filters.tags as string[]) : undefined;
  const trimmedSearch = debouncedSearch.trim() || undefined;

  const assetsPage = useAuthedQuery(
    api.assets.listPage,
    orgId && view === "serialized"
      ? {
          orgId,
          search: trimmedSearch,
          status: statusF,
          condition: conditionF,
          locationId: locationF,
          categoryId: categoryF,
          tagsHasSome: tagsF,
          page,
          pageSize,
          sortBy,
          sortOrder,
        }
      : "skip",
  );
  const bulkPage = useAuthedQuery(
    api.bulkAssets.listPage,
    orgId && view === "bulk"
      ? {
          orgId,
          search: trimmedSearch,
          status: statusF,
          locationId: locationF,
          categoryId: categoryF,
          page,
          pageSize,
          sortBy,
          sortOrder,
        }
      : "skip",
  );

  // Primary photos are cross-domain (asset/model media still Prisma) so they
  // come from a separate, non-reactive server query and are merged in below.
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: photos } = useServerQuery({
    queryKey: ["asset-registry-photos", orgId, isAuthenticated],
    queryFn: () => convex.query(api.assets.registryPhotos, { orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });

  // listPage already resolves model (+ category) and location server-side —
  // enrich only needs to merge in the photo lookup.
  const enrich = useMemo(() => {
    const assetPhotos = photos?.assetPhotos ?? {};
    const modelPhotos = photos?.modelPhotos ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (row: any) => {
      const mPhoto = row.modelId ? modelPhotos[row.modelId] : undefined;
      const aPhoto = assetPhotos[row.id];
      return {
        ...row,
        model: row.model ? { ...row.model, media: mPhoto ? [{ file: mPhoto }] : [] } : null,
        media: aPhoto ? [{ file: aPhoto }] : [],
      };
    };
  }, [photos]);

  const assets = useMemo(() => (assetsPage?.assets ?? []).map(enrich), [assetsPage, enrich]);
  const bulkAssets = useMemo(() => (bulkPage?.bulkAssets ?? []).map(enrich), [bulkPage, enrich]);
  const isLoading = view === "serialized" ? assetsPage === undefined : bulkPage === undefined;
  const total = view === "serialized" ? (assetsPage?.total ?? 0) : (bulkPage?.total ?? 0);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkEditOpen(false);
    setBulkTagsOpen(false);
  };

  const forceReturnMutation = useServerMutation({
    mutationFn: () => warehouseWrites.bulkForceReturnAssets(Array.from(selectedIds)),
    onSuccess: (result) => {
      toast.success(`Force returned ${result.count} assets to available`);
      clearSelection();
      // The registry list is Convex-reactive (useAssets/useBulkAssets); the
      // server action dual-writes, so the push refreshes it. No cache to invalidate.
    },
    onError: (e) => toast.error(e.message),
  });

  const viewToggle = (
    <div className="flex rounded-full border-2 border-line-2 p-0.5">
      <button
        onClick={() => { setView("serialized"); clearFilters(); setSelectedIds(new Set()); }}
        className={cn(
          "rounded-full px-3 py-1.5 text-ui-text font-medium motion-safe:transition-colors",
          focusRing,
          view === "serialized" ? "bg-red text-primary-foreground" : "text-muted hover:text-ink",
        )}
      >
        Serialized
      </button>
      <button
        onClick={() => { setView("bulk"); clearFilters(); setSelectedIds(new Set()); }}
        className={cn(
          "rounded-full px-3 py-1.5 text-ui-text font-medium motion-safe:transition-colors",
          focusRing,
          view === "bulk" ? "bg-red text-primary-foreground" : "text-muted hover:text-ink",
        )}
      >
        Bulk
      </button>
    </div>
  );

  const actionButtons = (
    <CanDo resource="asset" action="create">
      <Button
        variant="line"
        size="sm"
        className="hidden sm:inline-flex"
        onClick={async () => {
          const csv = view === "serialized" ? await exportAssetsCSV() : await exportBulkAssetsCSV();
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = view === "serialized" ? "assets.csv" : "bulk-assets.csv";
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download className="mr-2 h-4 w-4" />
        Export
      </Button>
      <Button variant="line" size="sm" className="hidden sm:inline-flex" onClick={() => setImportOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import
      </Button>
      <Button size="sm" asChild>
        <Link href={`/assets/registry/new?type=${view}`}>
          <Plus className="mr-2 h-4 w-4" />
          New {view === "serialized" ? "asset" : "bulk asset"}
        </Link>
      </Button>
    </CanDo>
  );

  return (
    <div className="space-y-4">
      {/* Bulk edit bar */}
      {view === "serialized" && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--r)] border-2 border-line-2 bg-paper-2/50 px-4 py-2">
          <span className="text-ui-text font-medium text-ink tabular-nums">{selectedIds.size} selected</span>
          <CanDo resource="asset" action="update">
            <Button size="sm" variant="line" onClick={() => setBulkEditOpen(true)}>
              <Pencil className="mr-2 h-3 w-3" />
              Bulk edit
            </Button>
          </CanDo>
          <CanDo resource="asset" action="update">
            <Button size="sm" variant="line" onClick={() => setBulkTagsOpen(true)}>
              <Tag className="mr-2 h-3 w-3" />
              Add tags
            </Button>
          </CanDo>
          <CanDo resource="warehouse" action="check_in">
            <Button
              size="sm"
              variant="line"
              className="text-warn"
              loading={forceReturnMutation.isPending}
              onClick={() => setBulkForceReturnOpen(true)}
            >
              <RotateCcw className="mr-2 h-3 w-3" />
              Force return
            </Button>
          </CanDo>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {view === "serialized" ? (
        <DataTable
          data={assets}
          columns={serializedColumns}
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
          searchPlaceholder="Search by tag, serial, or name..."
          columnVisibility={columnVisibility}
          onToggleColumnVisibility={toggleColumnVisibility}
          onResetPreferences={resetPreferences}
          savedViews={{ tableId: "assets", currentConfig, applyConfig }}
          isLoading={isLoading}
          emptyPreset="assets"
          enableRowSelection
          selectedRows={selectedIds}
          onSelectionChange={setSelectedIds}
          toolbarPrefix={viewToggle}
          toolbarActions={actionButtons}
        />
      ) : (
        <DataTable
          data={bulkAssets}
          columns={bulkColumns}
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
          searchPlaceholder="Search bulk assets..."
          columnVisibility={columnVisibility}
          onToggleColumnVisibility={toggleColumnVisibility}
          onResetPreferences={resetPreferences}
          savedViews={{ tableId: "assets", currentConfig, applyConfig }}
          isLoading={isLoading}
          emptyPreset="assets"
          toolbarPrefix={viewToggle}
          toolbarActions={actionButtons}
        />
      )}

      {/* Mobile export/import buttons */}
      <CanDo resource="asset" action="create">
        <div className="flex gap-2 sm:hidden">
          <Button
            variant="line"
            size="sm"
            onClick={async () => {
              const csv = view === "serialized" ? await exportAssetsCSV() : await exportBulkAssetsCSV();
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = view === "serialized" ? "assets.csv" : "bulk-assets.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button variant="line" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
        </div>
      </CanDo>

      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedIds={selectedIds}
        locations={locations}
        onSuccess={() => {
          clearSelection();
        }}
      />

      <BulkAddTagsDialog
        open={bulkTagsOpen}
        onOpenChange={setBulkTagsOpen}
        selectedIds={selectedIds}
        orgId={orgId}
        onSuccess={() => {
          clearSelection();
        }}
      />

      <CSVImportDialog type="assets" open={importOpen} onOpenChange={setImportOpen} />

      <DeleteDialog
        open={bulkForceReturnOpen}
        onOpenChange={setBulkForceReturnOpen}
        title={`Force return ${selectedIds.size} asset${selectedIds.size === 1 ? "" : "s"}?`}
        description="Project assignments are marked returned and statuses reset. Each asset returns to its home location. Use when scanning isn't possible."
        confirmLabel={`Force return ${selectedIds.size}`}
        onConfirm={() => {
          forceReturnMutation.mutate();
          setBulkForceReturnOpen(false);
        }}
        pending={forceReturnMutation.isPending}
      />
    </div>
  );
}

function BulkEditDialog({
  open,
  onOpenChange,
  selectedIds,
  locations,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>;
  locations: Array<{ id: string; name: string; type: string; parent?: { name: string } | null }>;
  onSuccess: () => void;
}) {
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");
  const [bulkLocationId, setBulkLocationId] = useState<string | undefined>(undefined);

  const assetWrites = useAssetWrites();
  const mutation = useServerMutation({
    mutationFn: () =>
      assetWrites.bulkUpdate(Array.from(selectedIds), {
        status: bulkStatus || undefined,
        condition: bulkCondition || undefined,
        locationId: bulkLocationId,
      }),
    onSuccess: (result) => {
      toast.success(`Updated ${result.count} assets`);
      setBulkStatus("");
      setBulkCondition("");
      setBulkLocationId(undefined);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const hasChanges = bulkStatus || bulkCondition || bulkLocationId !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk edit {selectedIds.size} assets</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-muted">
          Only fields you change will be updated. Leave a field unchanged to keep existing values.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Status</Label>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className={cn("flex h-11 w-full rounded-[var(--r)] border-2 border-line-2 bg-transparent px-3 py-1 text-ui-text text-ink", focusRing, disabledState)}
            >
              <option value="">— No change —</option>
              <option value="AVAILABLE">Available</option>
              <option value="CHECKED_OUT">Deployed</option>
              <option value="IN_MAINTENANCE">In maintenance</option>
              <option value="RESERVED">Reserved</option>
              <option value="RETIRED">Retired</option>
              <option value="LOST">Lost</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Condition</Label>
            <select
              value={bulkCondition}
              onChange={(e) => setBulkCondition(e.target.value)}
              className={cn("flex h-11 w-full rounded-[var(--r)] border-2 border-line-2 bg-transparent px-3 py-1 text-ui-text text-ink", focusRing, disabledState)}
            >
              <option value="">— No change —</option>
              <option value="NEW">New</option>
              <option value="GOOD">Good</option>
              <option value="FAIR">Fair</option>
              <option value="POOR">Poor</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <ComboboxPicker
              value={bulkLocationId ?? ""}
              onChange={(v) => setBulkLocationId(v)}
              options={locations.map((loc) => ({
                value: loc.id,
                label: loc.parent ? `${loc.parent.name} > ${loc.name}` : loc.name,
                description: loc.type,
              }))}
              placeholder="— No change —"
              searchPlaceholder="Search locations..."
              allowClear
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!hasChanges}>
            Update {selectedIds.size} assets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkAddTagsDialog({
  open,
  onOpenChange,
  selectedIds,
  orgId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>;
  orgId: string | undefined;
  onSuccess: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const orgTags = useOrgTags(orgId);
  const assetWrites = useAssetWrites();

  const mutation = useServerMutation({
    mutationFn: () => assetWrites.bulkTag(Array.from(selectedIds), tags),
    onSuccess: (result) => {
      toast.success(`Added tags to ${result.count} asset${result.count === 1 ? "" : "s"}`);
      setTags([]);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTags([]);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tags to {selectedIds.size} asset{selectedIds.size === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-muted">
          Tags are appended — existing tags on each asset are kept. Duplicates are ignored.
        </p>
        <div className="space-y-2 py-2">
          <Label>Tags</Label>
          <TagInput value={tags} onChange={setTags} suggestions={orgTags} placeholder="Add tags…" />
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => { setTags([]); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={tags.length === 0}>
            Add to {selectedIds.size} asset{selectedIds.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
