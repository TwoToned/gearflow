"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { getSubHires } from "@/server/sub-hires";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { formatCurrency } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { subHireStatusLabels } from "@/lib/status-labels";
import { formatLabel } from "@/lib/status-labels";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySubHire = Record<string, any>;

function isOverdue(row: AnySubHire): boolean {
  return row.status === "ON_HIRE" && row.hireEnd && new Date(row.hireEnd) < new Date();
}

function useSubHireColumns(): ColumnDef<AnySubHire>[] {
  return [
    {
      id: "supplier",
      header: "Supplier",
      alwaysVisible: true,
      cell: (row) => (
        <Link
          href={`/sub-hires/${row.id}`}
          className="text-sm font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.supplier?.name || "Unknown"}
        </Link>
      ),
    },
    {
      id: "orderNumber",
      header: "Order #",
      accessorKey: "orderNumber",
      cell: (row) => (
        <span className="font-mono text-sm text-fg-3">{row.orderNumber}</span>
      ),
    },
    {
      id: "project",
      header: "Project",
      cell: (row) =>
        row.project ? (
          <Link
            href={`/projects/${row.project.id}`}
            className="text-sm hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.project.projectNumber} - {row.project.name}
          </Link>
        ) : (
          <span className="text-sm text-fg-4">Unassigned</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "DRAFT", label: "Draft" },
        { value: "CONFIRMED", label: "Confirmed" },
        { value: "ON_HIRE", label: "On Hire" },
        { value: "RETURNED", label: "Returned" },
        { value: "CANCELLED", label: "Cancelled" },
      ],
      cell: (row) =>
        isOverdue(row) ? (
          <StatusIndicator category="subHire" value="OVERDUE" intent="error" label="Overdue" variant="pill" />
        ) : (
          <StatusIndicator
            category="subHire"
            value={row.status}
            label={subHireStatusLabels[row.status] || formatLabel(row.status)}
            variant="pill"
          />
        ),
    },
    {
      id: "hireStart",
      header: "Hire Start",
      accessorKey: "hireStart",
      responsiveHide: "lg",
      cell: (row) => (
        <span className="text-sm text-fg-3">
          {row.hireStart
            ? new Date(row.hireStart).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
            : "\u2014"}
        </span>
      ),
    },
    {
      id: "hireEnd",
      header: "Hire End",
      accessorKey: "hireEnd",
      responsiveHide: "lg",
      cell: (row) => (
        <span className="text-sm text-fg-3">
          {row.hireEnd
            ? new Date(row.hireEnd).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
            : "\u2014"}
        </span>
      ),
    },
    {
      id: "totalCost",
      header: "Cost",
      accessorKey: "totalCost",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-fg-2">{formatCurrency(Number(row.totalCost))}</span>
      ),
    },
    {
      id: "totalCharge",
      header: "Charge",
      accessorKey: "totalCharge",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-fg-2">{formatCurrency(Number(row.totalCharge))}</span>
      ),
    },
    {
      id: "grossMargin",
      header: "Gross Margin",
      align: "right",
      cell: (row) => {
        const margin = Number(row.totalCharge) - Number(row.totalCost);
        const isPositive = margin > 0;
        const isNegative = margin < 0;
        return (
          <span
            className={`tabular-nums ${
              isPositive ? "text-success" : isNegative ? "text-error" : "text-fg-3"
            }`}
          >
            {isPositive ? "+" : ""}
            {formatCurrency(margin)}
          </span>
        );
      },
    },
  ];
}

export default function SubHiresPage() {
  const router = useRouter();
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
  } = useTablePreferences("sub-hires", { sortBy: "createdAt", sortOrder: "desc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  useKeyboardShortcut("n", () => router.push("/sub-hires/new"));

  const columns = useSubHireColumns();

  const { data, isLoading } = useQuery({
    queryKey: ["sub-hires", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () => {
      const statusFilter = filters?.status;
      return getSubHires({
        search: search || undefined,
        status: statusFilter ? (Array.isArray(statusFilter) ? statusFilter : [statusFilter]) : undefined,
        supplierId: filters?.supplierId as string | undefined,
      });
    },
  });

  const subHires = data || [];

  return (
    <FadeIn>
      <RequirePermission resource="subHire" action="read">
        <div className="space-y-4">
          <PageHeader
            title="Sub-Hires"
            description="Track gear rented from suppliers with cost and margin visibility."
          />

          <DataTable
            data={subHires}
            columns={columns}
            totalRows={subHires.length}
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
            searchPlaceholder="Search by order number, supplier, or item..."
            columnVisibility={columnVisibility}
            onToggleColumnVisibility={toggleColumnVisibility}
            onResetPreferences={resetPreferences}
            isLoading={isLoading}
            emptyTitle="No sub-hires yet"
            emptyDescription="Sub-hires track gear rented from suppliers with cost and margin visibility."
            toolbarActions={
              <CanDo resource="subHire" action="create">
                <Button size="sm" className="h-8" render={<Link href="/sub-hires/new" />}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Sub-Hire
                </Button>
              </CanDo>
            }
          />
        </div>
      </RequirePermission>
    </FadeIn>
  );
}
