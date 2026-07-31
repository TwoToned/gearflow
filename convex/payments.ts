import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/** Read-only queries for the `payments` table (#1055). Mirrors invoices.ts's
 *  getById/listForX shape. */

export const listForInvoice = query({
  args: { orgId: v.string(), invoiceId: v.string() },
  handler: async (ctx, { orgId, invoiceId }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    // Bounded by invoiceId (R-9.8) — see paymentsWrites.ts recomputeInvoicePaymentState.
    return await ctx.db
      .query("payments")
      .withIndex("by_organizationId_invoiceId", (q) => q.eq("organizationId", orgId).eq("invoiceId", invoiceId))
      .take(500);
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForInvoice: { summary: "List payments recorded against an invoice.", danger: "low", mcpTier: 1 },
};
