import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireService } from "./lib/auth";
import { projectRevision } from "./lib/quoteState";

/**
 * #1080/#1097 forward migration — best-effort stamp of `invoices.sourceRevision`
 * onto every pre-#1097 invoice that doesn't have one yet.
 *
 * There is no historical record of which revision was actually live when a
 * pre-#1097 invoice was created — this is BEST-EFFORT, using the project's
 * CURRENT `revision` (the allocator, its high-water mark) as the closest
 * available proxy, never a precise reconstruction (design doc §3.6/§6). An
 * invoice whose project can't be resolved (should not happen — defensive
 * only) is left with `sourceRevision` absent rather than guessed: the ledger
 * already renders that correctly ("we genuinely don't know which version
 * produced it") instead of showing a wrong-but-plausible chip.
 *
 * Same paginated-mutation + apply-flag shape as `backfillProjectLiveRevision.ts`.
 * Idempotent — an invoice that already has `sourceRevision` is skipped.
 * SERVICE-only.
 *
 * Driver: scripts/convex-backfill-invoice-source-revision.ts.
 */
export const backfillInvoiceSourceRevisionPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
    skippedNoProject: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("invoices").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let updated = 0;
    let skippedNoProject = 0;
    for (const invoice of res.page) {
      if (invoice.sourceRevision != null) continue; // already migrated
      scanned++;
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", invoice.projectId)).first();
      if (!project || project.organizationId !== invoice.organizationId) {
        skippedNoProject++;
        continue;
      }
      if (!apply) continue;
      await ctx.db.patch(invoice._id, { sourceRevision: projectRevision(project) });
      updated++;
    }
    return { scanned, updated, skippedNoProject, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/**
 * Verification — reports how many invoices are still missing `sourceRevision`
 * after a full apply run. Paginated like the migration itself so it can't
 * blow the read limit on a large org; the driver accumulates across pages.
 */
export const verifyInvoiceSourceRevision = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({
    totalInvoices: v.number(),
    invoicesMissingSourceRevision: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("invoices").paginate({ cursor, numItems: numItems ?? 300 });

    let totalInvoices = 0;
    let invoicesMissingSourceRevision = 0;
    for (const invoice of res.page) {
      totalInvoices++;
      if (invoice.sourceRevision == null) invoicesMissingSourceRevision++;
    }
    return { totalInvoices, invoicesMissingSourceRevision, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
