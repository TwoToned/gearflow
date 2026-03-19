"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Download, Upload } from "lucide-react";

import { getModels } from "@/server/models";
import { useActiveOrganization } from "@/lib/auth-client";
import { getCategories } from "@/server/categories";
import { exportModelsCSV } from "@/server/csv";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { CanDo } from "@/components/auth/permission-gate";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Record<string, any>;

function useModelColumns(
  categories: Array<{ id: string; name: string; parent?: { name: string } | null }>,
): ColumnDef<AnyModel>[] {
  return [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      alwaysVisible: true,
      sortKey: "name",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <MediaThumbnail
            url={row.media?.[0]?.file?.url}
            thumbnailUrl={row.media?.[0]?.file?.thumbnailUrl}
            alt={row.name}
            size={36}
          />
          <div>
            <Link href={`/assets/models/${row.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.name}
            </Link>
            {row.modelNumber && (
              <span className="ml-2 text-xs text-fg-3">{row.modelNumber}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "manufacturer",
      header: "Manufacturer",
      accessorKey: "manufacturer",
      sortKey: "manufacturer",
      cell: (row) => (
        <span className="text-fg-3">{row.manufacturer || "\u2014"}</span>
      ),
    },
    {
      id: "categoryId",
      header: "Category",
      sortKey: "category",
      filterable: true,
      filterType: "enum",
      filterOptions: categories.map((cat) => ({
        value: cat.id,
        label: cat.parent ? `${cat.parent.name} \u2192 ${cat.name}` : cat.name,
      })),
      cell: (row) =>
        row.category ? (
          <Badge variant="secondary">{row.category.name}</Badge>
        ) : (
          <span className="text-fg-3">{"\u2014"}</span>
        ),
    },
    {
      id: "assetType",
      header: "Type",
      accessorKey: "assetType",
      sortKey: "assetType",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "SERIALIZED", label: "Serialized" },
        { value: "BULK", label: "Bulk" },
      ],
      cell: (row) => (
        <Badge variant={row.assetType === "SERIALIZED" ? "default" : "outline"}>
          {row.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}
        </Badge>
      ),
    },
    {
      id: "assetCount",
      header: "Assets",
      sortable: false,
      align: "right",
      cell: (row) => row._count.assets + row._count.bulkAssets,
    },
    {
      id: "defaultRentalPrice",
      header: "Rental $/day",
      accessorKey: "defaultRentalPrice",
      sortKey: "defaultRentalPrice",
      align: "right",
      cell: (row) => (
        <span className="t-data">
          {row.defaultRentalPrice ? `$${Number(row.defaultRentalPrice).toFixed(2)}` : "\u2014"}
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

export function ModelTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
  } = useTablePreferences("models", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: () => getCategories(),
  });

  const columns = useModelColumns(categories);

  const { data, isLoading } = useQuery({
    queryKey: ["models", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () =>
      getModels({
        search: search || undefined,
        filters,
        page,
        pageSize,
        sortBy,
        sortOrder,
      }),
  });

  const models = data?.models || [];
  const total = data?.total || 0;

  const toolbarActions = (
    <CanDo resource="model" action="create">
      <Button
        variant="outline"
        size="sm"
        className="hidden sm:inline-flex h-8"
        onClick={async () => {
          const csv = await exportModelsCSV();
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "models.csv";
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
      <Button size="sm" className="h-8" render={<Link href="/assets/models/new" />}>
        <Plus className="mr-2 h-4 w-4" />
        New Model
      </Button>
    </CanDo>
  );

  return (
    <div className="space-y-4">
      <DataTable
        data={models}
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
        searchPlaceholder="Search models..."
        columnVisibility={columnVisibility}
        onToggleColumnVisibility={toggleColumnVisibility}
        onResetPreferences={resetPreferences}
        isLoading={isLoading}
        emptyPreset="models"
        toolbarActions={toolbarActions}
      />

      {/* Mobile export/import buttons */}
      <CanDo resource="model" action="create">
        <div className="flex gap-2 sm:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const csv = await exportModelsCSV();
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "models.csv";
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

      <CSVImportDialog type="models" open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
