import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";

/** Parity with src/lib/overbooking-core.ts EXCLUDED_PROJECT_STATUSES (Convex functions
 *  can't import from src/lib) — projects in these statuses never contribute to a
 *  booking-overlap window (projectMatchesWindow), matching DEAD_PROJECT_STATUSES in
 *  convex/projectLineItems.ts (swapLineItemAsset). */
const DEAD_PROJECT_STATUSES = new Set(["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"]);

/**
 * ONE-round-trip read of everything `computeOverbookedStatus` needs: for the given
 * models — the line items (across overlapping projects, for booking overlap) + active
 * assets + bulk assets (for the stock breakdown) — plus the relevant org projects (for
 * the date-window join) and all org models. Replaces ~5 separate server→Convex queries
 * in 2 waves with one backend-local query. Raw docs; the JS (sumBookingsByModel +
 * computeStockBreakdown) stays in src/lib (parity-by-construction). requireOrgRead
 * matches every constituent read's boundary (none were service-only).
 */
export const bundle = query({
  args: {
    orgId: v.string(),
    modelIds: v.array(v.string()),
    // Additive (expand-contract — see convex-prod-push-expand-contract note in
    // CLAUDE.md/memory): when `thisProjectId` is supplied, the line-item read is
    // SCOPED to the projects overlapping [rentalStartDate, rentalEndDate] (or, with
    // no window, just thisProjectId — matches sumBookingsByModel's window-null
    // branch) instead of an unbounded all-time `by_modelId` scan. Optional so a
    // caller still on the previous app build during a deploy window (old browser
    // tab, or the old container before Coolify swaps) gets the old, unscoped-but-
    // correct behavior rather than an argument-validation error.
    thisProjectId: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, modelIds, thisProjectId, rentalStartDate, rentalEndDate }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(modelIds)];
    // Matches the old assets/bulkAssets/projectLineItems.listByModelIds cap — guards
    // against an unbounded 3*N index fan-out hitting Convex read/time limits.
    if (unique.length > 1000) {
      throw new ConvexError("overbooking.bundle: too many modelIds (" + unique.length + " > 1000)");
    }
    const modelSet = new Set(unique);

    // Projects visited by the SCOPED path's range-scan below are cached here so the
    // final projects-by-id read (for the date-window join) can reuse them instead of
    // re-fetching the same docs a second time via by_cuid.
    const projectDocCache = new Map<string, Doc<"projects">>();

    async function buildLineItemDocs(): Promise<Doc<"projectLineItems">[]> {
      if (thisProjectId != null) {
        // SCOPED path. Candidate projects = thisProjectId + (when a window is given)
        // any org project overlapping it — the same range-scan `swapLineItemAsset`
        // uses (projectLineItems.ts:789-800): a project can only overlap
        // [rentalStartDate, rentalEndDate] if its rentalStartDate <= rentalEndDate, so
        // range-scan on that bound and finish the two-sided overlap check in JS on the
        // much smaller candidate set. This turns an O(all-time bookings for this
        // model) read into O(projects live/overlapping right now) — the dominant
        // Database-I/O cost (Phase 0 baseline, 2026-07: 77% of org DB I/O) came from
        // the unbounded version.
        const candidateProjectIds = new Set<string>([thisProjectId]);
        if (rentalStartDate != null && rentalEndDate != null) {
          for await (const p of ctx.db
            .query("projects")
            .withIndex("by_organizationId_rentalStartDate", (q) =>
              q.eq("organizationId", orgId).lte("rentalStartDate", rentalEndDate),
            )) {
            projectDocCache.set(p.id, p);
            if (p.isTemplate) continue;
            if (DEAD_PROJECT_STATUSES.has(p.status ?? "")) continue;
            const s = p.rentalStartDate ?? null;
            const e = p.rentalEndDate ?? null;
            if (s == null || e == null) continue;
            if (s <= rentalEndDate && e >= rentalStartDate) candidateProjectIds.add(p.id);
          }
        }
        const perProject = await Promise.all(
          [...candidateProjectIds].map((pid) =>
            ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", pid)).collect(),
          ),
        );
        return perProject.flat().filter((li) => li.modelId != null && modelSet.has(li.modelId));
      }
      // UNSCOPED fallback — unchanged all-time by_modelId scan (pre-rollout callers).
      const lineItemGroups = await Promise.all(
        unique.map((mid) => ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
      );
      return lineItemGroups.flat();
    }

    // Line items and assets/bulkAssets are independent reads — run them concurrently
    // instead of awaiting line items first (the pre-fix shape here awaited line items,
    // then started assets/bulkAssets, making total latency sum(lineItems, assets+bulk)
    // instead of max(lineItems, assets+bulk)).
    const [lineItemDocs, assetGroups, bulkGroups] = await Promise.all([
      buildLineItemDocs(),
      Promise.all(unique.map((mid) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
      Promise.all(unique.map((mid) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
    ]);

    const lineItems = lineItemDocs.filter((r) => r.organizationId === orgId);
    const assets = assetGroups.flat().filter((r) => r.organizationId === orgId);
    const bulkAssets = bulkGroups.flat().filter((r) => r.organizationId === orgId);

    // REFERENCED-ONLY reads (NOT whole-table). The consumer (reconstructOverbookedStatus)
    // looks projects/models up BY ID — so it only needs the projects these line items
    // belong to (for the date-window join) and the passed models (for the stock
    // breakdown). Previously this .collect()'d EVERY project + EVERY model in the org
    // and, being a reactive subscription, re-read both whole tables on ANY project/model
    // write org-wide — the dominant Database-I/O cost. by_cuid is global, so re-check org.
    // Reuse projectDocCache (populated by the SCOPED path's range-scan) before falling
    // back to a fresh by_cuid read — avoids reading the same project doc twice.
    const projectIds = [...new Set(lineItems.map((li) => li.projectId))];
    const [projectDocs, modelDocs] = await Promise.all([
      Promise.all(
        projectIds.map(
          (pid) => projectDocCache.get(pid) ?? ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique(),
        ),
      ),
      Promise.all(unique.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique())),
    ]);

    return {
      lineItems,
      assets,
      bulkAssets,
      projects: projectDocs.filter((p): p is NonNullable<typeof p> => !!p && p.organizationId === orgId),
      models: modelDocs.filter((m): m is NonNullable<typeof m> => !!m && m.organizationId === orgId),
    };
  },
});
