import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { invoiceArtifactFileName } from "@/lib/finance-artifacts";
import { artifactNotFound, streamStoredArtifact } from "@/lib/finance-artifact-response";

export const runtime = "nodejs";

/**
 * `GET /api/finance/invoice/[invoiceId]/pdf` — the stored, immutable invoice
 * document (#987). The invoice ROW has been immutable once ISSUED since WS1
 * (#940); this is what extends that guarantee past the database boundary to the
 * artifact the client is actually holding. No regeneration path.
 *
 * A VOIDed invoice keeps its document for the same reason a superseded quote
 * does: it was sent, so the record has to show what was sent.
 *
 * Auth: `invoice:read` + the org check inside
 * `financeArtifacts.invoiceArtifactContext` (`invoices.by_cuid` is GLOBAL —
 * R-8.4.3).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;

  let organizationId: string;
  try {
    ({ organizationId } = await requirePermission("invoice", "read"));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convex = await getConvexClient();
  let invoice;
  try {
    invoice = await convex.query(api.financeArtifacts.invoiceArtifactContext, {
      invoiceId,
      orgId: organizationId,
    });
  } catch {
    return artifactNotFound("Invoice not found.");
  }

  if (!invoice.pdfFileId) {
    return artifactNotFound("This invoice has no stored document yet.");
  }

  return streamStoredArtifact({
    storageId: invoice.pdfFileId,
    fileName: invoiceArtifactFileName(invoice.projectNumber, invoice.invoiceNumber),
    organizationId,
  });
}
