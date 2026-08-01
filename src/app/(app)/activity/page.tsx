"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useState, Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useActivityLogs } from "@/hooks/use-activity-log";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { exportActivityLogCSV } from "@/server/activity-log";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Badge } from "@/components/ui/badge";
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
  quote: "Quote",
  invoice: "Invoice",
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
  // Finance — quotes (convex/quotesWrites.ts / src/server/finance-documents.ts)
  QUOTE_CREATED: "Quote Created",
  QUOTE_SENT: "Quote Sent",
  QUOTE_RECALLED: "Quote Recalled",
  QUOTE_DELETED: "Quote Deleted",
  QUOTE_ACCEPTED: "Quote Accepted",
  QUOTE_DECLINED: "Quote Declined",
  QUOTE_UNACCEPTED: "Quote Unaccepted",
  QUOTE_PROTECTED: "Quote Protected",
  QUOTE_UNPROTECTED: "Quote Unprotected",
  QUOTE_CORRECTED: "Quote Corrected",
  QUOTE_DOCUMENT_STORED: "Quote PDF Stored",
  QUOTE_VERSION_SAVED: "Version Saved",
  // Finance — invoices (convex/invoicesWrites.ts / convex/xeroPush.ts)
  INVOICE_CREATED: "Invoice Created",
  INVOICE_ISSUED: "Invoice Issued",
  INVOICE_VOIDED: "Invoice Voided",
  INVOICE_DELETED: "Invoice Deleted",
  INVOICE_CREDIT_CREATED: "Credit Invoice Created",
  INVOICE_DOCUMENT_STORED: "Invoice PDF Stored",
  INVOICE_XERO_SYNCED: "Synced to Xero",
  INVOICE_XERO_SYNC_FAILED: "Xero Sync Failed",
  // Project lock/unlock (convex/projectUnlockSessionsWrites.ts — locking itself
  // rides on STATUS_CHANGE, see the lockTierFrom/lockTierTo metadata note below)
  UNLOCK_OPENED: "Unlock Opened",
  UNLOCK_COMMITTED: "Unlock Saved & Relocked",
  UNLOCK_DISCARDED: "Unlock Discarded",
  UNLOCK_AUTO_COMMITTED: "Unlock Auto-Closed",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLog = Record<string, any>;

/** `metadata.justification` (lock-tier gates, unlock sessions) and
 *  `metadata.reason` (quote recall/decline, invoice void) are two names for the
 *  same "why" a finance/lifecycle action needed a typed explanation — surfaced
 *  under one label here rather than adding a second column. */
function justificationOf(row: AnyLog): string | undefined {
  const metadata = row.metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>).justification ?? (metadata as Record<string, unknown>).reason;
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Read-side of `writeActivityLog`'s agent stamp (`convex/lib/audit.ts`) — mirrors
 *  `convex/activityLog.ts`'s `isAgentAuthored` (Phase 4, #1000, decision 1), kept
 *  as a small local check rather than importing the Convex module into a client
 *  component. */
function isAgentAuthored(row: AnyLog): boolean {
  return typeof row.metadata === "object" && row.metadata !== null && row.metadata.actorType === "apiKey";
}

const actorFilterOptions = [
  { value: "agent", label: "Agent" },
  { value: "human", label: "Human" },
];

function useActivityColumns(): ColumnDef<AnyLog>[] {
  return [
    {
      id: "createdAt",
      header: "Timestamp",
      sortKey: "createdAt",
      alwaysVisible: true,
      // Most-scanned field, but the actor owns the single subtitle slot, so the
      // timestamp rides as high-value meta rather than the secondary line.
      mobile: "meta",
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
      mobile: "subtitle", // the actor, under the event summary

      cell: (row) => (
        <span className="text-sm">{row.user?.name || row.userName || "\u2014"}</span>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      filterable: true,
      filterType: "enum",
      sortable: false,
      responsiveHide: "md",
      mobile: "meta",
      filterOptions: actorFilterOptions,
      // Agent-authored badge/filter (Phase 4, #1000, decision 1) \u2014 an operator
      // reviews agent-caused writes (especially agent-supplied justifications)
      // as a filterable set rather than having them buried in metadata.
      cell: (row) =>
        isAgentAuthored(row) ? (
          <Badge status="info">Agent</Badge>
        ) : (
          <span className="text-sm text-fg-3">Human</span>
        ),
    },
    {
      id: "action",
      header: "Action",
      accessorKey: "action",
      filterable: true,
      filterType: "enum",
      mobile: "badge",
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
      mobile: "title",
      cell: (row) => (
        <span className="text-sm max-w-[300px] truncate block">{row.summary}</span>
      ),
    },
    {
      id: "justification",
      header: "Reason / Justification",
      sortable: false,
      responsiveHide: "lg",
      mobile: "meta",
      cell: (row) => {
        const value = justificationOf(row);
        return value ? (
          <span className="text-sm text-fg-3 max-w-[240px] truncate block" title={value}>
            {value}
          </span>
        ) : (
          <span className="text-sm text-fg-3">—</span>
        );
      },
    },
  ];
}

function ActivityLogContent() {

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

  // A single selected value narrows to that actor kind; none or both selected
  // (the "show everything" states) leave the filter undefined.
  const actorSelection = Array.isArray(filters.actor) ? filters.actor : [];
  const agentAuthored =
    actorSelection.length === 1 ? actorSelection[0] === "agent" : undefined;

  const queryFilters = {
    search: search || undefined,
    entityType: Array.isArray(filters.entityType) ? filters.entityType[0] : urlEntityType,
    entityId: urlEntityId,
    action: Array.isArray(filters.action) ? filters.action[0] : undefined,
    agentAuthored,
    page,
    pageSize,
    sort: sortBy || "createdAt",
    order: sortOrder,
  };

  const { data, isLoading } = useActivityLogs(queryFilters);

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
        agentAuthored,
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
            variant="line"
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
