import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { bumpCountersForTable } from "./lib/counters";
import { backfillTestTagAssetsCore, orgDefaultIntervalMonths } from "./lib/testtagBackfill";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Native MODEL write mutations (Phase 3 browser-direct — replaces createModel/
 * updateModel/archiveModel/bulkUpdateRates). Models are Convex-only (Phase B
 * inversion). Each mutation runs the 4 guards + per-row org re-check + atomic
 * audit. There is no server action in this path — `useModelWrites()`
 * (src/hooks/use-model-writes.ts) runs `modelSchema.parse()` client-side before
 * calling these mutations directly; `assertModelFields` re-enforces the same
 * string-length/numeric bounds here so a caller invoking the mutation directly
 * (valid session, bypassing the UI) can't skip them (R-8.6.1/R-8.6.2 — the
 * mutation is the boundary, not the form).
 *
 * Side-effects folded in (all atomic now — the old server path made N round-trips):
 *  - create/update with requiresTestAndTag → backfillTestTagAssetsCore (auto-register).
 *  - update also PROPAGATES the model's T&T defaults to every active testTagAsset
 *    linked to its assets (equipmentClass / applianceType / testIntervalMonths).
 *  - archive DELETES all of the model's assets/bulkAssets (org-filtered) then
 *    soft-archives (isActive=false).
 *  - bulkUpdateRates computes each new rate from the current value INSIDE the
 *    mutation (dailyRate auto-syncs defaultRentalPrice).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const modelFields = {
  name: v.string(),
  manufacturer: v.optional(v.string()),
  modelNumber: v.optional(v.string()),
  sku: v.optional(v.string()),
  categoryId: v.optional(v.string()),
  description: v.optional(v.string()),
  image: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  manuals: v.optional(v.array(v.string())),
  specifications: v.optional(v.any()),
  customFields: v.optional(v.any()),
  defaultRentalPrice: v.optional(v.number()),
  dailyRate: v.optional(v.number()),
  weeklyRate: v.optional(v.number()),
  monthlyRate: v.optional(v.number()),
  defaultPurchasePrice: v.optional(v.number()),
  replacementCost: v.optional(v.number()),
  // WS11 (#950) — sales items. See convex/schema.ts's field comment for the
  // full spec (single per-model pool, no fallback chain on salePrice).
  salePrice: v.optional(v.number()),
  saleStockQuantity: v.optional(v.number()),
  weight: v.optional(v.number()),
  powerDraw: v.optional(v.number()),
  requiresTestAndTag: v.optional(v.boolean()),
  testAndTagIntervalDays: v.optional(v.number()),
  defaultEquipmentClass: v.optional(enums.EquipmentClass),
  defaultApplianceType: v.optional(enums.ApplianceType),
  defaultTestProfileId: v.optional(v.string()),
  maintenanceIntervalDays: v.optional(v.number()),
  assetType: v.optional(enums.AssetType),
  barcodeLabelTemplate: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  xeroRentalAccountCode: v.optional(v.string()),
  xeroSaleAccountCode: v.optional(v.string()),
};

type ModelArgs = {
  name: string;
  manufacturer?: string; modelNumber?: string; sku?: string; categoryId?: string;
  description?: string; image?: string; images?: string[]; manuals?: string[];
  specifications?: unknown; customFields?: unknown;
  defaultRentalPrice?: number; dailyRate?: number; weeklyRate?: number; monthlyRate?: number;
  defaultPurchasePrice?: number; replacementCost?: number; salePrice?: number; saleStockQuantity?: number;
  weight?: number; powerDraw?: number;
  requiresTestAndTag?: boolean; testAndTagIntervalDays?: number;
  defaultEquipmentClass?: string; defaultApplianceType?: string; defaultTestProfileId?: string;
  maintenanceIntervalDays?: number; assetType?: string; barcodeLabelTemplate?: string;
  tags?: string[]; isActive?: boolean;
  xeroRentalAccountCode?: string; xeroSaleAccountCode?: string;
};

/**
 * Mirrors `modelSchema`'s (src/lib/validations/model.ts) string-length + numeric
 * bounds — `v.string()`/`v.number()` only enforce type, not these business
 * constraints, so a browser-direct caller bypassing the client Zod parse would
 * otherwise skip them entirely (R-8.6.2). `name`'s required-ness and `dailyRate`'s
 * negative check keep their original domain-specific messages (existing callers/
 * tests key off "Name is required" / "positive"); every other field uses the
 * shared `assertStrLen`/`assertNumRange` primitives.
 */
function assertModelFields(a: ModelArgs) {
  if (!a.name || a.name.length < 1) throw new ConvexError("Name is required");
  assertStrLen(a.name, "name", { max: 200 });
  assertStrLen(a.manufacturer, "manufacturer", { max: 200 });
  assertStrLen(a.modelNumber, "modelNumber", { max: 100 });
  assertStrLen(a.sku, "sku", { max: 100 });
  assertStrLen(a.description, "description", { max: 2000 });
  assertStrLen(a.xeroRentalAccountCode, "xeroRentalAccountCode", { max: 50 });
  assertStrLen(a.xeroSaleAccountCode, "xeroSaleAccountCode", { max: 50 });

  if (a.dailyRate != null && (!Number.isFinite(a.dailyRate) || a.dailyRate < 0)) {
    throw new ConvexError("Daily rate must be zero or positive");
  }
  assertNumRange(a.defaultRentalPrice, "defaultRentalPrice", { min: 0 });
  assertNumRange(a.weeklyRate, "weeklyRate", { min: 0 });
  assertNumRange(a.monthlyRate, "monthlyRate", { min: 0 });
  assertNumRange(a.defaultPurchasePrice, "defaultPurchasePrice", { min: 0 });
  assertNumRange(a.replacementCost, "replacementCost", { min: 0 });
  assertNumRange(a.salePrice, "salePrice", { min: 0 });
  // No `min` — oversell is allowed (spec decision: warn, never block), so a
  // negative pool is valid data, not an input error. Integer-only (a stock count).
  assertNumRange(a.saleStockQuantity, "saleStockQuantity", { integer: true });
  assertNumRange(a.weight, "weight", { min: 0 });
  // Schema also requires these to be whole numbers (z.coerce.number().int()) — the
  // pre-existing hand-rolled checks missed the integer requirement; fixed here.
  assertNumRange(a.powerDraw, "powerDraw", { min: 0, integer: true });
  assertNumRange(a.maintenanceIntervalDays, "maintenanceIntervalDays", { min: 0, integer: true });
  assertNumRange(a.testAndTagIntervalDays, "testAndTagIntervalDays", { min: 1, integer: true });
}

/** Build the models doc from parsed form args (mirrors toConvexModelArgs — undefined clears). */
function toDoc(a: ModelArgs) {
  const tt = a.requiresTestAndTag ?? false;
  return {
    name: a.name,
    manufacturer: a.manufacturer ?? undefined,
    modelNumber: a.modelNumber ?? undefined,
    sku: a.sku || undefined,
    categoryId: a.categoryId || undefined,
    description: a.description ?? undefined,
    image: a.image ?? undefined,
    images: a.images ?? [],
    manuals: a.manuals ?? [],
    specifications: a.specifications ?? undefined,
    customFields: a.customFields ?? undefined,
    defaultRentalPrice: a.dailyRate ?? a.defaultRentalPrice ?? undefined,
    dailyRate: a.dailyRate ?? undefined,
    weeklyRate: a.weeklyRate ?? undefined,
    monthlyRate: a.monthlyRate ?? undefined,
    defaultPurchasePrice: a.defaultPurchasePrice ?? undefined,
    replacementCost: a.replacementCost ?? undefined,
    salePrice: a.salePrice ?? undefined,
    saleStockQuantity: a.saleStockQuantity ?? undefined,
    weight: a.weight ?? undefined,
    powerDraw: a.powerDraw ?? undefined,
    requiresTestAndTag: tt,
    testAndTagIntervalDays: tt ? a.testAndTagIntervalDays ?? undefined : undefined,
    defaultTestProfileId: tt ? a.defaultTestProfileId || undefined : undefined,
    defaultEquipmentClass: tt ? ((a.defaultEquipmentClass as "CLASS_I") || "CLASS_I") : undefined,
    defaultApplianceType: tt ? ((a.defaultApplianceType as "APPLIANCE") || "APPLIANCE") : undefined,
    maintenanceIntervalDays: a.maintenanceIntervalDays ?? undefined,
    assetType: (a.assetType as "SERIALIZED") ?? "SERIALIZED",
    barcodeLabelTemplate: a.barcodeLabelTemplate ?? undefined,
    isActive: a.isActive ?? true,
    tags: a.tags ?? [],
    xeroRentalAccountCode: a.xeroRentalAccountCode || undefined,
    xeroSaleAccountCode: a.xeroSaleAccountCode || undefined,
  };
}

async function logModel(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; details?: unknown }) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "model", entityId: a.id,
    entityName: a.name, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: a.details, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...modelFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "create");
    const actor = await resolveActor(ctx, a.actor);
    assertModelFields(a);

    const dup = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Model already exists");

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    if (a.categoryId) await assertRefInOrg(ctx, "categories", a.categoryId, a.orgId);
    if (a.defaultTestProfileId) await assertRefInOrg(ctx, "testProfiles", a.defaultTestProfileId, a.orgId);

    await ctx.db.insert("models", { id: a.id, organizationId: a.orgId, ...toDoc(a), createdAt: a.now, updatedAt: a.now });

    if (a.requiresTestAndTag) await backfillTestTagAssetsCore(ctx, a.orgId, a.now);

    await logModel(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name,
      summary: `Created model ${a.name}`, details: { created: { name: a.name, manufacturer: a.manufacturer ?? null } },
    });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...modelFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    assertModelFields(a);

    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Model not found");

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    if (a.categoryId) await assertRefInOrg(ctx, "categories", a.categoryId, a.orgId);
    if (a.defaultTestProfileId) await assertRefInOrg(ctx, "testProfiles", a.defaultTestProfileId, a.orgId);

    await ctx.db.patch(doc._id, { ...toDoc(a), updatedAt: a.now });

    if (a.requiresTestAndTag) {
      await backfillTestTagAssetsCore(ctx, a.orgId, a.now);

      // Propagate the model's T&T defaults to active testTagAssets on its assets.
      const equipmentClass = ((a.defaultEquipmentClass as "CLASS_I") || "CLASS_I");
      const applianceType = ((a.defaultApplianceType as "APPLIANCE") || "APPLIANCE");
      const intervalMonths = a.testAndTagIntervalDays
        ? Math.max(1, Math.round(a.testAndTagIntervalDays / 30))
        : await orgDefaultIntervalMonths(ctx, a.orgId);

      const modelAssets = (await ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", a.id)).collect())
        .filter((x) => x.organizationId === a.orgId && x.isActive !== false);
      for (const asset of modelAssets) {
        const ttRows = (await ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", asset.id)).collect())
          .filter((tt) => tt.organizationId === a.orgId && tt.isActive !== false);
        for (const tt of ttRows) {
          await ctx.db.patch(tt._id, { equipmentClass, applianceType, testIntervalMonths: intervalMonths, updatedAt: a.now });
        }
      }
    }

    await logModel(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated model ${a.name}` });
    return { id: a.id };
  },
});

export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Model not found");

    // Delete the model's assets + bulk assets (org-filtered — by_modelId is GLOBAL).
    const assets = (await ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", a.id)).collect())
      .filter((x) => x.organizationId === a.orgId);
    const bulk = (await ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", a.id)).collect())
      .filter((x) => x.organizationId === a.orgId);
    // Delete + decrement the sharded dashboard counters (parity with the old
    // api.assets.remove / api.bulkAssets.remove cascade, which bump on delete).
    for (const x of assets) { await ctx.db.delete(x._id); await bumpCountersForTable(ctx, "assets", x, null); }
    for (const x of bulk) { await ctx.db.delete(x._id); await bumpCountersForTable(ctx, "bulkAssets", x, null); }

    // Soft archive.
    await ctx.db.patch(doc._id, { isActive: false, updatedAt: a.now });

    await logModel(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: doc.name, summary: `Archived model ${doc.name}` });
    return { id: a.id };
  },
});

export const bulkUpdateRatesNative = mutation({
  returns: v.object({ count: v.number() }),
  args: {
    orgId: v.string(),
    modelIds: v.array(v.string()),
    // WS11 (#950) — salePrice rides the same bulk-rate-update lane.
    rateType: v.union(v.literal("dailyRate"), v.literal("weeklyRate"), v.literal("monthlyRate"), v.literal("salePrice")),
    operation: v.union(v.literal("set"), v.literal("multiply"), v.literal("increase_percent")),
    value: v.number(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);

    if (a.modelIds.length === 0) throw new ConvexError("No models selected");
    if (!Number.isFinite(a.value)) throw new ConvexError("Invalid value");
    if (a.operation === "set" && a.value < 0) throw new ConvexError("Rate cannot be negative");
    if (a.operation === "multiply" && a.value <= 0) throw new ConvexError("Multiplier must be positive");

    const selected = new Set(a.modelIds);
    let count = 0;
    for (const id of selected) {
      const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) continue; // per-item org re-check (by_cuid is GLOBAL)
      const current = Number((doc as Record<string, unknown>)[a.rateType] ?? 0);
      let newRate: number;
      switch (a.operation) {
        case "set": newRate = a.value; break;
        case "multiply": newRate = current * a.value; break;
        case "increase_percent": newRate = current * (1 + a.value / 100); break;
      }
      newRate = Math.round(newRate * 100) / 100;
      const patch: Record<string, number> = { [a.rateType]: newRate, updatedAt: a.now };
      if (a.rateType === "dailyRate") patch.defaultRentalPrice = newRate;
      await ctx.db.patch(doc._id, patch);
      count++;
    }

    await logModel(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.modelIds[0], name: `${count} models`,
      summary: `Bulk updated ${a.rateType} on ${count} model(s): ${a.operation} ${a.value}`,
    });
    return { count };
  },
});

export const agentOps: AgentOpsAnnotations = {
  // Delete/archive tier (§9) — also cascade-DELETES every asset + bulkAsset of
  // this model (not just a soft archive of the model itself), so it's high on
  // both grounds.
  archiveNative: { danger: "high" },
  // Rate metadata only (dailyRate/weeklyRate/monthlyRate/salePrice) — no
  // status/availability change at scale, so medium per the bulk-rate carve-out.
  bulkUpdateRatesNative: { danger: "medium" },
  createNative: { danger: "medium" },
  updateNative: { danger: "medium" },
};
