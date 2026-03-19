"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Loader2, Download, Upload, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { getAssets, bulkUpdateAssets } from "@/server/assets";
import { bulkForceReturnAssets } from "@/server/warehouse";
import { useActiveOrganization } from "@/lib/auth-client";
import { getBulkAssets } from "@/server/bulk-assets";
import { getLocations } from "@/server/locations";
import { getCategories } from "@/server/categories";
import { exportAssetsCSV, exportBulkAssetsCSV } from "@/server/csv";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { CanDo } from "@/components/auth/permission-gate";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
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
            <Link href={`/assets/registry/${row.id}`} className="font-mono font-medium text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.assetTag}
            </Link>
            {row.customName && (
              <p className="text-xs text-fg-3">{row.customName}</p>
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
        { value: "CHECKED_OUT", label: "Deployed", color: "bg-purple-500" },
        { value: "IN_MAINTENANCE", label: "In Maintenance", color: "bg-amber-500" },
        { value: "RESERVED", label: "Reserved", color: "bg-purple-500" },
        { value: "RETIRED", label: "Retired", color: "bg-gray-500" },
        { value: "LOST", label: "Lost", color: "bg-red-500" },
      ],
      cell: (row) => (
        <StatusIndicator category="asset" value={row.status} label={assetStatusLabels[row.status]} variant="pill" />
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
        <Link href={`/assets/registry/${row.id}?type=bulk`} className="font-mono font-medium text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
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
      cell: (row) => <span className="font-medium">{row.availableQuantity}</span>,
    },
    {
      id: "totalQuantity",
      header: "Total",
      accessorKey: "totalQuantity",
      sortKey: "totalQuantity",
      align: "right",
      cell: (row) => <span className="text-fg-3">{row.totalQuantity}</span>,
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
  } = useTablePreferences("assets", { sortBy: "assetTag", sortOrder: "asc", view: "serialized" });

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: locationsData } = useQuery({
    queryKey: ["locations", orgId],
    queryFn: () => getLocations({ pageSize: 100 }),
  });
  const locations = (locationsData?.locations || []) as Array<{ id: string; name: string; type: string; parent?: { name: string } | null }>;

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: () => getCategories(),
  });
  const categories = (categoriesData || []) as Array<{ id: string; name: string }>;

  const serializedColumns = useAssetColumns(locations, categories);
  const bulkColumns = useBulkAssetColumns(locations);

  const serializedQuery = useQuery({
    queryKey: ["assets", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () => getAssets({
      search: search || undefined,
      filters,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
    enabled: view === "serialized",
  });

  const bulkQuery = useQuery({
    queryKey: ["bulk-assets", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () => getBulkAssets({
      search: search || undefined,
      status: Array.isArray(filters.status) ? filters.status[0] : undefined,
      locationId: Array.isArray(filters.locationId) ? filters.locationId[0] : undefined,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
    enabled: view === "bulk",
  });

  const isLoading = view === "serialized" ? serializedQuery.isLoading : bulkQuery.isLoading;
  const total = view === "serialized"
    ? serializedQuery.data?.total || 0
    : bulkQuery.data?.total || 0;

  const assets = serializedQuery.data?.assets || [];
  const bulkAssets = bulkQuery.data?.bulkAssets || [];

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
              onClick={() => {
                if (confirm(`Force return ${selectedIds.size} selected assets to available? This will reset their status and location.`))
                  forceReturnMutation.mutate();
              }}
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
