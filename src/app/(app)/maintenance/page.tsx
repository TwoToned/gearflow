"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useMaintenanceRecords, fingerprintMaintenanceRecords } from "@/hooks/use-maintenance";
import {
  Plus,
  Wrench,
  CalendarClock,
  CheckCircle2,
  XCircle,
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
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";

const statusConfig: Record<
  string,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  SCHEDULED: {
    label: "Scheduled",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    icon: CalendarClock,
  },
  AWAITING_PARTS: {
    label: "Awaiting Parts",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    icon: CalendarClock,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    icon: Wrench,
  },
  QA: {
    label: "QA",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
    icon: Wrench,
  },
  COMPLETED: {
    label: "Completed",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-red-500/10 text-red-500 border-red-500/20",
    icon: XCircle,
  },
};

const typeLabels: Record<string, string> = {
  REPAIR: "Repair",
  PREVENTATIVE: "Preventative",
  INSPECTION: "Inspection",
  CLEANING: "Cleaning",
  FIRMWARE_UPDATE: "Firmware Update",
};

const resultConfig: Record<string, { label: string; color: string }> = {
  PASS: { label: "Pass", color: "bg-green-500/10 text-green-500 border-green-500/20" },
  FAIL: { label: "Fail", color: "bg-red-500/10 text-red-500 border-red-500/20" },
  CONDITIONAL: {
    label: "Conditional",
    color: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
};

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
        <Link href={`/maintenance/${row.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
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
                <span className="font-mono text-xs">{link.asset?.assetTag}</span>
                <span className="text-fg-3 text-xs ml-2">{link.asset?.model?.name}</span>
              </div>
            ))}
            {assets.length > 2 && (
              <span className="text-xs text-fg-3">+{assets.length - 2} more</span>
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
        { value: "FIRMWARE_UPDATE", label: "Firmware Update" },
      ],
      cell: (row) => <span className="text-sm">{typeLabels[row.type] || row.type}</span>,
    },
    {
      id: "reportedBy",
      header: "Reported By",
      sortKey: "reportedBy",
      defaultVisible: false,
      responsiveHide: "md",
      cell: (row) => <span className="text-sm text-fg-3">{row.reportedBy?.name || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "SCHEDULED", label: "Scheduled", color: "bg-blue-500" },
        { value: "AWAITING_PARTS", label: "Awaiting Parts", color: "bg-blue-500" },
        { value: "IN_PROGRESS", label: "In Progress", color: "bg-amber-500" },
        { value: "QA", label: "QA", color: "bg-cyan-500" },
        { value: "COMPLETED", label: "Completed", color: "bg-green-500" },
        { value: "CANCELLED", label: "Cancelled", color: "bg-red-500" },
      ],
      cell: (row) => {
        const status = statusConfig[row.status];
        const isOverdue =
          (row.status === "SCHEDULED" || row.status === "IN_PROGRESS") &&
          row.scheduledDate && new Date(row.scheduledDate) < now;
        return (
          <Badge
            variant="outline"
            className={`${status?.color || ""} ${isOverdue ? "ring-1 ring-destructive/50" : ""}`}
          >
            {status?.label || row.status}
            {isOverdue ? " (Overdue)" : null}
          </Badge>
        );
      },
    },
    {
      id: "scheduledDate",
      header: "Scheduled",
      sortKey: "scheduledDate",
      cell: (row) => (
        <span className="text-sm text-fg-3">
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
        <span className="text-sm text-fg-3">
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
        { value: "PASS", label: "Pass", color: "bg-green-500" },
        { value: "FAIL", label: "Fail", color: "bg-red-500" },
        { value: "CONDITIONAL", label: "Conditional", color: "bg-amber-500" },
      ],
      cell: (row) =>
        row.result ? (
          <Badge variant="outline" className={resultConfig[row.result]?.color || ""}>
            {resultConfig[row.result]?.label || row.result}
          </Badge>
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
            <Badge key={tag} variant="secondary" className="text-xs">
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
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.id);
            }}
          >
            <Trash2 className="h-4 w-4 text-fg-3 hover:text-destructive" />
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
          <div className="rounded-lg bg-bg-surface surface-ring border-destructive/50 flex items-center gap-3 py-3 px-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span className="text-sm font-medium">
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
              <Button size="sm" className="h-8" render={<Link href="/maintenance/new" />}>
                <Plus className="mr-2 h-4 w-4" />
                New Record
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
