"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { useProjectOperationalCosts } from "@/hooks/use-project-operational-costs";
import { api } from "../../../../convex/_generated/api";
import { FinancialSummary } from "@/components/projects/financial-summary";
import { BillingSummaryRow } from "@/components/projects/billing-summary-row";
import { ProjectQuoteRail, ASSIGN_CLIENT_FOR_QUOTES_MESSAGE, type QuoteRailVersionContext } from "@/components/projects/project-quote-rail";
import { ProjectInvoiceLedger } from "@/components/projects/finance/project-invoice-ledger";
import { XeroLine } from "@/components/projects/finance/xero-line";
import { TabStrip } from "@/components/ui/tab-strip";
import { useProjectVersion } from "@/components/projects/project-version-context";
import type { FinanceView } from "@/lib/finance-view";

/**
 * The Finance tab's pieces (UX Phase 10, spec §8b), composed by
 * `FinanceTabSlot` in `job-tab-slots.tsx`. Split out so each stays small.
 */

const SWITCH_ITEMS = [
  { value: "quotes", label: "Quotes" },
  { value: "invoices", label: "Invoices" },
];

/** D55: Quotes and Invoices are two words with one strip each, not stacked sections. */
export function FinanceWordsSwitch({ value, onValueChange }: { value: FinanceView; onValueChange: (v: FinanceView) => void }) {
  return (
    <TabStrip
      idPrefix="finance-view"
      aria-label="Quotes or invoices"
      items={SWITCH_ITEMS}
      value={value}
      onValueChange={(v) => onValueChange(v as FinanceView)}
    />
  );
}

/**
 * The ONE strip for the chosen word. `ProjectQuoteRail` and `ProjectInvoiceLedger`
 * are the SAME components the Overview tab's manager dialogs embed (R-3.1). The
 * invoice ledger is project-level, never per-version (invoices are
 * lineage-labelled), so it stays live while a version is being viewed.
 */
export function FinanceStrip({
  view,
  projectId,
  projectNumber,
  clientId,
  projectStatus,
  subtotal,
  taxAmount,
  total,
}: {
  view: FinanceView;
  projectId: string;
  projectNumber: string;
  clientId: string | null | undefined;
  projectStatus: string | null | undefined;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const { versions, isViewingVersion, viewingVersion } = useProjectVersion();

  if (view === "invoices") {
    return (
      <div className="space-y-4">
        <XeroLine projectId={projectId} orgId={orgId} />
        <ProjectInvoiceLedger projectId={projectId} orgId={orgId} clientId={clientId} projectStatus={projectStatus} total={total} />
      </div>
    );
  }
  if (!clientId) return <p className="t-micro text-fg-4">{ASSIGN_CLIENT_FOR_QUOTES_MESSAGE}</p>;
  const versionContext: QuoteRailVersionContext = {
    versions: versions.map((v) => ({ id: v.id, number: v.number, label: v.label })),
    viewing: isViewingVersion && viewingVersion ? { id: viewingVersion.id, number: viewingVersion.number, label: viewingVersion.label } : null,
  };
  return (
    <ProjectQuoteRail
      projectId={projectId}
      orgId={orgId}
      projectNumber={projectNumber}
      clientId={clientId}
      projectStatus={projectStatus}
      subtotal={subtotal}
      taxAmount={taxAmount}
      total={total}
      invoices={invoices}
      versionContext={versionContext}
    />
  );
}

type SummaryProps = Omit<React.ComponentProps<typeof FinancialSummary>, "margin" | "maintenance" | "subHeading">;

/**
 * Financials card: Revenue and Costs in two columns with ONE margin, ex GST.
 * The operational P&L (net margin, maintenance) is read ONLY when the project
 * carries a margin: the server leaves job cost out for a caller without it, so
 * `margin == null` means ABSENT and nothing here asks for, or prints, a cost.
 * A zero-filled `operationalCosts` shape (what such a caller would get) is
 * therefore never rendered as real.
 */
export function FinancialsCard({
  projectId,
  orgId,
  margin,
  billing,
  ...summary
}: SummaryProps & {
  projectId: string;
  orgId: string | undefined;
  margin: number | null;
  billing: Pick<React.ComponentProps<typeof BillingSummaryRow>, "rentalStartDate" | "rentalEndDate" | "billingWeeksOverride" | "billingDaysOverride">;
}) {
  const { data: pnl } = useProjectOperationalCosts(margin != null ? projectId : "");
  const pnlLoaded = margin != null && pnl != null && pnl.total > 0;
  return (
    <FinancialSummary
      {...summary}
      margin={pnlLoaded ? pnl.netMargin : margin}
      maintenance={
        pnlLoaded
          ? {
              total: pnl.maintenanceCostTotal,
              count: pnl.counts.maintenanceRecords,
              href: `/maintenance?projectId=${encodeURIComponent(projectId)}`,
              labourRevenue: pnl.labourServiceRevenue,
            }
          : null
      }
      subHeading={<BillingSummaryRow projectId={projectId} orgId={orgId} {...billing} />}
    />
  );
}
