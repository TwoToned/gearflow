"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Loader2, Download, Upload, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { bulkUpdateAssets, getAssetRegistryPhotos } from "@/server/assets";
import { useAssets, useBulkAssets } from "@/hooks/use-assets";
import { useModels } from "@/hooks/use-models";
import { bulkForceReturnAssets } from "@/server/warehouse";
import { useActiveOrganization } from "@/lib/auth-client";
import { useLocations } from "@/hooks/use-locations";
import { getCategories } from "@/server/categories";
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
      cell: (row) => (
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url || row.model?.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl || row.model?.media?.[0]?.file?.thumbnailUrl}
            alt={row.assetTag}
            size={32}
          />
          <div>
            <Link href={`/assets/registry/${row.id}`} className="font-mono text-xs text-fg-3 font-medium hover:underline hover:text-fg-1" onClick={(e) => e.stopPropagation()}>
              {row.assetTag}
            </Link>
            {row.customName && (
              <p className="text-xs text-fg-3 truncate max-w-[180px]">{row.customName}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "model",
      header: "Model",
      sortKey: "model",
      cell: (row) => (
        <div>
          <Link href={`/assets/models/${row.modelId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.model?.name}
          </Link>
          {row.model?.category && (
            <p className="text-xs text-fg-3">{row.model.category.name}</p>
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
      cell: (row) => (
        <span className="font-mono text-sm text-fg-3">
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
      filterOptions: [
        { value: "AVAILABLE", label: "Available", color: "bg-green-500" },
        { value: "CHECKED_OUT", label: "Deployed", color: "bg-teal-500" },
        { value: "IN_MAINTENANCE", label: "In Maintenance", color: "bg-amber-500" },
        { value: "RESERVED", label: "Reserved", color: "bg-blue-500" },
        { value: "RETIRED", label: "Retired", color: "bg-gray-500" },
        { value: "LOST", label: "Lost", color: "bg-red-500" },
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
      cell: (row) => {
        if (row.status === "CHECKED_OUT") {
          return <span className="text-xs font-medium text-teal-400">Deployed</span>;
        }
        if (row.status === "RESERVED") {
          return <span className="text-xs font-medium text-blue-400">Reserved</span>;
        }
        if (row.status === "IN_MAINTENANCE") {
          return <span className="text-xs font-medium text-amber-400">Maintenance</span>;
        }
        if (row.status === "RETIRED" || row.status === "LOST") {
          return <span className="text-xs text-fg-4">&mdash;</span>;
        }
        return <span className="text-xs text-fg-3">Available</span>;
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
      filterOptions: [
        { value: "NEW", label: "New", color: "bg-green-500" },
        { value: "GOOD", label: "Good", color: "bg-blue-500" },
        { value: "FAIR", label: "Fair", color: "bg-amber-500" },
        { value: "POOR", label: "Poor", color: "bg-orange-500" },
        { value: "DAMAGED", label: "Damaged", color: "bg-red-500" },
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
      cell: (row) => (
        <span className="text-fg-3">{row.location?.name || "—"}</span>
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
      cell: (row) => (
        <span className="text-fg-3">{row.model?.category?.name || "—"}</span>
      ),
    },
    {
      id: "tags",
      header: "Tags",
      filterable: false,
      defaultVisible: true,
      responsiveHide: "lg",
      sortable: false,
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
      cell: (row) => (
        <Link href={`/assets/registry/${row.id}?type=bulk`} className="font-mono text-xs text-fg-3 font-medium hover:underline hover:text-fg-1" onClick={(e) => e.stopPropagation()}>
          {row.assetTag}
        </Link>
      ),
    },
    {
      id: "model",
      header: "Model",
      sortKey: "model",
      cell: (row) => (
        <div>
          <Link href={`/assets/models/${row.modelId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.model?.name}
          </Link>
          {row.model?.category && (
            <p className="text-xs text-fg-3">{row.model.category.name}</p>
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
      cell: (row) => {
        const avail = row.availableQuantity ?? 0;
        const total = row.totalQuantity ?? 0;
        const deployed = total - avail;
        const pct = total > 0 ? Math.round((deployed / total) * 100) : 0;
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="font-medium tabular-nums">{avail}</span>
            {total > 0 && (
              <div className="w-12 h-1.5 rounded-full bg-border overflow-hidden" title={`${pct}% deployed`}>
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    pct === 0 ? "bg-success/60" : pct >= 80 ? "bg-error/60" : "bg-primary/60",
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
      cell: (row) => <span className="text-fg-3 tabular-nums">{row.totalQuantity}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "ACTIVE", label: "Active", color: "bg-green-500" },
        { value: "LOW_STOCK", label: "Low Stock", color: "bg-amber-500" },
        { value: "OUT_OF_STOCK", label: "Out of Stock", color: "bg-red-500" },
        { value: "RETIRED", label: "Retired", color: "bg-gray-500" },
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
      cell: (row) => (
        <span className="text-fg-3">{row.location?.name || "—"}</span>
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
  const [importOpen, setImportOpen] = useState(false);
  const [bulkForceReturnOpen, setBulkForceReturnOpen] = useState(false);

  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

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

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: () => getCategories(),
  });
  const categories = useMemo(
    () => (categoriesData || []) as Array<{ id: string; name: string }>,
    [categoriesData],
  );

  const serializedColumns = useAssetColumns(locations, categories);
  const bulkColumns = useBulkAssetColumns(locations);

  // Reactive asset + bulk lists straight from Convex (auto-update on any CRUD AND
  // any warehouse status/location change). Model name/category + location resolve
  // from the Convex models/categories/locations the table already loads; primary
  // photos are cross-domain (asset/model media still Prisma) so they come from a
  // separate, non-reactive server query and are merged in.
  const allAssets = useAssets(orgId);
  const allBulkAssets = useBulkAssets(orgId);
  const allModels = useModels(orgId);
  const { data: photos } = useQuery({
    queryKey: ["asset-registry-photos", orgId],
    queryFn: () => getAssetRegistryPhotos(),
    enabled: !!orgId,
  });

  const modelById = useMemo(() => new Map((allModels ?? []).map((m) => [m.id, m])), [allModels]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  // Attach a resolved `model` (with `category` + primary `media`), `location`, and
  // own primary `media` to a Convex asset/bulk doc, matching the old Prisma include.
  const enrich = useMemo(() => {
    const assetPhotos = photos?.assetPhotos ?? {};
    const modelPhotos = photos?.modelPhotos ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (row: any) => {
      const model = modelById.get(row.modelId);
      const category = model?.categoryId ? categoryById.get(model.categoryId) ?? null : null;
      const mPhoto = modelPhotos[row.modelId];
      const aPhoto = assetPhotos[row.id];
      return {
        ...row,
        model: model ? { ...model, category, media: mPhoto ? [{ file: mPhoto }] : [] } : null,
        location: row.locationId ? locationById.get(row.locationId) ?? null : null,
        media: aPhoto ? [{ file: aPhoto }] : [],
      };
    };
  }, [modelById, categoryById, locationById, photos]);

  // Client-side filter → sort → paginate over the reactive serialized list.
  const { assets, serializedTotal } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const statusF = filters?.status as string | string[] | undefined;
    const conditionF = filters?.condition as string | string[] | undefined;
    const locationF = filters?.locationId as string | string[] | undefined;
    const categoryF = filters?.categoryId as string | string[] | undefined;
    const tagsF = Array.isArray(filters?.tags) ? (filters.tags as string[]) : undefined;
    const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

    const filtered = (allAssets ?? []).filter((a) => {
      if (a.isActive === false) return false;
      if (pick(statusF) && a.status !== pick(statusF)) return false;
      if (pick(conditionF) && a.condition !== pick(conditionF)) return false;
      if (pick(locationF) && a.locationId !== pick(locationF)) return false;
      if (pick(categoryF) && modelById.get(a.modelId)?.categoryId !== pick(categoryF)) return false;
      if (tagsF && tagsF.length > 0 && !(a.tags ?? []).some((t) => tagsF.includes(t))) return false;
      if (q) {
        const name = modelById.get(a.modelId)?.name?.toLowerCase() ?? "";
        const hit = a.assetTag.toLowerCase().includes(q)
          || (a.serialNumber?.toLowerCase().includes(q) ?? false)
          || (a.customName?.toLowerCase().includes(q) ?? false)
          || name.includes(q);
        if (!hit) return false;
      }
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortBy === "model" ? modelById.get(a.modelId)?.name
        : sortBy === "location" ? locationById.get(a.locationId ?? "")?.name
        : (a as Record<string, unknown>)[sortBy];
      const bv = sortBy === "model" ? modelById.get(b.modelId)?.name
        : sortBy === "location" ? locationById.get(b.locationId ?? "")?.name
        : (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const start = (page - 1) * pageSize;
    return { assets: sorted.slice(start, start + pageSize).map(enrich), serializedTotal: sorted.length };
  }, [allAssets, modelById, locationById, search, filters, sortBy, sortOrder, page, pageSize, enrich]);

  // Client-side filter → sort → paginate over the reactive bulk list.
  const { bulkAssets, bulkTotal } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const statusF = Array.isArray(filters.status) ? filters.status[0] : (filters.status as string | undefined);
    const locationF = Array.isArray(filters.locationId) ? filters.locationId[0] : (filters.locationId as string | undefined);

    const filtered = (allBulkAssets ?? []).filter((b) => {
      if (b.isActive === false) return false;
      if (statusF && b.status !== statusF) return false;
      if (locationF && b.locationId !== locationF) return false;
      if (q) {
        const name = modelById.get(b.modelId)?.name?.toLowerCase() ?? "";
        if (!(b.assetTag.toLowerCase().includes(q) || name.includes(q))) return false;
      }
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortBy === "model" ? modelById.get(a.modelId)?.name
        : sortBy === "location" ? locationById.get(a.locationId ?? "")?.name
        : (a as Record<string, unknown>)[sortBy];
      const bv = sortBy === "model" ? modelById.get(b.modelId)?.name
        : sortBy === "location" ? locationById.get(b.locationId ?? "")?.name
        : (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const start = (page - 1) * pageSize;
    return { bulkAssets: sorted.slice(start, start + pageSize).map(enrich), bulkTotal: sorted.length };
  }, [allBulkAssets, modelById, locationById, search, filters, sortBy, sortOrder, page, pageSize, enrich]);

  const isLoading = view === "serialized" ? allAssets === undefined : allBulkAssets === undefined;
  const total = view === "serialized" ? serializedTotal : bulkTotal;

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkEditOpen(false);
  };

  const forceReturnMutation = useMutation({
    mutationFn: () => bulkForceReturnAssets(Array.from(selectedIds)),
    onSuccess: (result) => {
      toast.success(`Force returned ${result.count} assets to available`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const viewToggle = (
    <div className="flex rounded-md border">
      <button
        onClick={() => { setView("serialized"); clearFilters(); setSelectedIds(new Set()); }}
        className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === "serialized" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      >
        Serialized
      </button>
      <button
        onClick={() => { setView("bulk"); clearFilters(); setSelectedIds(new Set()); }}
        className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === "bulk" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
      >
        Bulk
      </button>
    </div>
  );

  const actionButtons = (
    <CanDo resource="asset" action="create">
      <Button
        variant="outline"
        size="sm"
        className="hidden sm:inline-flex h-8"
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
      <Button variant="outline" size="sm" className="hidden sm:inline-flex h-8" onClick={() => setImportOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import
      </Button>
      <Button size="sm" className="h-8" render={<Link href={`/assets/registry/new?type=${view}`} />}>
        <Plus className="mr-2 h-4 w-4" />
        New {view === "serialized" ? "Asset" : "Bulk Asset"}
      </Button>
    </CanDo>
  );

  return (
    <div className="space-y-4">
      {/* Bulk Edit Bar */}
      {view === "serialized" && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-bg-inset/50 px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <CanDo resource="asset" action="update">
            <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
              <Pencil className="mr-2 h-3 w-3" />
              Bulk Edit
            </Button>
          </CanDo>
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
            variant="outline"
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
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
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
          queryClient.invalidateQueries({ queryKey: ["assets"] });
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

  const mutation = useMutation({
    mutationFn: () =>
      bulkUpdateAssets(Array.from(selectedIds), {
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
          <DialogTitle>Bulk Edit {selectedIds.size} Assets</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-3">
          Only fields you change will be updated. Leave a field unchanged to keep existing values.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Status</Label>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">— No change —</option>
              <option value="AVAILABLE">Available</option>
              <option value="CHECKED_OUT">Deployed</option>
              <option value="IN_MAINTENANCE">In Maintenance</option>
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
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !hasChanges}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update {selectedIds.size} Assets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
