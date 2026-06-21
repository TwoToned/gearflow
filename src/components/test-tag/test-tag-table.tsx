"use client";

import { useServerQuery } from "@/hooks/use-server-query";
import { useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import Link from "next/link";
import { getTestTagAssets } from "@/server/test-tag-assets";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { getStatusColor } from "@/lib/status-colors";
import { testTagStatusLabels, equipmentClassLabels, applianceTypeLabels } from "@/lib/status-labels";

function StatusBadge({ status }: { status: string }) {
  return (
    <StatusIndicator
      category="testTag"
      value={status}
      label={testTagStatusLabels[status] ?? status}
      variant="pill"
    />
  );
}

function formatEquipmentClass(value: string): string {
  return equipmentClassLabels[value] ?? value;
}

function formatApplianceType(value: string): string {
  return applianceTypeLabels[value] ?? value;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = Record<string, any>;

function useTestTagColumns(): ColumnDef<AnyItem>[] {
  return [
    {
      id: "testTagId",
      header: "Test tag ID",
      accessorKey: "testTagId",
      alwaysVisible: true,
      cell: (row) => (
        <span className="t-mono font-medium text-table-cell">{row.testTagId}</span>
      ),
    },
    {
      id: "description",
      header: "Description",
      accessorKey: "description",
      cell: (row) => (
        <span className="max-w-[200px] truncate block">{row.description}</span>
      ),
    },
    {
      id: "equipmentClass",
      header: "Equipment class",
      accessorKey: "equipmentClass",
      filterable: true,
      filterType: "enum",
      responsiveHide: "lg",
      filterOptions: [
        { value: "CLASS_I", label: "Class I" },
        { value: "CLASS_II", label: "Class II" },
        { value: "CLASS_II_DOUBLE_INSULATED", label: "Class II (DI)" },
        { value: "LEAD_CORD_ASSEMBLY", label: "Lead / cord" },
      ],
      cell: (row) => (
        <span className="text-table-cell text-muted">
          {formatEquipmentClass(row.equipmentClass)}
        </span>
      ),
    },
    {
      id: "applianceType",
      header: "Appliance type",
      accessorKey: "applianceType",
      filterable: true,
      filterType: "enum",
      responsiveHide: "lg",
      defaultVisible: false,
      filterOptions: [
        { value: "APPLIANCE", label: "Appliance" },
        { value: "CORD_SET", label: "Cord set" },
        { value: "EXTENSION_LEAD", label: "Extension lead" },
        { value: "POWER_BOARD", label: "Power board" },
        { value: "RCD_PORTABLE", label: "RCD portable" },
        { value: "RCD_FIXED", label: "RCD fixed" },
        { value: "THREE_PHASE", label: "Three phase" },
        { value: "MICROWAVE", label: "Microwave" },
        { value: "OTHER", label: "Other" },
      ],
      cell: (row) => (
        <span className="text-table-cell text-muted">
          {formatApplianceType(row.applianceType)}
        </span>
      ),
    },
    {
      id: "testProfile",
      header: "Test profile",
      responsiveHide: "lg",
      defaultVisible: false,
      sortable: false,
      cell: (row) => (
        <span className="text-table-cell text-muted">
          {row.testProfile?.name || "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "CURRENT", label: "Current", color: getStatusColor("testTag", "CURRENT").dot },
        { value: "DUE_SOON", label: "Due soon", color: getStatusColor("testTag", "DUE_SOON").dot },
        { value: "OVERDUE", label: "Overdue", color: getStatusColor("testTag", "OVERDUE").dot },
        { value: "FAILED", label: "Failed", color: getStatusColor("testTag", "FAILED").dot },
        { value: "NOT_YET_TESTED", label: "Not tested", color: getStatusColor("testTag", "NOT_YET_TESTED").dot },
        { value: "RETIRED", label: "Retired", color: getStatusColor("testTag", "RETIRED").dot },
      ],
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "lastTestDate",
      header: "Last tested",
      responsiveHide: "sm",
      defaultVisible: false,
      sortable: false,
      cell: (row) => (
        <span className="text-table-cell text-muted t-data">{formatDate(row.lastTestDate)}</span>
      ),
    },
    {
      id: "nextDueDate",
      header: "Next due",
      responsiveHide: "sm",
      sortable: false,
      cell: (row) => (
        <span className="text-table-cell text-muted t-data">{formatDate(row.nextDueDate)}</span>
      ),
    },
    {
      id: "linkedAsset",
      header: "Linked asset",
      responsiveHide: "md",
      sortable: false,
      cell: (row) => {
        if (row.asset) {
          return (
            <Link
              href={`/assets/registry/${row.asset.id}`}
              className={cn("t-mono text-table-cell text-link hover:underline rounded-sm", focusRing)}
              onClick={(e) => e.stopPropagation()}
            >
              {row.asset.assetTag}
            </Link>
          );
        }
        if (row.bulkAsset) {
          return (
            <Link
              href={`/assets/registry/${row.bulkAsset.id}?type=bulk`}
              className={cn("t-mono text-table-cell text-link hover:underline rounded-sm", focusRing)}
              onClick={(e) => e.stopPropagation()}
            >
              {row.bulkAsset.assetTag}
            </Link>
          );
        }
        return <span className="text-muted">—</span>;
      },
    },
  ];
}

function TestTagTableContent({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("test-tag-registry", { sortBy: "testTagId", sortOrder: "asc" });

  const [search, setSearch] = useState("");

  const { data, isLoading } = useServerQuery({
    queryKey: [
      "test-tag-assets",
      orgId,
      { search, filters, page, pageSize, sortBy, sortOrder },
      refreshSignal,
    ],
    queryFn: () =>
      getTestTagAssets({
        search: search || undefined,
        status: Array.isArray(filters.status) ? filters.status[0] : undefined,
        equipmentClass: Array.isArray(filters.equipmentClass) ? filters.equipmentClass[0] : undefined,
        applianceType: Array.isArray(filters.applianceType) ? filters.applianceType[0] : undefined,
        page,
        pageSize,
      }),
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const columns = useTestTagColumns();

  return (
    <DataTable
      data={items}
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
      searchPlaceholder="Search by tag, description, serial, make, model..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      savedViews={{ tableId: "test-tag-registry", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyPreset="maintenance"
      emptyTitle="No test tag assets found"
      emptyDescription="Register an item or sync from your bulk assets to start tracking compliance."
      onRowClick={(item) => router.push(`/test-and-tag/${item.id}`)}
    />
  );
}

export function TestTagTable({ refreshSignal }: { refreshSignal?: number }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-3 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-[var(--r)]" />
          ))}
        </div>
      }
    >
      <TestTagTableContent refreshSignal={refreshSignal} />
    </Suspense>
  );
}
