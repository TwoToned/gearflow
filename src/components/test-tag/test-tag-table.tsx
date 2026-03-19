"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, Suspense, useCallback } from "react";
import Link from "next/link";
import { getTestTagAssets } from "@/server/test-tag-assets";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    CURRENT: { label: "Current", className: "bg-green-500/15 text-green-600 border-green-500/30" },
    DUE_SOON: { label: "Due Soon", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    OVERDUE: { label: "Overdue", className: "bg-red-500/15 text-red-600 border-red-500/30" },
    FAILED: { label: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/30 border-dashed" },
    NOT_YET_TESTED: { label: "Not Tested", className: "bg-bg-inset text-fg-3" },
    RETIRED: { label: "Retired", className: "bg-bg-inset text-fg-3 opacity-60" },
  };
  const { label, className } = map[status] || { label: status, className: "" };
  return <Badge variant="outline" className={className}>{label}</Badge>;
}

function formatEquipmentClass(value: string): string {
  const map: Record<string, string> = {
    CLASS_I: "Class I",
    CLASS_II: "Class II",
    CLASS_II_DOUBLE_INSULATED: "Class II (DI)",
    LEAD_CORD_ASSEMBLY: "Lead / Cord",
  };
  return map[value] || value;
}

function formatApplianceType(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "\u2014";
  const d = new Date(date);
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = Record<string, any>;

function useTestTagColumns(): ColumnDef<AnyItem>[] {
  return [
    {
      id: "testTagId",
      header: "Test Tag ID",
      accessorKey: "testTagId",
      alwaysVisible: true,
      cell: (row) => (
        <span className="font-mono font-medium text-sm">{row.testTagId}</span>
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
      header: "Equipment Class",
      accessorKey: "equipmentClass",
      filterable: true,
      filterType: "enum",
      responsiveHide: "lg",
      filterOptions: [
        { value: "CLASS_I", label: "Class I" },
        { value: "CLASS_II", label: "Class II" },
        { value: "CLASS_II_DOUBLE_INSULATED", label: "Class II (DI)" },
        { value: "LEAD_CORD_ASSEMBLY", label: "Lead / Cord" },
      ],
      cell: (row) => (
        <span className="text-sm text-fg-3">
          {formatEquipmentClass(row.equipmentClass)}
        </span>
      ),
    },
    {
      id: "applianceType",
      header: "Appliance Type",
      accessorKey: "applianceType",
      filterable: true,
      filterType: "enum",
      responsiveHide: "lg",
      defaultVisible: false,
      filterOptions: [
        { value: "APPLIANCE", label: "Appliance" },
        { value: "CORD_SET", label: "Cord Set" },
        { value: "EXTENSION_LEAD", label: "Extension Lead" },
        { value: "POWER_BOARD", label: "Power Board" },
        { value: "RCD_PORTABLE", label: "RCD Portable" },
        { value: "RCD_FIXED", label: "RCD Fixed" },
        { value: "THREE_PHASE", label: "Three Phase" },
        { value: "OTHER", label: "Other" },
      ],
      cell: (row) => (
        <span className="text-sm text-fg-3">
          {formatApplianceType(row.applianceType)}
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
        { value: "CURRENT", label: "Current", color: "bg-green-500" },
        { value: "DUE_SOON", label: "Due Soon", color: "bg-amber-500" },
        { value: "OVERDUE", label: "Overdue", color: "bg-red-500" },
        { value: "FAILED", label: "Failed", color: "bg-red-500" },
        { value: "NOT_YET_TESTED", label: "Not Tested", color: "bg-gray-500" },
        { value: "RETIRED", label: "Retired", color: "bg-gray-500" },
      ],
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "lastTestDate",
      header: "Last Tested",
      responsiveHide: "sm",
      defaultVisible: false,
      sortable: false,
      cell: (row) => (
        <span className="text-sm text-fg-3">{formatDate(row.lastTestDate)}</span>
      ),
    },
    {
      id: "nextDueDate",
      header: "Next Due",
      responsiveHide: "sm",
      sortable: false,
      cell: (row) => (
        <span className="text-sm text-fg-3">{formatDate(row.nextDueDate)}</span>
      ),
    },
    {
      id: "linkedAsset",
      header: "Linked Asset",
      responsiveHide: "md",
      sortable: false,
      cell: (row) => {
        if (row.asset) {
          return (
            <Link
              href={`/assets/registry/${row.asset.id}`}
              className="text-sm hover:underline"
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
              className="text-sm hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.bulkAsset.assetTag}
            </Link>
          );
        }
        return <span className="text-fg-3">{"\u2014"}</span>;
      },
    },
  ];
}

function TestTagTableContent() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
  } = useTablePreferences("test-tag-registry", { sortBy: "testTagId", sortOrder: "asc" });

  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [
      "test-tag-assets",
      orgId,
      { search, filters, page, pageSize, sortBy, sortOrder },
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
    staleTime: 60_000,
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
      isLoading={isLoading}
      emptyPreset="maintenance"
      emptyTitle="No test tag assets found"
      onRowClick={(item) => router.push(`/test-and-tag/${item.id}`)}
    />
  );
}

export function TestTagTable() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-fg-3" />
        </div>
      }
    >
      <TestTagTableContent />
    </Suspense>
  );
}
