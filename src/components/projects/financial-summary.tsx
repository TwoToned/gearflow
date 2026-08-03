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
  /** WS11 (#950) — standalone SALE lines' lineTotal, excluded from
   *  equipmentRevenue (convex/lib/recalc.ts). A SALE line inside a priced
   *  group still rides the group's bundle price, unaffected. */
  saleRevenue?: number | null;
  /** WS11 (#950) — resolved COGS for non-cancelled, non-optional SALE lines. */
  saleCostTotal?: number | null;
  serviceChargeTotal?: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subHireCostTotal?: number | null;
  subtotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  total: number | null;
  margin: number | null;
  /** WS1 (#940) — both DERIVED from the project's real Invoice rows
   *  (convex/lib/recalc.ts), never a hand-typed deposit-percent-of-total
   *  guess. `invoicedTotal` is the sum of every ISSUED invoice; `depositPaid`
   *  is the ISSUED-DEPOSIT-kind subset of that. See the project's Finance tab
   *  (Quotes & Invoices) for the underlying rows. */
  depositPaid: number | null;
  invoicedTotal: number | null;
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
  saleRevenue,
  saleCostTotal,
  serviceChargeTotal,
  serviceCostTotal,
  labourCostTotal,
  subHireCostTotal,
  subtotal,
  discountPercent,
  discountAmount,
  taxRate,
  taxAmount,
  total,
  margin,
  depositPaid,
  invoicedTotal,
  pricedGroupCount,
  totalGroupCount,
  groupBreakdown = [],
}: FinancialSummaryProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const totalVal = total != null ? Number(total) : 0;
  const marginVal = margin != null ? Number(margin) : 0;
  const equipmentVal = equipmentRevenue != null ? Number(equipmentRevenue) : 0;
  const saleRevenueVal = saleRevenue != null ? Number(saleRevenue) : 0;
  const saleCostVal = saleCostTotal != null ? Number(saleCostTotal) : 0;
  const serviceChargeVal = serviceChargeTotal != null ? Number(serviceChargeTotal) : 0;
  const serviceCostVal = serviceCostTotal != null ? Number(serviceCostTotal) : 0;
  const labourCostVal = labourCostTotal != null ? Number(labourCostTotal) : 0;
  const subHireCostVal = subHireCostTotal != null ? Number(subHireCostTotal) : 0;
  const costs = serviceCostVal + labourCostVal + subHireCostVal + saleCostVal;

  const allGroupsPriced =
    totalGroupCount != null && pricedGroupCount != null && pricedGroupCount >= totalGroupCount;

  return (
    <div className="space-y-4">
      {/* Overline label per DESIGN.md SectionHeader */}
      <div className="t-overline text-fg-3">
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

      {/* Client revenue breakdown */}
      <div className="space-y-1.5">
        <div className="t-overline text-fg-4">
          Revenue
        </div>
        <Row label="Equipment" value={formatCurrency(equipmentVal)} />
        {saleRevenueVal > 0 && (
          <Row label="Sale items" value={formatCurrency(saleRevenueVal)} />
        )}
        {serviceChargeVal > 0 && (
          <Row label="Services" value={formatCurrency(serviceChargeVal)} />
        )}
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

      {/* Business costs */}
      <div className="space-y-1.5">
        <div className="t-overline text-fg-4">
          Costs
        </div>
        {serviceCostVal > 0 && (
          <Row label="Services" value={formatCurrency(serviceCostVal)} />
        )}
        {labourCostVal > 0 && (
          <Row label="Labour" value={formatCurrency(labourCostVal)} />
        )}
        {subHireCostVal > 0 && (
          <Row label="Sub-Hires" value={formatCurrency(subHireCostVal)} />
        )}
        {saleCostVal > 0 && (
          <Row label="Sale cost of goods" value={formatCurrency(saleCostVal)} />
        )}
        {costs > 0 ? (
          <Row label="Total costs" value={formatCurrency(costs)} bold />
        ) : (
          <Row label="No costs recorded" value="—" muted />
        )}
      </div>

      {/* Invoicing — derived from real Invoice rows (WS1 #940), not a
          hand-typed percent-of-total guess. Only renders once something has
          actually been issued; see the project's Finance tab for the rows. */}
      {invoicedTotal != null && Number(invoicedTotal) > 0 && (
        <>
          <div className="h-px bg-border" />
          <div className="space-y-1.5">
            <div className="t-overline text-fg-4">Invoicing</div>
            {depositPaid != null && Number(depositPaid) > 0 && (
              <Row label="Deposit invoiced" value={formatCurrency(depositPaid)} />
            )}
            <Row label="Invoiced to date" value={formatCurrency(invoicedTotal)} />
            <Row label="Outstanding" value={formatCurrency(Math.max(0, totalVal - Number(invoicedTotal)))} bold />
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
