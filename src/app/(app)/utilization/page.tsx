"use client";

/**
 * Asset utilization dashboard (Wave 3).
 *
 * Answers the operator question "which gear is paying for itself, and
 * which is sitting idle?" — using the line-item revenue + maintenance +
 * damage data already in the system.
 *
 * Three views in one page:
 *   1. Summary cards (total assets, total revenue, avg utilization, idle)
 *   2. Top performers — highest net contribution
 *   3. Bottom performers — idle / lossy assets
 *
 * Period selector lets you compare "this quarter" vs. lifetime.
 *
 * Revenue attribution rule (worth reminding the user about in copy):
 * only line items where this exact asset is assigned count. Model-only
 * line items pre-checkout don't yet attribute revenue.
 */

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Package,
  AlertCircle,
} from "lucide-react";

import { getUtilizationSummary, type UtilizationSummaryRow } from "@/server/utilization";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { RequirePermission } from "@/components/auth/require-permission";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type PeriodKey = "30" | "90" | "365" | "all";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
  { key: "all", label: "All time" },
];

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-fg";
  return (
    <div className="rounded-md border bg-bg-surface p-3">
      <div className="flex items-center gap-2 text-xs text-fg-3">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums tracking-tight", toneClass)}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-fg-4">{hint}</div>}
    </div>
  );
}

function UtilBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color =
    pct >= 50
      ? "bg-[oklch(0.55_0.16_155)]" // green
      : pct >= 20
        ? "bg-[oklch(0.72_0.17_70)]" // amber
        : "bg-[oklch(0.58_0.22_27)]"; // red — idle
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 rounded-full bg-bg-inset">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-fg-3">{pct}%</span>
    </div>
  );
}

function UtilizationContent() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [period, setPeriod] = useState<PeriodKey>("90");
  const [showOnly, setShowOnly] = useState<"all" | "idle" | "lossy">("all");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["utilization-summary", orgId, period],
    queryFn: () =>
      getUtilizationSummary({
        periodDays: period === "all" ? undefined : Number(period),
      }),
    enabled: !!orgId,
  });

  const filtered = useMemo(() => {
    const r = (rows ?? []) as UtilizationSummaryRow[];
    if (showOnly === "idle") return r.filter((x) => x.bookingDays === 0);
    if (showOnly === "lossy") return r.filter((x) => x.netContribution < 0);
    return r;
  }, [rows, showOnly]);

  const summary = useMemo(() => {
    const r = (rows ?? []) as UtilizationSummaryRow[];
    if (r.length === 0) {
      return { count: 0, revenue: 0, avgUtil: 0, idleCount: 0, lossyCount: 0 };
    }
    const revenue = r.reduce((s, x) => s + x.revenue, 0);
    const totalUtil = r.reduce((s, x) => s + x.utilizationRate, 0);
    const idleCount = r.filter((x) => x.bookingDays === 0).length;
    const lossyCount = r.filter((x) => x.netContribution < 0).length;
    return {
      count: r.length,
      revenue,
      avgUtil: totalUtil / r.length,
      idleCount,
      lossyCount,
    };
  }, [rows]);

  const columns: ColumnDef<UtilizationSummaryRow>[] = [
    {
      id: "asset",
      header: "Asset",
      sortable: false,
      cell: (r) => (
        <Link
          href={`/assets/registry/${r.assetId}`}
          className="block min-w-0 hover:underline"
        >
          <div className="text-sm font-medium">{r.customName ?? r.modelName}</div>
          <div className="text-xs text-fg-3">{r.assetTag}</div>
        </Link>
      ),
    },
    {
      id: "category",
      header: "Category",
      responsiveHide: "md",
      sortable: false,
      cell: (r) => <span className="text-xs text-fg-3">{r.categoryName ?? "—"}</span>,
    },
    {
      id: "utilizationRate",
      header: "Utilization",
      accessorKey: "utilizationRate",
      cell: (r) => <UtilBar rate={r.utilizationRate} />,
    },
    {
      id: "bookingDays",
      header: "Booked",
      accessorKey: "bookingDays",
      responsiveHide: "sm",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.bookingDays} <span className="text-fg-4">/ {r.periodDays}d</span>
        </span>
      ),
    },
    {
      id: "projectCount",
      header: "Projects",
      accessorKey: "projectCount",
      responsiveHide: "md",
      cell: (r) => <span className="text-sm tabular-nums">{r.projectCount}</span>,
    },
    {
      id: "revenue",
      header: "Revenue",
      accessorKey: "revenue",
      cell: (r) =>
        r.revenue > 0 ? (
          <span className="text-sm tabular-nums">{formatCurrency(r.revenue)}</span>
        ) : (
          <span className="text-xs text-fg-4">—</span>
        ),
    },
    {
      id: "maintenanceCost",
      header: "Maint",
      accessorKey: "maintenanceCost",
      responsiveHide: "lg",
      cell: (r) =>
        r.maintenanceCost > 0 ? (
          <span className="text-sm tabular-nums text-[oklch(0.58_0.22_27)]">
            -{formatCurrency(r.maintenanceCost)}
          </span>
        ) : (
          <span className="text-xs text-fg-4">—</span>
        ),
    },
    {
      id: "damageCost",
      header: "Damage",
      accessorKey: "damageCost",
      responsiveHide: "lg",
      cell: (r) => {
        const our = r.damageCost - r.damageChargedBackTotal;
        if (our <= 0) return <span className="text-xs text-fg-4">—</span>;
        return (
          <span className="text-sm tabular-nums text-[oklch(0.58_0.22_27)]">
            -{formatCurrency(our)}
          </span>
        );
      },
    },
    {
      id: "netContribution",
      header: "Net",
      accessorKey: "netContribution",
      cell: (r) => {
        const v = r.netContribution;
        if (v === 0) return <span className="text-xs text-fg-4">—</span>;
        return (
          <span
            className={cn(
              "text-sm font-medium tabular-nums",
              v > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-[oklch(0.58_0.22_27)]",
            )}
          >
            {v > 0 ? "+" : ""}
            {formatCurrency(v)}
          </span>
        );
      },
    },
  ];

  return (
    <FadeIn className="space-y-4">
      <PageHeader
        title="Asset utilization"
        description="Which gear is paying for itself, which is sitting idle. Revenue counts only line items where this exact asset is assigned — model-only bookings pre-checkout don't attribute yet."
      />

      {/* Period + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border bg-bg-surface p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                period === p.key
                  ? "bg-bg-inset text-fg"
                  : "text-fg-3 hover:text-fg",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border bg-bg-surface p-0.5">
          {(["all", "idle", "lossy"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setShowOnly(k)}
              className={cn(
                "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                showOnly === k
                  ? "bg-bg-inset text-fg"
                  : "text-fg-3 hover:text-fg",
              )}
            >
              {k === "all" ? "All assets" : k === "idle" ? "Idle" : "Lossy"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          icon={Package}
          label="Active assets"
          value={summary.count.toLocaleString()}
        />
        <SummaryCard
          icon={DollarSign}
          label="Total revenue"
          value={formatCurrency(summary.revenue)}
          hint={`Across ${summary.count} asset${summary.count === 1 ? "" : "s"}`}
        />
        <SummaryCard
          icon={Activity}
          label="Avg utilization"
          value={`${Math.round(summary.avgUtil * 100)}%`}
          tone={summary.avgUtil >= 0.5 ? "good" : summary.avgUtil >= 0.2 ? "default" : "warn"}
        />
        <SummaryCard
          icon={AlertCircle}
          label="Idle assets"
          value={summary.idleCount.toLocaleString()}
          hint={summary.lossyCount > 0 ? `${summary.lossyCount} lossy` : undefined}
          tone={summary.idleCount > summary.count / 3 ? "warn" : "default"}
        />
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        columns={columns}
        totalRows={filtered.length}
        page={1}
        pageSize={filtered.length || 25}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        isLoading={isLoading}
      />

      {/* Helper toggles below the table */}
      <div className="flex flex-wrap gap-3 text-[11px] text-fg-4">
        <button
          type="button"
          onClick={() => setShowOnly("idle")}
          className="inline-flex items-center gap-1 hover:text-fg-3"
        >
          <TrendingDown className="size-3" />
          Find assets booked 0 days
        </button>
        <button
          type="button"
          onClick={() => setShowOnly("lossy")}
          className="inline-flex items-center gap-1 hover:text-fg-3"
        >
          <AlertCircle className="size-3" />
          Find assets where costs &gt; revenue
        </button>
        <button
          type="button"
          onClick={() => setShowOnly("all")}
          className="inline-flex items-center gap-1 hover:text-fg-3"
        >
          <TrendingUp className="size-3" />
          Show all
        </button>
      </div>
    </FadeIn>
  );
}

export default function UtilizationPage() {
  return (
    <RequirePermission resource="asset" action="read">
      <Suspense fallback={<div className="p-6 text-fg-3">Loading…</div>}>
        <UtilizationContent />
      </Suspense>
    </RequirePermission>
  );
}
