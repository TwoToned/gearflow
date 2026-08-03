import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import { effectiveQuoteStatus, quoteLabel, requireQuoteInOrg } from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Immutable finance ARTIFACTS (#987, Phase B) — the storage-id side of
 * "render once, keep the bytes".
 *
 * Before this, `/api/documents/[projectId]?type=quote` re-rendered from LIVE
 * project state on every click: two downloads a week apart produced two
 * different documents under the same name, and the document the client was
 * actually holding existed nowhere in the system. `quotes.pdfFileId` was
 * declared with zero readers and zero writers. Invoices had the same hole — the
 * ROW was immutable once ISSUED, but the artifact was not, so the guarantee
 * stopped at the database boundary.
 *
 * The freeze is now structural rather than disciplinary (the `withValidatedBody`
 * reasoning in CLAUDE.md): the PDF is rendered once by the server action
 * (`src/server/finance-documents.ts` — pdfme runs in Node, not Convex), the
 * bytes are stored in Convex `_storage` via `src/lib/storage.ts`, and the
 * storage id is attached HERE, **once**. There is deliberately no mutation that
 * can replace an artifact:
 *
 * - `attachQuoteArtifact` / `attachInvoiceArtifact` refuse to overwrite a
 *   non-null `pdfFileId`, reporting `attached: false` and handing back the id
 *   that is already there so the caller can bin its orphan upload. That is what
 *   makes the retry path (for a send whose render failed) safe to expose: it
 *   physically cannot rewrite history, so a retry racing a first attempt loses
 *   harmlessly instead of swapping the client's document.
 * - Nothing deletes one. A SUPERSEDED revision (a different row) KEEPS its
 *   artifact untouched — the client may be holding that copy, so destroying
 *   ours makes the record worse, not better. Recalling the SAME revision is the
 *   one case that unlinks `pdfFileId` (`quotesWrites.recallNative` moves it to
 *   `recalledPdfFileIds` rather than dropping it) — on purpose, so a resend is
 *   forced through a fresh render instead of this guard silently keeping the
 *   pre-recall bytes attached (#1027).
 *
 * SERVICE-gated (the Next.js server is the only caller, exactly like
 * `convex/files.ts`): rendering needs Node, and authorisation — `invoice:read`
 * to download, `invoice:publish`/`invoice:issue` to generate — happens in the
 * server action / route handler before we get here. Per CLAUDE.md rule 1, there
 * is NO agent escape hatch; an API key reaches these only through a server
 * action that has already resolved its RBAC.
 *
 * ⚠️ R-8.4.3: `quotes.by_cuid` / `invoices.by_cuid` are GLOBAL indexes and the
 * service token authorises nothing about the ROW. Every function here takes the
 * caller's `orgId` (resolved from the session upstream) and re-checks it against
 * the document, throwing the same `NOT_FOUND` for "missing" and "another org's"
 * so a cross-tenant probe can't distinguish them. The two artifact routes are
 * the highest-risk new surface in this program — see `financeArtifacts.test.ts`.
 */

/** Load an invoice by cuid, org-checked (`by_cuid` is global). */
async function requireInvoiceInOrg(
  ctx: QueryCtx | MutationCtx,
  invoiceId: string,
  orgId: string,
): Promise<Doc<"invoices">> {
  const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", invoiceId)).first();
  if (!invoice || invoice.organizationId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Invoice not found." });
  }
  return invoice;
}

/** The project a finance row hangs off, org-checked. Only its number/name are
 *  used (artifact file naming), never its live money. */
async function requireProjectInOrg(
  ctx: QueryCtx | MutationCtx,
  projectId: string,
  orgId: string,
): Promise<Doc<"projects">> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return project;
}

/**
 * Everything the render path and the download route need about a quote
 * revision, in one org-checked round trip.
 *
 * `quoteDate`/`validUntil` are the STAMPED values from the row — the whole point
 * of Phase B on the validity side. `build-document-data.ts` used to compute
 * `quoteValidUntil` from `now` at render time, so simply re-opening an old quote
 * silently extended how long it was valid.
 */
export const quoteArtifactContext = query({
  args: { quoteId: v.string(), orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { quoteId, orgId, now }) => {
    await requireService(ctx);
    const quote = await requireQuoteInOrg(ctx, quoteId, orgId);
    const project = await requireProjectInOrg(ctx, quote.projectId, orgId);
    return {
      quoteId: quote.id,
      projectId: quote.projectId,
      projectNumber: project.projectNumber,
      version: quote.version,
      effectiveStatus: effectiveQuoteStatus(quote, now ?? 0),
      label: quoteLabel(project.projectNumber, quote.version),
      // #1080/#1097 — the INTERNAL custom name (distinct from `label` above,
      // which is the derived "<projectNumber> vN" display string) and whether
      // it should be printed on the document header. `generateQuoteArtifact`
      // reads these to build the header's version suffix.
      customLabel: quote.label ?? null,
      labelOnDocument: quote.labelOnDocument ?? false,
      pdfFileId: quote.pdfFileId ?? null,
      // `sentAt || publishedAt` — a pre-#986 row the backfill hasn't reached
      // still counts as sent (convex/lib/quoteState.ts normalises the same way).
      sentAt: quote.sentAt ?? quote.publishedAt ?? null,
      quoteDate: quote.quoteDate ?? null,
      validUntil: quote.validUntil ?? null,
    };
  },
});

/** The invoice equivalent. `issuedAt` is the document date an issued invoice
 *  freezes at — the same "don't recompute from now" rule as a quote's dates.
 *
 *  Also carries the invoice's own money snapshot (`subtotal`/`taxAmount`/
 *  `total`) and its `invoiceLines` — the PDF pipeline used to have no
 *  awareness of a specific invoice row at all (every "invoice" render just
 *  used the LIVE project total/breakdown), so a DEPOSIT/BALANCE/CREDIT
 *  invoice's PDF always showed the full project amount instead of its own.
 *  `build-document-data.ts` reads these to render the actual invoice being
 *  requested instead of guessing from live project state. */
export const invoiceArtifactContext = query({
  args: { invoiceId: v.string(), orgId: v.string() },
  handler: async (ctx, { invoiceId, orgId }) => {
    await requireService(ctx);
    const invoice = await requireInvoiceInOrg(ctx, invoiceId, orgId);
    const project = await requireProjectInOrg(ctx, invoice.projectId, orgId);
    // Bounded by invoiceId (R-9.8) — an invoice's own line count is small and
    // fixed (one summary line for DEPOSIT/BALANCE/CREDIT, the equipment/
    // service breakdown for FULL), same bound deleteVoidNative already uses.
    const lines = await ctx.db
      .query("invoiceLines")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
      .take(500);
    lines.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return {
      invoiceId: invoice.id,
      projectId: invoice.projectId,
      projectNumber: project.projectNumber,
      invoiceNumber: invoice.invoiceNumber ?? null,
      kind: invoice.kind,
      status: invoice.status,
      pdfFileId: invoice.pdfFileId ?? null,
      issuedAt: invoice.issuedAt ?? null,
      invoiceDate: invoice.invoiceDate ?? null,
      dueDate: invoice.dueDate ?? null,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      notes: invoice.notes ?? null,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    };
  },
});

const attachResult = v.object({
  attached: v.boolean(),
  pdfFileId: v.string(),
});

/**
 * Attach the rendered artifact to a SENT revision — the write that makes the
 * document immutable.
 *
 * Refuses (without throwing) when one is already attached: the caller gets
 * `attached: false` plus the existing id, deletes the bytes it just uploaded,
 * and serves the original. "Never overwrite" is enforced here rather than by the
 * caller remembering to check first, so the retry path can be exposed to the UI
 * without a second render path opening up for a quote that already has one.
 */
export const attachQuoteArtifact = mutation({
  returns: attachResult,
  args: { quoteId: v.string(), orgId: v.string(), storageId: v.string(), now: v.number() },
  handler: async (ctx, { quoteId, orgId, storageId, now }) => {
    await requireService(ctx);
    const quote = await requireQuoteInOrg(ctx, quoteId, orgId);

    if (quote.pdfFileId) return { attached: false, pdfFileId: quote.pdfFileId };

    // A never-sent draft has no frozen document to stand behind — its figures
    // are still the project's live totals. The watermarked DRAFT PREVIEW
    // (`/api/documents/[projectId]?type=quote&preview=1`) is the only document a
    // draft ever produces, and it is deliberately never stored.
    if (quote.sentAt == null && quote.publishedAt == null) {
      throw new ConvexError({
        code: "QUOTE_NOT_SENT",
        message: "Only a sent quote revision has a stored document.",
      });
    }

    await ctx.db.patch(quote._id, { pdfFileId: storageId, updatedAt: now });
    return { attached: true, pdfFileId: storageId };
  },
});

/** Invoice counterpart — same never-overwrite guarantee, gated on ISSUED
 *  rather than sent (a DRAFT invoice's amounts are still mutable). A VOID
 *  invoice keeps the artifact it was issued with. */
export const attachInvoiceArtifact = mutation({
  returns: attachResult,
  args: { invoiceId: v.string(), orgId: v.string(), storageId: v.string(), now: v.number() },
  handler: async (ctx, { invoiceId, orgId, storageId, now }) => {
    await requireService(ctx);
    const invoice = await requireInvoiceInOrg(ctx, invoiceId, orgId);

    if (invoice.pdfFileId) return { attached: false, pdfFileId: invoice.pdfFileId };

    if (invoice.issuedAt == null) {
      throw new ConvexError({
        code: "INVOICE_NOT_ISSUED",
        message: "Only an issued invoice has a stored document.",
      });
    }

    await ctx.db.patch(invoice._id, { pdfFileId: storageId, updatedAt: now });
    return { attached: true, pdfFileId: storageId };
  },
});

export const agentOps: AgentOpsAnnotations = {
  quoteArtifactContext: {
    agentAccess: "denied",
    reason:
      "Module docstring is explicit: SERVICE-gated with NO agent escape hatch for any function here, mirroring convex/files.ts. Exposes pdfFileId (a _storage pointer into the render-once/stored-bytes subsystem); the non-sensitive fields (status/dates) are already agent-reachable via quotes.ts, so widening only adds a new pointer surface into the deliberately-closed finance-document pipeline for no net capability gain.",
  },
  invoiceArtifactContext: {
    agentAccess: "denied",
    reason:
      "Same as quoteArtifactContext: SERVICE-gated by design (module docstring), exposes pdfFileId into the deliberately-closed finance-document subsystem; non-sensitive fields are already agent-reachable via invoices.ts.",
  },
};
