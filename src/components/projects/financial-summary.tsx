"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
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
  /** ABSENT (undefined), with `labourCostTotal` and `margin`, for a caller without
   *  job cost (invoice:read, not a noFinancials key — owner ruling 2026-11-24).
   *  Then no margin and no costs render — never a $0. */
  serviceCostTotal?: number | null;
  labourCostTotal?: number | null;
  subHireCostTotal?: number | null;
  /** Maintenance spend on this job's gear (operational P&L). Job cost: only ever
   *  passed when the caller sees job cost, and only shown alongside the costs. */
  maintenance?: { total: number; count: number; href: string; labourRevenue: number } | null;
  subtotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  total: number | null;
  /** THE one margin, ex GST (UX Phase 10: the P&L's net margin when loaded, else
   *  the project's). Absent/null for a caller without job cost. */
  margin?: number | null;
  pricedGroupCount?: number;
  totalGroupCount?: number;
  groupBreakdown?: GroupBreakdownItem[];
  /** The billing-period line (`Billed as 2 wk 1 d · change`), rendered in the card's sub-heading. */
  subHeading?: ReactNode;
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

function CostsColumn({
  service,
  labour,
  subHire,
  sale,
  maintenance,
}: {
  service: number;
  labour: number;
  subHire: number;
  sale: number;
  maintenance: { total: number; count: number; href: string; labourRevenue: number } | null;
}) {
  const m = maintenance ?? { total: 0, count: 0, href: "", labourRevenue: 0 };
  // The costs the margin subtracts (`marginExGst`): services, labour, sub-hire, sale COGS.
  const costs = service + labour + subHire + sale;
  // Only non-zero lines show. "Labour revenue" is a memo beside the labour COST
  // row (WS10 #949): revenue for service-linked LABOUR services, while the cost
  // also covers standalone crew that never has a charge side.
  const lines: { label: string; amount: number; muted?: boolean }[] = [
    { label: "Services", amount: service },
    { label: "Labour", amount: labour },
    { label: "Labour revenue", amount: m.labourRevenue, muted: true },
    { label: "Sub-Hires", amount: subHire },
    { label: "Sale cost of goods", amount: sale },
  ];
  return (
    <div className="space-y-1.5">
      <div className="t-overline text-fg-4">Costs</div>
      {lines.filter((l) => l.amount > 0).map((l) => (
        <Row key={l.label} label={l.label} value={formatCurrency(l.amount)} muted={l.muted} />
      ))}
      {costs > 0 ? <Row label="Total costs" value={formatCurrency(costs)} bold /> : <Row label="No costs recorded" value="—" muted />}
      {/* Maintenance is its own memo line: it is NOT in the margin above, so it never makes a second margin. */}
      {m.total > 0 && <Row label={`Maintenance (${m.count}), not in margin`} value={formatCurrency(m.total)} muted />}
      {m.count > 0 && (
        <Link href={m.href} className="inline-block text-caption text-link underline-offset-2 hover:underline">
          Maintenance records →
        </Link>
      )}
    </div>
  );
}

function RevenueColumn(p: {
  equipment: number;
  sale: number;
  service: number;
  subtotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  taxAmount: number | null;
}) {
  return (
    <div className="space-y-1.5">
      <div className="t-overline text-fg-4">Revenue</div>
      <Row label="Equipment" value={formatCurrency(p.equipment)} />
      {p.sale > 0 && <Row label="Sale items" value={formatCurrency(p.sale)} />}
      {p.service > 0 && <Row label="Services" value={formatCurrency(p.service)} />}
      <Row label="Subtotal" value={formatCurrency(p.subtotal)} bold />
      {p.discountPercent != null && Number(p.discountPercent) > 0 && (
        <Row label={`Discount (${Number(p.discountPercent)}%)`} value={`-${formatCurrency(p.discountAmount)}`} negative />
      )}
      <Row label={`Tax (${p.taxRate != null ? Number(p.taxRate) : 10}%)`} value={formatCurrency(p.taxAmount)} muted />
    </div>
  );
}

/** `Show group pricing`: each priced group's bundle price (the audit trail). */
function GroupPricing({ items }: { items: GroupBreakdownItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 text-xs text-fg-4 transition-colors hover:text-fg-3"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Show group pricing
      </button>
      {open && (
        <div className="space-y-0.5">
          {items.map((g, i) => (
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
    </div>
  );
}

/**
 * The Finance tab's Financials card (spec §8b): Revenue and Costs in two
 * columns with ONE margin, ex GST. Invoiced / paid figures live in the
 * position tiles above (derived once, never repeated here). The cost column and
 * the margin render by PRESENCE: the server leaves the job-cost totals out for a
 * caller without job cost, and absent and null are the SAME here (a
 * reconstructed project maps absent to null).
 */
export function FinancialSummary({
  equipmentRevenue,
  saleRevenue,
  saleCostTotal,
  serviceChargeTotal,
  serviceCostTotal,
  labourCostTotal,
  subHireCostTotal,
  maintenance = null,
  subtotal,
  discountPercent,
  discountAmount,
  taxRate,
  taxAmount,
  total,
  margin,
  pricedGroupCount,
  totalGroupCount,
  groupBreakdown = [],
  subHeading,
}: FinancialSummaryProps) {
  const totalVal = total != null ? Number(total) : 0;
  const marginVal = margin != null ? Number(margin) : 0;
  // The margin's base is revenue EX GST (the same base as the tile): total less tax.
  const revenueExGst = totalVal - (taxAmount != null ? Number(taxAmount) : 0);
  const costsShown = margin != null && serviceCostTotal != null && labourCostTotal != null;
  const allGroupsPriced = totalGroupCount != null && pricedGroupCount != null && pricedGroupCount >= totalGroupCount;

  return (
    <div className="space-y-4">
      <div>
        <div className="t-overline text-fg-3">Financials</div>
        {subHeading ? <div className="mt-1">{subHeading}</div> : null}
      </div>

      {/* Total + the one margin */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-3">Total inc GST</span>
          <span className="text-lg font-bold tabular-nums tracking-tight text-fg">{formatCurrency(totalVal)}</span>
        </div>
        {costsShown && <MarginBar margin={marginVal} total={revenueExGst} />}
        <div className="flex items-baseline justify-between">
          {costsShown ? (
            <span className="text-right text-[11px] text-fg-4">Margin: {formatCurrency(marginVal)} ex GST</span>
          ) : (
            <span />
          )}
          {totalGroupCount != null && totalGroupCount > 0 && (
            <span className={cn("text-[11px] tabular-nums", allGroupsPriced ? "text-fg-4" : "text-[oklch(0.72_0.17_70)]")}>
              {pricedGroupCount}/{totalGroupCount} groups priced
            </span>
          )}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className={cn("grid gap-6", costsShown && "sm:grid-cols-2")}>
        <RevenueColumn
          equipment={equipmentRevenue != null ? Number(equipmentRevenue) : 0}
          sale={saleRevenue != null ? Number(saleRevenue) : 0}
          service={serviceChargeTotal != null ? Number(serviceChargeTotal) : 0}
          subtotal={subtotal}
          discountPercent={discountPercent}
          discountAmount={discountAmount}
          taxRate={taxRate}
          taxAmount={taxAmount}
        />
        {costsShown && (
          <CostsColumn
            service={Number(serviceCostTotal)}
            labour={Number(labourCostTotal)}
            subHire={subHireCostTotal != null ? Number(subHireCostTotal) : 0}
            sale={saleCostTotal != null ? Number(saleCostTotal) : 0}
            maintenance={maintenance}
          />
        )}
      </div>

      <GroupPricing items={groupBreakdown} />
    </div>
  );
}
