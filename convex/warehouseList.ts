import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * BROWSER-facing native replacement for the warehouse LANDING list
 * (`warehouse/page.tsx`), the last surface still on the version-vector +
 * getProjects server-action path (Phase 4). Returns the warehouse-pipeline
 * projects (bounded by status) with the exact fields the list renders: identity,
 * status, rental window, client name, and THIN line items ({status, type,
 * isKitChild}) for the per-project stage counts. Reactive — the project /
 * line-item mirrors push every change over the WebSocket, replacing the
 * warehouseDetail.listVersion doorbell → getProjects refetch.
 *
 * Gated on requireOrgRead (org-scoping — matches getProjects' getOrgContext; no
 * new RBAC gate, so no access change). Dates stay epoch-ms (the client wraps with
 * `new Date()`). Name/number search stays CLIENT-side (the list is bounded); the
 * server action's rarely-used location-name search clause is not reproduced here.
 */

// Mirrors WAREHOUSE_STATUSES in src/app/(app)/warehouse/page.tsx — the pipeline the
// landing shows. Querying these via the by_organizationId_status composite index
// keeps the composite bounded (active projects only, never the whole-org history).
const WAREHOUSE_STATUSES = [
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
] as const;

type ProjectDoc = {
  id: string;
  isTemplate?: boolean;
  status?: string;
  name: string;
  projectNumber: string;
  rentalStartDate?: number;
  rentalEndDate?: number;
  clientId?: string;
};

export const bundle = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);

    // Query ONLY the 5 pipeline statuses via the composite index (mirrors the
    // former listVersion) — reads ~the pipeline size, not the whole project history.
    const byStatus = await Promise.all(
      WAREHOUSE_STATUSES.map((status) =>
        ctx.db
          .query("projects")
          .withIndex("by_organizationId_status", (q) =>
            q.eq("organizationId", orgId).eq("status", status),
          )
          .collect(),
      ),
    );
    const pipeline = (byStatus.flat() as unknown as ProjectDoc[])
      .filter((p) => p.isTemplate !== true)
      .sort((a, b) => (a.rentalStartDate ?? 0) - (b.rentalStartDate ?? 0));

    // Thin line items per project (only the 3 fields the stage counter reads).
    const lineItemsByProject = new Map<
      string,
      Array<{ status: string; type: string; isKitChild: boolean }>
    >();
    await Promise.all(
      pipeline.map(async (p) => {
        const rows = await ctx.db
          .query("projectLineItems")
          .withIndex("by_projectId", (q) => q.eq("projectId", p.id))
          .collect();
        lineItemsByProject.set(
          p.id,
          rows.map((li) => ({
            status: li.status ?? "",
            type: li.type ?? "EQUIPMENT",
            isKitChild: li.isKitChild === true,
          })),
        );
      }),
    );

    // Client names by referenced id (point reads, org-scoped).
    const clientIds = [...new Set(pipeline.map((p) => p.clientId).filter((x): x is string => !!x))];
    const clientMap = new Map<string, { name: string }>();
    await Promise.all(
      clientIds.map(async (id) => {
        const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
        if (c && c.organizationId === orgId) clientMap.set(id, { name: c.name });
      }),
    );

    return {
      projects: pipeline.map((p) => ({
        id: p.id,
        name: p.name,
        projectNumber: p.projectNumber,
        status: p.status ?? "",
        rentalStartDate: p.rentalStartDate ?? null,
        rentalEndDate: p.rentalEndDate ?? null,
        client: p.clientId ? clientMap.get(p.clientId) ?? null : null,
        lineItems: lineItemsByProject.get(p.id) ?? [],
      })),
    };
  },
});
