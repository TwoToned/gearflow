"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { getActivityLogs, exportActivityLogCSV } from "@/server/activity-log";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";

const entityTypeLabels: Record<string, string> = {
  asset: "Asset",
  bulkAsset: "Bulk Asset",
  model: "Model",
  kit: "Kit",
  project: "Project",
  client: "Client",
  location: "Location",
  category: "Category",
  supplier: "Supplier",
  maintenance: "Maintenance",
  testTagAsset: "T&T Asset",
  testTagRecord: "T&T Record",
  lineItem: "Line Item",
  member: "Member",
  invitation: "Invitation",
  settings: "Settings",
};

const actionLabels: Record<string, string> = {
  CREATE: "Create",
  UPDATE: "Update",
  DELETE: "Delete",
  STATUS_CHANGE: "Status Change",
  CHECK_OUT: "Deploy",
  CHECK_IN: "Return",
  ASSIGN: "Assign",
  UNASSIGN: "Unassign",
  EXPORT: "Export",
  IMPORT: "Import",
  INVITE: "Invite",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLog = Record<string, any>;

function useActivityColumns(): ColumnDef<AnyLog>[] {
  return [
    {
      id: "createdAt",
      header: "Timestamp",
      sortKey: "createdAt",
      alwaysVisible: true,
      cell: (row) => (
        <span className="whitespace-nowrap text-sm">
          {format(new Date(row.createdAt), "MMM d, yyyy HH:mm")}
        </span>
      ),
    },
    {
      id: "userName",
      header: "User",
      responsiveHide: "sm",
      sortable: false,
      cell: (row) => (
        <span className="text-sm">{row.user?.name || row.userName || "\u2014"}</span>
      ),
    },
    {
      id: "action",
      header: "Action",
      accessorKey: "action",
      filterable: true,
      filterType: "enum",
      filterOptions: Object.entries(actionLabels).map(([value, label]) => ({ value, label })),
      cell: (row) => (
        <StatusIndicator category="activity" value={row.action} label={actionLabels[row.action] || row.action} variant="pill" />
      ),
    },
    {
      id: "entityType",
      header: "Entity Type",
      accessorKey: "entityType",
      filterable: true,
      filterType: "enum",
      responsiveHide: "md",
      filterOptions: Object.entries(entityTypeLabels).map(([value, label]) => ({ value, label })),
      cell: (row) => (
        <span className="text-sm text-fg-3">
          {entityTypeLabels[row.entityType] || row.entityType}
        </span>
      ),
    },
    {
      id: "summary",
      header: "Summary",
      accessorKey: "summary",
      sortable: false,
      cell: (row) => (
        <span className="text-sm max-w-[300px] truncate block">{row.summary}</span>
      ),
    },
  ];
}

function ActivityLogContent() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const searchParams = useSearchParams();
  const urlEntityType = searchParams.get("entityType") || undefined;
  const urlEntityId = searchParams.get("entityId") || undefined;

  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("activity-log", { sortBy: "createdAt", sortOrder: "desc" });

  // Pre-seed the entityType filter from the URL so deep-links from
  // per-entity ActivityTimeline "View all" land with the dropdown set.
  useEffect(() => {
    if (urlEntityType) setFilter("entityType", [urlEntityType]);
  }, [urlEntityType, setFilter]);

  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const queryFilters = {
    search: search || undefined,
    entityType: Array.isArray(filters.entityType) ? filters.entityType[0] : urlEntityType,
    entityId: urlEntityId,
    action: Array.isArray(filters.action) ? filters.action[0] : undefined,
    page,
    pageSize,
    sort: sortBy || "createdAt",
    order: sortOrder,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["activity-logs", orgId, queryFilters],
    queryFn: () => getActivityLogs(queryFilters),
    enabled: !!orgId,
  });

  const items = (data?.items || []) as AnyLog[];
  const total = data?.total || 0;

  const columns = useActivityColumns();

  async function handleExport() {
    setIsExporting(true);
    try {
      const csv = await exportActivityLogCSV({
        search: search || undefined,
        entityType: Array.isArray(filters.entityType) ? filters.entityType[0] : urlEntityType,
        entityId: urlEntityId,
        action: Array.isArray(filters.action) ? filters.action[0] : undefined,
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Activity log exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  // Build contextual description
  const scopeLabel = urlEntityId
    ? `${entityTypeLabels[urlEntityType ?? ""] ?? urlEntityType ?? "entity"} ${urlEntityId.slice(0, 8)}…`
    : null;
  const description = scopeLabel
    ? `Filtered to ${scopeLabel} · ${total.toLocaleString()} ${total === 1 ? "event" : "events"}`
    : total > 0
      ? `${total.toLocaleString()} recorded ${total === 1 ? "event" : "events"} across your workspace`
      : "Audit trail of every action taken by your team.";

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Activity Log"
        description={description}
      />

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
        searchPlaceholder="Search activity..."
        columnVisibility={columnVisibility}
        onToggleColumnVisibility={toggleColumnVisibility}
        onResetPreferences={resetPreferences}
        savedViews={{ tableId: "activity-log", currentConfig, applyConfig }}
        isLoading={isLoading}
        emptyPreset="activity"
        toolbarActions={
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
        }
      />
    </FadeIn>
  );
}

export default function ActivityLogPage() {
  return (
    <Suspense fallback={<div className="p-6 text-fg-3">Loading...</div>}>
      <ActivityLogContent />
    </Suspense>
  );
}
