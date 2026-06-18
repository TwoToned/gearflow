"use client";

/**
 * Operational P&L panel for the project detail right-rail (Wave 2).
 *
 * Shows the canonical cost stack: revenue minus services / labour /
 * sub-hire / maintenance.
 *
 * Per the approved plan: collapsed by default, single right-rail section
 * mirroring FinancialSummary's visual treatment. The deep-view link goes
 * to /projects/[id]/costs.
 */

import { useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getProjectOperationalCosts } from "@/server/project-costs";
import { formatCurrency } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";

function MarginBar({ margin, total }: { margin: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (margin / total) * 100)) : 0;
  // Threshold colour: healthy margin = ok green, thin = warn amber, at/under = t-out.
  const color =
    pct >= 40
      ? "bg-ok"
      : pct >= 20
        ? "bg-warn"
        : "bg-t-out";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-paper-2">
        <div
          className={cn("h-full rounded-full motion-safe:transition-all motion-safe:duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-caption tabular-nums text-muted">{pct.toFixed(0)}%</span>
    </div>
  );
}

function Row({
  label,
  value,
  negative,
  muted,
  bold,
}: {
  label: string;
  value: string;
  negative?: boolean;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={cn("text-caption", muted ? "text-faint" : "text-muted")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "text-ui-text font-semibold text-ink" : "text-caption text-ink-2",
          negative && "text-t-out",
        )}
      >
        {value}
      </span>
    </div>
  );
}

interface ProjectCostsPanelProps {
  projectId: string;
}

export function ProjectCostsPanel({ projectId }: ProjectCostsPanelProps) {
  const [showDetail, setShowDetail] = useState(false);
  const { data, isLoading } = useServerQuery({
    queryKey: ["project-operational-costs", projectId],
    queryFn: () => getProjectOperationalCosts(projectId),
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="t-overline text-muted">Operational P&amp;L</div>
        <p className="text-caption text-faint">Calculating…</p>
      </div>
    );
  }

  if (!data || data.total <= 0) {
    return null; // No revenue yet — panel adds noise. Hide until the project has totals.
  }

  const totalCosts =
    data.serviceCostTotal +
    data.labourCostTotal +
    data.subHireCostTotal +
    data.maintenanceCostTotal;

  return (
    <div className="space-y-3">
      <div className="t-overline text-muted">Operational P&amp;L</div>

      {/* Headline: net margin + bar */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-caption text-muted">Net margin</span>
          <span className="text-section-header font-bold tabular-nums tracking-tight text-ink">
            {formatCurrency(data.netMargin)}
          </span>
        </div>
        <MarginBar margin={data.netMargin} total={data.total} />
        <div className="text-right text-caption text-faint tabular-nums">
          {data.marginPercent.toFixed(0)}% of {formatCurrency(data.total)}
        </div>
      </div>

      <div className="h-px bg-line" />

      {/* Costs breakdown — always visible */}
      <div className="space-y-1.5">
        <Row label="Services" value={formatCurrency(data.serviceCostTotal)} negative />
        <Row label="Labour" value={formatCurrency(data.labourCostTotal)} negative />
        <Row label="Sub-hire" value={formatCurrency(data.subHireCostTotal)} negative />
        {data.maintenanceCostTotal > 0 && (
          <Row label={`Maintenance (${data.counts.maintenanceRecords})`} value={formatCurrency(data.maintenanceCostTotal)} negative />
        )}
        <div className="h-px bg-line my-1" />
        <Row label="Total costs" value={formatCurrency(totalCosts)} bold negative />
      </div>

      {/* Toggle for the revenue side */}
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className={cn("flex items-center gap-1 rounded-sm text-caption text-faint hover:text-muted", focusRing)}
      >
        {showDetail ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {showDetail ? "Hide revenue detail" : "Show revenue detail"}
      </button>

      {showDetail && (
        <div className="space-y-1.5">
          <Row label="Equipment revenue" value={formatCurrency(data.equipmentRevenue)} muted />
          <Row label="Service revenue" value={formatCurrency(data.serviceRevenue)} muted />
          <div className="h-px bg-line my-1" />
          <Row label="Revenue total" value={formatCurrency(data.total)} bold />
        </div>
      )}

      {/* Deep-link drilldowns */}
      <div className="flex flex-wrap gap-3 pt-1 text-caption">
        {data.counts.maintenanceRecords > 0 && (
          <Link
            href={`/maintenance?projectId=${encodeURIComponent(projectId)}`}
            className={cn("rounded-sm text-link underline-offset-2 hover:underline", focusRing)}
          >
            Maintenance records →
          </Link>
        )}
      </div>
    </div>
  );
}
