"use client";
// Extracted from dashboard/page.tsx's Zone 2 ("Needs attention" chip tray) —
// same hooks, same JSX, unchanged logic (R-3.1).

import Link from "next/link";
import {
  useNativeDashboardStats,
  useNativeSubHireStats,
  useNativeBlocking,
  useNativePendingCrewOffers,
  useNativeOverbookingCounts,
  useNativeOrgFinanceCounts,
} from "@/hooks/use-native-dashboard";
import { ShieldAlert, AlertTriangle, UserCheck, Boxes, Send, Wrench } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { cn, focusRing } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

function NeedsAttention({
  stats,
  loading,
  blockers,
  pendingCrewOffers,
  subHireOverdue,
  overbookingCounts,
  orgFinanceCounts,
}: {
  stats?: { overdueReturns?: number; maintenanceDue?: number; modelsDueForService?: number };
  loading: boolean;
  blockers: Record<string, unknown>[];
  pendingCrewOffers?: number;
  subHireOverdue: number;
  overbookingCounts?: { hardCount: number; pencilledCount: number; saleStockCount: number };
  orgFinanceCounts?: {
    quotesOutCount: number;
    expiringCount: number;
    neverSentCount: number;
    confirmedUninvoicedCount: number;
    depositDueCount: number;
    outstandingCount: number;
  };
}) {
  if (loading) {
    return (
      <div className="flex gap-2">
        <Skeleton className="h-8 w-36 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
    );
  }
  const chips = [
    blockers.length > 0 && {
      href: `/projects/${blockers[0].projectId}`,
      label: `${blockers.length} blocker${blockers.length > 1 ? "s" : ""} need you`,
      cls: "bg-out-soft text-t-out hover:bg-out-soft/70",
      Icon: ShieldAlert,
    },
    (stats?.overdueReturns ?? 0) > 0 && {
      href: "/projects",
      label: `${stats?.overdueReturns} overdue return${(stats?.overdueReturns ?? 0) > 1 ? "s" : ""}`,
      cls: "bg-out-soft text-t-out hover:bg-out-soft/70",
      Icon: AlertTriangle,
    },
    subHireOverdue > 0 && {
      href: "/suppliers",
      label: `${subHireOverdue} sub-hire overdue`,
      cls: "bg-out-soft text-t-out hover:bg-out-soft/70",
      Icon: AlertTriangle,
    },
    (overbookingCounts?.hardCount ?? 0) > 0 && {
      href: "/overbookings",
      label: `${overbookingCounts?.hardCount} hard overbooking${(overbookingCounts?.hardCount ?? 0) > 1 ? "s" : ""}`,
      cls: "bg-out-soft text-t-out hover:bg-out-soft/70",
      Icon: AlertTriangle,
    },
    (overbookingCounts?.pencilledCount ?? 0) > 0 && {
      href: "/overbookings",
      label: `${overbookingCounts?.pencilledCount} pencilled collision${(overbookingCounts?.pencilledCount ?? 0) > 1 ? "s" : ""}`,
      cls: "bg-warn-soft text-warn hover:bg-warn-soft/70",
      Icon: AlertTriangle,
    },
    (overbookingCounts?.saleStockCount ?? 0) > 0 && {
      href: "/overbookings",
      label: `${overbookingCounts?.saleStockCount} sale stock to procure`,
      cls: "bg-warn-soft text-warn hover:bg-warn-soft/70",
      Icon: Boxes,
    },
    (stats?.maintenanceDue ?? 0) > 0 && {
      href: "/maintenance",
      label: `${stats?.maintenanceDue} maintenance due`,
      cls: "bg-warn-soft text-warn hover:bg-warn-soft/70",
      Icon: Wrench,
    },
    (stats?.modelsDueForService ?? 0) > 0 && {
      href: "/maintenance/due",
      label: `${stats?.modelsDueForService} model${(stats?.modelsDueForService ?? 0) > 1 ? "s" : ""} due for service`,
      cls: "bg-warn-soft text-warn hover:bg-warn-soft/70",
      Icon: Wrench,
    },
    (pendingCrewOffers ?? 0) > 0 && {
      href: "/crew",
      label: `${pendingCrewOffers} crew offer${(pendingCrewOffers ?? 0) > 1 ? "s" : ""} pending`,
      cls: "bg-blue-soft text-blue hover:bg-blue-soft/70",
      Icon: UserCheck,
    },
    (orgFinanceCounts?.expiringCount ?? 0) > 0 && {
      href: "/finance",
      label: `${orgFinanceCounts?.expiringCount} quote${(orgFinanceCounts?.expiringCount ?? 0) > 1 ? "s" : ""} expiring`,
      cls: "bg-warn-soft text-warn hover:bg-warn-soft/70",
      Icon: AlertTriangle,
    },
    (orgFinanceCounts?.quotesOutCount ?? 0) > 0 && {
      href: "/finance",
      label: `${orgFinanceCounts?.quotesOutCount} quote${(orgFinanceCounts?.quotesOutCount ?? 0) > 1 ? "s" : ""} out`,
      cls: "bg-blue-soft text-blue hover:bg-blue-soft/70",
      Icon: Send,
    },
  ].filter(Boolean) as { href: string; label: string; cls: string; Icon: LucideIcon }[];

  if (chips.length === 0) {
    return (
      <div className="flex items-center gap-3 py-1">
        <FlowMascot className="h-9 w-9 shrink-0" eyeColor="var(--ok)" />
        <div>
          <p className="text-[14px] font-medium text-ink">All clear.</p>
          <p className="t-micro text-muted">No overdue returns, no clashes, nothing waiting on you. Frame it.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-table-cell font-medium shadow-[var(--sh-stk)] transition-colors",
            focusRing,
            c.cls,
          )}
        >
          <c.Icon className="h-4 w-4" /> {c.label}
        </Link>
      ))}
    </div>
  );
}

export function NeedsAttentionWidget({ orgId }: { orgId: string | undefined }) {
  const nativeStats = useNativeDashboardStats(orgId);
  const subHireStats = useNativeSubHireStats(orgId);
  const overbookingCounts = useNativeOverbookingCounts(orgId);
  const orgFinanceCounts = useNativeOrgFinanceCounts(orgId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myBlockers = useNativeBlocking(orgId) as any;
  const pendingCrewOffers = useNativePendingCrewOffers(orgId);

  return (
    <NeedsAttention
      stats={nativeStats.data}
      loading={nativeStats.isLoading}
      blockers={myBlockers ?? []}
      pendingCrewOffers={pendingCrewOffers}
      subHireOverdue={subHireStats?.overdueReturns ?? 0}
      overbookingCounts={overbookingCounts}
      orgFinanceCounts={orgFinanceCounts}
    />
  );
}
