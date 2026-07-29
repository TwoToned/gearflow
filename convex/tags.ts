import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Org-wide tag autocomplete — the distinct union of the `tags` arrays across every
 * taggable entity (model / asset / bulkAsset / kit / location / category /
 * maintenance / project / client). Browser-callable (`requireOrgReadFor(ctx, orgId,
 * "orgSettings")`, Phase 5 #1001; service tokens short-circuit allow) — replaces
 * the `getOrgTags` server action. Called ONE-SHOT
 * (autocomplete, no liveness requirement — `useOrgTags` fetches on mount/org-change),
 * so the 9 org-scoped scans are acceptable; do NOT wire this as a reactive subscription.
 */
export const getOrgTags = query({
  args: { orgId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { orgId }): Promise<string[]> => {
    await requireOrgReadFor(ctx, orgId, "orgSettings"); // Phase 5 domain slice (#1001) — org-wide tag catalog is a config concept, not any single entity resource

    const byOrg = (table: "models" | "assets" | "bulkAssets" | "kits" | "locations" | "categories" | "maintenanceRecords" | "projects" | "clients") =>
      ctx.db
        .query(table)
        .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment) — see docs/exceptions.md R-8.3.3
        .collect();

    const tables = await Promise.all([
      byOrg("models"),
      byOrg("assets"),
      byOrg("bulkAssets"),
      byOrg("kits"),
      byOrg("locations"),
      byOrg("categories"),
      byOrg("maintenanceRecords"),
      byOrg("projects"),
      byOrg("clients"),
    ]);

    const all = new Set<string>();
    for (const rows of tables) {
      for (const row of rows) {
        const tags = (row as { tags?: string[] }).tags;
        if (tags) for (const t of tags) all.add(t);
      }
    }
    return Array.from(all).sort();
  },
});

export const agentOps: AgentOpsAnnotations = {
  getOrgTags: { summary: "List the distinct set of tags used anywhere in the org (autocomplete).", danger: "low", mcpTier: 2 },
};
