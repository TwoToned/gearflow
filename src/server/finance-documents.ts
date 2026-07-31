"use server";

/**
 * Immutable finance ARTIFACTS — render once, store the bytes (#987, Phase B).
 *
 * This is the freeze moment for the *document*, the way `quotesWrites.sendNative`
 * is the freeze moment for the *money*. The PDF is rendered here (pdfme needs
 * Node, so it can't live in a Convex mutation), uploaded to Convex `_storage`
 * via `src/lib/storage.ts`, and its storage id attached to the row by
 * `convex/financeArtifacts.ts` — which refuses to overwrite an existing one.
 *
 * Why bytes and not "re-render from the snapshot on demand": a reconstruction
 * path would re-execute ~1,400 lines of `build-document-data.ts` plus the
 * composer against a snapshot that would have to grow to carry every token, and
 * any future change to that code would silently rewrite historical documents.
 * Storing the bytes makes immutability structural instead of disciplinary — the
 * same reasoning as `withValidatedBody` in CLAUDE.md.
 *
 * **Failure handling.** The Convex row is written first (inside its own
 * transaction); this runs immediately after. If it fails, the quote is `SENT`
 * with a null `pdfFileId` and the Finance tab renders a "document still
 * generating / failed — retry" state wired to these same two actions. The retry
 * is safe to expose precisely because `attach*Artifact` can't overwrite: a retry
 * that races a slow first attempt loses the race harmlessly, and its orphan
 * upload is deleted here rather than left to accumulate.
 *
 * Both actions are idempotent and cheap to call twice.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { logger } from "@/lib/logger";
import { generatePdf } from "@/lib/pdfme/generate-pdf";
import { uploadToS3, deleteFromS3 } from "@/lib/storage";
import { quoteArtifactFileName, invoiceArtifactFileName } from "@/lib/finance-artifacts";

export interface ArtifactResult {
  /** The storage id now on the row — never null on success. */
  pdfFileId: string;
  /** False when an artifact already existed (nothing was overwritten). */
  generated: boolean;
}

/**
 * Render + store the PDF for a SENT quote revision.
 *
 * Called immediately after `quotesWrites.sendNative` and by the retry action on
 * a sent revision whose render failed. Requires `invoice:publish` — the same
 * audience that can send in the first place.
 */
export async function generateQuoteArtifact(quoteId: string): Promise<ArtifactResult> {
  const { organizationId, userId, userName } = await requirePermission("invoice", "publish");
  const convex = await getConvexClient();

  const quote = await convex.query(api.financeArtifacts.quoteArtifactContext, {
    quoteId,
    orgId: organizationId,
    now: Date.now(),
  });

  // Already frozen — hand back the existing artifact. This is the property the
  // whole program rests on: there is no code path that re-renders over one.
  if (quote.pdfFileId) return serialize({ pdfFileId: quote.pdfFileId, generated: false });
  if (quote.sentAt == null) {
    throw new Error("Only a sent quote revision has a stored document. Send it first.");
  }

  const pdf = await generatePdf(quote.projectId, organizationId, "quote", {
    // From the ROW, never `now` — re-rendering must not move the client's dates.
    stampedDates: {
      documentDate: quote.quoteDate ?? quote.sentAt,
      quoteValidUntil: quote.validUntil ?? undefined,
    },
  });

  const fileName = quoteArtifactFileName(quote.projectNumber, quote.version);
  const upload = await uploadToS3(Buffer.from(pdf), {
    organizationId,
    folder: "finance/quotes",
    entityId: quote.quoteId,
    fileName,
    mimeType: "application/pdf",
  });

  const attached = await convex.mutation(api.financeArtifacts.attachQuoteArtifact, {
    quoteId,
    orgId: organizationId,
    storageId: upload.storageKey,
    now: Date.now(),
  });

  if (!attached.attached) {
    await discardOrphan(upload.storageKey);
    return serialize({ pdfFileId: attached.pdfFileId, generated: false });
  }

  await logActivity({
    organizationId,
    action: "QUOTE_DOCUMENT_STORED",
    entityType: "quote",
    entityId: quote.quoteId,
    entityName: quote.label,
    userId,
    userName,
    summary: `Stored the quote document for ${quote.label}`,
    details: { version: quote.version, fileName },
    projectId: quote.projectId,
  });

  return serialize({ pdfFileId: attached.pdfFileId, generated: true });
}

/**
 * Render + store the PDF for an ISSUED invoice. Requires `invoice:issue` — the
 * audience that can issue one.
 */
export async function generateInvoiceArtifact(invoiceId: string): Promise<ArtifactResult> {
  const { organizationId, userId, userName } = await requirePermission("invoice", "issue");
  const convex = await getConvexClient();

  const invoice = await convex.query(api.financeArtifacts.invoiceArtifactContext, {
    invoiceId,
    orgId: organizationId,
  });

  if (invoice.pdfFileId) return serialize({ pdfFileId: invoice.pdfFileId, generated: false });
  if (invoice.issuedAt == null) {
    throw new Error("Only an issued invoice has a stored document. Issue it first.");
  }

  const pdf = await generatePdf(invoice.projectId, organizationId, "invoice", {
    // `invoiceDate` (#989) is the user-chosen printed date; a pre-#989 issued
    // invoice has none, so fall back to the system `issuedAt` timestamp.
    stampedDates: {
      documentDate: invoice.invoiceDate ?? invoice.issuedAt,
      invoiceDueDate: invoice.dueDate ?? undefined,
    },
  });

  const fileName = invoiceArtifactFileName(invoice.projectNumber, invoice.invoiceNumber);
  const upload = await uploadToS3(Buffer.from(pdf), {
    organizationId,
    folder: "finance/invoices",
    entityId: invoice.invoiceId,
    fileName,
    mimeType: "application/pdf",
  });

  const attached = await convex.mutation(api.financeArtifacts.attachInvoiceArtifact, {
    invoiceId,
    orgId: organizationId,
    storageId: upload.storageKey,
    now: Date.now(),
  });

  if (!attached.attached) {
    await discardOrphan(upload.storageKey);
    return serialize({ pdfFileId: attached.pdfFileId, generated: false });
  }

  await logActivity({
    organizationId,
    action: "INVOICE_DOCUMENT_STORED",
    entityType: "invoice",
    entityId: invoice.invoiceId,
    entityName: invoice.invoiceNumber ?? invoice.invoiceId,
    userId,
    userName,
    summary: `Stored the invoice document for ${invoice.invoiceNumber ?? invoice.invoiceId}`,
    details: { fileName },
    projectId: invoice.projectId,
  });

  return serialize({ pdfFileId: attached.pdfFileId, generated: true });
}

/** Bin the bytes we uploaded but didn't attach (another attempt won the race).
 *  Best-effort: a leaked blob is not worth failing a download over, but it is
 *  worth logging, because a pattern of them means the retry path is being hit. */
async function discardOrphan(storageKey: string): Promise<void> {
  try {
    await deleteFromS3(storageKey);
  } catch (error) {
    logger.warn("[FinanceArtifacts] failed to delete an unattached artifact upload", {
      storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
