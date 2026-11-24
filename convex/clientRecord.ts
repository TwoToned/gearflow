import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import { collectCapped } from "./lib/pagination";
import { effectiveQuoteStatus } from "./lib/quoteState";
import { resolveNow } from "./lib/projectSegments";

/**
 * The client record's account view (UX Phase 13, spec §9m, `Quotes & invoices` tab): the
 * client's invoices and the quotes on its jobs. Finance owns the documents; this is the
 * account view that links into them. Invoice figures are the invoice-read line
 * (`canSeeJobCost`): without it the whole read is `null` (the tab is absent), never zeros.
 * Every row is reached through an index and org-checked per row (`by_clientId` and
 * `by_projectId` are global); bounded with `collectCapped`.
 */
export const agentOps: AgentOpsAnnotations = {
  clientAccount: { summary: "A client's invoices and the quotes on its jobs (null without invoice access).", danger: "low", mcpTier: 3 },
};

const CAP = 200;

export const clientAccount = query({
  args: { orgId: v.string(), clientId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, clientId, now: nowArg }) => {
    await requireOrgReadFor(ctx, orgId, "client");
    if (!(await canSeeJobCost(ctx, orgId))) return null;
    const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
    if (!client || client.organizationId !== orgId) return null;
    const now = resolveNow(nowArg);
    const [invoices, projects] = await Promise.all([
      collectCapped(ctx.db.query("invoices").withIndex("by_clientId", (q) => q.eq("clientId", clientId)), CAP),
      collectCapped(ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", clientId)), CAP),
    ]);
    const jobs = projects.rows.filter((p) => p.organizationId === orgId && !p.isTemplate);
    const numberOf = new Map(jobs.map((p) => [p.id, p.projectNumber]));
    const quotes = [];
    for (const p of jobs) {
      const rows = await collectCapped(ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", p.id)), 50);
      for (const q of rows.rows) {
        if (q.organizationId !== orgId) continue;
        quotes.push({ id: q.id, projectId: p.id, projectNumber: p.projectNumber, version: q.version, label: q.label ?? null, status: effectiveQuoteStatus(q, now), validUntil: q.validUntil ?? null, sentAt: q.sentAt ?? null });
      }
    }
    return {
      invoices: invoices.rows
        .filter((i) => i.organizationId === orgId && i.status !== "DRAFT")
        .map((i) => ({
          id: i.id, invoiceNumber: i.invoiceNumber ?? null, projectId: i.projectId, projectNumber: numberOf.get(i.projectId) ?? null, status: i.status,
          paymentStatus: i.paymentStatus ?? null, total: i.total, amountPaid: i.amountPaid ?? 0, dueDate: i.dueDate ?? null,
        })),
      quotes: quotes.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)),
      truncated: invoices.truncated || projects.truncated,
    };
  },
});
