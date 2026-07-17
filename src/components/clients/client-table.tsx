"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Archive } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { useClientProjectCounts } from "@/hooks/use-client-project-counts";
import { useClientWrites } from "@/hooks/use-native-client-writes";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { getStatusColor } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";

const typeLabels: Record<string, string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual",
  VENUE: "Venue",
  PRODUCTION_COMPANY: "Production co.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = Record<string, any>;

const columns: ColumnDef<AnyClient>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    alwaysVisible: true,
    sortKey: "name",
    mobile: "title",
    cell: (row) => (
      <Link
        href={`/clients/${row.id}`}
        className={cn("rounded-sm font-medium text-ink hover:underline", focusRing)}
        onClick={(e) => e.stopPropagation()}
      >
        {row.name}
      </Link>
    ),
  },
  {
    id: "type",
    header: "Type",
    accessorKey: "type",
    sortKey: "type",
    filterable: true,
    filterType: "enum",
    mobile: "badge",
    filterOptions: [
      { value: "COMPANY", label: "Company", color: getStatusColor("clientType", "COMPANY").dot },
      { value: "INDIVIDUAL", label: "Individual", color: getStatusColor("clientType", "INDIVIDUAL").dot },
      { value: "VENUE", label: "Venue", color: getStatusColor("clientType", "VENUE").dot },
      { value: "PRODUCTION_COMPANY", label: "Production company", color: getStatusColor("clientType", "PRODUCTION_COMPANY").dot },
    ],
    cell: (row) => (
      <StatusIndicator category="clientType" value={row.type} label={typeLabels[row.type] || row.type} variant="pill" />
    ),
  },
  {
    id: "contactName",
    header: "Contact",
    accessorKey: "contactName",
    sortKey: "contactName",
    responsiveHide: "md",
    mobile: "subtitle",
    cell: (row) => (
      <span className="text-muted">
        {row.contactName || "\u2014"}
      </span>
    ),
  },
  {
    id: "contactEmail",
    header: "Email",
    accessorKey: "contactEmail",
    sortKey: "contactEmail",
    responsiveHide: "md",
    mobile: "meta",
    cell: (row) => (
      <span className="text-muted">
        {row.contactEmail || "\u2014"}
      </span>
    ),
  },
  {
    id: "projects",
    header: "Projects",
    sortKey: "name",
    align: "right",
    mobile: "meta",
    cell: (row) => <span className="t-data">{row._count?.projects ?? 0}</span>,
  },
  {
    id: "isActive",
    header: "Status",
    sortKey: "isActive",
    mobile: "badge",
    cell: (row) => (
      <Badge status={row.isActive ? "ok" : "overbooked"}>
        {row.isActive ? "Active" : "Archived"}
      </Badge>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    sortable: false,
    defaultVisible: true,
    responsiveHide: "lg",
    mobile: "hidden",
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
];

export function ClientTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("clients", { sortBy: "name", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { bulkArchive } = useClientWrites();
  const clearSelection = () => setSelectedIds(new Set());
  const bulkArchiveMutation = useServerMutation({
    mutationFn: () => bulkArchive(Array.from(selectedIds)),
    onSuccess: (result) => {
      toast.success(`Archived ${result.archived} client${result.archived === 1 ? "" : "s"}`);
      clearSelection();
    },
    onError: (e) => toast.error(e.message),
  });

  // ONE server-side query (filter + sort done in Convex) instead of the
  // whole-org live subscription this used to mount (useClients) and filter/
  // sort client-side. See docs/designs/perf-convex-efficiency-2026-06.md
  // Finding #1. Project counts are cross-domain (projects still in Prisma) so
  // they stay a separate, non-reactive server query merged in below —
  // unchanged. Search is debounced since each keystroke is now a real
  // round-trip.
  const debouncedSearch = useDebouncedValue(search, 200);
  // Enum filter columns always store FilterValue as string[] (src/lib/table-utils.ts) —
  // unwrap to the first selected value, matching asset-table.tsx's pick(). Without this,
  // the array was cast straight into a Convex arg typed v.optional(v.string()), which
  // throws an ArgumentValidationError the moment this filter is applied.
  const typeFilter = Array.isArray(filters?.type) ? filters.type[0] : (filters?.type as string | undefined);
  const clientsPage = useAuthedQuery(
    api.clients.listPage,
    orgId
      ? {
          orgId,
          search: debouncedSearch.trim() || undefined,
          type: typeFilter,
          page,
          pageSize,
          sortBy,
          sortOrder,
        }
      : "skip",
  );
  const { data: pagedClients, total, isLoading } = usePaginatedTableResult(clientsPage);
  const projectCounts = useClientProjectCounts(orgId);

  const clients = useMemo(
    () => pagedClients.map((c) => ({ ...c, _count: { projects: projectCounts?.[c.id] ?? 0 } })),
    [pagedClients, projectCounts],
  );

  const toolbarActions = (
    <CanDo resource="client" action="create">
      <Button asChild>
        <Link href="/clients/new">
          <Plus className="mr-2 h-4 w-4" />
          New client
        </Link>
      </Button>
    </CanDo>
  );

  return (
    <div className="space-y-4">
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--r)] border-2 border-line-2 bg-paper-2/50 px-4 py-2">
          <span className="text-ui-text font-medium text-ink tabular-nums">{selectedIds.size} selected</span>
          <CanDo resource="client" action="update">
            <Button
              size="sm"
              variant="line"
              className="text-warn"
              loading={bulkArchiveMutation.isPending}
              onClick={() => setBulkArchiveOpen(true)}
            >
              <Archive className="mr-2 h-3 w-3" />
              Archive
            </Button>
          </CanDo>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      <DataTable
        data={clients}
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
        searchPlaceholder="Search by name, contact, or email..."
        columnVisibility={columnVisibility}
        onToggleColumnVisibility={toggleColumnVisibility}
        onResetPreferences={resetPreferences}
        savedViews={{ tableId: "clients", currentConfig, applyConfig }}
        isLoading={isLoading}
        emptyPreset="clients"
        emptyTitle="No clients yet"
        emptyDescription="Add a client to start quoting and tracking their projects."
        enableRowSelection
        selectedRows={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbarActions={toolbarActions}
      />

      <DeleteDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        title={`Archive ${selectedIds.size} client${selectedIds.size === 1 ? "" : "s"}?`}
        description="Archived clients are hidden from the active list but keep their history and projects. You can reactivate a client from its detail page."
        confirmLabel={`Archive ${selectedIds.size}`}
        onConfirm={() => {
          bulkArchiveMutation.mutate();
          setBulkArchiveOpen(false);
        }}
        pending={bulkArchiveMutation.isPending}
      />
    </div>
  );
}
