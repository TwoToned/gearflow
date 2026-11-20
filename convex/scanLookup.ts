import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

export const agentOps: AgentOpsAnnotations = {
  resolve: {
    summary:
      "Resolve a scanned barcode/tag to its asset/kit/bulk-asset/test-tag navigation target, plus which jobs it is on right now (to pick / packed / out) and any kit-member or accessory guard.",
    danger: "low",
    mcpTier: 2,
  },
};

/**
 * Resolve a scanned barcode/tag value to a navigation target (Phase 3 — replaces the
 * `scanLookup` server action). Browser-callable and agent-reachable (`requireOrgReadFor`,
 * resource "warehouse"). Checks, in order: serialized asset → kit → bulk asset →
 * test&tag item (by testTagId). Cheap point-reads on org-scoped indexes.
 *
 * Phase 4 (the floor's `Look up` mode, spec §9c.3) adds, additively:
 *   - `activity` — the jobs the tag is on right now, each with its state
 *     (`to_pick` · `packed` · `out`), so the strip can say
 *     `SK-0012 · packed for #2341` and offer `Receive` for an out unit.
 *   - `guard` — a kit member (scan the kit) or a permanent accessory (returns
 *     with its parent).
 * Bounded: at most `MAX_UNITS_PER_STATUS` units per status and `MAX_KIT_LINES`
 * kit lines. Every line / project / kit read on a global index is org-checked.
 */
const SAFE_TAG = /^[A-Za-z0-9\-_.:/ ]+$/;

const MAX_UNITS_PER_STATUS = 10;
const MAX_KIT_LINES = 20;
const ACTIVE_UNIT_STATUSES = ["CONFIRMED", "PREPPED", "CHECKED_OUT"] as const;

const activityValidator = v.object({
  projectId: v.string(),
  projectNumber: v.string(),
  projectName: v.string(),
  lineItemId: v.string(),
  state: v.union(v.literal("to_pick"), v.literal("packed"), v.literal("out")),
  quantity: v.number(),
});
const guardValidator = v.union(
  v.null(),
  v.object({ kind: v.literal("kit_member"), kitTag: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("accessory_child"), parentTag: v.union(v.string(), v.null()) }),
);

type Activity = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  lineItemId: string;
  state: "to_pick" | "packed" | "out";
  quantity: number;
};
type Guard = { kind: "kit_member"; kitTag: string | null } | { kind: "accessory_child"; parentTag: string | null } | null;
type Result = { url: string | null; label: string | null; activity: Activity[]; guard: Guard };

const NONE: Result = { url: null, label: null, activity: [], guard: null };

function stateOf(status: string | undefined, prepStatus: string | undefined): Activity["state"] {
  if (status === "CHECKED_OUT") return "out";
  if (status === "PREPPED" || prepStatus === "PACKED") return "packed";
  return "to_pick";
}

/** The project, if it is ours and not a template (`by_cuid` is global). */
async function projectFor(ctx: QueryCtx, orgId: string, projectId: string) {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  return project && project.organizationId === orgId && !project.isTemplate ? project : null;
}

/** The unit's line and job, if both are ours and the line is live work. */
async function jobOf(ctx: QueryCtx, orgId: string, lineItemId: string) {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
  if (!line || line.organizationId !== orgId || line.status === "CANCELLED") return null;
  const project = await projectFor(ctx, orgId, line.projectId);
  return project ? { line, project } : null;
}

type UnitRow = { lineItemId: string; status?: string; prepStatus?: string; quantity?: number; returnedQuantity?: number };

async function activityFromUnits(ctx: QueryCtx, orgId: string, units: UnitRow[]): Promise<Activity[]> {
  const out: Activity[] = [];
  for (const u of units) {
    const quantity = Math.max(0, (u.quantity ?? 1) - (u.returnedQuantity ?? 0));
    if (quantity === 0) continue;
    const job = await jobOf(ctx, orgId, u.lineItemId);
    if (!job) continue;
    out.push({
      projectId: job.project.id,
      projectNumber: job.project.projectNumber,
      projectName: job.project.name,
      lineItemId: job.line.id,
      state: stateOf(u.status, u.prepStatus),
      quantity,
    });
  }
  return out;
}

async function unitsFor(ctx: QueryCtx, orgId: string, field: "assetId" | "bulkAssetId", id: string): Promise<UnitRow[]> {
  const perStatus = await Promise.all(
    ACTIVE_UNIT_STATUSES.map((status) =>
      field === "assetId"
        ? ctx.db
            .query("projectLineItemUnits")
            .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", orgId).eq("assetId", id).eq("status", status))
            .take(MAX_UNITS_PER_STATUS)
        : ctx.db
            .query("projectLineItemUnits")
            .withIndex("by_organizationId_bulkAssetId_status", (q) => q.eq("organizationId", orgId).eq("bulkAssetId", id).eq("status", status))
            .take(MAX_UNITS_PER_STATUS),
    ),
  );
  return perStatus.flat();
}

async function assetGuard(ctx: QueryCtx, orgId: string, asset: { kitId?: string; parentAssetId?: string }): Promise<Guard> {
  if (asset.kitId) {
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", asset.kitId!)).first();
    return { kind: "kit_member", kitTag: kit && kit.organizationId === orgId ? kit.assetTag : null };
  }
  if (asset.parentAssetId) {
    const parent = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", asset.parentAssetId!)).first();
    return { kind: "accessory_child", parentTag: parent && parent.organizationId === orgId ? parent.assetTag : null };
  }
  return null;
}

/** A kit is on a job through its PARENT line (`by_kitId` is global — org-check). */
async function kitActivity(ctx: QueryCtx, orgId: string, kitId: string): Promise<Activity[]> {
  const lines = await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).take(MAX_KIT_LINES);
  const out: Activity[] = [];
  for (const line of lines) {
    if (line.organizationId !== orgId || line.isKitChild) continue;
    if (!ACTIVE_UNIT_STATUSES.includes(line.status as (typeof ACTIVE_UNIT_STATUSES)[number])) continue;
    const project = await projectFor(ctx, orgId, line.projectId);
    if (!project) continue;
    out.push({
      projectId: project.id,
      projectNumber: project.projectNumber,
      projectName: project.name,
      lineItemId: line.id,
      state: stateOf(line.status, line.prepStatus),
      quantity: 1,
    });
  }
  return out;
}

export const resolve = query({
  args: { orgId: v.string(), value: v.string() },
  returns: v.object({
    url: v.union(v.string(), v.null()),
    label: v.union(v.string(), v.null()),
    activity: v.array(activityValidator),
    guard: guardValidator,
  }),
  handler: async (ctx, { orgId, value }): Promise<Result> => {
    await requireOrgReadFor(ctx, orgId, "warehouse");

    const tag = value.trim();
    if (!tag || tag.length > 128 || !SAFE_TAG.test(tag)) return NONE;

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
      .first();
    if (asset) {
      const [activity, guard] = await Promise.all([
        unitsFor(ctx, orgId, "assetId", asset.id).then((u) => activityFromUnits(ctx, orgId, u)),
        assetGuard(ctx, orgId, asset),
      ]);
      return { url: `/assets/registry/${asset.id}`, label: `Asset ${asset.assetTag}`, activity, guard };
    }

    const kit = await ctx.db
      .query("kits")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
      .first();
    if (kit) return { url: `/kits/${kit.id}`, label: `Kit ${kit.assetTag}`, activity: await kitActivity(ctx, orgId, kit.id), guard: null };

    const bulk = await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
      .first();
    if (bulk) {
      const activity = await activityFromUnits(ctx, orgId, await unitsFor(ctx, orgId, "bulkAssetId", bulk.id));
      return { url: `/assets/registry/${bulk.id}`, label: `Bulk Asset ${bulk.assetTag}`, activity, guard: null };
    }

    const tt = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) => q.eq("organizationId", orgId).eq("testTagId", tag))
      .first();
    if (tt) return { url: `/test-and-tag/${tt.id}`, label: `T&T ${tt.testTagId}`, activity: [], guard: null };

    return NONE;
  },
});
