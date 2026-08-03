"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";
import { ProjectQuoteRail } from "@/components/projects/project-quote-rail";
import { ProjectInvoiceLedger } from "@/components/projects/finance/project-invoice-ledger";

interface ProjectFinancePanelProps {
  projectId: string;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
}

/**
 * WS1 (#940), reworked by #986 — the project's Quotes & Invoices workflow.
 *
 * A thin composer over the two independently-embeddable halves (invoices
 * manager modal work) — `<ProjectQuoteRail>` and `<ProjectInvoiceLedger>`
 * are the SAME components the Overview tab's `QuoteManagerDialog`/
 * `InvoiceManagerDialog` embed, so this panel and those modals can never
 * drift (POLICY.md R-3.1). See those two files for the actual quote/invoice
 * workflow documentation.
 *
 * `invoices` is queried once here and passed down to `ProjectQuoteRail` for
 * its per-revision invoice lineage line (avoiding a second query there, per
 * its own R-3.1 comment) — `ProjectInvoiceLedger` queries it again itself,
 * which is cheap and idiomatic: Convex dedupes reactive queries with
 * identical args across components.
 */
export function ProjectFinancePanel({ projectId, projectNumber, clientId, projectStatus, subtotal, taxAmount, total }: ProjectFinancePanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");

  return (
    <div className="space-y-6">
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
      />

      <ProjectInvoiceLedger
        projectId={projectId}
        orgId={orgId}
        clientId={clientId}
        projectStatus={projectStatus}
        total={total}
      />
    </div>
  );
}
