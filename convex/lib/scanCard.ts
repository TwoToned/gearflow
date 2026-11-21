/**
 * The Scan page's result card (Phase 16, spec §9i.2): what a scanned tag IS and the
 * four facts a tester needs before checking or testing it — Where, On job, Last check,
 * Last T&T. Shared by `scanLookup.checkCard` (warehouse read) and `scanLookup.testCard`
 * (testTag read, which adds the resolved profile), so a T&T-only role isn't locked out
 * of its own page (overseer Q12).
 *
 * Resolve order: serialised asset tag → kit tag → bulk tag → test tag (`TT-0412`). A
 * test tag linked to a serialised asset resolves to THAT asset, so a tag and a test tag
 * reach the same card. Kits and bulk return their identity only (no check applies:
 * bulk stock has no condition, D50 / Q14).
 *
 * Bounded reads throughout; every read on a GLOBAL index (`by_cuid`) is org re-checked;
 * the lookups on org-scoped composite indexes are org-scoped by construction.
 */
import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getProjectWindow } from "./projectWindow";
import { activityFromUnits, projectFor, unitsFor, type Activity } from "./scanActivity";

/** Newest check records read to find the last check (its items share one `performedAt`). */
const MAX_CHECK_ROWS = 50;
/** A model's check items counted (more than this is still "has items"). */
const MAX_CHECK_ITEMS = 100;
/** T&T register rows read for one inventory asset. */
const MAX_TT_ROWS = 5;

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());

export const scanCardKind = v.union(v.literal("asset"), v.literal("kit"), v.literal("bulk"), v.literal("ttOnly"), v.literal("unknown"));

const ttValidator = v.object({
  id: v.string(),
  testTagId: v.string(),
  description: v.string(),
  status: nullableString,
  equipmentClass: nullableString,
  applianceType: nullableString,
  make: nullableString,
  modelName: nullableString,
  lastTestDate: nullableNumber,
  nextDueDate: nullableNumber,
  testIntervalMonths: nullableNumber,
  outletCount: nullableNumber,
  isActive: v.boolean(),
  assetId: nullableString,
  bulkAssetId: nullableString,
});

/** Every field of the card, as a validator map (testCard spreads it and adds `profile`). */
export const scanCardFields = {
  kind: scanCardKind,
  tag: v.string(),
  asset: v.union(
    v.null(),
    v.object({
      id: v.string(),
      assetTag: v.string(),
      serialNumber: nullableString,
      modelId: v.string(),
      modelName: nullableString,
      status: nullableString,
      condition: nullableString,
    }),
  ),
  kit: v.union(v.null(), v.object({ id: v.string(), assetTag: v.string(), name: v.string() })),
  bulk: v.union(v.null(), v.object({ id: v.string(), assetTag: v.string(), modelName: nullableString })),
  location: v.union(v.null(), v.object({ id: v.string(), name: v.string() })),
  job: v.union(
    v.null(),
    v.object({
      projectId: v.string(),
      projectNumber: v.string(),
      projectName: v.string(),
      lineItemId: v.string(),
      state: v.union(v.literal("to_pick"), v.literal("packed"), v.literal("out")),
      backAt: nullableNumber,
    }),
  ),
  lastCheck: v.union(
    v.null(),
    v.object({ at: v.number(), byName: nullableString, total: v.number(), failed: v.number(), truncated: v.boolean() }),
  ),
  checkItemCount: v.number(),
  tt: v.union(v.null(), ttValidator),
};

const scanCardValidator = v.object(scanCardFields);
export type ScanCard = Infer<typeof scanCardValidator>;

type Ctx = QueryCtx;

/** The card for a tag nothing carries. */
export function unknownCard(tag: string): ScanCard {
  return { kind: "unknown", tag, asset: null, kit: null, bulk: null, location: null, job: null, lastCheck: null, checkItemCount: 0, tt: null };
}

/** `undefined` → `null` (the card's wire shape has no absent fields). */
export function orNull<X>(x: X | undefined): X | null {
  return x === undefined ? null : x;
}

function ttFacts(tt: Doc<"testTagAssets">): NonNullable<ScanCard["tt"]> {
  return {
    id: tt.id,
    testTagId: tt.testTagId,
    description: tt.description,
    status: orNull(tt.status),
    equipmentClass: orNull(tt.equipmentClass),
    applianceType: orNull(tt.applianceType),
    make: orNull(tt.make),
    modelName: orNull(tt.modelName),
    lastTestDate: orNull(tt.lastTestDate),
    nextDueDate: orNull(tt.nextDueDate),
    testIntervalMonths: orNull(tt.testIntervalMonths),
    outletCount: orNull(tt.outletCount),
    isActive: tt.isActive !== false,
    assetId: orNull(tt.assetId),
    bulkAssetId: orNull(tt.bulkAssetId),
  };
}

async function modelName(ctx: Ctx, orgId: string, modelId: string): Promise<string | null> {
  const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
  return model && model.organizationId === orgId ? model.name : null;
}

async function locationFact(ctx: Ctx, orgId: string, locationId: string | undefined): Promise<ScanCard["location"]> {
  if (!locationId) return null;
  const loc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", locationId)).first();
  return loc && loc.organizationId === orgId ? { id: loc.id, name: loc.name } : null;
}

const STATE_RANK: Record<Activity["state"], number> = { out: 0, packed: 1, to_pick: 2 };

/** The job the unit is most committed to (out > packed > to pick), with when it's back. */
async function jobFact(ctx: Ctx, orgId: string, assetId: string): Promise<ScanCard["job"]> {
  const activity = await activityFromUnits(ctx, orgId, await unitsFor(ctx, orgId, "assetId", assetId));
  const first = [...activity].sort((x, y) => STATE_RANK[x.state] - STATE_RANK[y.state])[0];
  if (!first) return null;
  const project = await projectFor(ctx, orgId, first.projectId);
  return {
    projectId: first.projectId,
    projectNumber: first.projectNumber,
    projectName: first.projectName,
    lineItemId: first.lineItemId,
    state: first.state,
    backAt: project ? getProjectWindow(project).end : null,
  };
}

/** The newest check (all items saved in one go share a `performedAt`). */
async function lastCheckFact(ctx: Ctx, orgId: string, assetId: string): Promise<ScanCard["lastCheck"]> {
  const rows = await ctx.db
    .query("checkRecords")
    .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
    .order("desc")
    .take(MAX_CHECK_ROWS);
  const at = Math.max(...rows.map((r) => r.performedAt ?? 0));
  if (rows.length === 0 || at <= 0) return null;
  const group = rows.filter((r) => (r.performedAt ?? 0) === at);
  const by = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", group[0].performedById)).first();
  return {
    at,
    byName: by?.name ?? null,
    total: group.length,
    failed: group.filter((r) => r.result === "FAIL").length,
    truncated: rows.length === MAX_CHECK_ROWS && group.length === rows.length,
  };
}

async function checkItemCount(ctx: Ctx, orgId: string, modelId: string): Promise<number> {
  const items = await ctx.db
    .query("modelCheckItems")
    .withIndex("by_organizationId_modelId", (q) => q.eq("organizationId", orgId).eq("modelId", modelId))
    .take(MAX_CHECK_ITEMS);
  return items.length;
}

/** The inventory asset's T&T register row (an active one first). */
async function ttForAsset(ctx: Ctx, orgId: string, assetId: string): Promise<Doc<"testTagAssets"> | null> {
  const rows = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
    .take(MAX_TT_ROWS);
  return rows.find((r) => r.isActive !== false) ?? rows[0] ?? null;
}

/** The full card for a serialised asset (already org-scoped by its lookup). */
async function assetCard(ctx: Ctx, orgId: string, tag: string, asset: Doc<"assets">, tt: Doc<"testTagAssets"> | null): Promise<ScanCard> {
  const [name, location, job, lastCheck, count, ownTt] = await Promise.all([
    modelName(ctx, orgId, asset.modelId),
    locationFact(ctx, orgId, asset.locationId),
    jobFact(ctx, orgId, asset.id),
    lastCheckFact(ctx, orgId, asset.id),
    checkItemCount(ctx, orgId, asset.modelId),
    tt ? Promise.resolve(tt) : ttForAsset(ctx, orgId, asset.id),
  ]);
  return {
    ...unknownCard(tag),
    kind: "asset",
    asset: {
      id: asset.id,
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber ?? null,
      modelId: asset.modelId,
      modelName: name,
      status: asset.status ?? null,
      condition: asset.condition ?? null,
    },
    location, job, lastCheck, checkItemCount: count,
    tt: ownTt ? ttFacts(ownTt) : null,
  };
}

/** A test tag: the asset it is linked to, or the register row alone. */
async function testTagCard(ctx: Ctx, orgId: string, tag: string, tt: Doc<"testTagAssets">): Promise<ScanCard> {
  if (tt.assetId) {
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", tt.assetId!)).first();
    if (asset && asset.organizationId === orgId) return await assetCard(ctx, orgId, tag, asset, tt);
  }
  return { ...unknownCard(tag), kind: "ttOnly", tt: ttFacts(tt) };
}

/** Resolve an already-validated tag to its card. */
export async function loadScanCard(ctx: Ctx, orgId: string, tag: string): Promise<ScanCard> {
  const asset = await ctx.db
    .query("assets")
    .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
    .first();
  if (asset) return await assetCard(ctx, orgId, tag, asset, null);

  const kit = await ctx.db
    .query("kits")
    .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
    .first();
  if (kit) return { ...unknownCard(tag), kind: "kit", kit: { id: kit.id, assetTag: kit.assetTag, name: kit.name } };

  const bulk = await ctx.db
    .query("bulkAssets")
    .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
    .first();
  if (bulk) {
    return { ...unknownCard(tag), kind: "bulk", bulk: { id: bulk.id, assetTag: bulk.assetTag, modelName: await modelName(ctx, orgId, bulk.modelId) } };
  }

  const tt = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_testTagId", (q) => q.eq("organizationId", orgId).eq("testTagId", tag))
    .first();
  return tt ? await testTagCard(ctx, orgId, tag, tt) : unknownCard(tag);
}
