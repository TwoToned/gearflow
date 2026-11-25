import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { bumpCountersForTable } from "./lib/counters";
import { reserveAssetTagCounter } from "./lib/assetTagCounter";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assetHistoryReason, assetHistoryText } from "./lib/assetHistory";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";

/**
 * Native BULK-ASSET write mutations (Phase 3 browser-direct — replaces
 * createBulkAsset/updateBulkAsset/deleteBulkAsset/archiveBulkAsset;
 * updateBulkAssetNotes was dead and is dropped). Each runs the 4 guards + per-row
 * org re-check + atomic audit + sharded-counter bump (parity with the service
 * create/patch/remove which bump). The form runs bulkAssetSchema; validateBulk
 * re-checks server-side (the mutation is the boundary).
 *
 * Invariants folded in:
 *  - create: dup-tag guard (by_organizationId_assetTag) + dup-id guard (by_cuid) +
 *    reserveAssetTagCounter(1) advance (parity — create used a form tag but bumped
 *    the counter by 1).
 *  - update: dup-tag guard only when the tag changed; availableQuantity recomputed
 *    from the total delta (max(0, prev + (newTotal - prevTotal))); purchasePrice/
 *    location/notes cleared when blank.
 *  - delete: reference guards (project line items → kit membership block).
 *  - archive: soft (isActive=false, status=RETIRED).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const bulkFields = {
  modelId: v.string(),
  assetTag: v.string(),
  totalQuantity: v.optional(v.number()),
  purchasePricePerUnit: v.optional(v.number()),
  locationId: v.optional(v.string()),
  status: v.optional(enums.BulkAssetStatus),
  notes: v.optional(v.string()),
  isActive: v.optional(v.boolean()),
  tags: v.optional(v.array(v.string())),
};

type BulkArgs = {
  modelId: string; assetTag: string; totalQuantity?: number; purchasePricePerUnit?: number;
  locationId?: string; status?: string; notes?: string; isActive?: boolean; tags?: string[];
};

/**
 * Mirrors bulkAssetSchema (src/lib/validations/asset.ts). `useBulkAssetWrites()` runs
 * that schema client-side before calling createNative/updateNative directly (no server
 * action in this path); this re-enforces the same string-length/quantity/price bounds
 * here so a caller invoking the mutation directly can't skip them (R-8.6.1/R-8.6.2).
 */
function validateBulk(a: BulkArgs) {
  assertStrLen(a.modelId, "modelId", { min: 1 });
  assertStrLen(a.assetTag, "assetTag", { min: 1, max: 50 });
  assertNumRange(a.totalQuantity ?? 0, "totalQuantity", { min: 0, integer: true });
  assertNumRange(a.purchasePricePerUnit, "purchasePricePerUnit", { min: 0 });
  assertStrLen(a.notes, "notes", { max: 2000 });
}

async function logBulk(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; assetTag: string; summary: string; details?: unknown }) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "bulkAsset", entityId: a.id,
    entityName: a.assetTag, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: a.details, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...bulkFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "create");
    const actor = await resolveActor(ctx, a.actor);
    validateBulk(a);

    const dupId = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dupId) throw new ConvexError("Bulk asset already exists");
    const dupTag = await ctx.db.query("bulkAssets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.orgId).eq("assetTag", a.assetTag)).first();
    if (dupTag) throw new ConvexError(`Asset tag "${a.assetTag}" already exists.`);

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    await assertRefInOrg(ctx, "models", a.modelId, a.orgId);
    if (a.locationId) await assertRefInOrg(ctx, "locations", a.locationId, a.orgId);

    const total = a.totalQuantity ?? 0;
    const doc = {
      id: a.id,
      organizationId: a.orgId,
      modelId: a.modelId,
      assetTag: a.assetTag,
      totalQuantity: total,
      availableQuantity: total,
      purchasePricePerUnit: a.purchasePricePerUnit != null ? Number(a.purchasePricePerUnit) : undefined,
      locationId: a.locationId || undefined,
      status: (a.status as "ACTIVE") ?? "ACTIVE",
      notes: a.notes || undefined,
      isActive: a.isActive ?? true,
      tags: a.tags || [],
      createdAt: a.now,
      updatedAt: a.now,
    };
    await ctx.db.insert("bulkAssets", doc);
    await bumpCountersForTable(ctx, "bulkAssets", null, doc);
    await reserveAssetTagCounter(ctx, a.orgId, 1, a.now); // advance counter (parity)

    await logBulk(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, assetTag: a.assetTag,
      summary: `Created bulk asset ${a.assetTag}`, details: { created: { assetTag: a.assetTag, totalQuantity: total } },
    });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string(), undoable: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), ...bulkFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");
    const actor = await resolveActor(ctx, a.actor);
    validateBulk(a);

    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    if (a.assetTag !== doc.assetTag) {
      const dup = await ctx.db.query("bulkAssets")
        .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.orgId).eq("assetTag", a.assetTag)).first();
      if (dup && dup.id !== a.id) throw new ConvexError(`Asset tag "${a.assetTag}" already exists.`);
    }

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    await assertRefInOrg(ctx, "models", a.modelId, a.orgId);
    if (a.locationId) await assertRefInOrg(ctx, "locations", a.locationId, a.orgId);

    // Availability recompute from the total delta (parity).
    const prevTotal = doc.totalQuantity ?? 0;
    const prevAvail = doc.availableQuantity ?? 0;
    const newTotal = a.totalQuantity ?? 0;
    const newAvailable = Math.max(0, prevAvail + (newTotal - prevTotal));

    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = {
      ...rest,
      modelId: a.modelId,
      assetTag: a.assetTag,
      totalQuantity: newTotal,
      availableQuantity: newAvailable,
      status: (a.status as "ACTIVE") ?? "ACTIVE",
      isActive: a.isActive ?? true,
      tags: a.tags ?? [],
      updatedAt: a.now,
    };
    if (a.purchasePricePerUnit != null) merged.purchasePricePerUnit = Number(a.purchasePricePerUnit);
    else delete merged.purchasePricePerUnit;
    if (a.locationId) merged.locationId = a.locationId;
    else delete merged.locationId;
    if (a.notes) merged.notes = a.notes;
    else delete merged.notes;

    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "bulkAssets", doc, merged);

    // The audit row IS the exact-Undo snapshot of what this edit changed (`undoUpdateNative`).
    const diff = diffFields({ ...doc, tags: doc.tags ?? [] }, merged, BULK_EDIT_FIELDS); // absent tags == []
    if (diff) {
      await recordFieldEdit(ctx, {
        orgId: a.orgId, entityType: "bulkAsset", entityId: a.id, entityName: a.assetTag, auditId: a.auditId, actor, now: a.now,
        summary: `Updated bulk asset ${a.assetTag}`, diff,
      });
    } else {
      await logBulk(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, assetTag: a.assetTag, summary: `Updated bulk asset ${a.assetTag}` });
    }
    return { id: a.id, undoable: diff != null };
  },
});

/** The fields an edit can change and an Undo can restore (`availableQuantity` moves with the total). */
const BULK_EDIT_FIELDS = [
  "modelId", "assetTag", "totalQuantity", "availableQuantity", "purchasePricePerUnit",
  "locationId", "status", "notes", "tags", "isActive",
] as const;

/** The exact reverse of ONE bulk `updateNative`, from its own audit row (ids only). */
export const undoUpdateNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: { id: v.string(), orgId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");
    const actor = await resolveActor(ctx, a.actor);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    return undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "bulkAsset", entityId: a.id, entityName: doc?.assetTag ?? a.id, auditId: a.auditId, actor, now: a.now,
      load: async () => (doc && doc.organizationId === a.orgId ? doc : null),
      apply: async (d, plan) => {
        const tag = plan.set.assetTag;
        if (typeof tag === "string" && tag !== d.assetTag) {
          const dup = await ctx.db.query("bulkAssets").withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.orgId).eq("assetTag", tag)).first();
          if (dup && dup.id !== a.id) throw new ConvexError({ code: "DUPLICATE_ASSET_TAG", message: `Asset tag "${tag}" is used by another asset now.` });
        }
        const patch = { ...plan.set, ...Object.fromEntries(plan.clear.map((k) => [k, undefined])), updatedAt: a.now };
        await ctx.db.patch(d._id, patch);
        await bumpCountersForTable(ctx, "bulkAssets", d, { ...d, ...patch });
      },
    });
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    // D32 / Q-11: Delete is only for a bare row (the same ONE rule as a serialised unit,
    // which also covers a job and a kit; every candidate row is org-checked inside it).
    const history = await assetHistoryReason(ctx, a.orgId, { bulkAssetId: a.id });
    if (history) {
      throw new ConvexError({
        code: "ASSET_HAS_HISTORY",
        reason: history,
        message: `This bulk asset can't be deleted because ${assetHistoryText(history)}. Retire it instead.`,
      });
    }

    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "bulkAssets", doc, null);

    await logBulk(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, assetTag: doc.assetTag, summary: `Deleted bulk asset ${doc.assetTag}`, details: { deleted: { assetTag: doc.assetTag } } });
    return { id: a.id };
  },
});

/** Retire (`RETIRED`) or reinstate (`ACTIVE`) one bulk row, audited with the exact-Undo snapshot. */
async function setBulkRetired(
  ctx: MutationCtx,
  a: { id: string; orgId: string; now: number; actor: Actor; auditId: string },
  retired: boolean,
) {
  const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
  if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");
  // Reinstate is the way back from RETIRED only. Nothing derives LOW_STOCK / OUT_OF_STOCK
  // in the backend, so a reinstated row is ACTIVE; the status is never client-supplied.
  if (!retired && doc.status !== "RETIRED") {
    throw new ConvexError({ code: "NOT_RETIRED", message: `Bulk asset ${doc.assetTag} is not retired, so it can't be reinstated.` });
  }
  const set = retired ? { isActive: false, status: "RETIRED" as const } : { isActive: true, status: "ACTIVE" as const };
  const diff = diffFields(doc, { ...doc, ...set }, ["status", "isActive"]);
  if (!diff) return { id: a.id, undoable: false };
  await ctx.db.patch(doc._id, { ...set, updatedAt: a.now });
  await bumpCountersForTable(ctx, "bulkAssets", doc, { ...doc, ...set, updatedAt: a.now });
  await recordFieldEdit(ctx, {
    orgId: a.orgId, entityType: "bulkAsset", entityId: a.id, entityName: doc.assetTag, auditId: a.auditId, actor: a.actor, now: a.now,
    summary: `${retired ? "Retired" : "Reinstated"} bulk asset ${doc.assetTag}`, diff,
  });
  return { id: a.id, undoable: true };
}

// Retire is audited now (D33/Q-11): the audit row is the exact-Undo snapshot, the
// same shape as `assetWrites.archiveNative`.
export const archiveNative = mutation({
  returns: v.object({ id: v.string(), undoable: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");
    const actor = await resolveActor(ctx, a.actor);
    return setBulkRetired(ctx, { ...a, actor }, true);
  },
});

export const reinstateNative = mutation({
  returns: v.object({ id: v.string(), undoable: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");
    const actor = await resolveActor(ctx, a.actor);
    return setBulkRetired(ctx, { ...a, actor }, false);
  },
});

/** Exact reverse of ONE bulk retire / reinstate, from its own audit row (ids only). */
export const undoRetireNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: { id: v.string(), orgId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");
    const actor = await resolveActor(ctx, a.actor);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    return undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "bulkAsset", entityId: a.id, entityName: doc?.assetTag ?? a.id, auditId: a.auditId, actor, now: a.now,
      load: async () => (doc && doc.organizationId === a.orgId ? doc : null),
      apply: async (d, plan) => {
        const patch = { ...plan.set, ...Object.fromEntries(plan.clear.map((k) => [k, undefined])), updatedAt: a.now };
        await ctx.db.patch(d._id, patch);
        await bumpCountersForTable(ctx, "bulkAssets", d, { ...d, ...patch });
      },
    });
  },
});

export const agentOps: AgentOpsAnnotations = {
  // Makes retired stock bookable again (stock-affecting), so `high`.
  reinstateNative: { danger: "high" },
  undoRetireNative: { danger: "medium" },
  undoUpdateNative: { danger: "medium" },
  archiveNative: { danger: "high" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  updateNative: { danger: "medium" },
};
