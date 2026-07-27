import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc } from "./lib/auth";

/** Read-only queries for the `invoices` table (WS1 #940). Mirrors the
 *  getById/listForOrg shape every other domain's generic CRUD file uses. */

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("invoices")
      .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
      .collect();
  },
});

export const listRecentForOrg = query({
  args: { orgId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("invoices")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
  },
});
