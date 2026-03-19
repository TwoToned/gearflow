"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { getCrewMembers } from "@/server/crew";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { crewMemberStatusLabels, crewMemberTypeLabels, formatLabel } from "@/lib/status-labels";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCrewMember = Record<string, any>;

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-500/10 text-green-500 border-green-500/20",
  INACTIVE: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  ON_LEAVE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  ARCHIVED: "bg-red-500/10 text-red-500 border-red-500/20",
};

const columns: ColumnDef<AnyCrewMember>[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "lastName",
    alwaysVisible: true,
    sortKey: "lastName",
    cell: (row) => {
      const avatarSrc = row.user?.image || row.image;
      const displayName = row.user?.name || `${row.firstName} ${row.lastName}`;
      return (
        <Link href={`/crew/${row.id}`} className="flex items-center gap-2 font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          <Avatar className="size-7">
            {avatarSrc ? <AvatarImage src={avatarSrc} alt={displayName} /> : null}
            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
              {row.firstName?.[0]}{row.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          {displayName}
        </Link>
      );
    },
  },
  {
    id: "role",
    header: "Role",
    sortable: false,
    responsiveHide: "md",
    cell: (row) => (
      <span className="text-muted-foreground">
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
    cell: (row) => (
      <Badge variant="outline">{crewMemberTypeLabels[row.type] || formatLabel(row.type)}</Badge>
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
    cell: (row) => (
      <span className="text-muted-foreground">{row.department || "\u2014"}</span>
    ),
  },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    sortKey: "email",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="text-muted-foreground">{row.email || "\u2014"}</span>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone",
    responsiveHide: "lg",
    cell: (row) => (
      <span className="text-muted-foreground">{row.phone || "\u2014"}</span>
    ),
  },
  {
    id: "dayRate",
    header: "Day Rate",
    align: "right",
    responsiveHide: "lg",
    cell: (row) =>
      row.defaultDayRate != null
        ? `$${Number(row.defaultDayRate).toFixed(2)}`
        : "\u2014",
  },
  {
    id: "skills",
    header: "Skills",
    sortable: false,
    responsiveHide: "lg",
    cell: (row) => (
      <div className="flex flex-wrap gap-1">
        {row.skills?.slice(0, 3).map((s: { id: string; name: string }) => (
          <Badge key={s.id} variant="secondary" className="text-xs">
            {s.name}
          </Badge>
        ))}
        {row.skills?.length > 3 && (
          <Badge variant="secondary" className="text-xs">+{row.skills.length - 3}</Badge>
        )}
      </div>
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
      { value: "ACTIVE", label: "Active" },
      { value: "INACTIVE", label: "Inactive" },
      { value: "ON_LEAVE", label: "On Leave" },
      { value: "ARCHIVED", label: "Archived" },
    ],
    cell: (row) => (
      <Badge variant="outline" className={statusColors[row.status] || ""}>
        {crewMemberStatusLabels[row.status] || formatLabel(row.status)}
      </Badge>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    sortable: false,
    defaultVisible: false,
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

export function CrewTable() {
  const {
    sortBy, sortOrder, pageSize, page,
    setPage, setPageSize, handleSort,
    columnVisibility, toggleColumnVisibility, resetPreferences,
    filters, setFilter,
  } = useTablePreferences("crew", { sortBy: "lastName", sortOrder: "asc" });

  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["crew-members", orgId, { search, filters, page, pageSize, sortBy, sortOrder }],
    queryFn: () => getCrewMembers({
      search: search || undefined,
      filters,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
  });

  const crewMembers = data?.crewMembers || [];
  const total = data?.total || 0;

  const toolbarActions = (
    <CanDo resource="crew" action="create">
      <Button render={<Link href="/crew/new" />}>
        <Plus className="mr-2 h-4 w-4" />
        New Crew Member
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
      isLoading={isLoading}
      emptyPreset="crew"
      toolbarActions={toolbarActions}
    />
  );
}
