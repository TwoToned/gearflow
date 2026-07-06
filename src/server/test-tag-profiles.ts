"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { SEED_PROFILES } from "@/lib/test-profiles/seed-data";
import {
  getTestProfilesFromConvex,
  getAllTestProfilesFromConvex,
  getTestProfileFromConvex,
  type TestProfileRow,
} from "@/lib/test-profiles-read";
import {
  getTestTagAssetById,
  getFullTestProfileById,
} from "@/lib/test-tag-read";
import { getAssetById } from "@/lib/assets-read";
import { getModelById } from "@/lib/models-read";

// Test profiles are CONVEX-ONLY (Phase B write inversion): every
// create/update/duplicate/seed/delete writes the Convex `testProfiles` doc as the
// SOLE source of truth — no Prisma row, no mirror. The three inbound Prisma FKs
// (model.defaultTestProfileId, test_tag_asset.testProfileId,
// test_tag_record.testProfileId) were dropped in migration
// 20260617130000_drop_test_profile_fk_constraints, so those columns now hold a
// Convex testProfiles doc cuid. The `@@unique([organizationId, name])` DB
// constraint is re-implemented in app code below (Convex has no unique index).
// The visualChecks/electricalTests/thresholds Json fields pass straight through to
// Convex `v.any()`. testedBy / auth stays Prisma. See FEATUREDOCS/54 +
// docs/designs/convex-decommission-RUNBOOK.md.

const EQUIPMENT_CLASSES = [
  "CLASS_I",
  "CLASS_II",
  "CLASS_II_DOUBLE_INSULATED",
  "LEAD_CORD_ASSEMBLY",
] as const;
const APPLIANCE_TYPES = [
  "APPLIANCE",
  "CORD_SET",
  "EXTENSION_LEAD",
  "POWER_BOARD",
  "RCD_PORTABLE",
  "RCD_FIXED",
  "THREE_PHASE",
  "MICROWAVE",
  "OTHER",
] as const;

type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];
type ApplianceType = (typeof APPLIANCE_TYPES)[number];

const coerceEquipmentClass = (v?: string): EquipmentClass =>
  (EQUIPMENT_CLASSES as readonly string[]).includes(v ?? "")
    ? (v as EquipmentClass)
    : "CLASS_I";
const coerceApplianceType = (v?: string): ApplianceType =>
  (APPLIANCE_TYPES as readonly string[]).includes(v ?? "")
    ? (v as ApplianceType)
    : "APPLIANCE";

/** Shape the create/update return into the Prisma-row form consumers expect. */
function profileRow(args: {
  id: string;
  organizationId: string;
  name: string;
  equipmentClass: EquipmentClass;
  applianceType: ApplianceType;
  visualChecks: unknown;
  electricalTests: unknown;
  thresholds: unknown;
  requiresSubTests: boolean;
  defaultSubTestCount: number;
  subTestLabel: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}): TestProfileRow {
  return {
    id: args.id,
    organizationId: args.organizationId,
    name: args.name,
    equipmentClass: args.equipmentClass,
    applianceType: args.applianceType,
    visualChecks: args.visualChecks,
    electricalTests: args.electricalTests,
    thresholds: args.thresholds,
    requiresSubTests: args.requiresSubTests,
    defaultSubTestCount: args.defaultSubTestCount,
    subTestLabel: args.subTestLabel,
    isDefault: args.isDefault,
    isActive: args.isActive,
    createdAt: new Date(args.createdAt),
    updatedAt: new Date(args.updatedAt),
  };
}

export async function getTestProfiles(params?: {
  isActive?: boolean;
  equipmentClass?: string;
  applianceType?: string;
}) {
  const { organizationId } = await getOrgContext();

  // Convex-only read (Phase A). Filtering + orderBy replicated in
  // src/lib/test-profiles-read.ts. See FEATUREDOCS/54.
  const profiles = await getTestProfilesFromConvex(organizationId, params);

  return serialize(profiles);
}

export async function getTestProfile(id: string) {
  const { organizationId } = await getOrgContext();

  // Convex-only read (Phase A). getById is cuid-only; org-scope re-applied
  // in JS to match the Prisma { id, organizationId } scoping. See FEATUREDOCS/54.
  const profile = await getTestProfileFromConvex(id, organizationId);
  if (!profile) throw new Error("Test profile not found");

  return serialize(profile);
}

/**
 * Find the best matching profile for an asset based on cascade:
 * asset.testProfileId → model.defaultTestProfileId → default for class+type → any
 * active for class+type → null.
 *
 * Convex-only (Phase B): the old Prisma `include` cascade is re-implemented over
 * the Convex copies. The org-scope (testTagAsset `{ id, organizationId }`,
 * testProfile `{ id, organizationId }`) is re-applied in JS exactly as before.
 */
export async function resolveTestProfile(testTagAssetId: string) {
  const { organizationId } = await getOrgContext();

  const asset = await getTestTagAssetById(testTagAssetId);
  if (!asset || asset.organizationId !== organizationId) {
    throw new Error("Test tag asset not found");
  }

  // 1. Asset-level profile (testTagAsset.testProfileId). Re-apply the org scope:
  //    the old Prisma `testProfile: true` join could only resolve to a profile in
  //    the same org (org-cascade FK), so guard ownership here too.
  if (asset.testProfileId) {
    const own = await getTestProfileFromConvex(asset.testProfileId, organizationId);
    if (own) return serialize(own);
  }

  // 2. Model-level profile (testTagAsset.assetId → Asset.modelId → Model →
  //    defaultTestProfileId). The Prisma chain was asset.asset.model.defaultTestProfile.
  if (asset.assetId) {
    const linkedAsset = await getAssetById(asset.assetId);
    if (linkedAsset?.modelId) {
      const model = await getModelById(linkedAsset.modelId);
      if (model?.defaultTestProfileId) {
        const modelProfile = await getFullTestProfileById(model.defaultTestProfileId);
        if (modelProfile && modelProfile.organizationId === organizationId) {
          return serialize(modelProfile);
        }
      }
    }
  }

  // The remaining fallbacks are org-scoped findFirst over class+type. Read all org
  // profiles once (active + inactive) and replicate the Prisma `where` in JS
  // (findFirst → first match); each fallback filters `isActive` explicitly.
  const orgProfiles = await getAllTestProfilesFromConvex(organizationId);

  // 3. Default for class+type (isDefault: true, isActive: true).
  const defaultProfile = orgProfiles.find(
    (p) =>
      p.equipmentClass === asset.equipmentClass &&
      p.applianceType === asset.applianceType &&
      p.isDefault === true &&
      p.isActive === true,
  );
  if (defaultProfile) return serialize(defaultProfile);

  // 4. Any active profile for this class+type.
  const anyProfile = orgProfiles.find(
    (p) =>
      p.equipmentClass === asset.equipmentClass &&
      p.applianceType === asset.applianceType &&
      p.isActive === true,
  );

  return anyProfile ? serialize(anyProfile) : null;
}

export async function createTestProfile(data: {
  name: string;
  equipmentClass?: string;
  applianceType?: string;
  visualChecks: unknown[];
  electricalTests: unknown[];
  thresholds: Record<string, unknown>;
  requiresSubTests?: boolean;
  defaultSubTestCount?: number;
  subTestLabel?: string;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  // Re-implement @@unique([organizationId, name]): reject a duplicate name in org.
  const existing = await getAllTestProfilesFromConvex(organizationId);
  if (existing.some((p) => p.name === data.name)) {
    throw new Error(`A profile named "${data.name}" already exists`);
  }

  const id = createId();
  const now = Date.now();
  const equipmentClass = coerceEquipmentClass(data.equipmentClass);
  const applianceType = coerceApplianceType(data.applianceType);
  const requiresSubTests = data.requiresSubTests ?? false;
  const defaultSubTestCount = data.defaultSubTestCount ?? 1;
  const subTestLabel = data.subTestLabel ?? "Outlet";

  await (await getConvexClient()).mutation(api.testProfiles.create, {
    id,
    organizationId,
    name: data.name,
    equipmentClass,
    applianceType,
    visualChecks: data.visualChecks,
    electricalTests: data.electricalTests,
    thresholds: data.thresholds,
    requiresSubTests,
    defaultSubTestCount,
    subTestLabel,
    isDefault: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testProfile",
    entityId: id,
    entityName: data.name,
    summary: `Created test profile "${data.name}"`,
  });

  return serialize(
    profileRow({
      id,
      organizationId,
      name: data.name,
      equipmentClass,
      applianceType,
      visualChecks: data.visualChecks,
      electricalTests: data.electricalTests,
      thresholds: data.thresholds,
      requiresSubTests,
      defaultSubTestCount,
      subTestLabel,
      isDefault: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export async function updateTestProfile(id: string, data: {
  name?: string;
  equipmentClass?: string;
  applianceType?: string;
  visualChecks?: unknown[];
  electricalTests?: unknown[];
  thresholds?: Record<string, unknown>;
  requiresSubTests?: boolean;
  defaultSubTestCount?: number;
  subTestLabel?: string;
  isActive?: boolean;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "update");

  // Org-scope guard (replaces Prisma `where: { id, organizationId }`).
  const existing = await getTestProfileFromConvex(id, organizationId);
  if (!existing) throw new Error("Test profile not found");

  // Re-implement @@unique([organizationId, name]) on rename.
  if (data.name && data.name !== existing.name) {
    const all = await getAllTestProfilesFromConvex(organizationId);
    if (all.some((p) => p.id !== id && p.name === data.name)) {
      throw new Error(`A profile named "${data.name}" already exists`);
    }
  }

  const now = Date.now();
  const next = {
    name: data.name ?? existing.name,
    equipmentClass:
      data.equipmentClass !== undefined
        ? coerceEquipmentClass(data.equipmentClass)
        : (existing.equipmentClass as EquipmentClass),
    applianceType:
      data.applianceType !== undefined
        ? coerceApplianceType(data.applianceType)
        : (existing.applianceType as ApplianceType),
    visualChecks: data.visualChecks !== undefined ? data.visualChecks : existing.visualChecks,
    electricalTests:
      data.electricalTests !== undefined ? data.electricalTests : existing.electricalTests,
    thresholds: data.thresholds !== undefined ? data.thresholds : existing.thresholds,
    requiresSubTests:
      data.requiresSubTests !== undefined ? data.requiresSubTests : existing.requiresSubTests,
    defaultSubTestCount:
      data.defaultSubTestCount !== undefined
        ? data.defaultSubTestCount
        : existing.defaultSubTestCount,
    subTestLabel: data.subTestLabel !== undefined ? data.subTestLabel : existing.subTestLabel,
    isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
  };

  // Patch only the supplied fields (mirror the old conditional `data` spread).
  await (await getConvexClient()).mutation(api.testProfiles.update, {
    id,
    patch: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.equipmentClass !== undefined && { equipmentClass: next.equipmentClass }),
      ...(data.applianceType !== undefined && { applianceType: next.applianceType }),
      ...(data.visualChecks !== undefined && { visualChecks: data.visualChecks }),
      ...(data.electricalTests !== undefined && { electricalTests: data.electricalTests }),
      ...(data.thresholds !== undefined && { thresholds: data.thresholds }),
      ...(data.requiresSubTests !== undefined && { requiresSubTests: data.requiresSubTests }),
      ...(data.defaultSubTestCount !== undefined && {
        defaultSubTestCount: data.defaultSubTestCount,
      }),
      ...(data.subTestLabel !== undefined && { subTestLabel: data.subTestLabel }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      updatedAt: now,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "testProfile",
    entityId: id,
    entityName: next.name,
    summary: `Updated test profile "${next.name}"`,
  });

  return serialize(
    profileRow({
      id,
      organizationId,
      name: next.name,
      equipmentClass: next.equipmentClass,
      applianceType: next.applianceType,
      visualChecks: next.visualChecks,
      electricalTests: next.electricalTests,
      thresholds: next.thresholds,
      requiresSubTests: next.requiresSubTests,
      defaultSubTestCount: next.defaultSubTestCount,
      subTestLabel: next.subTestLabel,
      isDefault: existing.isDefault,
      isActive: next.isActive,
      createdAt: existing.createdAt ? existing.createdAt.getTime() : now,
      updatedAt: now,
    }),
  );
}

export async function duplicateTestProfile(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const source = await getTestProfileFromConvex(id, organizationId);
  if (!source) throw new Error("Test profile not found");

  // Find a unique name (replicates the old findFirst dedup loop).
  const all = await getAllTestProfilesFromConvex(organizationId);
  const names = new Set(all.map((p) => p.name));
  let copyName = `${source.name} (Copy)`;
  let counter = 2;
  while (names.has(copyName)) {
    copyName = `${source.name} (Copy ${counter})`;
    counter++;
  }

  const newId = createId();
  const now = Date.now();
  const equipmentClass = source.equipmentClass as EquipmentClass;
  const applianceType = source.applianceType as ApplianceType;

  await (await getConvexClient()).mutation(api.testProfiles.create, {
    id: newId,
    organizationId,
    name: copyName,
    equipmentClass,
    applianceType,
    visualChecks: source.visualChecks,
    electricalTests: source.electricalTests,
    thresholds: source.thresholds,
    requiresSubTests: source.requiresSubTests,
    defaultSubTestCount: source.defaultSubTestCount,
    subTestLabel: source.subTestLabel,
    isDefault: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testProfile",
    entityId: newId,
    entityName: copyName,
    summary: `Duplicated test profile "${source.name}" as "${copyName}"`,
  });

  return serialize(
    profileRow({
      id: newId,
      organizationId,
      name: copyName,
      equipmentClass,
      applianceType,
      visualChecks: source.visualChecks,
      electricalTests: source.electricalTests,
      thresholds: source.thresholds,
      requiresSubTests: source.requiresSubTests,
      defaultSubTestCount: source.defaultSubTestCount,
      subTestLabel: source.subTestLabel,
      isDefault: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

/**
 * Seed default AS/NZS 3760 profiles for the org. Idempotent — skips profiles
 * that already exist by name.
 */
export async function seedDefaultProfiles() {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const existing = await getAllTestProfilesFromConvex(organizationId);
  const existingNames = new Set(existing.map((p) => p.name));

  const toCreate = SEED_PROFILES.filter((p) => !existingNames.has(p.name));

  if (toCreate.length === 0) {
    return { created: 0, message: "All default profiles already exist" };
  }

  const convex = await getConvexClient();
  const now = Date.now();
  // Independent default profiles — create them all concurrently (was sequential).
  // Promise.all preserves order, so `created` keeps the toCreate order.
  const created: TestProfileRow[] = await Promise.all(
    toCreate.map(async (p) => {
      const id = createId();
      await convex.mutation(api.testProfiles.create, {
        id,
        organizationId,
        name: p.name,
        equipmentClass: p.equipmentClass,
        applianceType: p.applianceType,
        visualChecks: p.visualChecks,
        electricalTests: p.electricalTests,
        thresholds: p.thresholds,
        requiresSubTests: p.requiresSubTests,
        defaultSubTestCount: p.defaultSubTestCount,
        subTestLabel: p.subTestLabel,
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return profileRow({
        id,
        organizationId,
        name: p.name,
        equipmentClass: p.equipmentClass,
        applianceType: p.applianceType,
        visualChecks: p.visualChecks,
        electricalTests: p.electricalTests,
        thresholds: p.thresholds,
        requiresSubTests: p.requiresSubTests,
        defaultSubTestCount: p.defaultSubTestCount,
        subTestLabel: p.subTestLabel,
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }),
  );

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testProfile",
    entityId: created[0]?.id || "",
    entityName: `${created.length} default profiles`,
    summary: `Seeded ${created.length} AS/NZS 3760 default test profiles`,
  });

  return serialize({ created: created.length, profiles: created });
}

export async function deleteTestProfile(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "delete");

  // Org-scope guard (replaces Prisma `where: { id, organizationId }`).
  const existing = await getTestProfileFromConvex(id, organizationId);
  if (!existing) throw new Error("Test profile not found");

  // Replicate the Prisma `_count` in-use check. The inbound FKs were dropped, so
  // count referencing rows by reading the Convex copies (testTagAssets +
  // testTagRecords are org-scoped Convex tables; models is the asset-model table).
  const convex = await getConvexClient();
  const [ttAssets, ttRecords, models] = await Promise.all([
    convex.query(api.testTagAssets.list, { orgId: organizationId }) as Promise<
      Array<{ testProfileId?: string | null }>
    >,
    convex.query(api.testTagRecords.list, { orgId: organizationId }) as Promise<
      Array<{ testProfileId?: string | null }>
    >,
    convex.query(api.models.list, { orgId: organizationId }) as Promise<
      Array<{ defaultTestProfileId?: string | null }>
    >,
  ]);
  const assetUses = ttAssets.filter((a) => a.testProfileId === id).length;
  const recordUses = ttRecords.filter((r) => r.testProfileId === id).length;
  const modelUses = models.filter((m) => m.defaultTestProfileId === id).length;

  // If in use, just deactivate (preserve the soft-deactivate branch).
  const inUse = assetUses + recordUses + modelUses > 0;
  if (inUse) {
    const now = Date.now();
    await convex.mutation(api.testProfiles.update, {
      id,
      patch: { isActive: false, updatedAt: now },
    });

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "testProfile",
      entityId: id,
      entityName: existing.name,
      summary: `Deactivated test profile "${existing.name}" (in use by ${assetUses} assets, ${recordUses} records)`,
    });

    return serialize(
      profileRow({
        id,
        organizationId,
        name: existing.name,
        equipmentClass: existing.equipmentClass as EquipmentClass,
        applianceType: existing.applianceType as ApplianceType,
        visualChecks: existing.visualChecks,
        electricalTests: existing.electricalTests,
        thresholds: existing.thresholds,
        requiresSubTests: existing.requiresSubTests,
        defaultSubTestCount: existing.defaultSubTestCount,
        subTestLabel: existing.subTestLabel,
        isDefault: existing.isDefault,
        isActive: false,
        createdAt: existing.createdAt ? existing.createdAt.getTime() : now,
        updatedAt: now,
      }),
    );
  }

  await convex.mutation(api.testProfiles.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "testProfile",
    entityId: id,
    entityName: existing.name,
    summary: `Deleted test profile "${existing.name}"`,
  });

  return { id };
}
