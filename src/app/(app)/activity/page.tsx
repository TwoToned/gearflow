"use client";

import { useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { getActivityLogs, exportActivityLogCSV } from "@/server/activity-log";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

const actionColors: Record<string, string> = {
  CREATE: "bg-emerald-500/15 text-emerald-500",
  UPDATE: "bg-blue-500/15 text-blue-500",
  DELETE: "bg-red-500/15 text-red-500",
  STATUS_CHANGE: "bg-purple-500/15 text-purple-500",
  CHECK_OUT: "bg-amber-500/15 text-amber-500",
  CHECK_IN: "bg-amber-500/15 text-amber-500",
  SCAN: "bg-gray-500/15 text-gray-500",
  ASSIGN: "bg-teal-500/15 text-teal-500",
  UNASSIGN: "bg-teal-500/15 text-teal-500",
  EXPORT: "bg-blue-500/15 text-blue-500",
  IMPORT: "bg-blue-500/15 text-blue-500",
  INVITE: "bg-purple-500/15 text-purple-500",
};

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

function formatDetails(details: unknown): { field: string; from: string; to: string }[] | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;

  if (Array.isArray(d.changes)) {
    return d.changes.map((c: Record<string, unknown>) => ({
      field: String(c.field ?? ""),
      from: String(c.from ?? ""),
      to: String(c.to ?? ""),
    }));
  }

  if (d.before && d.after && typeof d.before === "object" && typeof d.after === "object") {
    const before = d.before as Record<string, unknown>;
    const after = d.after as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changes: { field: string; from: string; to: string }[] = [];
    for (const key of allKeys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes.push({ field: key, from: String(before[key] ?? ""), to: String(after[key] ?? "") });
      }
    }
    return changes.length > 0 ? changes : null;
  }

  const entries = Object.entries(d);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => ({ field: key, from: "", to: String(value ?? "") }));
}

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
        <span className="text-sm">{row.user?.name || row.userName || "—"}</span>
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
        <Badge variant="outline" className={actionColors[row.action] || "bg-gray-500/15 text-gray-500"}>
          {actionLabels[row.action] || row.action}
        </Badge>
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
        <span className="text-sm text-muted-foreground">
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

  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
  } = useTablePreferences("activity-log", { sortBy: "createdAt", sortOrder: "desc" });

  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const queryFilters = {
    search: search || undefined,
    entityType: Array.isArray(filters.entityType) ? filters.entityType[0] : undefined,
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
        entityType: Array.isArray(filters.entityType) ? filters.entityType[0] : undefined,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="t-title text-fg">Activity Log</h1>
          <p className="text-[13px] text-fg-3">
            Audit trail of every action taken by your team.
          </p>
        </div>
      </div>

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
    </div>
  );
}

export default function ActivityLogPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading...</div>}>
      <ActivityLogContent />
    </Suspense>
  );
}
