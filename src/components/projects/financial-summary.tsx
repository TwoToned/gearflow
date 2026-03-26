"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface GroupBreakdownItem {
  title: string;
  quantity: number;
  price: number;
}

interface FinancialSummaryProps {
  equipmentRevenue: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subtotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  total: number | null;
  margin: number | null;
  depositPercent: number | null;
  depositPaid: number | null;
  pricedGroupCount?: number;
  totalGroupCount?: number;
  groupBreakdown?: GroupBreakdownItem[];
}

function MarginBar({ margin, total }: { margin: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (margin / total) * 100)) : 0;
  const color =
    pct >= 40
      ? "bg-[oklch(0.55_0.16_155)]" // success green
      : pct >= 20
        ? "bg-[oklch(0.72_0.17_70)]" // warning amber
        : "bg-[oklch(0.58_0.22_27)]"; // error red

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-bg-inset">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-fg-3">{pct.toFixed(0)}%</span>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  negative,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={cn("text-xs", muted ? "text-fg-4" : "text-fg-3")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "text-sm font-semibold text-fg" : "text-xs text-fg-2",
          negative && "text-[oklch(0.58_0.22_27)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function FinancialSummary({
  equipmentRevenue,
  serviceCostTotal,
  labourCostTotal,
  subtotal,
  discountPercent,
  discountAmount,
  taxRate,
  taxAmount,
  total,
  margin,
  depositPercent,
  depositPaid,
  pricedGroupCount,
  totalGroupCount,
  groupBreakdown = [],
}: FinancialSummaryProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const totalVal = total != null ? Number(total) : 0;
  const marginVal = margin != null ? Number(margin) : 0;
  const costs =
    (serviceCostTotal != null ? Number(serviceCostTotal) : 0) +
    (labourCostTotal != null ? Number(labourCostTotal) : 0);

  const allGroupsPriced =
    totalGroupCount != null && pricedGroupCount != null && pricedGroupCount >= totalGroupCount;

  return (
    <div className="space-y-4">
      {/* Overline label per DESIGN.md SectionHeader */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-3">
        Financials
      </div>

      {/* Total + margin bar */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-3">Total</span>
          <span className="text-lg font-bold tabular-nums tracking-tight text-fg">
            {formatCurrency(totalVal)}
          </span>
        </div>
        <MarginBar margin={marginVal} total={totalVal} />
        <div className="flex items-baseline justify-between">
          <span className="text-right text-[11px] text-fg-4">
            Margin: {formatCurrency(marginVal)}
          </span>
          {/* Pricing progress indicator */}
          {totalGroupCount != null && totalGroupCount > 0 && (
            <span
              className={cn(
                "text-[11px] tabular-nums",
                allGroupsPriced ? "text-fg-4" : "text-[oklch(0.72_0.17_70)]"
              )}
            >
              {pricedGroupCount}/{totalGroupCount} groups priced
            </span>
          )}
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Revenue breakdown */}
      <div className="space-y-1.5">
        <Row label="Equipment" value={formatCurrency(equipmentRevenue)} />
        <Row label="Subtotal" value={formatCurrency(subtotal)} bold />
        {discountPercent != null && Number(discountPercent) > 0 && (
          <Row
            label={`Discount (${Number(discountPercent)}%)`}
            value={`-${formatCurrency(discountAmount)}`}
            negative
          />
        )}
        <Row
          label={`Tax (${taxRate != null ? Number(taxRate) : 10}%)`}
          value={formatCurrency(taxAmount)}
          muted
        />
      </div>

      <div className="h-px bg-border" />

      {/* Costs */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-4">
          Costs
        </div>
        <Row label="Services" value={formatCurrency(serviceCostTotal)} />
        <Row label="Labour" value={formatCurrency(labourCostTotal)} />
        {costs > 0 && (
          <Row label="Total costs" value={formatCurrency(costs)} bold />
        )}
      </div>

      {/* Deposit */}
      {depositPercent != null && Number(depositPercent) > 0 && (
        <>
          <div className="h-px bg-border" />
          <div className="space-y-1.5">
            <Row
              label={`Deposit (${Number(depositPercent)}%)`}
              value={formatCurrency(totalVal * Number(depositPercent) / 100)}
            />
            {depositPaid != null && Number(depositPaid) > 0 && (
              <Row label="Paid" value={formatCurrency(depositPaid)} />
            )}
          </div>
        </>
      )}

      {/* Audit trail breakdown */}
      {groupBreakdown.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="flex w-full items-center gap-1 text-xs text-fg-4 hover:text-fg-3 transition-colors"
          >
            {showBreakdown ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Breakdown
          </button>
          {showBreakdown && (
            <div className="space-y-0.5">
              {groupBreakdown.map((g, i) => (
                <div key={i} className="flex items-baseline justify-between text-[11px]">
                  <span className="min-w-0 truncate text-fg-4">{g.title}</span>
                  <span className="flex-none tabular-nums text-fg-3">
                    {g.quantity > 1 ? `${g.quantity} × ` : ""}
                    {formatCurrency(g.price)}
                    {g.quantity > 1 && ` = ${formatCurrency(g.price * g.quantity)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
