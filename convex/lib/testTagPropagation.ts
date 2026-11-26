/**
 * Carries a model edit's Test & tag defaults to the T&T items that FOLLOW the model (UX Phase 14, 14b-5, D77 review).
 *
 * An item's class, type and interval are materialised on it when it is registered, so a model edit has to decide which items
 * still follow the model. The rule: an item field is rewritten ONLY when it still equals the model's PREVIOUS effective value
 * (the value the model would have given it before this edit), meaning the item was following the model. An item whose value
 * differs was set on its own (an Edit on the item, or a different test regime) and is left alone. The effective value is the
 * one resolver's answer (`categoryTestDefaults.ts`) with the registration fallbacks (class `CLASS_I`, type `APPLIANCE`, the
 * org's default interval), exactly what registration would have stored.
 */
import type { MutationCtx } from "../_generated/server";
import { effectiveTestDefaults, type ModelTestDefaults } from "./categoryTestDefaults";
import { categoryOfModel } from "./categoryTestDefaultsLoad";
import { orgDefaultIntervalMonths } from "./testtagBackfill";

type ModelSide = ModelTestDefaults & { defaultApplianceType?: string | null; categoryId?: string | null };

export interface FollowedValues {
  equipmentClass: string;
  applianceType: string;
  testIntervalMonths: number;
}

/** What a model gives an item registered under it right now (the registration fallbacks applied). */
export async function followedValues(ctx: MutationCtx, orgId: string, model: ModelSide, orgDefaultMonths: number): Promise<FollowedValues> {
  const eff = effectiveTestDefaults(model, await categoryOfModel(ctx, orgId, model));
  return {
    equipmentClass: eff.equipmentClass ?? "CLASS_I",
    applianceType: model.defaultApplianceType || "APPLIANCE",
    testIntervalMonths: eff.intervalMonths ?? orgDefaultMonths,
  };
}

/** The fields to rewrite on one item: those that still equal the previous value and differ from the new one. */
export function followingPatch(item: FollowedValues, prev: FollowedValues, next: FollowedValues): Partial<FollowedValues> {
  const patch: Partial<FollowedValues> = {};
  if (item.equipmentClass === prev.equipmentClass && prev.equipmentClass !== next.equipmentClass) patch.equipmentClass = next.equipmentClass;
  if (item.applianceType === prev.applianceType && prev.applianceType !== next.applianceType) patch.applianceType = next.applianceType;
  if (item.testIntervalMonths === prev.testIntervalMonths && prev.testIntervalMonths !== next.testIntervalMonths) patch.testIntervalMonths = next.testIntervalMonths;
  return patch;
}

export async function propagateModelTestDefaults(
  ctx: MutationCtx,
  a: { orgId: string; modelId: string; prev: ModelSide; next: ModelSide; now: number },
): Promise<void> {
  const orgDefault = await orgDefaultIntervalMonths(ctx, a.orgId);
  const prev = await followedValues(ctx, a.orgId, a.prev, orgDefault);
  const next = await followedValues(ctx, a.orgId, a.next, orgDefault);
  if (prev.equipmentClass === next.equipmentClass && prev.applianceType === next.applianceType && prev.testIntervalMonths === next.testIntervalMonths) return;

  const assets = (await ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", a.modelId)).collect()).filter((x) => x.organizationId === a.orgId && x.isActive !== false);
  for (const asset of assets) {
    const rows = (await ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", asset.id)).collect()).filter((tt) => tt.organizationId === a.orgId && tt.isActive !== false);
    for (const tt of rows) {
      const patch = followingPatch({ equipmentClass: tt.equipmentClass ?? "CLASS_I", applianceType: tt.applianceType ?? "APPLIANCE", testIntervalMonths: tt.testIntervalMonths ?? orgDefault }, prev, next);
      if (Object.keys(patch).length > 0) await ctx.db.patch(tt._id, { ...patch, updatedAt: a.now } as never);
    }
  }
}
