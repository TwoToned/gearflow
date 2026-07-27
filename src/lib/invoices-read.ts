import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Service-token read helper for the `invoices` table (WS1 #940). Not
 * exported (knip-flagged as dead — this file's only consumer today is
 * `getLatestInvoiceNumberForProject` below, in the same file); re-export it
 * if/when a second non-browser server context needs a project's raw invoice
 * list, following the same `*-read.ts` shape every other one uses
 * (FEATUREDOCS/54).
 */
async function getInvoicesByProject(projectId: string, organizationId: string): Promise<Doc<"invoices">[]> {
  const convex = await getConvexClient();
  return withConvexReadRetry(() => convex.query(api.invoices.listForProject, { orgId: organizationId, projectId }));
}

/**
 * The invoice number to show on the "invoice" PDF: the most recently ISSUED
 * non-VOID invoice for this project (BALANCE/FULL preferred over a DEPOSIT,
 * since that's the document a client would actually receive as "the
 * invoice"), or null when nothing has been issued yet (a DRAFT invoice has
 * no number — see convex/invoicesWrites.ts issueNative).
 */
export async function getLatestInvoiceNumberForProject(projectId: string, organizationId: string): Promise<string | null> {
  const invoices = await getInvoicesByProject(projectId, organizationId);
  const issued = invoices.filter((inv) => inv.status === "ISSUED" && inv.invoiceNumber);
  if (issued.length === 0) return null;
  const priority: Record<string, number> = { FULL: 0, BALANCE: 1, DEPOSIT: 2, CREDIT: 3 };
  issued.sort((a, b) => {
    const p = (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9);
    if (p !== 0) return p;
    return (b.issuedAt ?? 0) - (a.issuedAt ?? 0);
  });
  return issued[0]!.invoiceNumber ?? null;
}
