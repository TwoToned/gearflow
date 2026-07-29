import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * XeroSyncLog (WS1 #940) — audit trail of every Xero API interaction, modeled
 * on convex/wooCommerceOrderLogs.ts. Service-only (written from
 * src/server/xero.ts); `listRecentForOrg` is bounded (`.take()`, not
 * `.collect()` — R-9.8) since this table only grows.
 */

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    direction: v.union(
      v.literal("PUSH_INVOICE"),
      v.literal("SYNC_CONTACT"),
      v.literal("REFRESH_TOKEN"),
      v.literal("FETCH_REFERENCE_DATA"),
    ),
    status: v.union(v.literal("PENDING"), v.literal("SUCCESS"), v.literal("FAILED")),
    invoiceId: v.optional(v.string()),
    xeroInvoiceId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    payload: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("xeroSyncLogs", args);
  },
});

export const listRecentForOrg = query({
  args: { orgId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    await requireOrgReadFor(ctx, orgId, "invoice"); // Phase 5 domain slice (#1001) — payload shapes checked: no Xero credentials/tokens, only ids/counts/error strings
    return await ctx.db
      .query("xeroSyncLogs")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
  },
});

export const listForInvoice = query({
  args: { invoiceId: v.string(), orgId: v.string() },
  handler: async (ctx, { invoiceId, orgId }) => {
    await requireOrgReadFor(ctx, orgId, "invoice"); // Phase 5 domain slice (#1001)
    // Narrowed by the by_invoiceId index (a single invoice's push attempts,
    // not an org-wide scan) — no R-9.8 hazard, so no exceptions.md marker needed.
    const rows = await ctx.db
      .query("xeroSyncLogs")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

export const agentOps: AgentOpsAnnotations = {
  listRecentForOrg: { summary: "List the org's recent Xero sync attempts (push/refresh/fetch), newest first.", danger: "low", mcpTier: 3 },
  listForInvoice: { summary: "List Xero sync attempts for one invoice.", danger: "low", mcpTier: 3 },
};
