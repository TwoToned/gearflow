"use client";

import { useQuery } from "@tanstack/react-query";
import { getTestTagDashboardStats } from "@/server/test-tag-assets";
import Link from "next/link";
import { Loader2, Zap, Plus, List, AlertTriangle, Clock, CheckCircle, XCircle, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    CURRENT: { label: "Current", className: "bg-green-500/15 text-green-600 border-green-500/30" },
    DUE_SOON: { label: "Due Soon", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    OVERDUE: { label: "Overdue", className: "bg-red-500/15 text-red-600 border-red-500/30" },
    FAILED: { label: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/30 border-dashed" },
    NOT_YET_TESTED: { label: "Not Tested", className: "bg-muted text-muted-foreground" },
    RETIRED: { label: "Retired", className: "bg-muted text-muted-foreground opacity-60" },
    PASS: { label: "Pass", className: "bg-green-500/15 text-green-600 border-green-500/30" },
    FAIL: { label: "Fail", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  };
  const { label, className } = map[status] || { label: status, className: "" };
  return <Badge variant="outline" className={className}>{label}</Badge>;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-AU");
}

function daysFromNow(date: string | Date | null | undefined): number {
  if (!date) return 0;
  const d = new Date(date);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatClass(cls: string) {
  return cls.replace("CLASS_", "Class ").replace("_DOUBLE_INSULATED", " (DI)");
}

export default function TestAndTagPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: stats, isLoading } = useQuery({
    queryKey: ["test-tag-dashboard-stats", orgId],
    queryFn: () => getTestTagDashboardStats(),
    staleTime: 60_000,
  });

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <RequirePermission resource="testTag" action="read">
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Test & Tag</h1>
          <p className="text-muted-foreground text-sm">Manage electrical testing and compliance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CanDo resource="testTag" action="create">
            <Button size="sm" render={<Link href="/test-and-tag/quick-test" />}>
              <Zap className="mr-2 h-4 w-4" />
              Quick Test
            </Button>
            <Button size="sm" variant="outline" render={<Link href="/test-and-tag/new" />}>
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </CanDo>
          <Button size="sm" variant="outline" render={<Link href="/test-and-tag/registry" />}>
            <List className="mr-2 h-4 w-4" />
            Registry
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {stats.overdue}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Due Soon</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {stats.dueSoon}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400 flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              {stats.current}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              {stats.failed}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Not Yet Tested</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              {stats.notYetTested}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overdue Items */}
      {stats.overdueItems && stats.overdueItems.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h2 className="text-xl font-semibold">Overdue Items</h2>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Tag ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden md:table-cell">Class</TableHead>
                  <TableHead className="hidden sm:table-cell">Last Tested</TableHead>
                  <TableHead className="hidden sm:table-cell">Due Date</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead className="hidden lg:table-cell">Linked Asset</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(stats.overdueItems as any[]).map((item) => (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/test-and-tag/${item.id}`} className="font-medium text-primary hover:underline">
                        {item.testTagId}
                      </Link>
                    </TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatClass(item.equipmentClass)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(item.lastTestDate)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(item.nextDueDate)}</TableCell>
                    <TableCell>
                      <span className="font-medium text-destructive">
                        {Math.abs(daysFromNow(item.nextDueDate))}d
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {item.asset ? (
                        <Link href={`/assets/registry/${item.asset.id}`} className="text-primary hover:underline">
                          {item.asset.assetTag}
                        </Link>
                      ) : item.bulkAsset ? (
                        <Link href={`/assets/registry/${item.bulkAsset.id}?type=bulk`} className="text-primary hover:underline">
                          {item.bulkAsset.assetTag}
                        </Link>
                      ) : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Due Soon Items */}
      {stats.dueSoonItems && stats.dueSoonItems.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-400" />
            <h2 className="text-xl font-semibold">Due Soon</h2>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Tag ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden md:table-cell">Class</TableHead>
                  <TableHead className="hidden sm:table-cell">Last Tested</TableHead>
                  <TableHead className="hidden sm:table-cell">Due Date</TableHead>
                  <TableHead>Due In</TableHead>
                  <TableHead className="hidden lg:table-cell">Linked Asset</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(stats.dueSoonItems as any[]).map((item) => (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/test-and-tag/${item.id}`} className="font-medium text-primary hover:underline">
                        {item.testTagId}
                      </Link>
                    </TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatClass(item.equipmentClass)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(item.lastTestDate)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(item.nextDueDate)}</TableCell>
                    <TableCell>
                      <span className="font-medium text-amber-400">
                        {daysFromNow(item.nextDueDate)}d
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {item.asset ? (
                        <Link href={`/assets/registry/${item.asset.id}`} className="text-primary hover:underline">
                          {item.asset.assetTag}
                        </Link>
                      ) : item.bulkAsset ? (
                        <Link href={`/assets/registry/${item.bulkAsset.id}?type=bulk`} className="text-primary hover:underline">
                          {item.bulkAsset.assetTag}
                        </Link>
                      ) : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Recently Tested */}
      {stats.recentTests && stats.recentTests.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <h2 className="text-xl font-semibold">Recently Tested</h2>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Tag ID</TableHead>
                  <TableHead className="hidden sm:table-cell">Description</TableHead>
                  <TableHead className="hidden sm:table-cell">Test Date</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden md:table-cell">Tested By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(stats.recentTests as any[]).map((record) => (
                  <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/test-and-tag/${record.testTagAssetId}`} className="font-medium text-primary hover:underline">
                        {record.testTagAsset?.testTagId}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{record.testTagAsset?.description}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(record.testDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={record.result} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{record.testerName || record.testedBy?.name || "\u2014"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
    </RequirePermission>
  );
}
