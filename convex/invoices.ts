import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/** Read-only queries for the `invoices` table (WS1 #940). Mirrors the
 *  getById/listForOrg shape every other domain's generic CRUD file uses. */

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "invoice");
    return doc;
  },
});

export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    return await ctx.db
      .query("invoices")
      .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
      .collect();
  },
});

export const listRecentForOrg = query({
  args: { orgId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    return await ctx.db
      .query("invoices")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
  },
});

export const agentOps: AgentOpsAnnotations = {
  getById: { summary: "Get an invoice by id.", danger: "low", mcpTier: 1 },
  listForProject: { summary: "List invoices for a project.", danger: "low", mcpTier: 1 },
  listRecentForOrg: { summary: "List the org's most recent invoices.", danger: "low", mcpTier: 1 },
};
