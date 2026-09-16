"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";
import { ProjectQuoteRail, ASSIGN_CLIENT_FOR_QUOTES_MESSAGE, type QuoteRailVersionContext } from "@/components/projects/project-quote-rail";
import { ProjectInvoiceLedger } from "@/components/projects/finance/project-invoice-ledger";
import { useProjectVersion } from "@/components/projects/project-version-context";

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
 *
 * #1233 (Phase 6) UI follow-up — this is the ONE `ProjectQuoteRail` embed
 * site that opts into `versionContext` (`useProjectVersion()`, the same
 * subscription `VersionStrip`/the header pill already read — R-3.1, no new
 * query). It's always rendered under `ProjectVersionProvider` (mounted once
 * above the tabs on `/projects/[id]`, `FinanceTabSlot`), which is what makes
 * this safe to call unconditionally. The Overview tab's `QuoteCard`/
 * `QuoteManagerDialog` deliberately do NOT — Overview stays live-only
 * (FEATUREDOCS/76), so they never pass this prop and keep exactly their
 * pre-follow-up behaviour.
 */
export function ProjectFinancePanel({ projectId, projectNumber, clientId, projectStatus, subtotal, taxAmount, total }: ProjectFinancePanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");

  const { versions, isViewingVersion, viewingVersion } = useProjectVersion();
  const versionContext: QuoteRailVersionContext = {
    versions: versions.map((v) => ({ id: v.id, number: v.number, label: v.label })),
    viewing: isViewingVersion && viewingVersion ? { id: viewingVersion.id, number: viewingVersion.number, label: viewingVersion.label } : null,
  };

  return (
    <div className="space-y-6">
      {clientId ? (
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
      ) : (
        <p className="t-micro text-fg-4">{ASSIGN_CLIENT_FOR_QUOTES_MESSAGE}</p>
      )}

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
