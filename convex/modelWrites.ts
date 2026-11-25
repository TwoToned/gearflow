import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import type { Doc } from "./_generated/dataModel";
import { writeActivityLog } from "./lib/audit";
import { bumpCountersForTable } from "./lib/counters";
import { backfillTestTagAssetsCore, orgDefaultIntervalMonths } from "./lib/testtagBackfill";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { collectCapped } from "./lib/pagination";
import { adjustModelSaleStock } from "./lib/saleStock";
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
  isContainer: v.optional(v.boolean()),
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
  tags?: string[]; isActive?: boolean; isContainer?: boolean;
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
    isContainer: a.isContainer ?? false,
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

    // A model's assetType gates which of its own inventory the model detail
    // tab, the bulk-asset model picker, and the equipment-add pickers show
    // (they branch/filter on this field, never both at once) — flipping it
    // while the OTHER kind's records still exist doesn't delete those rows,
    // it just makes them unreachable through any of those surfaces. Block the
    // flip instead of silently orphaning existing stock (R-9.3).
    const newAssetType = (a.assetType as "SERIALIZED" | "BULK" | undefined) ?? "SERIALIZED";
    const oldAssetType = (doc.assetType as "SERIALIZED" | "BULK" | undefined) ?? "SERIALIZED";
    if (newAssetType !== oldAssetType) {
      if (newAssetType === "BULK") {
        const { rows: assetRows } = await collectCapped(ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", a.id)));
        const activeAssets = assetRows.filter((x) => x.organizationId === a.orgId && x.isActive !== false);
        if (activeAssets.length > 0) {
          throw new ConvexError(`Cannot change to Bulk — ${activeAssets.length} serialized asset(s) still exist under this model. Archive or move them first.`);
        }
      } else {
        const { rows: bulkRows } = await collectCapped(ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", a.id)));
        const activeBulk = bulkRows.filter((x) => x.organizationId === a.orgId && x.isActive !== false);
        if (activeBulk.length > 0) {
          throw new ConvexError(`Cannot change to Serialized — ${activeBulk.length} bulk asset record(s) still exist under this model. Archive or move them first.`);
        }
      }
    }

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
  returns: v.object({ count: v.number(), auditIds: v.array(v.string()) }),
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

    await assertBulkSizeOk(ctx, a.modelIds.length);
    if (a.modelIds.length === 0) throw new ConvexError("No models selected");
    if (!Number.isFinite(a.value)) throw new ConvexError("Invalid value");
    if (a.operation === "set" && a.value < 0) throw new ConvexError("Rate cannot be negative");
    if (a.operation === "multiply" && a.value <= 0) throw new ConvexError("Multiplier must be positive");

    const selected = new Set(a.modelIds);
    let count = 0;
    const auditIds: string[] = [];
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
      // One field-edit audit row per model: the bulk Undo (`undoModelFieldEditsNative`) takes these ids.
      const diff = diffFields(doc, { ...doc, ...patch }, RATE_FIELDS);
      if (diff) {
        const auditId = `${a.auditId}:${doc.id}`;
        await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "model", entityId: doc.id, entityName: doc.name, auditId, actor, summary: `Set ${a.rateType} on ${doc.name} (${diff.before[a.rateType] ?? "unset"} -> ${newRate})`, diff, now: a.now });
        auditIds.push(auditId);
      }
      count++;
    }

    await logModel(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.modelIds[0], name: `${count} models`,
      summary: `Bulk updated ${a.rateType} on ${count} model(s): ${a.operation} ${a.value}`,
    });
    return { count, auditIds };
  },
});

/** Fields a bulk rate edit can change, i.e. what its per-model Undo restores. */
const RATE_FIELDS = ["dailyRate", "weeklyRate", "monthlyRate", "salePrice", "defaultRentalPrice"] as const;

/** The only fields `undoModelFieldEditsNative` will restore: anything else in a snapshot refuses the Undo. */
const MODEL_UNDO_FIELDS = [...RATE_FIELDS, "reorderLevel"] as const;

/**
 * The exact Undo of `bulkUpdateRatesNative` and `setReorderLevelsNative`: ids only (one field-edit audit
 * row per model, from the forward write). Atomic: one refusal (another person, past 10 minutes, already
 * undone, or a field changed since) rolls the whole batch back. Uses `convex/lib/fieldEditUndo.ts`.
 */
export const undoModelFieldEditsNative = mutation({
  returns: v.object({ restored: v.number() }),
  args: { orgId: v.string(), auditIds: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.auditIds.length);
    if (a.auditIds.length === 0) throw new ConvexError("Nothing to undo");
    for (const auditId of new Set(a.auditIds)) {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", auditId)).first();
      if (!row || row.organizationId !== a.orgId || row.entityType !== "model") throw new ConvexError("This change can't be undone");
      await undoFieldEdit(ctx, {
        orgId: a.orgId, entityType: "model", entityId: row.entityId, entityName: row.entityName, auditId, actor, now: a.now,
        load: async () => {
          const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", row.entityId)).first();
          return m && m.organizationId === a.orgId ? m : null;
        },
        apply: async (doc, plan) => {
          const unsupported = [...Object.keys(plan.set), ...plan.clear].filter((f) => !(MODEL_UNDO_FIELDS as readonly string[]).includes(f));
          if (unsupported.length > 0) throw new ConvexError("This change can't be undone");
          const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
          for (const f of plan.clear) patch[f] = undefined;
          await ctx.db.patch(doc._id, patch);
        },
      });
    }
    return { restored: new Set(a.auditIds).size };
  },
});

const reorderEntry = v.object({ id: v.string(), level: v.union(v.number(), v.null()) });

/**
 * `Set reorder level` (Sales stock list, row and bulk): a whole number >= 0 per model, or null to clear
 * (an unset level is never read as 0). One field-edit audit row per changed model; Undo is
 * `undoModelFieldEditsNative`. Unchanged models write nothing and return no audit id.
 */
export const setReorderLevelsNative = mutation({
  returns: v.object({ auditIds: v.array(v.string()), count: v.number() }),
  args: { orgId: v.string(), entries: v.array(reorderEntry), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.entries.length);
    if (a.entries.length === 0) throw new ConvexError("Nothing to set");
    if (new Set(a.entries.map((e) => e.id)).size !== a.entries.length) throw new ConvexError("Each model can appear once");
    const auditIds: string[] = [];
    for (const e of a.entries) {
      assertNumRange(e.level ?? undefined, "reorderLevel", { min: 0, integer: true });
      const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", e.id)).first();
      if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Model not found");
      const diff = diffFields(doc, { ...doc, reorderLevel: e.level }, ["reorderLevel"]);
      if (!diff) continue;
      await ctx.db.patch(doc._id, { reorderLevel: e.level ?? undefined, updatedAt: a.now });
      const auditId = `${a.auditId}:${doc.id}`;
      await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "model", entityId: doc.id, entityName: doc.name, auditId, actor, summary: `Set reorder level on ${doc.name} (${diff.before.reorderLevel ?? "unset"} -> ${e.level ?? "unset"})`, diff, now: a.now });
      auditIds.push(auditId);
    }
    return { auditIds, count: auditIds.length };
  },
});

export const adjustSaleStockNative = mutation({
  returns: v.object({ id: v.string(), saleStockQuantity: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    // Positive = stock received (restock); negative = a manual correction
    // (stocktake, damage write-off). Zero is rejected — there's nothing to log.
    delta: v.number(),
    reason: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);

    if (a.delta === 0 || !Number.isInteger(a.delta)) {
      throw new ConvexError("Adjustment must be a nonzero whole number");
    }
    assertStrLen(a.reason, "reason", { max: 500 });

    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Model not found");

    // auditId is caller-minted for the create/update/archive mutations above (one
    // predictable id per user action); this write's audit row is instead minted
    // inside adjustModelSaleStock (shared with the line-item call sites, which
    // each need their OWN id per delta) — a.auditId is accepted for API-contract
    // consistency with the rest of this module but isn't threaded through.
    const { to } = await adjustModelSaleStock(ctx, {
      modelId: a.id,
      orgId: a.orgId,
      delta: a.delta,
      reason: a.reason,
      actor,
      now: a.now,
    });
    return { id: a.id, saleStockQuantity: to };
  },
});

const saleAdjustment = v.object({ id: v.string(), delta: v.number() });

/**
 * Bulk / row `Adjust stock` (UX Phase 14, 14a-1). One manual adjustment per model through the same
 * `adjustModelSaleStock` primitive as `adjustSaleStockNative`, returning each write's audit id so the
 * list's ONE Undo (`undoSaleStockNative`) takes ids only. Atomic: one bad row rolls the batch back.
 */
export const adjustSaleStockManyNative = mutation({
  returns: v.object({ results: v.array(v.object({ id: v.string(), auditId: v.string(), from: v.number(), to: v.number() })) }),
  args: {
    orgId: v.string(),
    adjustments: v.array(saleAdjustment),
    reason: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    /** One caller-minted audit id per adjustment, same order (deterministic ids for the Undo toast). */
    auditIds: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.adjustments.length);
    assertStrLen(a.reason, "reason", { max: 500 });
    if (a.adjustments.length === 0) throw new ConvexError("Nothing to adjust");
    if (a.auditIds.length !== a.adjustments.length) throw new ConvexError("One audit id per adjustment");
    if (new Set(a.adjustments.map((x) => x.id)).size !== a.adjustments.length) throw new ConvexError("Each model can appear once");
    if (new Set(a.auditIds).size !== a.auditIds.length) throw new ConvexError("Audit ids must be distinct");

    const results: { id: string; auditId: string; from: number; to: number }[] = [];
    for (const [i, adj] of a.adjustments.entries()) {
      if (adj.delta === 0 || !Number.isInteger(adj.delta)) throw new ConvexError("Adjustment must be a nonzero whole number");
      const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", adj.id)).first();
      if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Model not found");
      const r = await adjustModelSaleStock(ctx, { modelId: adj.id, orgId: a.orgId, delta: adj.delta, reason: a.reason, actor, now: a.now, auditId: a.auditIds[i] });
      results.push({ id: adj.id, auditId: a.auditIds[i], from: r.from, to: r.to });
    }
    return { results };
  },
});

interface UndoableSaleChange {
  model: Doc<"models">;
  from: number;
  to: number;
  auditId: string;
}

interface SaleStockAudit {
  from: number;
  to: number;
  serverSavedAt: number;
}

/** The forward row's `details.saleStock`, only for a MANUAL adjustment (no `projectId`) with all three numbers. */
function manualSaleStockAudit(details: unknown): SaleStockAudit | null {
  const s = (details as { saleStock?: Partial<SaleStockAudit> & { projectId?: string } } | undefined)?.saleStock;
  if (!s || s.projectId) return null;
  return typeof s.from === "number" && typeof s.to === "number" && typeof s.serverSavedAt === "number"
    ? { from: s.from, to: s.to, serverSavedAt: s.serverSavedAt }
    : null;
}

/**
 * Refuses a second Undo: the Undo's own audit row has the DETERMINISTIC id `${auditId}:undo`, so one `by_cuid`
 * lookup answers it (never a scan of recent history, which a busy model would outrun).
 */
async function assertNotAlreadyUndone(ctx: MutationCtx, orgId: string, auditId: string): Promise<void> {
  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", `${auditId}:undo`)).first();
  if (marker && marker.organizationId === orgId) throw new ConvexError("This stock change was already undone");
}

/** The model (org-checked), whose pool is still exactly what the forward adjustment left. */
async function requireUntouchedPool(ctx: MutationCtx, orgId: string, modelId: string, expectedPool: number): Promise<Doc<"models">> {
  const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
  if (!model || model.organizationId !== orgId) throw new ConvexError("Model not found");
  if ((model.saleStockQuantity ?? 0) !== expectedPool) throw new ConvexError(`${model.name}'s stock has changed since: it can't be undone`);
  return model;
}

/** One forward audit row proven undoable by `actorUserId`: org, author, window, first undo, pool untouched. */
async function loadUndoableSaleChange(
  ctx: MutationCtx,
  a: { orgId: string; auditId: string; actorUserId: string; serverNow: number },
): Promise<UndoableSaleChange> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  const sale = row && row.organizationId === a.orgId && row.entityType === "model" ? manualSaleStockAudit(row.details) : null;
  if (!row || !sale) throw new ConvexError("This stock change can't be undone");
  if (row.userId !== a.actorUserId) throw new ConvexError("Only the person who made this change can undo it");
  assertWithinUndoWindow(sale.serverSavedAt, a.serverNow, "change");
  await assertNotAlreadyUndone(ctx, a.orgId, a.auditId);
  const model = await requireUntouchedPool(ctx, a.orgId, row.entityId, sale.to);
  return { model, from: sale.from, to: sale.to, auditId: a.auditId };
}

/**
 * The exact Undo of `adjustSaleStockManyNative` (ids only). Reads each forward audit row
 * (`details.saleStock {from, to, serverSavedAt}`) and refuses the WHOLE batch, changing nothing,
 * unless for every row: it is a manual adjustment, by the caller, inside the server-clock window,
 * not already undone, and the model's pool is still exactly `to` (no sale, restock or other
 * adjustment since). Restores `from` and appends an UNDO audit row per model.
 */
export const undoSaleStockNative = mutation({
  returns: v.object({ restored: v.number() }),
  args: { orgId: v.string(), auditIds: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "model");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.auditIds.length);
    if (a.auditIds.length === 0) throw new ConvexError("Nothing to undo");
    const serverNow = Date.now();

    const plan: UndoableSaleChange[] = [];
    for (const auditId of new Set(a.auditIds)) {
      plan.push(await loadUndoableSaleChange(ctx, { orgId: a.orgId, auditId, actorUserId: actor.userId, serverNow }));
    }

    for (const p of plan) {
      await ctx.db.patch(p.model._id, { saleStockQuantity: p.from, updatedAt: a.now });
      await writeActivityLog(ctx, {
        id: `${p.auditId}:undo`,
        organizationId: a.orgId,
        action: "UNDO",
        entityType: "model",
        entityId: p.model.id,
        entityName: p.model.name,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Undid a sale stock change on ${p.model.name} (${p.to} -> ${p.from})`,
        details: { undoOf: p.auditId, saleStock: { from: p.to, to: p.from } },
        createdAt: a.now,
      });
    }
    return { restored: plan.length };
  },
});

export const agentOps: AgentOpsAnnotations = {
  undoModelFieldEditsNative: { danger: "high", summary: "Exactly undo recent bulk rate edits or reorder-level changes by their audit ids (refuses if a field changed since)." },
  setReorderLevelsNative: { danger: "low", summary: "Set (or clear) the sale-stock reorder level of one or more models.", mcpTier: 2 },
  adjustSaleStockManyNative: { danger: "low", summary: "Adjust the new-stock sale pool of several models by a delta each (restock or correction).", mcpTier: 2 },
  undoSaleStockNative: { danger: "high", summary: "Exactly undo a recent manual sale-stock adjustment by its audit ids (refuses if the stock moved since)." },
  // Delete/archive tier (§9) — also cascade-DELETES every asset + bulkAsset of
  // this model (not just a soft archive of the model itself), so it's high on
  // both grounds.
  archiveNative: { danger: "high" },
  // A single model's stock count, reversible by an equal-and-opposite
  // adjustment — no asset/availability impact (that's `saleStock.ts`'s
  // FROM_RENTAL_STOCK primitives, which touch real assets and aren't
  // reachable through this mutation).
  adjustSaleStockNative: { danger: "low", summary: "Adjust a model's new-stock sale-stock pool by a delta (restock or correction).", mcpTier: 2 },
  // Rate metadata only (dailyRate/weeklyRate/monthlyRate/salePrice) — no
  // status/availability change at scale, so medium per the bulk-rate carve-out.
  bulkUpdateRatesNative: { danger: "medium" },
  createNative: { danger: "medium" },
  updateNative: { danger: "medium" },
};
