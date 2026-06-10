"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Star } from "lucide-react";

import { getLocationCounts } from "@/server/locations";
import { useServerQuery } from "@/hooks/use-server-query";
import { useLocations } from "@/hooks/use-locations";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

const typeLabels: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  VENUE: "Venue",
  VEHICLE: "Vehicle",
  OFFSITE: "Offsite",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocationRow = Record<string, any> & { _depth: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTreeRows(locations: any[]): LocationRow[] {
  const childrenMap = new Map<string | null, typeof locations>();
  for (const loc of locations) {
    const pid = loc.parentId || null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(loc);
  }

  const rows: LocationRow[] = [];

  function addChildren(parentId: string | null, depth: number) {
    const children = childrenMap.get(parentId) || [];
    for (const child of children) {
      rows.push({ ...child, _depth: depth });
      addChildren(child.id, depth + 1);
    }
  }

  // Start with root locations (no parentId, or parent not in current result set)
  const locationIds = new Set(locations.map((l) => l.id));
  const roots = locations.filter((l) => !l.parentId || !locationIds.has(l.parentId));

  for (const root of roots) {
    rows.push({ ...root, _depth: 0 });
    addChildren(root.id, 1);
  }

  // If tree-building produced fewer rows than input (shouldn't happen), add missing ones
  const addedIds = new Set(rows.map((r) => r.id));
  for (const loc of locations) {
    if (!addedIds.has(loc.id)) {
      rows.push({ ...loc, _depth: 0 });
    }
  }

  return rows;
}

const columns: ColumnDef<LocationRow>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    sortKey: "name",
    alwaysVisible: true,
    cell: (row) => (
      <div className="flex items-center gap-2" style={{ paddingLeft: row._depth * 24 }}>
        <Link href={`/locations/${row.id}`} className="font-medium hover:underline">
          {row.name}
        </Link>
        {row.isDefault && (
          <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
        )}
      </div>
    ),
  },
  {
    id: "type",
    header: "Type",
    accessorKey: "type",
    sortKey: "type",
    responsiveHide: "sm",
    filterable: true,
    filterType: "enum",
    filterOptions: [
      { value: "WAREHOUSE", label: "Warehouse", color: "bg-blue-500" },
      { value: "VENUE", label: "Venue", color: "bg-amber-500" },
      { value: "VEHICLE", label: "Vehicle", color: "bg-teal-500" },
      { value: "OFFSITE", label: "Offsite", color: "bg-gray-500" },
    ],
    cell: (row) => (
      <StatusIndicator category="locationType" value={row.type} label={typeLabels[row.type] || row.type} variant="pill" />
    ),
  },
  {
    id: "address",
    header: "Address",
    accessorKey: "address",
    sortKey: "address",
    responsiveHide: "md",
    cell: (row) => (
      <span className="text-fg-3">{row.address || "\u2014"}</span>
    ),
  },
  {
    id: "assets",
    header: "Assets",
    sortKey: "name",
    sortable: false,
    align: "right",
    cell: (row) => {
      const count = (row._count?.assets || 0) + (row._count?.bulkAssets || 0) + (row._count?.kits || 0);
      return count;
    },
  },
  {
    id: "tags",
    header: "Tags",
    sortable: false,
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

export function LocationTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter, clearFilters,
    currentConfig, applyConfig,
  } = useTablePreferences("locations", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive location list straight from Convex (auto-updates on any location
  // create/update/delete). Asset/bulk/kit counts are cross-domain (still in
  // Prisma) so they come from a separate, non-reactive server query.
  const allLocations = useLocations(orgId);
  const { data: locationCounts } = useServerQuery({
    queryKey: ["location-counts", orgId],
    queryFn: () => getLocationCounts(),
    enabled: !!orgId,
  });

  // Filter (search name/address + type) → sort siblings (isDefault first, then
  // the chosen column) → build the hierarchy tree → paginate the tree rows. All
  // client-side over the reactive list. Counts merged in (children derived from
  // the flat list itself).
  const { treeRows, total } = useMemo(() => {
    const source = allLocations ?? [];
    const q = search.trim().toLowerCase();
    const typeFilter = filters?.type as string | undefined;
    const nameById = new Map(source.map((l) => [l.id, l.name]));

    const filtered = source.filter((l) => {
      if (typeFilter && l.type !== typeFilter) return false;
      if (q) {
        const hit = l.name.toLowerCase().includes(q) || (l.address?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      // Mirror the server's [{ isDefault: desc }, { sortBy: order }] default.
      if ((b.isDefault ? 1 : 0) !== (a.isDefault ? 1 : 0)) return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
      const av = sortBy === "parent" ? (a.parentId ? nameById.get(a.parentId) : undefined) : (a as Record<string, unknown>)[sortBy];
      const bv = sortBy === "parent" ? (b.parentId ? nameById.get(b.parentId) : undefined) : (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const childCount = new Map<string, number>();
    for (const l of source) if (l.parentId) childCount.set(l.parentId, (childCount.get(l.parentId) ?? 0) + 1);

    const tree = buildTreeRows(sorted).map((r) => ({
      ...r,
      _count: {
        assets: locationCounts?.[r.id]?.assets ?? 0,
        bulkAssets: locationCounts?.[r.id]?.bulkAssets ?? 0,
        kits: locationCounts?.[r.id]?.kits ?? 0,
        children: childCount.get(r.id) ?? 0,
      },
    }));
    const start = (page - 1) * pageSize;
    return { treeRows: tree.slice(start, start + pageSize), total: tree.length };
  }, [allLocations, locationCounts, search, filters, sortBy, sortOrder, page, pageSize]);

  const isLoading = allLocations === undefined;

  const actionButtons = (
    <Button render={<Link href="/locations/new" />}>
      <Plus className="mr-2 h-4 w-4" />
      New Location
    </Button>
  );

  return (
    <DataTable
      data={treeRows}
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
      searchPlaceholder="Search by name or address..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      savedViews={{ tableId: "locations", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyPreset="locations"
      toolbarActions={actionButtons}
    />
  );
}
