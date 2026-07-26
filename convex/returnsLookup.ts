import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Project-less scan resolution for the org-wide returns station (issue #944 WS5).
 *
 * `convex/scanLookup.resolve` (the existing project-less tag lookup) only ever
 * returns a navigation target (`{url, label}`) — it was built for "go look at this
 * thing", not "return this thing". This is the returns-specific twin: it resolves
 * a scanned tag all the way to the CHECKED_OUT unit(s)/line(s)/project(s) it needs
 * to flip, using the org-wide `by_organizationId_assetId_status` /
 * `by_organizationId_bulkAssetId_status` indexes on `projectLineItemUnits`
 * (convex/schema.ts) instead of `src/server/warehouse.ts`'s `lookupAssetForScan`,
 * which is hard-wired to ONE `projectId` (the returns station has no project
 * pre-selection — that's the whole point of WS5).
 *
 * Same SAFE_TAG + length-cap pattern as scanLookup.ts. Browser-callable
 * (`requireOrgRead`).
 *
 * The result is a discriminated union on `kind`:
 *   - "not_found"            — tag matches nothing in this org.
 *   - "guard_kit_member"     — asset belongs to a kit; scan the kit instead.
 *   - "guard_accessory_child"— asset is a permanent accessory; returns with its parent.
 *   - "exception"            — resolvable identity, but no active return to make
 *                               (retired / not checked out anywhere / kit not out).
 *                               Never blocks the dock — the caller adds it to the
 *                               session-local exceptions list and moves on.
 *   - "asset"                — exactly one active deployment. Ready to return.
 *   - "asset_multi"          — checked out on >1 project at once (data anomaly, but
 *                               guarded rather than silently picked) — disambiguate.
 *   - "bulk"                 — bulk tag out on exactly one project. Ready to return.
 *   - "bulk_multi"           — bulk tag out on >1 project — per-project qty prompt.
 *   - "kit"                  — kit out on exactly one project. Ready for checkInKit.
 *   - "kit_multi"            — kit linked to >1 CHECKED_OUT parent line (anomaly) —
 *                               disambiguate rather than auto-pick.
 */

const SAFE_TAG = /^[A-Za-z0-9\-_.:/ ]+$/;

type ProjectLabel = { projectId: string; projectName: string; projectNumber: string };

async function projectLabel(ctx: QueryCtx, projectId: string): Promise<ProjectLabel | null> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  return p ? { projectId: p.id, projectName: p.name, projectNumber: p.projectNumber } : null;
}

async function modelName(ctx: QueryCtx, modelId: string | null | undefined): Promise<string | null> {
  if (!modelId) return null;
  const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
  return m?.name ?? null;
}

async function resolveAsset(ctx: QueryCtx, orgId: string, asset: NonNullable<Awaited<ReturnType<typeof loadAssetByTag>>>) {
  const assetName = (await modelName(ctx, asset.modelId)) ?? "Asset";

  // Guard: kit member — the kit is the unit of return, not its individual parts.
  if (asset.kitId) {
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", asset.kitId!)).first();
    return {
      kind: "guard_kit_member" as const,
      assetId: asset.id, assetTag: asset.assetTag, assetName,
      kitId: kit?.id ?? null, kitAssetTag: kit?.assetTag ?? null, kitName: kit?.name ?? null,
    };
  }

  // Guard: permanent accessory child — travels with its parent asset.
  if (asset.parentAssetId) {
    const parent = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", asset.parentAssetId!)).first();
    const parentInOrg = parent && parent.organizationId === orgId ? parent : null;
    return {
      kind: "guard_accessory_child" as const,
      assetId: asset.id, assetTag: asset.assetTag, assetName,
      parentAssetId: parentInOrg?.id ?? null, parentAssetTag: parentInOrg?.assetTag ?? null,
    };
  }

  if (asset.status === "RETIRED") {
    return { kind: "exception" as const, reason: "retired" as const, assetId: asset.id, assetTag: asset.assetTag, assetName };
  }

  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", orgId).eq("assetId", asset.id).eq("status", "CHECKED_OUT"))
    .collect();

  const deployments: Array<ProjectLabel & { lineItemId: string; unitId: string }> = [];
  for (const u of units) {
    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", u.lineItemId)).first();
    if (!line || line.organizationId !== orgId || line.status !== "CHECKED_OUT") continue;
    const proj = await projectLabel(ctx, line.projectId);
    if (proj) deployments.push({ ...proj, lineItemId: line.id, unitId: u.id });
  }

  if (deployments.length === 0) {
    return { kind: "exception" as const, reason: "no_active_deployment" as const, assetId: asset.id, assetTag: asset.assetTag, assetName };
  }
  if (deployments.length > 1) {
    return { kind: "asset_multi" as const, assetId: asset.id, assetTag: asset.assetTag, assetName, deployments };
  }
  const d = deployments[0];
  return {
    kind: "asset" as const, assetId: asset.id, assetTag: asset.assetTag, assetName,
    lineItemId: d.lineItemId, unitId: d.unitId, projectId: d.projectId, projectName: d.projectName, projectNumber: d.projectNumber,
  };
}

async function resolveBulk(ctx: QueryCtx, orgId: string, bulk: NonNullable<Awaited<ReturnType<typeof loadBulkByTag>>>) {
  const assetName = (await modelName(ctx, bulk.modelId)) ?? "Bulk item";

  if (bulk.status === "RETIRED") {
    return { kind: "exception" as const, reason: "retired" as const, bulkAssetId: bulk.id, assetTag: bulk.assetTag, assetName };
  }

  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_organizationId_bulkAssetId_status", (q) => q.eq("organizationId", orgId).eq("bulkAssetId", bulk.id).eq("status", "CHECKED_OUT"))
    .collect();

  // Group by project (org-re-checked per line), summing each project's outstanding
  // quantity — display/prompt only. The actual write re-derives the line breakdown
  // itself server-side (never trusts a client-supplied breakdown).
  const outstandingByProject = new Map<string, number>();
  const lineCache = new Map<string, { organizationId: string; projectId: string } | null>();
  for (const u of units) {
    let line = lineCache.get(u.lineItemId);
    if (line === undefined) {
      const row = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", u.lineItemId)).first();
      line = row && row.status === "CHECKED_OUT" ? { organizationId: row.organizationId, projectId: row.projectId } : null;
      lineCache.set(u.lineItemId, line);
    }
    if (!line || line.organizationId !== orgId) continue;
    const outstanding = Math.max(0, (u.quantity ?? 0) - (u.returnedQuantity ?? 0));
    if (outstanding <= 0) continue;
    outstandingByProject.set(line.projectId, (outstandingByProject.get(line.projectId) ?? 0) + outstanding);
  }

  const deployments: Array<ProjectLabel & { outstanding: number }> = [];
  for (const [projectId, outstanding] of outstandingByProject) {
    const proj = await projectLabel(ctx, projectId);
    if (proj) deployments.push({ ...proj, outstanding });
  }

  if (deployments.length === 0) {
    return { kind: "exception" as const, reason: "no_active_deployment" as const, bulkAssetId: bulk.id, assetTag: bulk.assetTag, assetName };
  }
  if (deployments.length > 1) {
    return { kind: "bulk_multi" as const, bulkAssetId: bulk.id, assetTag: bulk.assetTag, assetName, deployments };
  }
  const d = deployments[0];
  return {
    kind: "bulk" as const, bulkAssetId: bulk.id, assetTag: bulk.assetTag, assetName,
    projectId: d.projectId, projectName: d.projectName, projectNumber: d.projectNumber, outstanding: d.outstanding,
  };
}

async function resolveKit(ctx: QueryCtx, orgId: string, kit: NonNullable<Awaited<ReturnType<typeof loadKitByTag>>>) {
  if (kit.status === "RETIRED") {
    return { kind: "exception" as const, reason: "retired" as const, kitId: kit.id, assetTag: kit.assetTag, assetName: kit.name };
  }
  if (kit.status !== "CHECKED_OUT") {
    return { kind: "exception" as const, reason: "no_active_deployment" as const, kitId: kit.id, assetTag: kit.assetTag, assetName: kit.name };
  }

  const lines = await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kit.id)).collect();
  const parentLines = lines.filter((l) => l.organizationId === orgId && !l.isKitChild && l.status === "CHECKED_OUT");

  const deployments: Array<ProjectLabel & { lineItemId: string }> = [];
  for (const line of parentLines) {
    const proj = await projectLabel(ctx, line.projectId);
    if (proj) deployments.push({ ...proj, lineItemId: line.id });
  }

  if (deployments.length === 0) {
    return { kind: "exception" as const, reason: "no_active_deployment" as const, kitId: kit.id, assetTag: kit.assetTag, assetName: kit.name };
  }
  if (deployments.length > 1) {
    return { kind: "kit_multi" as const, kitId: kit.id, assetTag: kit.assetTag, assetName: kit.name, deployments };
  }
  const d = deployments[0];
  return {
    kind: "kit" as const, kitId: kit.id, assetTag: kit.assetTag, assetName: kit.name,
    lineItemId: d.lineItemId, projectId: d.projectId, projectName: d.projectName, projectNumber: d.projectNumber,
  };
}

function loadAssetByTag(ctx: QueryCtx, orgId: string, tag: string) {
  return ctx.db.query("assets").withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag)).first();
}
function loadBulkByTag(ctx: QueryCtx, orgId: string, tag: string) {
  return ctx.db.query("bulkAssets").withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag)).first();
}
function loadKitByTag(ctx: QueryCtx, orgId: string, tag: string) {
  return ctx.db.query("kits").withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag)).first();
}

export const resolve = query({
  args: { orgId: v.string(), value: v.string() },
  handler: async (ctx, { orgId, value }) => {
    await requireOrgRead(ctx, orgId);

    const tag = value.trim();
    if (!tag || tag.length > 128 || !SAFE_TAG.test(tag)) {
      return { kind: "not_found" as const };
    }

    const asset = await loadAssetByTag(ctx, orgId, tag);
    if (asset) return resolveAsset(ctx, orgId, asset);

    const bulk = await loadBulkByTag(ctx, orgId, tag);
    if (bulk) return resolveBulk(ctx, orgId, bulk);

    const kit = await loadKitByTag(ctx, orgId, tag);
    if (kit) return resolveKit(ctx, orgId, kit);

    return { kind: "not_found" as const };
  },
});
