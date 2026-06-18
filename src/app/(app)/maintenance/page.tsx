"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useMaintenanceRecords, fingerprintMaintenanceRecords } from "@/hooks/use-maintenance";
import {
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import {
  getMaintenanceRecords,
  deleteMaintenanceRecord,
} from "@/server/maintenance";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { getStatusColor } from "@/lib/status-colors";
import {
  maintenanceStatusLabels,
  maintenanceTypeLabels,
  maintenanceResultLabels,
  formatLabel,
} from "@/lib/status-labels";
import { cn, focusRing } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function useMaintenanceColumns(
  now: Date,
  onDelete: (id: string) => void,
): ColumnDef<AnyRecord>[] {
  return [
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      alwaysVisible: true,
      sortKey: "title",
      cell: (row) => (
        <Link href={`/maintenance/${row.id}`} className={cn("rounded-sm font-medium text-ink hover:underline", focusRing)} onClick={(e) => e.stopPropagation()}>
          {row.title}
        </Link>
      ),
    },
    {
      id: "asset",
      header: "Asset",
      sortKey: "asset",
      cell: (row) => {
        const assets = row.assets || [];
        if (assets.length === 0) return "—";
        return (
          <div className="space-y-0.5">
            {assets.slice(0, 2).map((link: AnyRecord) => (
              <div key={link.id}>
                <span className="t-mono">{link.asset?.assetTag}</span>
                <span className="text-muted text-caption ml-2">{link.asset?.model?.name}</span>
              </div>
            ))}
            {assets.length > 2 && (
              <span className="text-caption text-muted">+{assets.length - 2} more</span>
            )}
          </div>
        );
      },
    },
    {
      id: "type",
      header: "Type",
      accessorKey: "type",
      sortKey: "type",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "REPAIR", label: "Repair" },
        { value: "PREVENTATIVE", label: "Preventative" },
        { value: "INSPECTION", label: "Inspection" },
        { value: "CLEANING", label: "Cleaning" },
        { value: "FIRMWARE_UPDATE", label: "Firmware update" },
      ],
      cell: (row) => <span className="text-ui-text">{maintenanceTypeLabels[row.type] || formatLabel(row.type)}</span>,
    },
    {
      id: "reportedBy",
      header: "Reported by",
      sortKey: "reportedBy",
      defaultVisible: false,
      responsiveHide: "md",
      cell: (row) => <span className="text-ui-text text-muted">{row.reportedBy?.name || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "SCHEDULED", label: "Scheduled", color: getStatusColor("maintenance", "SCHEDULED").dot },
        { value: "AWAITING_PARTS", label: "Awaiting parts", color: getStatusColor("maintenance", "AWAITING_PARTS").dot },
        { value: "IN_PROGRESS", label: "In progress", color: getStatusColor("maintenance", "IN_PROGRESS").dot },
        { value: "QA", label: "QA", color: getStatusColor("maintenance", "QA").dot },
        { value: "COMPLETED", label: "Completed", color: getStatusColor("maintenance", "COMPLETED").dot },
        { value: "CANCELLED", label: "Cancelled", color: getStatusColor("maintenance", "CANCELLED").dot },
      ],
      cell: (row) => {
        const isOverdue =
          (row.status === "SCHEDULED" || row.status === "IN_PROGRESS") &&
          row.scheduledDate && new Date(row.scheduledDate) < now;
        return (
          <div className="flex items-center gap-1.5">
            <StatusIndicator
              category="maintenance"
              value={row.status}
              label={maintenanceStatusLabels[row.status] || formatLabel(row.status)}
              variant="pill"
            />
            {isOverdue ? <Badge status="overbooked">Overdue</Badge> : null}
          </div>
        );
      },
    },
    {
      id: "scheduledDate",
      header: "Scheduled",
      sortKey: "scheduledDate",
      cell: (row) => (
        <span className="text-ui-text text-muted tabular-nums">
          {row.scheduledDate ? format(new Date(row.scheduledDate), "MMM d, yyyy") : "—"}
        </span>
      ),
    },
    {
      id: "completedDate",
      header: "Completed",
      sortKey: "completedDate",
      defaultVisible: false,
      cell: (row) => (
        <span className="text-ui-text text-muted tabular-nums">
          {row.completedDate ? format(new Date(row.completedDate), "MMM d, yyyy") : "—"}
        </span>
      ),
    },
    {
      id: "result",
      header: "Result",
      accessorKey: "result",
      sortKey: "result",
      filterable: true,
      filterType: "enum",
      defaultVisible: false,
      filterOptions: [
        { value: "PASS", label: "Pass", color: getStatusColor("maintenanceResult", "PASS").dot },
        { value: "FAIL", label: "Fail", color: getStatusColor("maintenanceResult", "FAIL").dot },
        { value: "CONDITIONAL", label: "Conditional", color: getStatusColor("maintenanceResult", "CONDITIONAL").dot },
      ],
      cell: (row) =>
        row.result ? (
          <StatusIndicator
            category="maintenanceResult"
            value={row.result}
            label={maintenanceResultLabels[row.result] || formatLabel(row.result)}
            variant="pill"
          />
        ) : (
          "—"
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
            <Badge key={tag} status="neutral">
              {tag}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      width: 40,
      cell: (row) => (
        <CanDo resource="maintenance" action="delete">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted hover:text-t-out"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </CanDo>
      ),
    },
  ];
}

export default function MaintenancePage() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("maintenance", { sortBy: "scheduledDate", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading, refetch } = useServerQuery({
    queryKey: ["maintenance", orgId, search, filters, page, pageSize, sortBy, sortOrder],
    queryFn: () =>
      getMaintenanceRecords({
        search: search || undefined,
        status: Array.isArray(filters.status) ? filters.status[0] : undefined,
        type: Array.isArray(filters.type) ? filters.type[0] : undefined,
        page,
        pageSize,
        sortBy: sortBy || undefined,
        sortOrder: sortBy ? sortOrder : undefined,
      }),
  });

  // Cross-tab live sync: subscribe to the dual-written Convex maintenanceRecords
  // table; a fingerprint change (new repair, kanban move, field edit, deletion in
  // another tab) triggers the existing server-action refetch.
  const maintenanceDocs = useMaintenanceRecords(orgId);
  const maintenanceFp = fingerprintMaintenanceRecords(maintenanceDocs);
  const prevMaintenanceFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (maintenanceFp !== undefined && prevMaintenanceFp.current !== undefined && maintenanceFp !== prevMaintenanceFp.current) {
      refetch();
    }
    if (maintenanceFp !== undefined) prevMaintenanceFp.current = maintenanceFp;
  }, [maintenanceFp, refetch]);

  // Same-view read+write island: the delete invalidated ["maintenance"] (this
  // reader's own key) — replaced by refetch(). Not in the SSE map, so no
  // cross-user liveness is lost (data-identical).
  const deleteMutation = useServerMutation({
    mutationFn: deleteMaintenanceRecord,
    onSuccess: () => {
      refetch();
      toast.success("Record deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const records = (data?.records || []) as AnyRecord[];
  const total = data?.total || 0;
  const now = new Date();

  const columns = useMaintenanceColumns(now, (id) => setDeleteId(id));

  const overdueMaintenance = records.filter((r) => {
    if (r.status !== "SCHEDULED" && r.status !== "IN_PROGRESS") return false;
    return r.scheduledDate && new Date(r.scheduledDate) < now;
  }).length;

  return (
    <FadeIn>
      <RequirePermission resource="maintenance" action="read">
        <div className="space-y-6">
        <PageHeader
          title="Maintenance"
          description="Repairs, inspections, and scheduled servicing."
        />

        {overdueMaintenance > 0 && (
          <div className="flex items-center gap-3 rounded-[var(--r)] border border-line border-l-2 border-l-t-out bg-card px-4 py-3 shadow-[var(--sh-card)]">
            <AlertTriangle className="h-5 w-5 shrink-0 text-t-out" />
            <span className="text-ui-text font-medium text-ink">
              {overdueMaintenance} overdue maintenance{" "}
              {overdueMaintenance === 1 ? "record" : "records"}
            </span>
          </div>
        )}

        <DataTable
          data={records}
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
          searchPlaceholder="Search records..."
          columnVisibility={columnVisibility}
          onToggleColumnVisibility={toggleColumnVisibility}
          onResetPreferences={resetPreferences}
          savedViews={{ tableId: "maintenance", currentConfig, applyConfig }}
          isLoading={isLoading}
          emptyPreset="maintenance"
          toolbarActions={
            <CanDo resource="maintenance" action="create">
              <Button size="sm" asChild>
                <Link href="/maintenance/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New record
                </Link>
              </Button>
            </CanDo>
          }
        />
      </div>
    </RequirePermission>
    <DeleteDialog
      open={!!deleteId}
      onOpenChange={(open) => !open && setDeleteId(null)}
      title="Delete maintenance record?"
      description="This removes the maintenance record and its work-order history. This cannot be undone."
      confirmLabel="Delete record"
      onConfirm={() => {
        if (deleteId) {
          deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }
      }}
      pending={deleteMutation.isPending}
    />
    </FadeIn>
  );
}
