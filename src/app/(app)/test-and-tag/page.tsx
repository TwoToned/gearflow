"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { useServerQuery } from "@/hooks/use-server-query";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import { Zap, Plus, List, AlertTriangle, Clock, CheckCircle, XCircle, HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { testTagResultLabels, equipmentClassLabels } from "@/lib/status-labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU");
}

function daysFromNow(date: string | Date | null | undefined): number {
  if (!date) return 0;
  const d = new Date(date);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatClass(cls: string) {
  return equipmentClassLabels[cls] ?? cls;
}

export default function TestAndTagPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const { data: stats, isLoading } = useServerQuery({
    queryKey: ["test-tag-dashboard-stats", orgId, isAuthenticated],
    queryFn: () => convex.query(api.testTagAssets.dashboardStats, { orgId: orgId!, nowMs: Date.now() }),
    enabled: !!orgId && isAuthenticated,
  });

  return (
    <RequirePermission resource="testTag" action="read">
    <FadeIn>
    <div className="space-y-8">
      <PageHeader
        title="Test & tag"
        description="Electrical testing, compliance, and certification tracking."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CanDo resource="testTag" action="create">
              <Button size="sm" asChild>
                <Link href="/test-and-tag/quick-test">
                  <Zap className="mr-2 h-4 w-4" />
                  Quick test
                </Link>
              </Button>
              <Button size="sm" variant="line" asChild>
                <Link href="/test-and-tag/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add equipment
                </Link>
              </Button>
            </CanDo>
            <Button size="sm" variant="line" asChild>
              <Link href="/test-and-tag/registry">
                <List className="mr-2 h-4 w-4" />
                Registry
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading || !stats ? (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-[var(--r)]" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-[var(--r)]" />
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
          <p className="t-overline text-muted mb-2">Total items</p>
          <div className="t-title t-data text-ink">{stats.total}</div>
        </div>
        <div className="rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
          <p className="text-caption font-medium text-muted mb-2">Overdue</p>
          <div className="t-title t-data text-t-out flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {stats.overdue}
          </div>
        </div>
        <div className="rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
          <p className="text-caption font-medium text-muted mb-2">Due soon</p>
          <div className="t-title t-data text-warn flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {stats.dueSoon}
          </div>
        </div>
        <div className="rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
          <p className="text-caption font-medium text-muted mb-2">Current</p>
          <div className="t-title t-data text-ok flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            {stats.current}
          </div>
        </div>
        <div className="rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
          <p className="text-caption font-medium text-muted mb-2">Failed</p>
          <div className="t-title t-data text-t-out flex items-center gap-2">
            <XCircle className="h-5 w-5" />
            {stats.failed}
          </div>
        </div>
        <div className="rounded-[var(--r)] bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)]">
          <p className="text-caption font-medium text-muted mb-2">Not yet tested</p>
          <div className="t-title t-data text-muted flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            {stats.notYetTested}
          </div>
        </div>
      </div>

      {/* Overdue Items */}
      {stats.overdueItems && stats.overdueItems.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-t-out" />
            <h2 className="t-title text-ink">Overdue items</h2>
          </div>
          <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test tag ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden md:table-cell">Class</TableHead>
                  <TableHead className="hidden sm:table-cell">Last tested</TableHead>
                  <TableHead className="hidden sm:table-cell">Due date</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead className="hidden lg:table-cell">Linked asset</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(stats.overdueItems as any[]).map((item) => (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-elev">
                    <TableCell>
                      <Link href={`/test-and-tag/${item.id}`} className={cn("t-mono font-medium text-link hover:underline rounded-sm", focusRing)}>
                        {item.testTagId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-2">{item.description}</TableCell>
                    <TableCell className="hidden md:table-cell text-ink-2">{formatClass(item.equipmentClass)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-ink-2 t-data">{formatDate(item.lastTestDate)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-ink-2 t-data">{formatDate(item.nextDueDate)}</TableCell>
                    <TableCell>
                      <span className="font-medium text-t-out t-data">
                        {Math.abs(daysFromNow(item.nextDueDate))}d
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {item.asset ? (
                        <Link href={`/assets/registry/${item.asset.id}`} className={cn("t-mono text-link hover:underline rounded-sm", focusRing)}>
                          {item.asset.assetTag}
                        </Link>
                      ) : item.bulkAsset ? (
                        <Link href={`/assets/registry/${item.bulkAsset.id}?type=bulk`} className={cn("t-mono text-link hover:underline rounded-sm", focusRing)}>
                          {item.bulkAsset.assetTag}
                        </Link>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Due Soon Items */}
      {stats.dueSoonItems && stats.dueSoonItems.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-warn" />
            <h2 className="t-title text-ink">Due soon</h2>
          </div>
          <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test tag ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden md:table-cell">Class</TableHead>
                  <TableHead className="hidden sm:table-cell">Last tested</TableHead>
                  <TableHead className="hidden sm:table-cell">Due date</TableHead>
                  <TableHead>Due in</TableHead>
                  <TableHead className="hidden lg:table-cell">Linked asset</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(stats.dueSoonItems as any[]).map((item) => (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-elev">
                    <TableCell>
                      <Link href={`/test-and-tag/${item.id}`} className={cn("t-mono font-medium text-link hover:underline rounded-sm", focusRing)}>
                        {item.testTagId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-2">{item.description}</TableCell>
                    <TableCell className="hidden md:table-cell text-ink-2">{formatClass(item.equipmentClass)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-ink-2 t-data">{formatDate(item.lastTestDate)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-ink-2 t-data">{formatDate(item.nextDueDate)}</TableCell>
                    <TableCell>
                      <span className="font-medium text-warn t-data">
                        {daysFromNow(item.nextDueDate)}d
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {item.asset ? (
                        <Link href={`/assets/registry/${item.asset.id}`} className={cn("t-mono text-link hover:underline rounded-sm", focusRing)}>
                          {item.asset.assetTag}
                        </Link>
                      ) : item.bulkAsset ? (
                        <Link href={`/assets/registry/${item.bulkAsset.id}?type=bulk`} className={cn("t-mono text-link hover:underline rounded-sm", focusRing)}>
                          {item.bulkAsset.assetTag}
                        </Link>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Recently Tested */}
      {stats.recentTests && stats.recentTests.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-ok" />
            <h2 className="t-title text-ink">Recently tested</h2>
          </div>
          <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test tag ID</TableHead>
                  <TableHead className="hidden sm:table-cell">Description</TableHead>
                  <TableHead className="hidden sm:table-cell">Test date</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden md:table-cell">Tested by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(stats.recentTests as any[]).map((record) => (
                  <TableRow key={record.id} className="cursor-pointer hover:bg-elev">
                    <TableCell>
                      <Link href={`/test-and-tag/${record.testTagAssetId}`} className={cn("t-mono font-medium text-link hover:underline rounded-sm", focusRing)}>
                        {record.testTagAsset?.testTagId}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-ink-2">{record.testTagAsset?.description}</TableCell>
                    <TableCell className="hidden sm:table-cell text-ink-2 t-data">{formatDate(record.testDate)}</TableCell>
                    <TableCell>
                      <StatusIndicator
                        category="testTagResult"
                        value={record.result}
                        label={testTagResultLabels[record.result] ?? record.result}
                        variant="pill"
                      />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-ink-2">{record.testerName || record.testedBy?.name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      </>
      )}
    </div>
    </FadeIn>
    </RequirePermission>
  );
}
