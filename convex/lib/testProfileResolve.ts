/**
 * The ONE test-profile cascade for a test & tag asset (extracted from
 * `testProfiles.resolveForAsset`, Phase 16): asset.testProfileId → the linked
 * inventory asset's model `defaultTestProfileId` → the org default for the asset's
 * class + type → any active profile for class + type → null. Every hop uses a GLOBAL
 * `by_cuid` index and is org re-checked here. Shared by `resolveForAsset`, the Scan
 * page's `scanLookup.testCard`, and `testTagRecordsWrites.createNative` (which
 * enforces the resolved profile's enabled tests, D51) — so the profile a tester sees
 * is the profile the server holds them to.
 */
import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";

type Ctx = { db: DatabaseReader };

/** Profiles scanned for the class + type fallback (orgs have a handful). */
const MAX_ORG_PROFILES = 200;

/** A profile by id, only if it belongs to `orgId` (`by_cuid` is global). */
export async function orgTestProfile(ctx: Ctx, orgId: string, id: string): Promise<Doc<"testProfiles"> | null> {
  const p = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return p && p.organizationId === orgId ? p : null;
}

async function modelDefaultProfile(ctx: Ctx, orgId: string, inventoryAssetId: string): Promise<Doc<"testProfiles"> | null> {
  const linked = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", inventoryAssetId)).first();
  if (!linked || linked.organizationId !== orgId || !linked.modelId) return null;
  const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", linked.modelId)).first();
  if (!model || model.organizationId !== orgId || !model.defaultTestProfileId) return null;
  return await orgTestProfile(ctx, orgId, model.defaultTestProfileId);
}

/** The cascade for an already org-checked T&T asset. */
export async function resolveTestProfileForAsset(
  ctx: Ctx,
  orgId: string,
  asset: Doc<"testTagAssets">,
): Promise<Doc<"testProfiles"> | null> {
  if (asset.testProfileId) {
    const own = await orgTestProfile(ctx, orgId, asset.testProfileId);
    if (own) return own;
  }
  if (asset.assetId) {
    const fromModel = await modelDefaultProfile(ctx, orgId, asset.assetId);
    if (fromModel) return fromModel;
  }
  // A small admin-configured catalog (12 seeded AS/NZS 3760 profiles); bounded rather
  // than collected, so this shared cascade needs no R-8.3.3 exception.
  const orgProfiles = await ctx.db.query("testProfiles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(MAX_ORG_PROFILES);
  const matches = (p: Doc<"testProfiles">) => p.equipmentClass === asset.equipmentClass && p.applianceType === asset.applianceType;
  return (
    orgProfiles.find((p) => matches(p) && p.isDefault === true && p.isActive === true) ??
    orgProfiles.find((p) => matches(p) && p.isActive === true) ??
    null
  );
}
