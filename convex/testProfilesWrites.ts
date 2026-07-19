import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";

/**
 * Native TEST-PROFILE write mutations (Phase 3 browser-direct — replaces the
 * test-tag-profiles.ts server actions). Test profiles are Convex-only config
 * (the inbound FKs were dropped; class/type/checks are plain data). Each mutation
 * runs the 4 guards (writes-enabled + rate limit + RBAC `testTag:*` + resolveActor)
 * + per-row org re-check + atomic audit. The `@@unique([organizationId, name])`
 * DB constraint is re-implemented in-mutation (Convex has no unique index). Delete
 * soft-deactivates when the profile is still referenced (asset/record/model).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const EQUIPMENT_CLASSES = ["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"] as const;
const APPLIANCE_TYPES = ["APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD", "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "MICROWAVE", "OTHER"] as const;
type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];
type ApplianceType = (typeof APPLIANCE_TYPES)[number];
const coerceClass = (v?: string): EquipmentClass => ((EQUIPMENT_CLASSES as readonly string[]).includes(v ?? "") ? (v as EquipmentClass) : "CLASS_I");
const coerceType = (v?: string): ApplianceType => ((APPLIANCE_TYPES as readonly string[]).includes(v ?? "") ? (v as ApplianceType) : "APPLIANCE");

async function log(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string }) {
  await writeActivityLog(ctx, { id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "testProfile", entityId: a.id, entityName: a.name, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, createdAt: a.now });
}

/** Org profiles for the org (unique-name checks + fallbacks). */
const orgProfiles = (ctx: MutationCtx, orgId: string) =>
  ctx.db.query("testProfiles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();

async function orgProfile(ctx: MutationCtx, orgId: string, id: string) {
  const p = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return p && p.organizationId === orgId ? p : null;
}

const profileBody = {
  visualChecks: v.any(),
  electricalTests: v.any(),
  thresholds: v.any(),
  requiresSubTests: v.optional(v.boolean()),
  defaultSubTestCount: v.optional(v.number()),
  subTestLabel: v.optional(v.string()),
};

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), name: v.string(), equipmentClass: v.optional(v.string()), applianceType: v.optional(v.string()), ...profileBody, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testProfile");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);
    if (!a.name || a.name.trim().length < 1) throw new ConvexError("Name is required");

    if ((await orgProfiles(ctx, a.orgId)).some((p) => p.name === a.name)) throw new ConvexError(`A profile named "${a.name}" already exists`);
    const dup = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Test profile already exists");

    await ctx.db.insert("testProfiles", {
      id: a.id, organizationId: a.orgId, name: a.name,
      equipmentClass: coerceClass(a.equipmentClass), applianceType: coerceType(a.applianceType),
      visualChecks: a.visualChecks, electricalTests: a.electricalTests, thresholds: a.thresholds,
      requiresSubTests: a.requiresSubTests ?? false, defaultSubTestCount: a.defaultSubTestCount ?? 1, subTestLabel: a.subTestLabel ?? "Outlet",
      isDefault: false, isActive: true, createdAt: a.now, updatedAt: a.now,
    });
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created test profile "${a.name}"` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(), orgId: v.string(),
    name: v.optional(v.string()), equipmentClass: v.optional(v.string()), applianceType: v.optional(v.string()),
    visualChecks: v.optional(v.any()), electricalTests: v.optional(v.any()), thresholds: v.optional(v.any()),
    requiresSubTests: v.optional(v.boolean()), defaultSubTestCount: v.optional(v.number()), subTestLabel: v.optional(v.string()), isActive: v.optional(v.boolean()),
    now: v.number(), actor: actorValidator, auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testProfile");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await orgProfile(ctx, a.orgId, a.id);
    if (!doc) throw new ConvexError("Test profile not found");
    if (a.name && a.name !== doc.name && (await orgProfiles(ctx, a.orgId)).some((p) => p.id !== a.id && p.name === a.name)) {
      throw new ConvexError(`A profile named "${a.name}" already exists`);
    }

    // Patch only supplied fields (mirror the conditional spread).
    const patch: Record<string, unknown> = { updatedAt: a.now };
    if (a.name !== undefined) patch.name = a.name;
    if (a.equipmentClass !== undefined) patch.equipmentClass = coerceClass(a.equipmentClass);
    if (a.applianceType !== undefined) patch.applianceType = coerceType(a.applianceType);
    if (a.visualChecks !== undefined) patch.visualChecks = a.visualChecks;
    if (a.electricalTests !== undefined) patch.electricalTests = a.electricalTests;
    if (a.thresholds !== undefined) patch.thresholds = a.thresholds;
    if (a.requiresSubTests !== undefined) patch.requiresSubTests = a.requiresSubTests;
    if (a.defaultSubTestCount !== undefined) patch.defaultSubTestCount = a.defaultSubTestCount;
    if (a.subTestLabel !== undefined) patch.subTestLabel = a.subTestLabel;
    if (a.isActive !== undefined) patch.isActive = a.isActive;

    await ctx.db.patch(doc._id, patch);
    const name = a.name ?? doc.name;
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name, summary: `Updated test profile "${name}"` });
    return { id: a.id };
  },
});

export const duplicateNative = mutation({
  returns: v.object({ id: v.string(), name: v.string() }),
  args: { id: v.string(), newId: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testProfile");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);

    const source = await orgProfile(ctx, a.orgId, a.id);
    if (!source) throw new ConvexError("Test profile not found");

    const dupId = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", a.newId)).first();
    if (dupId) throw new ConvexError("Test profile already exists");

    const names = new Set((await orgProfiles(ctx, a.orgId)).map((p) => p.name));
    let copyName = `${source.name} (Copy)`;
    let counter = 2;
    while (names.has(copyName)) copyName = `${source.name} (Copy ${counter++})`;

    await ctx.db.insert("testProfiles", {
      id: a.newId, organizationId: a.orgId, name: copyName,
      equipmentClass: source.equipmentClass, applianceType: source.applianceType,
      visualChecks: source.visualChecks, electricalTests: source.electricalTests, thresholds: source.thresholds,
      requiresSubTests: source.requiresSubTests, defaultSubTestCount: source.defaultSubTestCount, subTestLabel: source.subTestLabel,
      isDefault: false, isActive: true, createdAt: a.now, updatedAt: a.now,
    });
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.newId, name: copyName, summary: `Duplicated test profile "${source.name}" as "${copyName}"` });
    return { id: a.newId, name: copyName };
  },
});

export const seedDefaultsNative = mutation({
  returns: v.object({ created: v.number() }),
  args: {
    orgId: v.string(),
    profiles: v.array(v.object({
      id: v.string(), name: v.string(),
      equipmentClass: enums.EquipmentClass, applianceType: enums.ApplianceType,
      visualChecks: v.any(), electricalTests: v.any(), thresholds: v.any(),
      requiresSubTests: v.boolean(), defaultSubTestCount: v.number(), subTestLabel: v.string(),
    })),
    now: v.number(), actor: actorValidator, auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testProfile");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);

    // Idempotent — skip names that already exist (server-side dedup). `seen` also
    // catches DUPLICATE names WITHIN this batch (else both would insert). id-collision
    // guarded per row (by_cuid is non-unique → a reused id breaks .unique()/.first()).
    const seen = new Set((await orgProfiles(ctx, a.orgId)).map((p) => p.name));
    let firstId = "";
    let created = 0;
    for (const p of a.profiles) {
      if (seen.has(p.name)) continue;
      const dupId = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", p.id)).first();
      if (dupId) continue;
      seen.add(p.name);
      await ctx.db.insert("testProfiles", {
        id: p.id, organizationId: a.orgId, name: p.name,
        equipmentClass: p.equipmentClass, applianceType: p.applianceType,
        visualChecks: p.visualChecks, electricalTests: p.electricalTests, thresholds: p.thresholds,
        requiresSubTests: p.requiresSubTests, defaultSubTestCount: p.defaultSubTestCount, subTestLabel: p.subTestLabel,
        isDefault: true, isActive: true, createdAt: a.now, updatedAt: a.now,
      });
      if (!firstId) firstId = p.id;
      created++;
    }
    if (created > 0) {
      await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: firstId, name: `${created} default profiles`, summary: `Seeded ${created} AS/NZS 3760 default test profiles` });
    }
    return { created };
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string(), deactivated: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testProfile");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await orgProfile(ctx, a.orgId, a.id);
    if (!doc) throw new ConvexError("Test profile not found");

    // In-use check (the inbound FKs were dropped — count referencing rows, org-scoped).
    const assetUses = (await ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect()).filter((x) => x.testProfileId === a.id).length; // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)
    const recordUses = (await ctx.db.query("testTagRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect()).filter((x) => x.testProfileId === a.id).length; // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)
    const modelUses = (await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect()).filter((x) => x.defaultTestProfileId === a.id).length; // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)

    if (assetUses + recordUses + modelUses > 0) {
      await ctx.db.patch(doc._id, { isActive: false, updatedAt: a.now });
      await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: doc.name, summary: `Deactivated test profile "${doc.name}" (in use by ${assetUses} assets, ${recordUses} records)` });
      return { id: a.id, deactivated: true };
    }

    await ctx.db.delete(doc._id);
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: doc.name, summary: `Deleted test profile "${doc.name}"` });
    return { id: a.id, deactivated: false };
  },
});
