"use client";

import { FinancialSummary } from "@/components/projects/financial-summary";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * Read-only projection of the Finance tab's money summary for a non-live
 * version. Reuses `<FinancialSummary>` — the SAME presentational component
 * the live Finance tab renders (page.tsx) — fed from `projected.finance`
 * instead of the live `project` object, rather than a parallel hand-built
 * summary (R-3.1).
 *
 * The quote/invoice ledger (`ProjectFinancePanel`) and operational-cost
 * breakdown (`ProjectCostsPanel`) are deliberately NOT reproduced here:
 * invoices are lineage-labelled on ONE project-level ledger, never
 * per-version (design doc decision 3) — they stay live, always — and
 * per-version operational-cost breakdowns have no snapshot-derivable
 * equivalent (project-level cost TOTALS are captured; the itemised
 * breakdown `ProjectCostsPanel` renders is computed live from current
 * line items, which is exactly the kind of number this projection would
 * otherwise have to fake). Both are called out below rather than silently
 * omitted.
 */
export function VersionProjectedFinance() {
  const { projected, isLoadingProjection, viewingRevision } = useProjectVersion();

  if (isLoadingProjection) {
    return <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">Loading v{viewingRevision}…</div>;
  }
  if (!projected) return null;

  const f = projected.finance;
  const serviceChargeTotal =
    f.subtotal != null && f.equipmentRevenue != null
      ? f.subtotal - f.equipmentRevenue - (f.saleRevenue ?? 0)
      : null;

  return (
    <div className="space-y-4">
      <FinancialSummary
        equipmentRevenue={f.equipmentRevenue}
        saleRevenue={f.saleRevenue}
        saleCostTotal={f.saleCostTotal}
        serviceChargeTotal={serviceChargeTotal}
        serviceCostTotal={f.serviceCostTotal}
        labourCostTotal={f.labourCostTotal}
        subHireCostTotal={f.subHireCostTotal}
        subtotal={f.subtotal}
        discountPercent={f.discountPercent}
        discountAmount={f.discountAmount}
        taxRate={f.taxRate}
        taxAmount={f.taxAmount}
        total={f.total}
        margin={f.margin}
        // Real money received/invoiced is never rolled back by a version view
        // (design doc's PROMOTE field-exclusion table) — rendered as "not
        // captured" via `null`, never a stale or misleading snapshot figure.
        depositPaid={null}
        invoicedTotal={null}
      />
      <div className="rounded-[var(--r)] border border-line bg-card px-3 py-2 text-caption text-muted">
        Invoices aren&apos;t versioned — they&apos;re shown on the live Finance tab, labelled with the
        version that produced their figures. Operational cost breakdown isn&apos;t captured in this
        version — showing current.
      </div>
    </div>
  );
}
