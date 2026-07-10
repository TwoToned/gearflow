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
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DateRangeBar } from "@/components/ui/sparkline";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { projectStatusLabels } from "@/lib/status-labels";
import { getStatusColor } from "@/lib/status-colors";

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
  DRY_HIRE: "Dry hire",
  WET_HIRE: "Wet hire",
  INSTALLATION: "Installation",
  TOUR: "Tour",
  CORPORATE: "Corporate",
  THEATRE: "Theatre",
  FESTIVAL: "Festival",
  CONFERENCE: "Conference",
  OTHER: "Other",
};

// Type chip — RVLT soft module hues (no rainbow). Status carries the primary
// signal; type is a calm secondary cue.
const typeColors: Record<string, string> = {
  DRY_HIRE: "bg-blue-soft text-blue",
  WET_HIRE: "bg-teal-soft text-teal",
  INSTALLATION: "bg-coral-soft text-coral",
  TOUR: "bg-purple-soft text-purple",
  CORPORATE: "bg-rep-soft text-rep",
  THEATRE: "bg-purple-soft text-purple",
  FESTIVAL: "bg-amber-soft text-amber",
  CONFERENCE: "bg-blue-soft text-blue",
  OTHER: "bg-rep-soft text-rep",
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
    mobile: "meta",
    cell: (row) => (
      <Link
        href={`/projects/${row.id}`}
        className="font-mono text-xs text-muted hover:underline"
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
    mobile: "title",
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
          <span className="text-xs text-muted">{row.client.name}</span>
        )}
      </div>
    ),
  },
  {
    id: "client",
    header: "Client",
    sortKey: "client",
    // The name cell already renders the client name beneath the title, so a
    // dedicated card row would just duplicate it.
    mobile: "hidden",
    cell: (row) => (
      <span className="text-muted">
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
    mobile: "badge",
    // Filter-legend dots mirror the type chip module hues (RVLT tokens, no
    // raw Tailwind palette / non-red accents).
    filterOptions: [
      { value: "DRY_HIRE", label: "Dry hire", color: "bg-blue" },
      { value: "WET_HIRE", label: "Wet hire", color: "bg-teal" },
      { value: "INSTALLATION", label: "Installation", color: "bg-coral" },
      { value: "TOUR", label: "Tour", color: "bg-purple" },
      { value: "CORPORATE", label: "Corporate", color: "bg-rep" },
      { value: "THEATRE", label: "Theatre", color: "bg-purple" },
      { value: "FESTIVAL", label: "Festival", color: "bg-amber" },
      { value: "CONFERENCE", label: "Conference", color: "bg-blue" },
      { value: "OTHER", label: "Other", color: "bg-rep" },
    ],
    cell: (row) => (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${typeColors[row.type] || "bg-rep-soft text-rep"}`}>
        {typeLabels[row.type] || row.type}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortKey: "status",
    filterable: true,
    filterType: "enum",
    mobile: "badge",
    // Dots derive from the status intent map (status-colors.ts) — the single
    // source of truth — instead of hardcoded palette swatches.
    filterOptions: [
      { value: "ENQUIRY", label: "Enquiry", color: getStatusColor("project", "ENQUIRY").dot },
      { value: "QUOTING", label: "Quoting", color: getStatusColor("project", "QUOTING").dot },
      { value: "QUOTED", label: "Quoted", color: getStatusColor("project", "QUOTED").dot },
      { value: "CONFIRMED", label: "Confirmed", color: getStatusColor("project", "CONFIRMED").dot },
      { value: "PREPPING", label: "Prepping", color: getStatusColor("project", "PREPPING").dot },
      { value: "CHECKED_OUT", label: "Deployed", color: getStatusColor("project", "CHECKED_OUT").dot },
      { value: "ON_SITE", label: "On site", color: getStatusColor("project", "ON_SITE").dot },
      { value: "RETURNED", label: "Returned", color: getStatusColor("project", "RETURNED").dot },
      { value: "COMPLETED", label: "Completed", color: getStatusColor("project", "COMPLETED").dot },
      { value: "INVOICED", label: "Invoiced", color: getStatusColor("project", "INVOICED").dot },
      { value: "CANCELLED", label: "Cancelled", color: getStatusColor("project", "CANCELLED").dot },
    ],
    cell: (row) => (
      <StatusIndicator category="project" value={row.status} label={projectStatusLabels[row.status] || row.status} variant="pill" />
    ),
  },
  {
    id: "rentalStartDate",
    header: "Dates",
    sortKey: "rentalStartDate",
    mobile: "meta",
    cell: (row) => {
      const start = row.rentalStartDate as number | null;
      const end = row.rentalEndDate as number | null;
      const { rangeStart, rangeEnd } = getDateRangeWindow();
      return (
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-muted text-sm">
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
    mobile: "meta",
    mobileEmpty: (row) => row.total == null,
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
    mobile: "hidden",
    cell: (row) => (
      <div className="flex flex-wrap gap-1">
        {row.tags?.map((tag: string) => (
          <span key={tag} className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-muted">
            {tag}
          </span>
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
      <Button asChild>
        <Link href="/projects/new"><Plus className="mr-2 h-4 w-4" /> New job</Link>
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
        <TooltipTrigger className="inline-flex items-center gap-0.5 rounded-full bg-red-soft px-1.5 py-0.5 text-[11px] font-medium text-red">
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
    ? "text-t-out"
    : "text-blue";

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
