import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/** Read-only queries for the `invoiceLines` PARENT_JOIN table (WS1 #940). No
 *  organizationId column (by design — see scripts/org-export-tables.ts), so
 *  callers pass the parent invoice's orgId for the read-side org check
 *  against the loaded invoice row (this mirrors supplierOrderItems'
 *  read pattern for the same PARENT_JOIN shape). */

export const listForInvoice = query({
  args: { orgId: v.string(), invoiceId: v.string() },
  handler: async (ctx, { orgId, invoiceId }) => {
    // Org membership MUST be checked before the invoice lookup, not after —
    // a nonexistent invoiceId used to short-circuit to `[]` before
    // requireOrgReadFor ever ran, so a caller from an unrelated org got a
    // silent empty result instead of a rejection (#1076, A6's exhaustive
    // sweep found this: it never leaked real data, since a real foreign-org
    // invoice IS caught by the org-mismatch check below, but the guard
    // wasn't unconditional the way every other org-scoped read's is).
    await requireOrgReadFor(ctx, orgId, "invoice");
    const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", invoiceId)).first();
    if (!invoice || invoice.organizationId !== orgId) return [];
    return await ctx.db.query("invoiceLines").withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId)).collect();
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForInvoice: { summary: "List line items for an invoice.", danger: "low", mcpTier: 2 },
};
