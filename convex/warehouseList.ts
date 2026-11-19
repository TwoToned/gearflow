import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { getProjectWindow } from "./lib/projectWindow";
import { resolveLiveVersionIdForProject, versionRows } from "./lib/versionScope";
import { floorCounts, warehouseStage } from "./lib/warehouseStage";
import { earliestOutbound, isOutboundService, type OutboundServiceLike } from "./lib/outboundTruck";

export const agentOps: AgentOpsAnnotations = {
  bundle: {
    summary:
      "Org-wide warehouse floor: every pipeline job with its derived floor stage (to pick / prepping / ready / out / returning), unit counts, PM and outbound truck time.",
    danger: "low",
    mcpTier: 1,
  },
};

/** Services scanned per job before giving up (R-9.8). A job has a handful;
 *  hitting this sets `outboundTruncated` rather than guessing. */
const MAX_SERVICES_SCANNED = 200;

/**
 * The job's earliest outbound truck (`convex/lib/outboundTruck.ts`), from its
 * LIVE version's services. Streams `by_versionId_date` IN DATE ORDER, so the
 * earliest dated outbound service is reached first and the scan stops once the
 * date moves past it — a cap can never drop the earliest one (a cap on an
 * unordered read could). Undated rows sort first in the index; they are kept
 * as candidates but `earliestOutbound` ranks them after any dated one. Rows are
 * filtered BEFORE they can end the scan (org, type, not cancelled), and
 * `by_versionId_date` is a GLOBAL index — org-check every row (R-8.4.3).
 */
async function outboundFor(ctx: QueryCtx, versionId: string, orgId: string) {
  const candidates: OutboundServiceLike[] = [];
  let firstDate: number | null = null;
  let scanned = 0;
  let truncated = false;
  for await (const s of ctx.db
    .query("projectServices")
    .withIndex("by_versionId_date", (q) => q.eq("versionId", versionId))) {
    if (++scanned > MAX_SERVICES_SCANNED) { truncated = true; break; }
    if (firstDate != null && s.date !== firstDate) break;
    if (s.organizationId !== orgId || !isOutboundService(s)) continue;
    candidates.push(s);
    if (s.date != null) firstDate = s.date;
  }
  return { outbound: earliestOutbound(candidates), truncated };
}

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
  // #1236 — AWAITING_PAYMENT is in HARD_PROJECT_STATUSES (the gear is held from
  // the moment the job is agreed), so it belongs on the warehouse landing too.
  // Leaving it out stranded every org that reconciles payments in Xero rather
  // than recording them in Flow: the job entered the money phase and became
  // invisible to the only screen that could move it on.
  "AWAITING_PAYMENT",
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
  projectStartDate?: number;
  projectEndDate?: number;
  clientId?: string;
  projectManagerId?: string;
};

type FloorFacts = {
  lineItems: Array<{ status: string; type: string; isKitChild: boolean }>;
  counts: ReturnType<typeof floorCounts>;
  outbound: Awaited<ReturnType<typeof outboundFor>>;
};

export const bundle = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "warehouse"); // Phase 2 read bootstrap (#998)

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
      .sort((a, b) => (getProjectWindow(a).start ?? 0) - (getProjectWindow(b).start ?? 0));

    // Per project, from the LIVE version (#1228 — the floor counts the live
    // plan): the thin line items (kept for existing consumers), the floor's
    // derived unit counts (convex/lib/warehouseStage.ts) and the outbound truck.
    const factsByProject = new Map<string, FloorFacts>();
    await Promise.all(
      pipeline.map(async (p) => {
        const versionId = await resolveLiveVersionIdForProject(ctx, p.id, orgId);
        const [rows, outbound] = await Promise.all([
          versionRows(ctx, "projectLineItems", versionId),
          outboundFor(ctx, versionId, orgId),
        ]);
        // `by_versionId` is global; the version came from an org-checked
        // project, but re-check the rows (R-8.4.3).
        const own = rows.filter((li) => li.organizationId === orgId);
        factsByProject.set(p.id, {
          lineItems: own.map((li) => ({
            status: li.status ?? "",
            type: li.type ?? "EQUIPMENT",
            isKitChild: li.isKitChild === true,
          })),
          counts: floorCounts(own),
          outbound,
        });
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
      projects: pipeline.map((p) => projectRow(p, clientMap, factsByProject.get(p.id))),
    };
  },
});

function projectRow(p: ProjectDoc, clientMap: Map<string, { name: string }>, facts: FloorFacts | undefined) {
  return { ...identityFields(p, clientMap), ...floorFields(p, facts) };
}

/** Phase 4 floor (additive). DERIVED on read, never stored (D27). */
function floorFields(p: ProjectDoc, facts: FloorFacts | undefined) {
  const counts = facts?.counts ?? floorCounts([]);
  return {
    lineItems: facts?.lineItems ?? [],
    projectManagerId: p.projectManagerId ?? null,
    counts,
    stage: warehouseStage(counts),
    outbound: facts?.outbound.outbound ?? null,
    // True only if the job had more services than one scan reads: the truck
    // shown may then not be the earliest.
    outboundTruncated: facts?.outbound.truncated ?? false,
  };
}

function identityFields(p: ProjectDoc, clientMap: Map<string, { name: string }>) {
  return {
    id: p.id,
    name: p.name,
    projectNumber: p.projectNumber,
    status: p.status ?? "",
    rentalStartDate: p.rentalStartDate ?? null,
    rentalEndDate: p.rentalEndDate ?? null,
    // Gear-committed window — falls back to rental when unset (see
    // project-window.ts). The list's urgency classifier reads THESE, not the
    // raw rental pair above (kept for reference/other display uses).
    projectStartDate: p.projectStartDate ?? null,
    projectEndDate: p.projectEndDate ?? null,
    client: p.clientId ? clientMap.get(p.clientId) ?? null : null,
  };
}
