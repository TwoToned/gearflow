"use client";

import { StalePricingBanner } from "@/components/projects/stale-pricing-banner";
import { PositionTiles } from "@/components/projects/finance/position-tiles";
import { FinanceStrip, FinanceWordsSwitch, FinancialsCard } from "@/components/projects/finance/finance-tab-parts";
import { useFinanceView } from "@/hooks/use-finance-view";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * The job page's Finance tab body, moved out of
 * `src/app/(app)/projects/[id]/page.tsx` (UX Phase 7) so the page stays small enough
 * for Phases 9 and 10 to merge into. (The Notes body moved to
 * `tasks-notes/notes-section.tsx` when Tasks, Notes and Files merged, UX Phase 10.)
 */

interface FinanceTabSlotProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId: string | null | undefined;
  projectStatus: string | null | undefined;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
  billingWeeksOverride: number | null;
  billingDaysOverride: number | null;
  categories: { groups: { title: string; quantity: number; price: unknown }[] }[] | undefined;
  equipmentRevenue: number | null;
  saleRevenue: number | null;
  saleCostTotal: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subHireCostTotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  margin: number | null;
}

/**
 * The Finance tab (UX Phase 10, spec §8b): four position tiles, the stale-pricing
 * notice, a Quotes / Invoices words-switch (D55; `?fin=`) with one strip each,
 * then the Financials card. Margin, costs and the P&L render by PRESENCE: a
 * caller without job cost gets none of them from the server (`null` = absent).
 */
export function FinanceTabSlot(props: FinanceTabSlotProps) {
  const { isViewingVersion } = useProjectVersion();
  const [view, setView] = useFinanceView();
  const allGroups = props.categories?.flatMap((c) => c.groups) ?? [];
  const totalGroupCount = allGroups.length;
  const pricedGroupCount = allGroups.filter((g) => g.price != null && Number(g.price) > 0).length;
  const groupBreakdown = allGroups
    .filter((g) => g.price != null && Number(g.price) > 0)
    .map((g) => ({ title: g.title, quantity: g.quantity, price: Number(g.price) }));

  return (
    <div className="space-y-6">
      <PositionTiles
        projectId={props.projectId}
        orgId={props.orgId}
        clientId={props.clientId}
        total={props.total}
        taxAmount={props.taxAmount}
        margin={props.margin}
      />
      {/* Recalculate is a live-data write action — not meaningful while
          viewing a read-only historical version. */}
      {!isViewingVersion && <StalePricingBanner projectId={props.projectId} orgId={props.orgId} />}
      <div className="space-y-4">
        <FinanceWordsSwitch value={view} onValueChange={setView} />
        <FinanceStrip
          view={view}
          projectId={props.projectId}
          projectNumber={props.projectNumber}
          clientId={props.clientId}
          projectStatus={props.projectStatus}
          subtotal={props.subtotal}
          taxAmount={props.taxAmount}
          total={props.total}
        />
      </div>
      <div className="h-px bg-line" />
      {/* The money breakdown is always the LIVE project's — a viewed version's OWN
          figures aren't computable without recalculating totals against that
          version's line items (`recalcVersionTotals`, a Convex-side job). */}
      {isViewingVersion && <VersionNotTrackedNote what="This financial breakdown" />}
      <FinancialsCard
        projectId={props.projectId}
        orgId={props.orgId}
        billing={{
          rentalStartDate: props.rentalStartDate,
          rentalEndDate: props.rentalEndDate,
          billingWeeksOverride: props.billingWeeksOverride,
          billingDaysOverride: props.billingDaysOverride,
        }}
        equipmentRevenue={props.equipmentRevenue}
        saleRevenue={props.saleRevenue}
        saleCostTotal={props.saleCostTotal}
        serviceChargeTotal={
          props.subtotal != null && props.equipmentRevenue != null
            ? props.subtotal - props.equipmentRevenue - (props.saleRevenue ?? 0)
            : null
        }
        serviceCostTotal={props.serviceCostTotal}
        labourCostTotal={props.labourCostTotal}
        subHireCostTotal={props.subHireCostTotal}
        subtotal={props.subtotal}
        discountPercent={props.discountPercent}
        discountAmount={props.discountAmount}
        taxRate={props.taxRate}
        taxAmount={props.taxAmount}
        total={props.total}
        margin={props.margin}
        pricedGroupCount={pricedGroupCount}
        totalGroupCount={totalGroupCount}
        groupBreakdown={groupBreakdown}
      />
    </div>
  );
}
