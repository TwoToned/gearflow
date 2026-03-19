"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
          <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Platform overview and recent activity.
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.totalUsers ?? "-"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Organizations
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.totalOrgs ?? "-"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Site Admins</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data?.siteAdminCount ?? "-"}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Recent Users */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Registrations</CardTitle>
            </CardHeader>
            <CardContent>
              {data?.recentUsers?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No users yet.</p>
              ) : (
                <div className="space-y-3">
                  {data?.recentUsers?.map(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (u: any) => (
                      <div key={u.id} className="flex items-center justify-between text-sm">
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-muted-foreground">{u.email}</div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Orgs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Organizations</CardTitle>
            </CardHeader>
            <CardContent>
              {data?.recentOrgs?.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No organizations yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {data?.recentOrgs?.map(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (o: any) => (
                      <div key={o.id} className="flex items-center justify-between text-sm">
                        <div>
                          <div className="font-medium">{o.name}</div>
                          <div className="text-muted-foreground">{o.slug}</div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(o.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
