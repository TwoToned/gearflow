"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Eye, Building2, AlertTriangle } from "lucide-react";
import { getAllOrganizations } from "@/server/site-admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
type OrgRow = any;

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function AdminOrganizationsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [neverActivatedOnly, setNeverActivatedOnly] = useState(false);

  const { data, isLoading } = useServerQuery({
    queryKey: ["admin-organizations", search, page, neverActivatedOnly],
    queryFn: () => getAllOrganizations({ page, pageSize: 20, search, neverActivatedOnly }),
  });

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="t-title text-fg">Organizations</h1>
          <p className="text-fg-3">
            Every organization on the platform.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
            <Input
              placeholder="Search organizations..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Button
            variant={neverActivatedOnly ? "primary" : "line"}
            size="sm"
            onClick={() => {
              setNeverActivatedOnly(!neverActivatedOnly);
              setPage(1);
            }}
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Never activated
          </Button>
        </div>

        <div className="rounded-lg bg-bg-surface p-0 surface-ring">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-bg-inset/50">
                  <th className="p-3 text-left font-medium">Organization</th>
                  <th className="p-3 text-center font-medium hidden sm:table-cell">Members</th>
                  <th className="p-3 text-left font-medium hidden md:table-cell">Storage</th>
                  <th className="p-3 text-left font-medium hidden lg:table-cell">Last Activity</th>
                  <th className="p-3 text-left font-medium hidden md:table-cell">Created</th>
                  <th className="p-3 text-center font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                <OrgTableBody
                  isLoading={isLoading}
                  organizations={data?.organizations}
                  neverActivatedOnly={neverActivatedOnly}
                />
              </tbody>
            </table>
          </div>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-3">
              Showing {data.organizations?.length} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="line"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="line"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function OrgTableBody({
  isLoading,
  organizations,
  neverActivatedOnly,
}: {
  isLoading: boolean;
  organizations: OrgRow[] | undefined;
  neverActivatedOnly: boolean;
}) {
  if (isLoading) {
    return (
      <tr>
        <td colSpan={7} className="p-8 text-center text-fg-3">
          Loading...
        </td>
      </tr>
    );
  }
  if (!organizations || organizations.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="p-8 text-center text-fg-3">
          <Building2 className="mx-auto mb-2 h-6 w-6" />
          {neverActivatedOnly ? "No never-activated organizations." : "No organizations found."}
        </td>
      </tr>
    );
  }
  return organizations.map((org: OrgRow) => <OrgTableRow key={org.id} org={org} />);
}

function OrgStatusBadges({ org }: { org: OrgRow }) {
  if (org.archivedAt) return <Badge status="warn">Archived</Badge>;
  if (org.neverActivated) return <Badge status="overbooked">Never activated</Badge>;
  return <Badge status="ok">Active</Badge>;
}

function OrgTableRow({ org }: { org: OrgRow }) {
  return (
    <tr className="border-b hover:bg-bg-elevated/30">
      <td className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-bold">
            {org.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{org.name}</div>
            <div className="text-xs text-fg-3 font-mono truncate">{org.slug}</div>
          </div>
        </div>
      </td>
      <td className="p-3 text-center hidden sm:table-cell">{org._count?.members ?? 0}</td>
      <td className="p-3 text-fg-3 hidden md:table-cell">
        {formatStorageSize(org.storageUsage?.totalBytes ?? 0)}
        {org.storageUsage?.truncated && (
          <span
            className="ml-1 text-xs"
            title="More files than the bounded scan covers — this is a floor, not an exact total."
          >
            +
          </span>
        )}
      </td>
      <td className="p-3 text-fg-3 hidden lg:table-cell">
        {org.lastActivityAt ? new Date(org.lastActivityAt).toLocaleDateString() : "Never"}
      </td>
      <td className="p-3 text-fg-3 hidden md:table-cell">{new Date(org.createdAt).toLocaleDateString()}</td>
      <td className="p-3 text-center">
        <div className="flex flex-wrap items-center justify-center gap-1">
          <OrgStatusBadges org={org} />
        </div>
      </td>
      <td className="p-3 text-right">
        <Button size="sm" variant="line" asChild>
          <Link href={`/admin/organizations/${org.id}`}>
            <Eye className="mr-2 h-4 w-4" />
            Manage
          </Link>
        </Button>
      </td>
    </tr>
  );
}
