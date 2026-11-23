"use client";

import Link from "next/link";
import {
  useNativeDashboardStats,
  useNativeSubHireStats,
  useNativeBlocking,
  useNativePendingCrewOffers,
  useNativeOverbookingCounts,
  useNativeOrgFinanceCounts,
} from "@/hooks/use-native-dashboard";
import { useCurrentRole } from "@/lib/use-permissions";
import { useFormatters } from "@/components/providers/format-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusWord } from "@/components/ui/status-word";
import { WidgetCount, useBoardHas } from "@/components/dashboard/widget-chrome";
import { buildNeedsAttentionLines, type NeedsAttentionLine, type NeedsAttentionTone } from "@/lib/needs-attention";
import { canOpenLink } from "@/lib/dashboard-links";
import { reachesResource } from "@/lib/permission-reach";
import type { ColorIntent } from "@/lib/status-colors";
import type { Resource } from "@/lib/permissions";
import { cn, focusRing } from "@/lib/utils";

const TONE_INTENT: Record<NeedsAttentionTone, ColorIntent> = { error: "error", warning: "warning", info: "neutral" };

type Permissions = ReturnType<typeof useCurrentRole>["permissions"];

/** The org id for a query only when the role can open what it feeds; otherwise the query is skipped. */
function gated(orgId: string | undefined, permissions: Permissions, ...resources: Resource[]): string | undefined {
  return resources.every((r) => reachesResource(permissions, r)) ? orgId : undefined;
}

/**
 * Each line's read, skipped (and the line absent) when the role can't open the
 * list it links to (UX Phase 11, §6c.2). `useAuthedQuery` does not catch errors,
 * so hiding a line is not enough: the query must not run.
 */
function useNeedsAttentionSources(orgId: string | undefined) {
  const { permissions, isLoading: roleLoading } = useCurrentRole();
  const projectOrg = gated(orgId, permissions, "project");
  const stats = useNativeDashboardStats(projectOrg);
  // Counted under subHire, opened on Suppliers: the read runs only when both are open.
  const subHireOverdue = useNativeSubHireStats(gated(orgId, permissions, "subHire", "supplier"))?.overdueReturns;
  const overbookings = useNativeOverbookingCounts(projectOrg);
  const finance = useNativeOrgFinanceCounts(gated(orgId, permissions, "invoice"));
  const blockers = useNativeBlocking(projectOrg) as { projectId: string }[] | undefined;
  const crewOffers = useNativePendingCrewOffers(gated(orgId, permissions, "project", "crew"));
  const canMaintenance = gated(orgId, permissions, "maintenance") !== undefined;
  return {
    permissions,
    loading: roleLoading || stats.isLoading,
    stats: stats.data,
    maintenance: canMaintenance ? stats.data : undefined,
    subHireOverdue,
    overbookings,
    finance,
    blockers,
    crewOffers,
  };
}

function LineRow({ line }: { line: NeedsAttentionLine }) {
  return (
    <Link
      href={line.link.href}
      title={line.link.tip}
      className={cn("group flex min-h-11 items-center gap-2.5 border-t border-line py-1 text-[13.5px] text-ink", focusRing)}
    >
      <span className="min-w-0 flex-1 group-hover:underline">
        <StatusWord
          status={{ label: line.count, intent: TONE_INTENT[line.tone] }}
          className="font-mono text-[13.5px] font-semibold"
        />{" "}
        {line.text}
      </span>
      {line.detail && <span className="whitespace-nowrap font-mono text-[12.5px] text-muted">{line.detail}</span>}
    </Link>
  );
}

/** Home's Needs attention (§6c.2): dot-word lines with a mono count, each deep-linked. */
export function NeedsAttentionWidget({ orgId }: { orgId: string | undefined }) {
  const { loading, permissions, ...sources } = useNeedsAttentionSources(orgId);
  const { formatCurrency } = useFormatters();
  const overdueTileOnBoard = useBoardHas("statOverdueReturns");

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }
  const lines = buildNeedsAttentionLines({
    ...sources,
    overdueTileOnBoard,
    canOpen: (link) => canOpenLink(link, permissions),
    formatMoney: (n) => formatCurrency(n, { cents: false }),
  });
  if (lines.length === 0) {
    return (
      <p className="py-3 text-[13.5px] text-muted">
        <span className="font-semibold text-ink">All clear.</span> No overdue returns, no clashes, nothing waiting on you.
      </p>
    );
  }
  return (
    <>
      <WidgetCount>{lines.length}</WidgetCount>
      <div className="[&>a:first-child]:border-t-0">
        {lines.map((l) => (
          <LineRow key={l.key} line={l} />
        ))}
      </div>
    </>
  );
}
