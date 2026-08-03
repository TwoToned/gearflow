import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { requirePermission } from "@/lib/org-context";
import { generatePdf } from "@/lib/pdfme/generate-pdf";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";

/**
 * Warehouse document rendering — pull slip, delivery docket, return sheet.
 * These are internal artifacts of live project state by design: a packer wants
 * TODAY's list, so re-rendering is the correct behaviour for them.
 *
 * Quote and invoice are NOT in that category and no longer have a live path
 * here (#987). The document the client holds is the stored artifact
 * (`/api/finance/{quote,invoice}/…/pdf`); this route will only produce one for
 * them behind `preview=1`, which stamps a "DRAFT PREVIEW — NOT SENT" watermark
 * on every page and requires `invoice:read`. That is what removes the rogue
 * path the header's Documents ▾ used to expose.
 */

/** Map URL type param values to pdfme ProjectDocumentType */
const typeMap: Record<string, ProjectDocumentType> = {
  quote: "quote",
  invoice: "invoice",
  "pull-slip": "packing-list",
  "return-sheet": "return-sheet",
  "delivery-docket": "delivery-docket",
};

/** Client-facing finance docs — reachable here ONLY as a watermarked preview. */
const PREVIEW_ONLY_TYPES = new Set<ProjectDocumentType>(["quote", "invoice"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "quote";
  const preview = url.searchParams.get("preview") === "1";
  // Which SPECIFIC invoice this preview is for — without it, `generatePdf`
  // falls back to the live project total/breakdown, which is only correct
  // for a FULL invoice (bug fix: a DEPOSIT/BALANCE/CREDIT invoice needs its
  // own snapshot, not the whole project's). Passed through unconditionally
  // below — `buildDocumentData` only reads it for `docType: "invoice"`, so
  // it's a harmless no-op on any other type, not worth its own branch here.
  const invoiceId = url.searchParams.get("invoiceId") || undefined;

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  const docType = typeMap[type];
  if (!docType) {
    return NextResponse.json({ error: `Unknown document type: ${type}` }, { status: 400 });
  }

  if (PREVIEW_ONLY_TYPES.has(docType)) {
    if (!preview) {
      return NextResponse.json(
        {
          error:
            "Quotes and invoices are served from the Finance tab as stored documents. " +
            "Use /api/finance/quote/{quoteId}/pdf or add preview=1 for a watermarked draft preview.",
        },
        { status: 400 },
      );
    }
    try {
      await requirePermission("invoice", "read");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    // `draftPreview` is set for the finance types only — a warehouse doc is not
    // a draft of anything, so it never carries the banner.
    const pdf = await generatePdf(projectId, organizationId, docType, {
      draftPreview: preview && PREVIEW_ONLY_TYPES.has(docType),
      invoiceId,
    });
    const filename = `${docType}-${projectId}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("PDF generation error", { error: error });
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
