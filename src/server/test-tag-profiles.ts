"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { SEED_PROFILES } from "@/lib/test-profiles/seed-data";

export async function getTestProfiles(params?: {
  isActive?: boolean;
  equipmentClass?: string;
  applianceType?: string;
}) {
  const { organizationId } = await getOrgContext();
  const { isActive = true, equipmentClass, applianceType } = params || {};

  const profiles = await prisma.testProfile.findMany({
    where: {
      organizationId,
      ...(isActive !== undefined && { isActive }),
      ...(equipmentClass && { equipmentClass: equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY" }),
      ...(applianceType && { applianceType: applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "MICROWAVE" | "OTHER" }),
    },
    orderBy: { name: "asc" },
  });

  return serialize(profiles);
}

export async function getTestProfile(id: string) {
  const { organizationId } = await getOrgContext();

  const profile = await prisma.testProfile.findFirst({
    where: { id, organizationId },
  });
  if (!profile) throw new Error("Test profile not found");

  return serialize(profile);
}

/**
 * Find the best matching profile for an asset based on cascade:
 * asset.testProfileId → model.defaultTestProfileId → default for class+type → null
 */
export async function resolveTestProfile(testTagAssetId: string) {
  const { organizationId } = await getOrgContext();

  const asset = await prisma.testTagAsset.findFirst({
    where: { id: testTagAssetId, organizationId },
    include: {
      testProfile: true,
      asset: {
        include: {
          model: {
            include: {
              defaultTestProfile: true,
            },
          },
        },
      },
    },
  });

  if (!asset) throw new Error("Test tag asset not found");

  // 1. Asset-level profile
  if (asset.testProfile) return serialize(asset.testProfile);

  // 2. Model-level profile
  if (asset.asset?.model?.defaultTestProfile) {
    return serialize(asset.asset.model.defaultTestProfile);
  }

  // 3. Default for class+type
  const defaultProfile = await prisma.testProfile.findFirst({
    where: {
      organizationId,
      equipmentClass: asset.equipmentClass,
      applianceType: asset.applianceType,
      isDefault: true,
      isActive: true,
    },
  });
  if (defaultProfile) return serialize(defaultProfile);

  // 4. Any active profile for this class+type
  const anyProfile = await prisma.testProfile.findFirst({
    where: {
      organizationId,
      equipmentClass: asset.equipmentClass,
      applianceType: asset.applianceType,
      isActive: true,
    },
  });

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

  // Check for duplicate name
  const existing = await prisma.testProfile.findFirst({
    where: { organizationId, name: data.name },
  });
  if (existing) throw new Error(`A profile named "${data.name}" already exists`);

  const profile = await prisma.testProfile.create({
    data: {
      organizationId,
      name: data.name,
      equipmentClass: (data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
      applianceType: (data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "MICROWAVE" | "OTHER") || "APPLIANCE",
      visualChecks: data.visualChecks as object,
      electricalTests: data.electricalTests as object,
      thresholds: data.thresholds as object,
      requiresSubTests: data.requiresSubTests ?? false,
      defaultSubTestCount: data.defaultSubTestCount ?? 1,
      subTestLabel: data.subTestLabel ?? "Outlet",
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testProfile",
    entityId: profile.id,
    entityName: profile.name,
    summary: `Created test profile "${profile.name}"`,
  });

  return serialize(profile);
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

  const existing = await prisma.testProfile.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Test profile not found");

  // Check for duplicate name
  if (data.name && data.name !== existing.name) {
    const dup = await prisma.testProfile.findFirst({
      where: { organizationId, name: data.name, id: { not: id } },
    });
    if (dup) throw new Error(`A profile named "${data.name}" already exists`);
  }

  const profile = await prisma.testProfile.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.equipmentClass !== undefined && { equipmentClass: data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY" }),
      ...(data.applianceType !== undefined && { applianceType: data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "MICROWAVE" | "OTHER" }),
      ...(data.visualChecks !== undefined && { visualChecks: data.visualChecks as object }),
      ...(data.electricalTests !== undefined && { electricalTests: data.electricalTests as object }),
      ...(data.thresholds !== undefined && { thresholds: data.thresholds as object }),
      ...(data.requiresSubTests !== undefined && { requiresSubTests: data.requiresSubTests }),
      ...(data.defaultSubTestCount !== undefined && { defaultSubTestCount: data.defaultSubTestCount }),
      ...(data.subTestLabel !== undefined && { subTestLabel: data.subTestLabel }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "testProfile",
    entityId: profile.id,
    entityName: profile.name,
    summary: `Updated test profile "${profile.name}"`,
  });

  return serialize(profile);
}

export async function duplicateTestProfile(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const source = await prisma.testProfile.findFirst({
    where: { id, organizationId },
  });
  if (!source) throw new Error("Test profile not found");

  // Find a unique name
  let copyName = `${source.name} (Copy)`;
  let counter = 2;
  while (await prisma.testProfile.findFirst({ where: { organizationId, name: copyName } })) {
    copyName = `${source.name} (Copy ${counter})`;
    counter++;
  }

  const profile = await prisma.testProfile.create({
    data: {
      organizationId,
      name: copyName,
      equipmentClass: source.equipmentClass,
      applianceType: source.applianceType,
      visualChecks: source.visualChecks as object,
      electricalTests: source.electricalTests as object,
      thresholds: source.thresholds as object,
      requiresSubTests: source.requiresSubTests,
      defaultSubTestCount: source.defaultSubTestCount,
      subTestLabel: source.subTestLabel,
      isDefault: false,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testProfile",
    entityId: profile.id,
    entityName: profile.name,
    summary: `Duplicated test profile "${source.name}" as "${profile.name}"`,
  });

  return serialize(profile);
}

/**
 * Seed default AS/NZS 3760 profiles for the org. Idempotent — skips profiles
 * that already exist by name.
 */
export async function seedDefaultProfiles() {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const existingNames = new Set(
    (await prisma.testProfile.findMany({
      where: { organizationId },
      select: { name: true },
    })).map(p => p.name)
  );

  const toCreate = SEED_PROFILES.filter(p => !existingNames.has(p.name));

  if (toCreate.length === 0) {
    return { created: 0, message: "All default profiles already exist" };
  }

  const created = await prisma.$transaction(
    toCreate.map(p =>
      prisma.testProfile.create({
        data: {
          organizationId,
          name: p.name,
          equipmentClass: p.equipmentClass,
          applianceType: p.applianceType,
          visualChecks: p.visualChecks as object,
          electricalTests: p.electricalTests as object,
          thresholds: p.thresholds as object,
          requiresSubTests: p.requiresSubTests,
          defaultSubTestCount: p.defaultSubTestCount,
          subTestLabel: p.subTestLabel,
          isDefault: true,
        },
      })
    )
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

  const existing = await prisma.testProfile.findFirst({
    where: { id, organizationId },
    include: {
      _count: { select: { testTagAssets: true, testTagRecords: true, models: true } },
    },
  });
  if (!existing) throw new Error("Test profile not found");

  // If in use, just deactivate
  const inUse = (existing._count.testTagAssets + existing._count.testTagRecords + existing._count.models) > 0;
  if (inUse) {
    const profile = await prisma.testProfile.update({
      where: { id },
      data: { isActive: false },
    });

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "testProfile",
      entityId: id,
      entityName: existing.name,
      summary: `Deactivated test profile "${existing.name}" (in use by ${existing._count.testTagAssets} assets, ${existing._count.testTagRecords} records)`,
    });

    return serialize(profile);
  }

  await prisma.testProfile.delete({ where: { id } });

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
