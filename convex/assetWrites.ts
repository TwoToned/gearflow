import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { bumpAssetCounters, bumpCountersForTable } from "./lib/counters";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { reserveAssetTagCounter } from "./lib/assetTagCounter";
import { registerAssetTestTag, backfillTestTagAssetsCore } from "./lib/testtagBackfill";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";

/**
 * Native ASSET write mutations (Phase 5 — Convex becomes the domain layer, not just
 * a write target).
 *
 * ADDITIVE + ISOLATED: the generated service mutations in convex/assets.ts are left
 * untouched, so the live server-action write path is unchanged. These new mutations
 * are the native path — each enforces, in ONE transaction:
 *   • RBAC (requireOrgPermission — 5a): the same resource/action the server action's
 *     requirePermission checked, now unbypassable at the Convex boundary. Because
 *     Convex mutations are PUBLIC, this is what makes it safe for a browser/user token
 *     to call the mutation directly (5d optimistic) — relaxing requireService without
 *     this would open a hole.
 *   • Domain invariants (5b): per-mutation (dup-tag guards, status rules, …).
 *   • Atomic audit (5c): the activityLogs row is written in the same transaction as
 *     the data change via writeActivityLog, so data + audit can't drift.
 *
 * `actor` carries the acting user for the audit trail (a service-token call has no
 * user identity of its own, so the caller passes it; a user-token call can pass its
 * own id). `auditId` + `now` are caller-generated (a Convex mutation can't mint a
 * cuid — Math.random is non-deterministic) and keep the write deterministic.
 *
 * `updateNotesNative` is the mechanism-prover: the simplest asset write (notes-only,
 * no cross-entity invariant) exercising the full RBAC + atomic-audit pattern that the
 * heavier create/update/delete mutations will reuse.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * Mirrors `assetSchema` (src/lib/validations/asset.ts) string-length + price bounds —
 * `v.string()`/`v.number()` only enforce type, not these business constraints, so a
 * browser-direct caller bypassing the client Zod parse would otherwise skip them
 * entirely (R-8.6.2). `assetTag` presence is checked separately by the dup-tag path;
 * only its length is a shared concern here.
 */
function assertAssetFields(f: {
  assetTag?: string;
  serialNumber?: string;
  customName?: string;
  purchaseSupplier?: string;
  purchaseOrderNumber?: string;
  notes?: string;
  barcode?: string;
  purchasePrice?: number;
}): void {
  if (f.assetTag != null) assertStrLen(f.assetTag, "assetTag", { min: 1, max: 50 });
  assertStrLen(f.serialNumber, "serialNumber", { max: 100 });
  assertStrLen(f.customName, "customName", { max: 200 });
  assertStrLen(f.purchaseSupplier, "purchaseSupplier", { max: 200 });
  assertStrLen(f.purchaseOrderNumber, "purchaseOrderNumber", { max: 100 });
  assertStrLen(f.notes, "notes", { max: 2000 });
  assertStrLen(f.barcode, "barcode", { max: 100 });
  assertNumRange(f.purchasePrice, "purchasePrice", { min: 0 });
}

export const updateNotesNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "asset"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, orgId, "asset", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    // Defence in depth: the RBAC guard already checked the token's org, but the
    // asset must belong to it too (a valid member of org A can't edit org B's asset).
    if (asset.organizationId !== orgId) {
      throw new ConvexError("Forbidden: organization mismatch.");
    }

    // `undefined` clears the field (matches updateAssetNotes' clear-to-null).
    await ctx.db.patch(asset._id, { notes: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated notes on asset ${asset.assetTag}`,
      assetId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});

/**
 * archiveNative — soft-retire an asset (isActive:false + status RETIRED) and retire
 * any linked test&tag entries, all in one transaction. RBAC(asset,update). Mirrors
 * archiveAsset (src/server/assets.ts:865); adds an audit row (the server action
 * wrote none — an intentional improvement, not a parity break on data state).
 */
export const archiveNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "asset"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, orgId, "asset", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    if (asset.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Retire linked T&T entries (Convex-only write — same as archiveAsset).
    const linkedTT = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id))
      .collect();
    for (const tt of linkedTT) {
      await ctx.db.patch(tt._id, { status: "RETIRED", isActive: false, updatedAt: now });
    }

    await ctx.db.patch(asset._id, { isActive: false, status: "RETIRED", updatedAt: now });
    await bumpAssetCounters(ctx, orgId, asset, { isActive: false, status: "RETIRED" });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Archived asset ${asset.assetTag}`,
      details: { archived: true },
      assetId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});

/**
 * deleteNative — hard-delete an asset. Enforces the orphan guards transactionally
 * (mirrors deleteAsset, src/server/assets.ts:771): reject if it's referenced by any
 * project line item, is a kit member, or has serialized/bulk accessory children.
 * Retires linked T&T entries, then removes the row + writes the DELETE audit — all
 * atomic, so the guards can't race the delete. RBAC(asset,delete).
 *
 * Throws a distinct ConvexError code per guard so the client can surface the exact
 * reason (the mirror/UI reads `error.data`).
 */
export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "asset"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, orgId, "asset", "delete");
    const actor = await resolveActor(ctx, suppliedActor);

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    if (asset.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    const lineItems = await ctx.db
      .query("projectLineItems")
      .withIndex("by_assetId", (q) => q.eq("assetId", id))
      .collect();
    if (lineItems.some((li) => li.organizationId === orgId)) {
      throw new ConvexError({ code: "ASSET_IN_USE", message: "This asset is referenced by project line items." });
    }

    const kitMember = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id))
      .first();
    if (kitMember) {
      throw new ConvexError({ code: "ASSET_IN_KIT", message: "This asset is part of a kit." });
    }

    const childAssets = await ctx.db
      .query("assets")
      .withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id))
      .collect();
    const childBulk = await ctx.db
      .query("assetBulkChildren")
      .withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id))
      .collect();
    if (childAssets.some((c) => c.organizationId === orgId) || childBulk.some((c) => c.organizationId === orgId)) {
      throw new ConvexError({ code: "ASSET_HAS_ACCESSORIES", message: "This asset has accessories attached." });
    }

    // Retire linked T&T entries (Convex-only write — same as deleteAsset).
    const linkedTT = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id))
      .collect();
    for (const tt of linkedTT) {
      await ctx.db.patch(tt._id, { status: "RETIRED", isActive: false, updatedAt: now });
    }

    await ctx.db.delete(asset._id);
    await bumpAssetCounters(ctx, orgId, asset, null);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted asset ${asset.assetTag}`,
      details: { deleted: { assetTag: asset.assetTag } },
      assetId: id,
      createdAt: now,
    });

    return { id };
  },
});

// Patchable asset fields (mirrors convex/assets.ts assetSet — kept local so a CRUD
// regen of assets.ts can't clobber the native-write path). Reused by updateNative.
const assetSet = v.object({
  modelId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  customName: v.optional(v.string()),
  status: v.optional(enums.AssetStatus),
  condition: v.optional(enums.AssetCondition),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  purchaseSupplier: v.optional(v.string()),
  supplierId: v.optional(v.string()),
  purchaseOrderNumber: v.optional(v.string()),
  supplierOrderId: v.optional(v.string()),
  warrantyExpiry: v.optional(v.number()),
  notes: v.optional(v.string()),
  locationId: v.optional(v.string()),
  customFieldValues: v.optional(v.any()),
  lastTestAndTagDate: v.optional(v.number()),
  nextTestAndTagDate: v.optional(v.number()),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  kitId: v.optional(v.string()),
  parentAssetId: v.optional(v.string()),
});
const ASSET_NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

/**
 * createNative — insert an asset with the dup-tag guard + CREATE audit in ONE
 * transaction. RBAC(asset,create). The dup guard (by_organizationId_assetTag) and
 * the audit are atomic with the insert, closing the check-then-write race two
 * concurrent creates of the same tag would otherwise hit. There is no server action
 * in this path anymore — `useAssetWrites().create` (src/hooks/use-asset-writes.ts)
 * calls this mutation directly from the browser after `assetSchema.parse()` +
 * custom-field resolution client-side; `assertAssetFields` re-enforces the same
 * string-length/price bounds here so a caller invoking the mutation directly (valid
 * session, bypassing the UI) can't skip them (R-8.6.1/R-8.6.2). Throws
 * ConvexError({code:"DUPLICATE_ASSET_TAG"}) → mapped to UserFacingError by the caller.
 */
export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "asset"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, fields.organizationId, "asset", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    // dup-id guard (by_cuid is GLOBAL + non-unique) — a replayed/duplicate client cuid
    // inserts a 2nd `assets` row that later crashes every `by_cuid(...).unique()` reader
    // (kit add, checkout, detail). Mirrors bulkAssetsWrites/kitWrites createNative.
    const dupId = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", fields.id)).first();
    if (dupId) throw new ConvexError({ code: "DUPLICATE_ASSET", message: "Asset already exists." });
    assertAssetFields(fields);

    const dup = await ctx.db
      .query("assets")
      .withIndex("by_organizationId_assetTag", (q) =>
        q.eq("organizationId", fields.organizationId).eq("assetTag", fields.assetTag),
      )
      .first();
    if (dup) {
      throw new ConvexError({
        code: "DUPLICATE_ASSET_TAG",
        message: `Asset tag "${fields.assetTag}" already exists.`,
      });
    }

    // Org-validate every client-supplied FK (by_cuid is GLOBAL — the referenced row
    // could belong to another org; the service-token read path never re-checks).
    await assertRefInOrg(ctx, "models", fields.modelId, fields.organizationId);
    if (fields.locationId) await assertRefInOrg(ctx, "locations", fields.locationId, fields.organizationId);
    if (fields.supplierId) await assertRefInOrg(ctx, "suppliers", fields.supplierId, fields.organizationId);
    if (fields.parentAssetId) await assertRefInOrg(ctx, "assets", fields.parentAssetId, fields.organizationId);
    if (fields.kitId) await assertRefInOrg(ctx, "kits", fields.kitId, fields.organizationId);

    await ctx.db.insert("assets", fields);
    await bumpAssetCounters(ctx, fields.organizationId, null, fields);
    const createNow = fields.createdAt ?? fields.updatedAt ?? 0;
    // Advance the asset-tag counter + auto-register T&T (parity with createAsset).
    await reserveAssetTagCounter(ctx, fields.organizationId, 1, createNow);
    await registerAssetTestTag(ctx, {
      organizationId: fields.organizationId, assetId: fields.id, assetTag: fields.assetTag,
      serialNumber: fields.serialNumber, modelId: fields.modelId,
    }, createNow);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "asset",
      entityId: fields.id,
      entityName: fields.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created asset ${fields.assetTag}`,
      details: { created: { assetTag: fields.assetTag, modelId: fields.modelId } },
      assetId: fields.id,
      createdAt: fields.createdAt ?? fields.updatedAt ?? 0,
    });

    return { id: fields.id };
  },
});

/**
 * updateNative — apply a set/clear patch (the patchAsset clear-to-null pattern) with
 * the tag-change dup guard + UPDATE audit, all in one transaction. RBAC(asset,update).
 * `useAssetWrites().update` runs `assetSchema.parse()` + custom-field validation and
 * builds the set/clear patch client-side before calling this mutation directly (no
 * server action in this path); `assertAssetFields` re-enforces the same bounds on
 * `set` here so a direct-mutation caller can't skip them (R-8.6.1/R-8.6.2).
 */
export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    set: assetSet,
    clear: v.array(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "asset"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, orgId, "asset", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Asset not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    assertAssetFields(set);

    // DUP GUARD only when the tag changed (mirrors updateAsset).
    if (set.assetTag && set.assetTag !== doc.assetTag) {
      const dup = await ctx.db
        .query("assets")
        .withIndex("by_organizationId_assetTag", (q) =>
          q.eq("organizationId", orgId).eq("assetTag", set.assetTag!),
        )
        .first();
      if (dup && dup.id !== id) {
        throw new ConvexError({
          code: "DUPLICATE_ASSET_TAG",
          message: `Asset tag "${set.assetTag}" already exists.`,
        });
      }
    }

    // Org-validate any client-supplied FK present in the sanitized `set` (by_cuid is
    // GLOBAL — a member of org A must not point their asset at org B's model/location/…).
    if (typeof set.modelId === "string") await assertRefInOrg(ctx, "models", set.modelId, orgId);
    if (typeof set.locationId === "string") await assertRefInOrg(ctx, "locations", set.locationId, orgId);
    if (typeof set.supplierId === "string") await assertRefInOrg(ctx, "suppliers", set.supplierId, orgId);
    if (typeof set.parentAssetId === "string") await assertRefInOrg(ctx, "assets", set.parentAssetId, orgId);
    if (typeof set.kitId === "string") await assertRefInOrg(ctx, "kits", set.kitId, orgId);

    // Apply set (+ clear-to-null) — the patchAsset pattern. Stamp updatedAt from the
    // mutation `now` (the client `set` omits it; parity with the old updateAsset).
    const setWithTs = { ...set, updatedAt: now };
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, setWithTs);
      await bumpAssetCounters(ctx, orgId, doc, { ...doc, ...setWithTs });
    } else {
      const { _id, _creationTime, ...rest } = doc;
      const merged: Record<string, unknown> = { ...rest, ...setWithTs };
      for (const k of clear) {
        if (ASSET_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(doc._id, merged as typeof rest);
      await bumpAssetCounters(ctx, orgId, doc, merged);
    }

    const finalTag = set.assetTag ?? doc.assetTag;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: finalTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated asset ${finalTag}`,
      assetId: id,
      createdAt: now,
    });

    // Auto-register/reconcile T&T if the (new) model requires it (parity: updateAsset
    // runs the full backfill when the model requires T&T).
    const modelId = set.modelId ?? doc.modelId;
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    if (model && model.organizationId === orgId && model.requiresTestAndTag === true) {
      await backfillTestTagAssetsCore(ctx, orgId, now);
    }

    return { id };
  },
});

const actorLog = async (ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; id: string; assetTag: string; modelId: string }) => {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: "CREATE", entityType: "asset", entityId: a.id,
    entityName: a.assetTag, userId: a.actor.userId, userName: a.actor.userName,
    summary: `Created asset ${a.assetTag}`, details: { created: { assetTag: a.assetTag, modelId: a.modelId } },
    assetId: a.id, createdAt: a.now,
  });
};

/**
 * createManyNative — batch asset create (browser-direct). Insert N assets with a
 * per-asset dup-tag guard + counter bumps + tag-counter advance(N) + per-asset T&T
 * auto-register + one CREATE audit per asset, atomic. Each asset carries its own
 * client-minted id + auditId. RBAC(asset,create). Mirrors createAssets.
 */
export const createManyNative = mutation({
  returns: v.object({ ids: v.array(v.string()) }),
  args: {
    orgId: v.string(),
    now: v.number(),
    actor: actorValidator,
    assets: v.array(v.object({
      id: v.string(),
      auditId: v.string(),
      modelId: v.string(),
      assetTag: v.string(),
      serialNumber: v.optional(v.string()),
      customName: v.optional(v.string()),
      status: v.optional(enums.AssetStatus),
      condition: v.optional(enums.AssetCondition),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      purchaseSupplier: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      warrantyExpiry: v.optional(v.number()),
      notes: v.optional(v.string()),
      locationId: v.optional(v.string()),
      customFieldValues: v.optional(v.any()),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, { orgId, now, actor: suppliedActor, assets }) => {
    await assertWritesEnabled(ctx, "asset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "asset", "create");
    const actor = await resolveActor(ctx, suppliedActor);
    if (assets.length === 0) throw new ConvexError("No assets to create");

    const ids: string[] = [];
    for (const a of assets) {
      const dupId = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
      if (dupId) throw new ConvexError({ code: "DUPLICATE_ASSET", message: `Asset already exists: ${a.id}` });
      assertAssetFields(a);
      const dup = await ctx.db.query("assets")
        .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", a.assetTag)).first();
      if (dup) throw new ConvexError({ code: "DUPLICATE_ASSET_TAG", tag: a.assetTag, message: `Asset tag "${a.assetTag}" already exists.` });
      // Org-validate the client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
      await assertRefInOrg(ctx, "models", a.modelId, orgId);
      if (a.locationId) await assertRefInOrg(ctx, "locations", a.locationId, orgId);
      if (a.supplierId) await assertRefInOrg(ctx, "suppliers", a.supplierId, orgId);
      const { auditId: _auditId, ...assetFields } = a;
      const fields = { ...assetFields, organizationId: orgId, createdAt: now, updatedAt: now };
      await ctx.db.insert("assets", fields);
      await bumpCountersForTable(ctx, "assets", null, fields);
      await registerAssetTestTag(ctx, { organizationId: orgId, assetId: a.id, assetTag: a.assetTag, serialNumber: a.serialNumber, modelId: a.modelId }, now);
      await actorLog(ctx, { orgId, actor, auditId: a.auditId, now, id: a.id, assetTag: a.assetTag, modelId: a.modelId });
      ids.push(a.id);
    }
    // Advance the tag counter once for the whole batch.
    await reserveAssetTagCounter(ctx, orgId, assets.length, now);
    return { ids };
  },
});

/**
 * bulkUpdateNative — apply a shared set/clear patch to N assets (status/condition/
 * location bulk-bar), per-row org re-check + counter bumps. RBAC(asset,update).
 * No audit (parity — bulkUpdateAssets logged none). Returns the count applied.
 */
export const bulkUpdateNative = mutation({
  returns: v.object({ count: v.number() }),
  // Restricted to the 3 bulk-bar fields (status/condition/location) — NOT the full
  // assetSet, so a browser caller can't bulk-change assetTag/modelId/tags/… and
  // bypass the dup-tag / T&T invariants (codex).
  args: {
    orgId: v.string(),
    ids: v.array(v.string()),
    set: v.object({ status: v.optional(enums.AssetStatus), condition: v.optional(enums.AssetCondition), locationId: v.optional(v.string()) }),
    clear: v.array(v.literal("locationId")),
    now: v.number(),
  },
  handler: async (ctx, { orgId, ids, set, clear, now }) => {
    await assertWritesEnabled(ctx, "asset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "asset", "update");
    if (ids.length === 0) throw new ConvexError("Nothing selected");
    if (Object.keys(set).length === 0 && clear.length === 0) throw new ConvexError("No changes specified");

    // Org-validate the one client-supplied FK in the shared set (by_cuid is GLOBAL).
    if (set.locationId) await assertRefInOrg(ctx, "locations", set.locationId, orgId);

    const patch = { ...set, updatedAt: now };
    let count = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== orgId) continue; // per-item org re-check (by_cuid is GLOBAL)
      if (clear.length === 0) {
        await ctx.db.patch(doc._id, patch);
        await bumpAssetCounters(ctx, orgId, doc, { ...doc, ...patch });
      } else {
        const { _id, _creationTime, ...rest } = doc;
        const merged: Record<string, unknown> = { ...rest, ...patch };
        for (const k of clear) { if (ASSET_NEVER_CLEAR.has(k)) continue; delete merged[k]; }
        await ctx.db.replace(doc._id, merged as typeof rest);
        await bumpAssetCounters(ctx, orgId, doc, merged);
      }
      count++;
    }
    return { count };
  },
});

/**
 * bulkTagNative — APPEND tags to N assets (union into each asset's existing tags),
 * per-row org re-check, idempotent. RBAC(asset,update). No counter/audit (parity).
 */
export const bulkTagNative = mutation({
  returns: v.object({ count: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), tags: v.array(v.string()), now: v.number() },
  handler: async (ctx, { orgId, ids, tags, now }) => {
    await assertWritesEnabled(ctx, "asset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "asset", "update");
    if (ids.length === 0) throw new ConvexError("Nothing selected");
    const add = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (add.length === 0) throw new ConvexError("No tags entered");
    let count = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== orgId) continue;
      count++;
      const existing = doc.tags ?? [];
      const merged = [...new Set([...existing, ...add])];
      if (merged.length === existing.length) continue; // all present
      await ctx.db.patch(doc._id, { tags: merged, updatedAt: now });
    }
    return { count };
  },
});
