"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminDashboardStats } from "@/server/site-admin";
import { Users, Building2, Shield } from "lucide-react";

export default function AdminDashboardPage() {
  const { data } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: getAdminDashboardStats,
  });

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="t-title text-fg">Dashboard</h1>
          <p className="text-fg-3">
            Platform overview and recent activity.
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-bg-surface p-4 surface-ring">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium">Total Users</p>
              <Users className="h-4 w-4 text-fg-3" />
            </div>
            <div className="t-title t-data">{data?.totalUsers ?? "-"}</div>
          </div>
          <div className="rounded-lg bg-bg-surface p-4 surface-ring">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium">
                Organizations
              </p>
              <Building2 className="h-4 w-4 text-fg-3" />
            </div>
            <div className="t-title t-data">{data?.totalOrgs ?? "-"}</div>
          </div>
          <div className="rounded-lg bg-bg-surface p-4 surface-ring">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-medium">Site Admins</p>
              <Shield className="h-4 w-4 text-fg-3" />
            </div>
            <div className="t-title t-data">
              {data?.siteAdminCount ?? "-"}
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Recent Users */}
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading mb-4">Recent Registrations</h3>
            {data?.recentUsers?.length === 0 ? (
              <p className="text-sm text-fg-3">No users yet.</p>
            ) : (
              <div className="space-y-3">
                {data?.recentUsers?.map(
                  (u) => (
                    <div key={u.id} className="flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-fg-3">{u.email}</div>
                      </div>
                      <div className="text-xs text-fg-3">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* Recent Orgs */}
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading mb-4">Recent Organizations</h3>
            {data?.recentOrgs?.length === 0 ? (
              <p className="text-sm text-fg-3">
                No organizations yet.
              </p>
            ) : (
              <div className="space-y-3">
                {data?.recentOrgs?.map(
                  (o) => (
                    <div key={o.id} className="flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{o.name}</div>
                        <div className="text-fg-3">{o.slug}</div>
                      </div>
                      <div className="text-xs text-fg-3">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
