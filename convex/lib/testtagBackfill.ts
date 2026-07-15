import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";

/**
 * Convex-native port of `src/server/test-tag-assets.ts#backfillTestTagAssets`.
 *
 * Auto-registers Test & Tag records for serialized assets whose model requires
 * T&T, retires orphaned/dangling T&T rows, and is idempotent (find-or-create by
 * cuid). Runs INSIDE a browser-direct mutation (model create/update, asset
 * create/backfill) so the whole reconciliation is one atomic transaction — the
 * old server path made N sequential Convex round-trips.
 *
 * Convex mutations tolerate `createId()` (cuid2) + `Date.now()`, but callers pass
 * `now` for a single stamp across the batch (see convex/lib/audit.ts). Reads the
 * org's default T&T interval from the `orgSettings` JSON blob (same source as the
 * server `getOrgTestTagSettings`). Every row is org-scoped via `by_organizationId`;
 * no global-index fetch, so no cross-tenant leak surface here.
 */

const EQUIPMENT_CLASSES = ["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"] as const;
const APPLIANCE_TYPES = [
  "APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD",
  "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "MICROWAVE", "OTHER",
] as const;
type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];
type ApplianceType = (typeof APPLIANCE_TYPES)[number];

/** Default T&T interval (months) from the org settings blob; falls back to 3. */
export async function orgDefaultIntervalMonths(ctx: MutationCtx, organizationId: string): Promise<number> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!row?.settings) return 3;
  try {
    const blob = JSON.parse(row.settings) as { testTag?: { defaultIntervalMonths?: number } };
    return blob.testTag?.defaultIntervalMonths || 3;
  } catch {
    return 3;
  }
}

export async function backfillTestTagAssetsCore(
  ctx: MutationCtx,
  organizationId: string,
  now: number,
): Promise<{ created: number; retired: number }> {
  const [allOrgAssets, allModels, allTTAssets] = await Promise.all([
    ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).collect(),
    ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).collect(),
    ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).collect(),
  ]);

  const modelMap = new Map(allModels.map((m) => [m.id, m]));
  const assetById = new Map(allOrgAssets.map((a) => [a.id, a]));

  // T&T rows already linked to a serialized asset (active only).
  const linkedAssetIds = new Set(
    allTTAssets.filter((t) => t.isActive !== false && t.assetId).map((t) => t.assetId as string),
  );

  // Assets needing T&T with no active linked entry.
  const unlinkedAssets = allOrgAssets
    .filter((a) => a.isActive !== false && modelMap.get(a.modelId)?.requiresTestAndTag === true && !linkedAssetIds.has(a.id))
    .map((a) => ({ asset: a, model: modelMap.get(a.modelId)! }));

  // Orphaned: active T&T entries whose linked asset is gone or inactive.
  const orphaned = allTTAssets.filter((t) => {
    if (t.isActive === false || !t.assetId) return false;
    const asset = assetById.get(t.assetId);
    return !asset || asset.isActive === false;
  });

  // Dangling: active auto-created T&T entries with no asset/bulk link whose
  // testTagId doesn't match any existing asset tag.
  const existingAssetTags = new Set(allOrgAssets.map((a) => a.assetTag));
  const dangling = allTTAssets.filter(
    (t) => t.isActive !== false && !t.assetId && !t.bulkAssetId && !existingAssetTags.has(t.testTagId),
  );

  const retireIds = [...new Set([...orphaned.map((o) => o.id), ...dangling.map((d) => d.id)])];
  let retired = 0;
  for (const id of retireIds) {
    const doc = allTTAssets.find((t) => t.id === id);
    if (!doc || doc.organizationId !== organizationId) continue;
    await ctx.db.patch(doc._id, { status: "RETIRED", isActive: false, updatedAt: now });
    retired++;
  }

  if (unlinkedAssets.length === 0) return { created: 0, retired };

  const defaultIntervalMonths = await orgDefaultIntervalMonths(ctx, organizationId);
  let created = 0;
  for (const { asset, model } of unlinkedAssets) {
    const intervalMonths = model.testAndTagIntervalDays
      ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
      : defaultIntervalMonths;
    const equipmentClass = (EQUIPMENT_CLASSES.includes(model.defaultEquipmentClass as EquipmentClass)
      ? model.defaultEquipmentClass
      : "CLASS_I") as EquipmentClass;
    const applianceType = (APPLIANCE_TYPES.includes(model.defaultApplianceType as ApplianceType)
      ? model.defaultApplianceType
      : "APPLIANCE") as ApplianceType;
    await ctx.db.insert("testTagAssets", {
      id: createId(),
      organizationId,
      testTagId: asset.assetTag,
      description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${asset.assetTag})`,
      equipmentClass,
      applianceType,
      ...(model.manufacturer && { make: model.manufacturer }),
      ...(model.modelNumber && { modelName: model.modelNumber }),
      ...(asset.serialNumber && { serialNumber: asset.serialNumber }),
      testIntervalMonths: intervalMonths,
      ...(model.defaultTestProfileId && { testProfileId: model.defaultTestProfileId }),
      status: "NOT_YET_TESTED" as const,
      assetId: asset.id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }

  return { created, retired };
}
