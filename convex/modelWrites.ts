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
import * as enums from "./lib/validators";

/**
 * Native MODEL write mutations (Phase 3 browser-direct — replaces createModel/
 * updateModel/archiveModel/bulkUpdateRates). Models are Convex-only (Phase B
 * inversion). Each mutation runs the 4 guards + per-row org re-check + atomic
 * audit. The form runs modelSchema before submit; validateModel re-checks the
 * key constraints server-side (the mutation is the boundary, not the form).
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

const modelFields = {
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
};

type ModelArgs = {
  name: string;
  manufacturer?: string; modelNumber?: string; sku?: string; categoryId?: string;
  description?: string; image?: string; images?: string[]; manuals?: string[];
  specifications?: unknown; customFields?: unknown;
  defaultRentalPrice?: number; dailyRate?: number; weeklyRate?: number; monthlyRate?: number;
  defaultPurchasePrice?: number; replacementCost?: number; weight?: number; powerDraw?: number;
  requiresTestAndTag?: boolean; testAndTagIntervalDays?: number;
  defaultEquipmentClass?: string; defaultApplianceType?: string; defaultTestProfileId?: string;
  maintenanceIntervalDays?: number; assetType?: string; barcodeLabelTemplate?: string;
  tags?: string[]; isActive?: boolean;
};

/** Server-side parity with modelSchema — the mutation is the boundary, not the form. */
function validateModel(a: ModelArgs) {
  if (!a.name || a.name.length < 1) throw new ConvexError("Name is required");
  const maxLen: [string, string | undefined, number][] = [
    ["Name", a.name, 200], ["Manufacturer", a.manufacturer, 200], ["Model number", a.modelNumber, 100],
    ["SKU", a.sku, 100], ["Description", a.description, 2000],
  ];
  for (const [label, val, cap] of maxLen) if (val && val.length > cap) throw new ConvexError(`${label} is too long`);
  const nonNeg: [string, number | undefined][] = [
    ["Default rental price", a.defaultRentalPrice], ["Daily rate", a.dailyRate], ["Weekly rate", a.weeklyRate],
    ["Monthly rate", a.monthlyRate], ["Purchase price", a.defaultPurchasePrice], ["Replacement cost", a.replacementCost],
    ["Weight", a.weight], ["Power draw", a.powerDraw], ["Maintenance interval", a.maintenanceIntervalDays],
  ];
  for (const [label, val] of nonNeg) {
    if (val == null) continue;
    if (!Number.isFinite(val) || val < 0) throw new ConvexError(`${label} must be zero or positive`);
  }
  if (a.testAndTagIntervalDays != null && (!Number.isFinite(a.testAndTagIntervalDays) || a.testAndTagIntervalDays < 1)) {
    throw new ConvexError("Test & tag interval must be at least 1 day");
  }
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
    validateModel(a);

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
    validateModel(a);

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
    rateType: v.union(v.literal("dailyRate"), v.literal("weeklyRate"), v.literal("monthlyRate")),
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
