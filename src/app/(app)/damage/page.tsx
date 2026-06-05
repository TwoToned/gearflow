"use client";

/**
 * Damage events list. Deep-linked from the project P&L panel via
 * `/damage?projectId=...`. Filterable by status / severity.
 *
 * Inline quick-actions: charge-back toggle and resolve. The full editor
 * lives in a detail drawer (TODO: build in a follow-up if triage needs
 * more than these two toggles).
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Camera,
  CheckCircle2,
  Receipt,
  RotateCcw,
} from "lucide-react";

import {
  listDamageEvents,
  chargeBackDamage,
  resolveDamage,
} from "@/server/damage";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { showError } from "@/lib/show-error";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/formatters";

const severityConfig: Record<string, { label: string; className: string }> = {
  MINOR: { label: "Minor", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  MAJOR: { label: "Major", className: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  TOTAL: { label: "Total", className: "bg-red-500/10 text-red-600 border-red-500/30" },
};

const statusConfig: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  UNDER_REPAIR: { label: "Under repair", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  RESOLVED: { label: "Resolved", className: "bg-green-500/10 text-green-600 border-green-500/30" },
  CHARGED_BACK: { label: "Charged back", className: "bg-purple-500/10 text-purple-600 border-purple-500/30" },
};

// Anywhere we touch `row` we keep the type loose — server fn returns
// includes for asset / bulkAsset / project / createdBy that the
// DataTable type doesn't strictly know about.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

function DamageListContent() {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const searchParams = useSearchParams();
  const urlProjectId = searchParams.get("projectId") || undefined;

  const {
    pageSize, page, setPage, setPageSize,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("damage-events", { sortBy: "createdAt", sortOrder: "desc" });

  const [search, setSearch] = useState("");

  const queryFilters = {
    search: search || undefined,
    status: Array.isArray(filters.status) ? filters.status[0] as "OPEN" | "UNDER_REPAIR" | "RESOLVED" | "CHARGED_BACK" : undefined,
    severity: Array.isArray(filters.severity) ? filters.severity[0] as "MINOR" | "MAJOR" | "TOTAL" : undefined,
    projectId: urlProjectId,
    page,
    pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["damage-events", orgId, queryFilters],
    queryFn: () => listDamageEvents(queryFilters),
    enabled: !!orgId,
  });

  const items = (data?.items ?? []) as AnyRow[];
  const total = data?.total ?? 0;

  const chargeBackMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => chargeBackDamage(id, value),
    onSuccess: (_data, variables) => {
      toast.success(variables.value ? "Marked charged back" : "Charge-back removed");
      queryClient.invalidateQueries({ queryKey: ["damage-events"] });
      queryClient.invalidateQueries({ queryKey: ["project-operational-costs"] });
    },
    onError: (e) => showError(e),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveDamage(id),
    onSuccess: () => {
      toast.success("Marked resolved");
      queryClient.invalidateQueries({ queryKey: ["damage-events"] });
    },
    onError: (e) => showError(e),
  });

  const columns: ColumnDef<AnyRow>[] = [
    {
      id: "createdAt",
      header: "Reported",
      alwaysVisible: true,
      cell: (row) => (
        <span className="whitespace-nowrap text-sm text-fg-2">
          {format(new Date(row.createdAt), "d MMM yyyy")}
        </span>
      ),
    },
    {
      id: "item",
      header: "Item",
      sortable: false,
      cell: (row) => {
        const tag = row.asset?.assetTag ?? row.bulkAsset?.assetTag;
        const name = row.asset?.customName ?? row.asset?.model?.name ?? row.bulkAsset?.model?.name ?? "—";
        return (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            {tag && <div className="text-xs text-fg-3">{tag}</div>}
          </div>
        );
      },
    },
    {
      id: "severity",
      header: "Severity",
      accessorKey: "severity",
      filterable: true,
      filterType: "enum",
      filterOptions: Object.entries(severityConfig).map(([value, c]) => ({ value, label: c.label })),
      cell: (row) => {
        const cfg = severityConfig[row.severity] ?? { label: row.severity, className: "" };
        return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
      },
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: Object.entries(statusConfig).map(([value, c]) => ({ value, label: c.label })),
      cell: (row) => {
        const cfg = statusConfig[row.status] ?? { label: row.status, className: "" };
        return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
      },
    },
    {
      id: "project",
      header: "Project",
      responsiveHide: "md",
      sortable: false,
      cell: (row) =>
        row.project ? (
          <Link
            href={`/projects/${row.project.id}`}
            className="text-sm text-fg-2 hover:underline"
          >
            {row.project.projectNumber}
          </Link>
        ) : (
          <span className="text-xs text-fg-4">—</span>
        ),
    },
    {
      id: "cost",
      header: "Cost",
      responsiveHide: "md",
      sortable: false,
      cell: (row) => {
        const cost = row.actualCost ?? row.estimatedCost;
        if (cost == null) return <span className="text-xs text-fg-4">—</span>;
        return (
          <span className="tabular-nums text-sm">
            {formatCurrency(Number(cost))}
            {row.actualCost == null && <span className="ml-1 text-[10px] text-fg-4">est.</span>}
          </span>
        );
      },
    },
    {
      id: "chargedBack",
      header: "Charged back",
      responsiveHide: "sm",
      sortable: false,
      cell: (row) =>
        row.chargedBack ? (
          <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30">
            <Receipt className="mr-1 size-3" /> Yes
          </Badge>
        ) : (
          <span className="text-xs text-fg-4">No</span>
        ),
    },
    {
      id: "photos",
      header: "Photos",
      responsiveHide: "sm",
      sortable: false,
      cell: (row) => {
        const count = (row.photos as string[] | undefined)?.length ?? 0;
        return count > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-fg-3">
            <Camera className="size-3" /> {count}
          </span>
        ) : (
          <span className="text-xs text-fg-4">—</span>
        );
      },
    },
    {
      id: "notes",
      header: "Notes",
      responsiveHide: "lg",
      sortable: false,
      cell: (row) => (
        <span className="text-sm text-fg-3 line-clamp-1 max-w-[260px]">{row.notes}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      alwaysVisible: true,
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.status !== "RESOLVED" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => resolveMutation.mutate(row.id)}
              disabled={resolveMutation.isPending}
              title="Mark resolved"
            >
              <CheckCircle2 className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              chargeBackMutation.mutate({ id: row.id, value: !row.chargedBack })
            }
            disabled={chargeBackMutation.isPending}
            title={row.chargedBack ? "Unmark charge-back" : "Charge back to client"}
          >
            {row.chargedBack ? <RotateCcw className="size-3.5" /> : <Receipt className="size-3.5" />}
          </Button>
        </div>
      ),
    },
  ];

  const scopeLabel = urlProjectId ? " for this project" : "";
  const description =
    total > 0
      ? `${total.toLocaleString()} event${total === 1 ? "" : "s"}${scopeLabel}`
      : "No damage reported yet.";

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title="Damage events"
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
        filters={filters}
        onFilterChange={setFilter}
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search notes or asset tag..."
        columnVisibility={columnVisibility}
        onToggleColumnVisibility={toggleColumnVisibility}
        onResetPreferences={resetPreferences}
        savedViews={{ tableId: "damage-events", currentConfig, applyConfig }}
        isLoading={isLoading}
      />
    </FadeIn>
  );
}

export default function DamageListPage() {
  return (
    <RequirePermission resource="maintenance" action="read">
      <Suspense fallback={<div className="p-6 text-fg-3">Loading…</div>}>
        <DamageListContent />
      </Suspense>
    </RequirePermission>
  );
}
