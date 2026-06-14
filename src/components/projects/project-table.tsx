"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { useServerQuery } from "@/hooks/use-server-query";
import { Plus, AlertTriangle, ShieldAlert } from "lucide-react";

import { getProjectIssueFlags } from "@/server/projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { useProjects } from "@/hooks/use-projects";
import { useClients } from "@/hooks/use-clients";
import { useLocations } from "@/hooks/use-locations";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DateRangeBar } from "@/components/ui/sparkline";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { projectStatusLabels } from "@/lib/status-labels";

/** 60-day window for the date range bar: today -7d to today +53d */
function getDateRangeWindow() {
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + 53);
  return { rangeStart, rangeEnd };
}

const typeLabels: Record<string, string> = {
  DRY_HIRE: "Dry Hire",
  WET_HIRE: "Wet Hire",
  INSTALLATION: "Installation",
  TOUR: "Tour",
  CORPORATE: "Corporate",
  THEATRE: "Theatre",
  FESTIVAL: "Festival",
  CONFERENCE: "Conference",
  OTHER: "Other",
};

const typeColors: Record<string, string> = {
  DRY_HIRE: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  WET_HIRE: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  INSTALLATION: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  TOUR: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  CORPORATE: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  THEATRE: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  FESTIVAL: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CONFERENCE: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  OTHER: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

function formatDateRange(
  start: number | string | null | undefined,
  end: number | string | null | undefined,
) {
  if (!start && !end) return "—";
  const fmt = (d: number | string) =>
    new Date(d).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProject = Record<string, any>;

const projectColumns: ColumnDef<AnyProject>[] = [
  {
    id: "projectNumber",
    header: "Project #",
    accessorKey: "projectNumber",
    sortKey: "projectNumber",
    alwaysVisible: true,
    cell: (row) => (
      <Link
        href={`/projects/${row.id}`}
        className="font-mono text-xs text-fg-3 hover:underline"
      >
        {row.projectNumber}
      </Link>
    ),
  },
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    sortKey: "name",
    alwaysVisible: true,
    cell: (row) => (
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/projects/${row.id}`}
            className="font-medium hover:underline"
          >
            {row.name}
          </Link>
          {row._issueFlags && (
            <ProjectIssueBadge issues={row._issueFlags} />
          )}
          {row._blockingCount > 0 && (
            <ProjectBlockingBadge count={row._blockingCount} />
          )}
        </div>
        {row.client?.name && (
          <span className="text-xs text-fg-3">{row.client.name}</span>
        )}
      </div>
    ),
  },
  {
    id: "client",
    header: "Client",
    sortKey: "client",
    cell: (row) => (
      <span className="text-fg-3">
        {row.client?.name || "—"}
      </span>
    ),
  },
  {
    id: "type",
    header: "Type",
    accessorKey: "type",
    sortKey: "type",
    filterable: true,
    filterType: "enum",
    filterOptions: [
      { value: "DRY_HIRE", label: "Dry Hire", color: "bg-blue-500" },
      { value: "WET_HIRE", label: "Wet Hire", color: "bg-cyan-500" },
      { value: "INSTALLATION", label: "Installation", color: "bg-orange-500" },
      { value: "TOUR", label: "Tour", color: "bg-teal-500" },
      { value: "CORPORATE", label: "Corporate", color: "bg-slate-500" },
      { value: "THEATRE", label: "Theatre", color: "bg-rose-500" },
      { value: "FESTIVAL", label: "Festival", color: "bg-amber-500" },
      { value: "CONFERENCE", label: "Conference", color: "bg-blue-500" },
      { value: "OTHER", label: "Other", color: "bg-gray-500" },
    ],
    cell: (row) => (
      <Badge variant="outline" className={typeColors[row.type] || ""}>
        {typeLabels[row.type] || row.type}
      </Badge>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortKey: "status",
    filterable: true,
    filterType: "enum",
    filterOptions: [
      { value: "ENQUIRY", label: "Enquiry", color: "bg-gray-500" },
      { value: "QUOTING", label: "Quoting", color: "bg-blue-500" },
      { value: "QUOTED", label: "Quoted", color: "bg-blue-500" },
      { value: "CONFIRMED", label: "Confirmed", color: "bg-green-500" },
      { value: "PREPPING", label: "Prepping", color: "bg-amber-500" },
      { value: "CHECKED_OUT", label: "Deployed", color: "bg-teal-500" },
      { value: "ON_SITE", label: "On Site", color: "bg-teal-500" },
      { value: "RETURNED", label: "Returned", color: "bg-teal-500" },
      { value: "COMPLETED", label: "Completed", color: "bg-green-500" },
      { value: "INVOICED", label: "Invoiced", color: "bg-green-500" },
      { value: "CANCELLED", label: "Cancelled", color: "bg-red-500" },
    ],
    cell: (row) => (
      <StatusIndicator category="project" value={row.status} label={projectStatusLabels[row.status] || row.status} variant="pill" />
    ),
  },
  {
    id: "rentalStartDate",
    header: "Dates",
    sortKey: "rentalStartDate",
    cell: (row) => {
      const start = row.rentalStartDate as number | null;
      const end = row.rentalEndDate as number | null;
      const { rangeStart, rangeEnd } = getDateRangeWindow();
      return (
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-fg-3 text-sm">
            {formatDateRange(start, end)}
          </span>
          {start && end && (
            <DateRangeBar
              start={new Date(start)}
              end={new Date(end)}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
            />
          )}
        </div>
      );
    },
  },
  {
    id: "total",
    header: "Total",
    sortKey: "total",
    align: "right",
    cell: (row) => (
      <span className="t-data">
        {row.total != null
          ? `$${Number(row.total).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`
          : "—"}
      </span>
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
];

export function ProjectTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("projects", { sortBy: "rentalStartDate", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Convex reactive subscriptions — any update in any tab fires immediately
  const allProjects = useProjects(orgId);
  const clients = useClients(orgId);
  const locations = useLocations(orgId);

  const clientMap = useMemo(
    () => new Map((clients ?? []).map((c) => [c.id, c.name])),
    [clients],
  );
  const locationMap = useMemo(
    () => new Map((locations ?? []).map((l) => [l.id, l.name])),
    [locations],
  );

  // Attach client + location name to each project doc
  const withMeta = useMemo(() => {
    if (!allProjects) return undefined;
    return allProjects
      .filter((p) => !p.isTemplate)
      .map((p) => ({
        ...p,
        client: p.clientId ? { name: clientMap.get(p.clientId) ?? null } : null,
        _locationName: p.locationId ? (locationMap.get(p.locationId) ?? null) : null,
      }));
  }, [allProjects, clientMap, locationMap]);

  // Client-side search + filter
  const filtered = useMemo(() => {
    if (!withMeta) return undefined;
    return withMeta.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.projectNumber.toLowerCase().includes(q) ||
          (p._locationName?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      // Enum filters are string[] (selected values); filter passes if project value is in the set
      const statusFilter = filters?.status;
      if (Array.isArray(statusFilter) && statusFilter.length > 0 && p.status && !statusFilter.includes(p.status as string)) return false;
      const typeFilter = filters?.type;
      if (Array.isArray(typeFilter) && typeFilter.length > 0 && p.type && !typeFilter.includes(p.type as string)) return false;
      return true;
    });
  }, [withMeta, search, filters]);

  // Client-side sort
  const sorted = useMemo(() => {
    if (!filtered) return undefined;
    return [...filtered].sort((a, b) => {
      let aVal: unknown;
      let bVal: unknown;
      if (sortBy === "client") {
        aVal = a.client?.name ?? "";
        bVal = b.client?.name ?? "";
      } else {
        aVal = (a as Record<string, unknown>)[sortBy];
        bVal = (b as Record<string, unknown>)[sortBy];
      }
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortBy, sortOrder]);

  // Client-side pagination
  const total = sorted?.length ?? 0;
  const paged = useMemo(
    () => sorted?.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const isLoading = allProjects === undefined;

  // Issue flags stay server-side (overbooking calculation)
  const projectIds = useMemo(() => (paged ?? []).map((p) => p.id), [paged]);
  const { data: issueFlags } = useServerQuery({
    queryKey: ["project-issues", projectIds],
    queryFn: () => getProjectIssueFlags(projectIds),
    enabled: projectIds.length > 0,
  });

  // Blocking-comment counts — reactive so a blocker raised elsewhere lights up
  // the badge immediately. Scoped to the current page's project ids.
  const blockingCounts = useAuthedQuery(
    api.collaboration.listBlockingForProjects,
    orgId && projectIds.length > 0 ? { orgId, projectIds } : "skip",
  ) as Record<string, number> | undefined;

  const enrichedProjects = useMemo(
    () =>
      (paged ?? []).map((p) => ({
        ...p,
        _issueFlags: issueFlags?.[p.id] ?? null,
        _blockingCount: blockingCounts?.[p.id] ?? 0,
      })),
    [paged, issueFlags, blockingCounts],
  );

  const toolbarActions = (
    <CanDo resource="project" action="create">
      <Button render={<Link href="/projects/new" />}>
        <Plus className="mr-2 h-4 w-4" />
        New Project
      </Button>
    </CanDo>
  );

  return (
    <DataTable
      data={enrichedProjects}
      columns={projectColumns}
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
      searchPlaceholder="Search by name, project #, or location..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      savedViews={{ tableId: "projects", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyPreset="projects"
      toolbarActions={toolbarActions}
    />
  );
}

function ProjectBlockingBadge({ count }: { count: number }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="inline-flex items-center gap-0.5 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
          <ShieldAlert className="h-3 w-3" />
          {count}
        </TooltipTrigger>
        <TooltipContent>
          {count} unresolved blocking comment{count === 1 ? "" : "s"} — prep &amp; send-out are gated
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ProjectIssueBadge({ issues }: { issues: { hasOverbooked: boolean; hasReducedStock: boolean } }) {
  const parts: string[] = [];
  if (issues.hasOverbooked) parts.push("Overbooked items");
  if (issues.hasReducedStock) parts.push("Reduced stock (assets in maintenance/lost)");
  if (parts.length === 0) return null;

  const color = issues.hasOverbooked
    ? "text-red-500"
    : "text-blue-500";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className={`inline-flex items-center justify-center rounded-full ${color}`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent>
          {parts.join(" & ")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
