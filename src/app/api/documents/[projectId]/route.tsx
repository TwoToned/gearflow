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
  manifest: "manifest",
  "container-label": "container-label",
  "kit-label": "kit-label",
};

/** Client-facing finance docs — reachable here ONLY as a watermarked preview. */
const PREVIEW_ONLY_TYPES = new Set<ProjectDocumentType>(["quote", "invoice"]);

/**
 * Preview-only date overrides (issue dialog bugfix): a preview of an unissued
 * invoice otherwise falls back to `now` + the org's default payment terms,
 * ignoring whatever invoice/due date is currently typed in the dialog. Only
 * meaningful for `preview` + `type=invoice` — `buildDocumentData` only reads
 * `stampedDates` there, so this is a no-op (returns `undefined`) elsewhere.
 */
function resolveInvoicePreviewStampedDates(
  preview: boolean,
  docType: ProjectDocumentType,
  invoiceDateParam: string | null,
  dueDateParam: string | null,
): { documentDate?: number; invoiceDueDate?: number } | undefined {
  if (!preview || docType !== "invoice") return undefined;
  const invoiceDate = invoiceDateParam ? Number(invoiceDateParam) : undefined;
  const dueDate = dueDateParam ? Number(dueDateParam) : undefined;
  const documentDate = Number.isFinite(invoiceDate) ? invoiceDate : undefined;
  const invoiceDueDate = Number.isFinite(dueDate) ? dueDate : undefined;
  if (documentDate == null && invoiceDueDate == null) return undefined;
  return { documentDate, invoiceDueDate };
}

/** Query params the route reads, parsed in one place so `GET` stays flat. */
function readDocumentParams(url: URL) {
  const q = url.searchParams;
  return {
    type: q.get("type") || "quote",
    preview: q.get("preview") === "1",
    // Which SPECIFIC invoice this preview is for — without it, `generatePdf`
    // falls back to the live project total/breakdown, which is only correct
    // for a FULL invoice (bug fix: a DEPOSIT/BALANCE/CREDIT invoice needs its
    // own snapshot, not the whole project's). Passed through unconditionally
    // below — `buildDocumentData` only reads it for `docType: "invoice"`, so
    // it's a harmless no-op on any other type, not worth its own branch here.
    invoiceId: q.get("invoiceId") || undefined,
    // `container-label` / `kit-label` only: print one container / kit instead
    // of all of them. A no-op for every other type.
    labelId: q.get("labelId") || undefined,
    previewInvoiceDateParam: q.get("invoiceDate"),
    previewDueDateParam: q.get("dueDate"),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const { type, preview, invoiceId, labelId, previewInvoiceDateParam, previewDueDateParam } = readDocumentParams(new URL(request.url));
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

  const stampedDates = resolveInvoicePreviewStampedDates(preview, docType, previewInvoiceDateParam, previewDueDateParam);

  try {
    // `draftPreview` is set for the finance types only — a warehouse doc is not
    // a draft of anything, so it never carries the banner.
    const pdf = await generatePdf(projectId, organizationId, docType, {
      draftPreview: preview && PREVIEW_ONLY_TYPES.has(docType),
      invoiceId,
      stampedDates,
      labelId,
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
