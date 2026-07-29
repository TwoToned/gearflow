import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { reserveTestTagIdCounter } from "./lib/testTagIdCounter";
import { backfillTestTagAssetsCore } from "./lib/testtagBackfill";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Native TEST-TAG-ASSET write mutations (Phase 3 browser-direct — replaces
 * createTestTagAsset/createTestTagAssetsFromBulk/updateTestTagAsset/retireTestTagAsset/
 * deleteTestTagAsset/reactivateTestTagAsset/backfillTestTagAssets). Each runs the 4
 * guards + per-row org re-check. Audit parity: create/createFromBulk/reactivate log;
 * update/retire/delete/backfill do NOT (matching the deleted server actions), so those
 * omit resolveActor. The test-tag-RECORD state machine stays server/service for now;
 * deleteNative only CASCADES record+subtest deletion for a RETIRED asset.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function logTT(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; details?: unknown }) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "testTagAsset", entityId: a.id,
    entityName: a.name, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: a.details, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string(), testTagId: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    testTagId: v.optional(v.string()),
    description: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    testIntervalMonths: v.optional(v.number()),
    testProfileId: v.optional(v.string()),
    outletCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);
    if (!a.description || a.description.trim().length < 1) throw new ConvexError("Description is required");
    // R-8.6.2: mirror testTagAssetSchema's bounds (client Zod validation is bypassable
    // by any caller hitting this Native mutation directly).
    assertStrLen(a.testTagId, "Test Tag ID", { max: 50 });
    assertStrLen(a.description, "Description", { max: 500 });
    assertStrLen(a.make, "Make", { max: 200 });
    assertStrLen(a.modelName, "Model", { max: 200 });
    assertStrLen(a.serialNumber, "Serial number", { max: 200 });
    assertStrLen(a.location, "Location", { max: 200 });
    assertNumRange(a.testIntervalMonths, "Test interval", { min: 1, max: 120, integer: true });
    assertNumRange(a.outletCount, "Outlet count", { min: 1, max: 50, integer: true });
    assertStrLen(a.notes, "Notes", { max: 2000 });

    const dupId = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dupId) throw new ConvexError("Test tag asset already exists");

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    if (a.assetId) await assertRefInOrg(ctx, "assets", a.assetId, a.orgId);
    if (a.bulkAssetId) await assertRefInOrg(ctx, "bulkAssets", a.bulkAssetId, a.orgId);
    if (a.testProfileId) await assertRefInOrg(ctx, "testProfiles", a.testProfileId, a.orgId);

    // If linking to a serialized asset, use the asset's tag as the test tag ID.
    let testTagId = a.testTagId;
    if (a.assetId) {
      const linked = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.assetId!)).first();
      if (linked && linked.organizationId === a.orgId) testTagId = linked.assetTag;
    }
    if (!testTagId) {
      const { ids } = await reserveTestTagIdCounter(ctx, a.orgId, 1, a.now);
      testTagId = ids[0];
    } else {
      const existing = await ctx.db.query("testTagAssets")
        .withIndex("by_organizationId_testTagId", (q) => q.eq("organizationId", a.orgId).eq("testTagId", testTagId!)).first();
      if (existing) throw new ConvexError(`Test tag ID "${testTagId}" already exists`);
    }

    await ctx.db.insert("testTagAssets", {
      id: a.id, organizationId: a.orgId, testTagId, description: a.description,
      equipmentClass: (a.equipmentClass as "CLASS_I") || "CLASS_I",
      applianceType: (a.applianceType as "APPLIANCE") || "APPLIANCE",
      ...(a.make && { make: a.make }),
      ...(a.modelName && { modelName: a.modelName }),
      ...(a.serialNumber && { serialNumber: a.serialNumber }),
      ...(a.location && { location: a.location }),
      testIntervalMonths: a.testIntervalMonths || 3,
      ...(a.testProfileId && { testProfileId: a.testProfileId }),
      ...(a.outletCount && { outletCount: a.outletCount }),
      ...(a.notes && { notes: a.notes }),
      ...(a.assetId && { assetId: a.assetId }),
      ...(a.bulkAssetId && { bulkAssetId: a.bulkAssetId }),
      status: "NOT_YET_TESTED", isActive: true, createdAt: a.now, updatedAt: a.now,
    });
    await logTT(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: testTagId, summary: `Created test tag asset ${testTagId}` });
    return { id: a.id, testTagId };
  },
});

export const createFromBulkNative = mutation({
  returns: v.object({ count: v.number(), items: v.array(v.object({ id: v.string(), testTagId: v.string() })) }),
  args: {
    orgId: v.string(),
    bulkAssetId: v.string(),
    ids: v.array(v.string()), // client-minted row ids (one per count)
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    testIntervalMonths: v.optional(v.number()),
    description: v.string(),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    location: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) throw new ConvexError("Count must be at least 1");
    assertStrLen(a.description, "Description", { max: 500 });
    assertStrLen(a.make, "Make", { max: 200 });
    assertStrLen(a.modelName, "Model", { max: 200 });
    assertStrLen(a.location, "Location", { max: 200 });
    assertNumRange(a.testIntervalMonths, "Test interval", { min: 1, max: 120, integer: true });

    const bulk = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.bulkAssetId)).first();
    if (!bulk || bulk.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    const { ids: testTagIds } = await reserveTestTagIdCounter(ctx, a.orgId, a.ids.length, a.now);
    const items: { id: string; testTagId: string }[] = [];
    for (let i = 0; i < a.ids.length; i++) {
      const id = a.ids[i];
      const testTagId = testTagIds[i];
      const dup = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (dup) continue; // idempotent (createManyIfMissing parity)
      await ctx.db.insert("testTagAssets", {
        id, organizationId: a.orgId, testTagId, description: a.description,
        equipmentClass: (a.equipmentClass as "CLASS_I") || "CLASS_I",
        applianceType: (a.applianceType as "APPLIANCE") || "APPLIANCE",
        ...(a.make && { make: a.make }),
        ...(a.modelName && { modelName: a.modelName }),
        ...(a.location && { location: a.location }),
        testIntervalMonths: a.testIntervalMonths || 3,
        bulkAssetId: a.bulkAssetId, status: "NOT_YET_TESTED", isActive: true, createdAt: a.now, updatedAt: a.now,
      });
      items.push({ id, testTagId });
    }
    await logTT(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: items[0]?.id || "",
      name: `${items.length} test tag assets`, summary: `Batch created ${items.length} test tag assets from bulk asset`,
      details: { count: items.length, bulkAssetId: a.bulkAssetId },
    });
    return { count: items.length, items };
  },
});

const patchFields = {
  description: v.optional(v.string()),
  equipmentClass: v.optional(enums.EquipmentClass),
  applianceType: v.optional(enums.ApplianceType),
  make: v.optional(v.union(v.string(), v.null())),
  modelName: v.optional(v.union(v.string(), v.null())),
  serialNumber: v.optional(v.union(v.string(), v.null())),
  location: v.optional(v.union(v.string(), v.null())),
  testIntervalMonths: v.optional(v.number()),
  testProfileId: v.optional(v.union(v.string(), v.null())),
  outletCount: v.optional(v.union(v.number(), v.null())),
  notes: v.optional(v.union(v.string(), v.null())),
  assetId: v.optional(v.union(v.string(), v.null())),
  bulkAssetId: v.optional(v.union(v.string(), v.null())),
};

// update/retire/delete are no-audit (parity — the old actions logged none), so no actor.
export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), patch: v.object(patchFields), now: v.number() },
  handler: async (ctx, { id, orgId, patch, now }) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "testTag", "update");

    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Test tag asset not found");

    // R-8.6.2: mirror testTagAssetSchema's bounds (null/undefined = leave-or-clear, skipped).
    assertStrLen(patch.description, "Description", { max: 500 });
    assertStrLen(patch.make, "Make", { max: 200 });
    assertStrLen(patch.modelName, "Model", { max: 200 });
    assertStrLen(patch.serialNumber, "Serial number", { max: 200 });
    assertStrLen(patch.location, "Location", { max: 200 });
    assertNumRange(patch.testIntervalMonths, "Test interval", { min: 1, max: 120, integer: true });
    assertNumRange(patch.outletCount, "Outlet count", { min: 1, max: 50, integer: true });
    assertStrLen(patch.notes, "Notes", { max: 2000 });

    // Org-validate client-supplied FKs when SET to a non-empty value (by_cuid is GLOBAL —
    // cross-org refs leak). A null/"" is a clear and needs no check.
    if (typeof patch.assetId === "string" && patch.assetId) await assertRefInOrg(ctx, "assets", patch.assetId, orgId);
    if (typeof patch.bulkAssetId === "string" && patch.bulkAssetId) await assertRefInOrg(ctx, "bulkAssets", patch.bulkAssetId, orgId);
    if (typeof patch.testProfileId === "string" && patch.testProfileId) await assertRefInOrg(ctx, "testProfiles", patch.testProfileId, orgId);

    // undefined = leave; null/"" = clear (Convex removes undefined keys).
    const set: Record<string, unknown> = { updatedAt: now };
    const scalars = ["description", "equipmentClass", "applianceType", "testIntervalMonths"] as const;
    for (const k of scalars) if (patch[k] !== undefined) set[k] = patch[k];
    const clearable = ["make", "modelName", "serialNumber", "location", "testProfileId", "outletCount", "notes", "assetId", "bulkAssetId"] as const;
    for (const k of clearable) if (patch[k] !== undefined) set[k] = patch[k] || undefined;
    await ctx.db.patch(doc._id, set);
    return { id };
  },
});

export const retireNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, now }) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "testTag", "update");
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Test tag asset not found");
    await ctx.db.patch(doc._id, { status: "RETIRED", isActive: false, updatedAt: now });
    return { id };
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "testTag", "delete");
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Test tag asset not found");
    if (doc.status !== "RETIRED") throw new ConvexError("Only retired items can be deleted");

    // Cascade: delete this asset's test records + their sub-tests (org-scoped record fetch).
    const records = await ctx.db.query("testTagRecords")
      .withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", id)).collect();
    for (const rec of records) {
      const subs = await ctx.db.query("subTestRecords").withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", rec.id)).collect();
      for (const st of subs) await ctx.db.delete(st._id);
      await ctx.db.delete(rec._id);
    }
    await ctx.db.delete(doc._id);
    return { id };
  },
});

export const reactivateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "update");
    const actor = await resolveActor(ctx, a.actor);
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Test tag asset not found");
    if (doc.status !== "RETIRED") throw new ConvexError("Only retired items can be reactivated");
    await ctx.db.patch(doc._id, { status: "NOT_YET_TESTED", isActive: true, updatedAt: a.now });
    await logTT(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: doc.testTagId, summary: `Reactivated test tag asset ${doc.testTagId}` });
    return { id: a.id };
  },
});

// backfill is no-audit (parity). Reconciles the org's serialized-asset T&T registrations.
export const backfillNative = mutation({
  returns: v.object({ created: v.number(), retired: v.number() }),
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "testTag", "create");
    return await backfillTestTagAssetsCore(ctx, orgId, now);
  },
});

// See docs/designs/api-mcp-reimplementation.md §9 for the classification rubric.
// retire/delete are `high` by rule (archive/delete — deleteNative additionally
// cascades record+subtest deletion for a RETIRED asset). backfillNative is an
// idempotent reconciliation job that can retire tags in bulk to match reality —
// `medium`, not `high`, since it's a system-driven sync rather than a targeted
// destructive action, but real enough not to be `low`. The rest are ordinary,
// recoverable create/update ops.
export const agentOps: AgentOpsAnnotations = {
  createNative: { danger: "medium" },
  createFromBulkNative: { danger: "medium" },
  updateNative: { danger: "medium" },
  retireNative: { danger: "high" }, // archive
  deleteNative: { danger: "high" }, // permanent delete + cascades records/subtests
  reactivateNative: { danger: "medium" },
  backfillNative: { danger: "medium" },
};
