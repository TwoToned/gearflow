"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { api } from "../../../../convex/_generated/api";
import { useMaintenanceRecords } from "@/hooks/use-maintenance";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Wrench,
  Activity,
  CircleCheck,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
      mobile: "subtitle", // the serviced asset is the headline; the record title sits under it

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
      mobile: "title",
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
        { value: "REPAIR", label: maintenanceTypeLabels.REPAIR },
        { value: "PREVENTATIVE", label: maintenanceTypeLabels.PREVENTATIVE },
        { value: "TEST_AND_TAG", label: maintenanceTypeLabels.TEST_AND_TAG },
        { value: "INSPECTION", label: maintenanceTypeLabels.INSPECTION },
        { value: "CLEANING", label: maintenanceTypeLabels.CLEANING },
        { value: "FIRMWARE_UPDATE", label: maintenanceTypeLabels.FIRMWARE_UPDATE },
      ],
      cell: (row) => <span className="text-ui-text">{maintenanceTypeLabels[row.type] || formatLabel(row.type)}</span>,
    },
    {
      id: "reportedBy",
      header: "Reported by",
      sortKey: "reportedBy",
      defaultVisible: false,
      responsiveHide: "md",
      mobile: "hidden", // low-signal on a mobile card; off by default on desktop too

      cell: (row) => <span className="text-ui-text text-muted">{row.reportedBy?.name || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      mobile: "badge",
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
      mobile: "meta",
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
      mobile: "badge",
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
      mobile: "hidden", // low-signal chips on a mobile card
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
      mobile: "actions",
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

/**
 * Dashboard metric tile for the maintenance list header (Retool/Zoho pattern:
 * a row of bordered metric cards above the table). Mirrors the crew dashboard's
 * StatCard idiom. §1: `alert` (overdue/failed) tints the figure + ring t-out;
 * `accent` (active/in-progress) tints the figure red (live work).
 */
function MaintenanceStatCard({
  title,
  value,
  description,
  icon: Icon,
  alert,
  accent,
  loading,
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: ComponentType<{ className?: string }>;
  alert?: boolean;
  accent?: boolean;
  loading?: boolean;
}) {
  const figureColor = alert ? "text-t-out" : accent ? "text-red" : "text-ink";
  const iconColor = alert ? "text-t-out" : accent ? "text-red" : "text-muted";
  return (
    <div
      className={cn(
        "rounded-[var(--r-lg)] bg-card p-4 ring-1 shadow-[var(--sh-card)]",
        alert ? "ring-t-out/50" : "ring-line",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-text font-medium text-ink-2">{title}</span>
        <Icon className={cn("size-4", iconColor)} />
      </div>
      {loading ? (
        <Skeleton className="h-9 w-14" />
      ) : (
        <div className={cn("text-section-header font-display font-extrabold tabular-nums", figureColor)}>
          {value}
        </div>
      )}
      {description && <p className="text-caption text-muted">{description}</p>}
    </div>
  );
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

  // Browser-direct reactive list read (re-home of getMaintenanceRecords). The
  // subscription auto-updates on any create/update/delete/kanban move in any tab,
  // so no manual refetch/fingerprint machinery is needed.
  const data = useAuthedQuery(
    api.maintenanceRecords.recordsPage,
    orgId
      ? {
          orgId,
          search: search || undefined,
          status: Array.isArray(filters.status) ? filters.status[0] : undefined,
          type: Array.isArray(filters.type) ? filters.type[0] : undefined,
          page,
          pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortBy ? sortOrder : undefined,
        }
      : "skip",
  );
  const isLoading = data === undefined;

  // Org-wide subscription still powers the dashboard stat tiles below.
  const maintenanceDocs = useMaintenanceRecords(orgId);

  const writes = useMaintenanceWrites();
  const deleteMutation = useServerMutation({
    mutationFn: (id: string) => writes.remove(id),
    onSuccess: () => {
      toast.success("Record deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const records = (data?.records || []) as AnyRecord[];
  const total = data?.total || 0;
  const now = new Date();

  const columns = useMaintenanceColumns(now, (id) => setDeleteId(id));

  // Dashboard stats — derived CLIENT-SIDE from the full org-wide maintenance
  // list streamed over Convex (maintenanceDocs), NOT the paginated table page,
  // so the tiles reflect every record regardless of the current page/filter.
  // While the subscription is loading (undefined), stats render a skeleton.
  const statsLoading = maintenanceDocs === undefined;
  const OPEN_STATUSES = ["SCHEDULED", "AWAITING_PARTS", "IN_PROGRESS", "QA"];
  const nowMs = now.getTime();
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const docs = maintenanceDocs ?? [];
  const openCount = docs.filter((d) => OPEN_STATUSES.includes(d.status ?? "")).length;
  const overdueCount = docs.filter(
    (d) =>
      (d.status === "SCHEDULED" || d.status === "IN_PROGRESS") &&
      typeof d.scheduledDate === "number" &&
      d.scheduledDate < nowMs,
  ).length;
  const inProgressCount = docs.filter((d) => d.status === "IN_PROGRESS").length;
  const completedThisMonth = docs.filter(
    (d) =>
      d.status === "COMPLETED" &&
      typeof d.completedDate === "number" &&
      d.completedDate >= monthStartMs,
  ).length;

  // Banner reuses the same org-wide overdue count.
  const overdueMaintenance = overdueCount;

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

        {/* Dashboard stat tiles — org-wide metrics derived from maintenanceDocs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MaintenanceStatCard
            title="Open"
            value={openCount}
            description="Scheduled, awaiting parts, in progress and QA"
            icon={Wrench}
            loading={statsLoading}
          />
          <MaintenanceStatCard
            title="Overdue"
            value={overdueCount}
            description="Past their scheduled date"
            icon={AlertTriangle}
            alert={overdueCount > 0}
            loading={statsLoading}
          />
          <MaintenanceStatCard
            title="In progress"
            value={inProgressCount}
            description="Active work right now"
            icon={Activity}
            accent={inProgressCount > 0}
            loading={statsLoading}
          />
          <MaintenanceStatCard
            title="Completed this month"
            value={completedThisMonth}
            description={format(now, "MMMM yyyy")}
            icon={CircleCheck}
            loading={statsLoading}
          />
        </div>

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
          emptyTitle="No maintenance records"
          emptyDescription="Repairs, inspections, and scheduled servicing will appear here once you log them."
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
