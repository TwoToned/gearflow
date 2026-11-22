import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { ACTIVE_UNIT_STATUSES, activityFromUnits, projectFor, stateOf, unitsFor, type Activity } from "./lib/scanActivity";
import { loadScanCard, orNull, redactForTestTagOnly, scanCardFields, unknownCard, type ScanCard } from "./lib/scanCard";
import type { Doc } from "./_generated/dataModel";
import { resolveTestProfileForAsset } from "./lib/testProfileResolve";

export const agentOps: AgentOpsAnnotations = {
  resolve: {
    summary:
      "Resolve a scanned barcode/tag to its asset/kit/bulk-asset/test-tag navigation target, plus which jobs it is on right now (to pick / packed / out) and any kit-member or accessory guard.",
    danger: "low",
    mcpTier: 2,
  },
  checkCard: {
    summary:
      "Scan page, Check mode: what a scanned tag (asset tag or test tag) is — asset/kit/bulk/T&T-only/unknown — with where it lives, the job it is on, its last check, its check-item count and its last test & tag.",
    danger: "low",
    mcpTier: 2,
  },
  testCard: {
    summary:
      "Scan page, Test & tag mode: the same card as checkCard (asset tag or test tag) plus the test profile the item is tested against (visual checks, electrical tests, thresholds, outlets).",
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

/** The scanned value, trimmed, or `null` when it isn't one of our tags. */
function safeTag(value: string): string | null {
  const tag = value.trim();
  return !tag || tag.length > 128 || !SAFE_TAG.test(tag) ? null : tag;
}

const MAX_KIT_LINES = 20;

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

type Guard = { kind: "kit_member"; kitTag: string | null } | { kind: "accessory_child"; parentTag: string | null } | null;
type Result = { url: string | null; label: string | null; activity: Activity[]; guard: Guard };

const NONE: Result = { url: null, label: null, activity: [], guard: null };

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

    const tag = safeTag(value);
    if (!tag) return NONE;

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

/**
 * The Scan page's result card in Check mode (Phase 16, spec §9i.2) —
 * `convex/lib/scanCard.ts`. A `warehouse` read; `testCard` is the `testTag` twin.
 * Args are stable (no clock), so the subscription settles.
 */
export const checkCard = query({
  args: { orgId: v.string(), value: v.string() },
  returns: v.object(scanCardFields),
  handler: async (ctx, { orgId, value }): Promise<ScanCard> => {
    await requireOrgReadFor(ctx, orgId, "warehouse");
    const tag = safeTag(value);
    return tag ? await loadScanCard(ctx, orgId, tag) : unknownCard(value.trim().slice(0, 128));
  },
});

const profileValidator = v.object({
  id: v.string(),
  name: v.string(),
  equipmentClass: v.union(v.string(), v.null()),
  applianceType: v.union(v.string(), v.null()),
  visualChecks: v.any(),
  electricalTests: v.any(),
  thresholds: v.any(),
  requiresSubTests: v.boolean(),
  defaultSubTestCount: v.union(v.number(), v.null()),
  subTestLabel: v.union(v.string(), v.null()),
});

/**
 * Test & tag mode's card: the same card plus the profile the item is held to (the
 * cascade `createNative` enforces D51 against), so the draft needs one read, not two.
 */
export const testCard = query({
  args: { orgId: v.string(), value: v.string() },
  returns: v.object({ ...scanCardFields, profile: v.union(v.null(), profileValidator) }),
  handler: async (ctx, { orgId, value }) => {
    await requireOrgReadFor(ctx, orgId, "testTag");
    const tag = safeTag(value);
    const card = tag ? await loadScanCard(ctx, orgId, tag) : unknownCard(value.trim().slice(0, 128));
    return { ...(await redactForTestTagOnly(ctx, orgId, card)), profile: await profileFor(ctx, orgId, card) };
  },
});

async function profileFor(ctx: QueryCtx, orgId: string, card: ScanCard) {
  if (!card.tt) return null;
  const tt = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", card.tt!.id)).first();
  if (!tt || tt.organizationId !== orgId) return null;
  const p = await resolveTestProfileForAsset(ctx, orgId, tt);
  return p ? profileFacts(p) : null;
}

function profileFacts(p: Doc<"testProfiles">) {
  return {
    id: p.id,
    name: p.name,
    equipmentClass: orNull(p.equipmentClass),
    applianceType: orNull(p.applianceType),
    visualChecks: orNull(p.visualChecks) ?? [],
    electricalTests: orNull(p.electricalTests) ?? [],
    thresholds: orNull(p.thresholds) ?? {},
    requiresSubTests: p.requiresSubTests === true,
    defaultSubTestCount: orNull(p.defaultSubTestCount),
    subTestLabel: orNull(p.subTestLabel),
  };
}
