import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/** Read-only queries for the `quotes` table (WS1 #940). */

export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("quotes")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});
