import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { MAX_LINKS_PER_TASK, targetLabel, type LinkKind } from "./lib/taskLinkTargets";

const TASK_CAP = 500;
const LINK_CAP = 400;

/**
 * Every task link on a job, ONE bounded read (UX Phase 10 Slice E): the task rows' link
 * chips, a file's `Task: …` back-reference and the `Attach to a task` picker all read
 * it, so there are no per-row queries. Each link is resolved to its target's label
 * through `targetLabel`, which org- and project-checks the target (a link whose target
 * is gone, or is not on this job, is dropped, never leaked). `truncated` says a cap bit.
 */
export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return { links: [], truncated: false };

    const tasks = (await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(TASK_CAP + 1)).filter(
      (t) => t.organizationId === orgId,
    );
    let truncated = tasks.length > TASK_CAP;
    const links: { id: string; taskId: string; taskTitle: string; kind: LinkKind; linkedId: string; label: string }[] = [];
    for (const t of tasks.slice(0, TASK_CAP)) {
      if (links.length >= LINK_CAP) {
        truncated = true;
        break;
      }
      const rows = (await ctx.db.query("projectTaskLinks").withIndex("by_taskId", (q) => q.eq("taskId", t.id)).take(MAX_LINKS_PER_TASK)).filter(
        (r) => r.organizationId === orgId,
      );
      for (const r of rows) {
        const label = await targetLabel(ctx, orgId, projectId, r.linkedKind, r.linkedId);
        if (label !== null) links.push({ id: r.id, taskId: t.id, taskTitle: t.title, kind: r.linkedKind, linkedId: r.linkedId, label });
      }
    }
    return { links, truncated };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: { summary: "Every task link on a job (task to line item / file / discussion), with each target's label (bounded).", danger: "low", mcpTier: 3 },
};
