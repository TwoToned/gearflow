"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { Plus } from "lucide-react";

import { focusRing } from "@/lib/utils";

import { getCrewMemberExtras } from "@/server/crew";
import { useCrewMembers, useCrewRoles } from "@/hooks/use-crew";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { crewMemberStatusLabels, crewMemberTypeLabels, formatLabel } from "@/lib/status-labels";
import { getStatusColor } from "@/lib/status-colors";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { PersonAvatar } from "@/components/ui/avatar";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCrewMember = Record<string, any>;

const columns: ColumnDef<AnyCrewMember>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "lastName",
    alwaysVisible: true,
    sortKey: "lastName",
    mobile: "title",
    cell: (row) => {
      const avatarSrc = row.user?.image || row.image;
      const displayName = row.user?.name || `${row.firstName} ${row.lastName}`;
      const subtitle = [row.crewRole?.name, row.department].filter(Boolean).join(" \u00b7 ");
      return (
        <div className="flex items-center gap-3">
          <PersonAvatar name={displayName} src={avatarSrc || undefined} className="size-8" />
          <div className="min-w-0">
            <Link
              href={`/crew/${row.id}`}
              className={`block truncate font-medium text-table-cell text-ink hover:text-red rounded-[var(--r)] ${focusRing}`}
              onClick={(e) => e.stopPropagation()}
            >
              {displayName}
            </Link>
            {subtitle && (
              <p className="text-caption text-muted truncate">{subtitle}</p>
            )}
          </div>
        </div>
      );
    },
  },
  {
    id: "role",
    header: "Role",
    sortable: false,
    responsiveHide: "md",
    // The name cell already prints "role · department" beneath the name.
    mobile: "hidden",
    cell: (row) => (
      <span className="text-muted">
        {row.crewRole?.name || "\u2014"}
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
      { value: "EMPLOYEE", label: "Employee" },
      { value: "FREELANCER", label: "Freelancer" },
      { value: "CONTRACTOR", label: "Contractor" },
      { value: "VOLUNTEER", label: "Volunteer" },
    ],
    responsiveHide: "md",
    mobile: "badge",
    cell: (row) => (
      <Badge status="neutral">{crewMemberTypeLabels[row.type] || formatLabel(row.type)}</Badge>
    ),
  },
  {
    id: "department",
    header: "Department",
    accessorKey: "department",
    sortKey: "department",
    filterable: true,
    filterType: "enum",
    responsiveHide: "lg",
    // Also carried by the name cell's "role · department" subline.
    mobile: "hidden",
    cell: (row) => (
      <span className="text-muted">{row.department || "\u2014"}</span>
    ),
  },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    sortKey: "email",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="text-muted">{row.email || "\u2014"}</span>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="text-muted">{row.phone || "\u2014"}</span>
    ),
  },
  {
    id: "dayRate",
    header: "Day rate",
    align: "right",
    responsiveHide: "lg",
    mobileEmpty: (row) => row.defaultDayRate == null,
    cell: (row) => (
      <span className="font-mono text-table-cell tabular-nums text-ink-2">
        {row.defaultDayRate != null
          ? `$${Number(row.defaultDayRate).toFixed(2)}`
          : "\u2014"}
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
    filterOptions: [
      { value: "ACTIVE", label: "Active", color: getStatusColor("crewMember", "ACTIVE").dot },
      { value: "INACTIVE", label: "Inactive", color: getStatusColor("crewMember", "INACTIVE").dot },
      { value: "ON_LEAVE", label: "On leave", color: getStatusColor("crewMember", "ON_LEAVE").dot },
      { value: "ARCHIVED", label: "Archived", color: getStatusColor("crewMember", "ARCHIVED").dot },
    ],
    mobile: "badge",
    cell: (row) => (
      <StatusIndicator category="crewMember" value={row.status} label={crewMemberStatusLabels[row.status] || formatLabel(row.status)} variant="pill" />
    ),
  },
  {
    id: "tags",
    header: "Tags",
    sortable: false,
    defaultVisible: false,
    responsiveHide: "lg",
    // Off by default; keep it out of cards so an enabled tag list can't swamp the badges.
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

export function CrewTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("crew", { sortBy: "lastName", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive roster straight from Convex (auto-updates on any member/role
  // create/update/delete). The linked platform user is cross-domain (Better Auth)
  // so it comes from a separate, non-reactive server query and is merged below.
  // crewRole name/color is resolved from the reactive crewRoles list.
  const allMembers = useCrewMembers(orgId);
  const roles = useCrewRoles(orgId);
  const { data: extras } = useServerQuery({
    queryKey: ["crew-member-extras", orgId],
    queryFn: () => getCrewMemberExtras(),
    enabled: !!orgId,
  });

  // Filter (search + type/department/status) → sort → paginate, all client-side
  // over the reactive list, merging the cross-domain role/user/skills/cert count.
  const { crewMembers, total } = useMemo(() => {
    const source = allMembers ?? [];
    const roleById = new Map((roles ?? []).map((r) => [r.id, r]));
    const q = search.trim().toLowerCase();
    const typeFilter = filters?.type as string | undefined;
    const deptFilter = filters?.department as string | undefined;
    const statusFilter = filters?.status as string | undefined;

    const merged = source.map((m) => {
      const role = m.crewRoleId ? roleById.get(m.crewRoleId) ?? null : null;
      const extra = extras?.[m.id];
      return {
        ...m,
        crewRole: role ? { id: role.id, name: role.name, color: role.color } : null,
        user: extra?.userName || extra?.userImage ? { name: extra.userName, image: extra.userImage } : null,
      };
    });

    const filtered = merged.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false;
      if (deptFilter && m.department !== deptFilter) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (q) {
        const hay = [
          m.firstName, m.lastName, m.user?.name, m.email, m.phone, m.department,
          ...(m.tags ?? []),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortOrder === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortBy];
      const bv = (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });

    const start = (page - 1) * pageSize;
    return { crewMembers: sorted.slice(start, start + pageSize), total: sorted.length };
  }, [allMembers, roles, extras, search, filters, sortBy, sortOrder, page, pageSize]);

  const isLoading = allMembers === undefined;

  const toolbarActions = (
    <CanDo resource="crew" action="create">
      <Button asChild>
        <Link href="/crew/new">
          <Plus className="size-5" />
          New crew member
        </Link>
      </Button>
    </CanDo>
  );

  return (
    <DataTable
      data={crewMembers}
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
      searchPlaceholder="Search by name, email, department..."
      columnVisibility={columnVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onResetPreferences={resetPreferences}
      savedViews={{ tableId: "crew", currentConfig, applyConfig }}
      isLoading={isLoading}
      emptyPreset="crew"
      toolbarActions={toolbarActions}
    />
  );
}
