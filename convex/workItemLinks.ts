import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Reads for `workItemLinks` (#1245, design §8.2/§10.1) — "all work linked to
 * this entity" as an indexed read (`by_organizationId_entityType_entityId`),
 * never a client-side scan of every work item's would-be array field.
 */

type WorkItemDoc = {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  kind?: string;
  dueDate?: number;
  completedAt?: number;
  assigneeUserId?: string;
  assigneeCrewId?: string;
};

/** Point-read the linked work items for a bounded set of link rows. Bounded
 *  by construction — a link list for one entity is never the whole org's
 *  work. */
async function resolveWorkItems(ctx: QueryCtx, workItemIds: string[]): Promise<Map<string, WorkItemDoc>> {
  const map = new Map<string, WorkItemDoc>();
  await Promise.all(
    [...new Set(workItemIds)].map(async (id) => {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (doc) map.set(id, doc as unknown as WorkItemDoc);
    }),
  );
  return map;
}

export const forEntity = query({
  args: { orgId: v.string(), entityType: enums.WorkItemLinkEntityType, entityId: v.string() },
  handler: async (ctx, { orgId, entityType, entityId }) => {
    await requireOrgReadFor(ctx, orgId, "work");
    const links = await ctx.db
      .query("workItemLinks")
      .withIndex("by_organizationId_entityType_entityId", (q) =>
        q.eq("organizationId", orgId).eq("entityType", entityType).eq("entityId", entityId),
      )
      .collect();
    const workItems = await resolveWorkItems(ctx, links.map((l) => l.workItemId));
    return links
      .map((l) => ({ linkId: l.id, workItemId: l.workItemId, workItem: workItems.get(l.workItemId) ?? null }))
      .filter((row) => row.workItem != null);
  },
});

export const agentOps: AgentOpsAnnotations = {
  forEntity: { summary: "List work items linked to an entity (e.g. a client's follow-ups).", danger: "low", mcpTier: 2 },
};
