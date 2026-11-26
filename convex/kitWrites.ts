import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import { reserveAssetTagCounter } from "./lib/assetTagCounter";
import { adjustBulkAvailability } from "./lib/inventory";
import { releaseKitMembers, getKitGuarded, assignAssetToKit, releaseAsset, getAssetDoc } from "./kits";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import { getKitByCuid } from "./lib/kits";
import { stampLocationMovement } from "./lib/locationMovement";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { kitCostGuard } from "./lib/gearCostRedact";
import { KIT_COST_FIELDS } from "./lib/gearCostFields";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Native KIT write mutations (Phase 5) — same shape as convex/assetWrites.ts:
 * ADDITIVE (the generated convex/kits.ts service mutations are untouched), each
 * enforcing RBAC(requireOrgPermission) + invariants + atomic audit(writeActivityLog)
 * in one transaction. `actor`/`auditId`/`now` are caller-generated (deterministic).
 * Browser-direct (the NATIVE_KIT_WRITES legacy server-action gate was removed in the cutover).
 *
 * Covers create/update/notes (the clean writes). archive/delete use the existing
 * cascade mutations (kits.archiveCascade / deleteCascade) + their own status guards —
 * a separate slice.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * The stored `INCOMPLETE` is the "reported missing" marker (convex/lib/kitState.ts): a MISSING return sets it and
 * ONLY `markCompleteNative` (with its audit row and Undo) clears it. A kit edit may neither set it nor clear it;
 * re-saving a kit that already carries it, unchanged, is fine.
 */
function assertReportedMissingUntouched(stored: string | undefined, next: string | undefined): void {
  if (next === "INCOMPLETE" && stored !== "INCOMPLETE") throw new ConvexError("A kit becomes Incomplete only when it is returned missing.");
  if (stored === "INCOMPLETE" && next !== undefined && next !== "INCOMPLETE") throw new ConvexError("Use Mark complete to clear a kit that was reported missing.");
}

/**
 * Mirrors `kitSchema` (src/lib/validations/kit.ts) string-length + weight/price bounds —
 * `v.string()`/`v.number()` only enforce type, not these business constraints, so a
 * browser-direct caller bypassing `useKitWrites()`'s client Zod parse would otherwise
 * skip them entirely (R-8.6.2). `assetTag` presence/uniqueness is checked separately by
 * the dup-tag path; only its length is a shared concern here.
 */
function assertKitFields(f: {
  name?: string;
  assetTag?: string;
  description?: string;
  caseType?: string;
  caseDimensions?: string;
  notes?: string;
  weight?: number;
  purchasePrice?: number;
  xeroAccountCode?: string;
}): void {
  if (f.name != null) assertStrLen(f.name, "name", { min: 1, max: 200 });
  if (f.assetTag != null) assertStrLen(f.assetTag, "assetTag", { min: 1, max: 50 });
  assertStrLen(f.description, "description", { max: 2000 });
  assertStrLen(f.caseType, "caseType", { max: 200 });
  assertStrLen(f.caseDimensions, "caseDimensions", { max: 200 });
  assertStrLen(f.notes, "notes", { max: 2000 });
  assertNumRange(f.weight, "weight", { min: 0 });
  assertNumRange(f.purchasePrice, "purchasePrice", { min: 0 });
  assertStrLen(f.xeroAccountCode, "xeroAccountCode", { max: 50 });
}

const kitPatch = v.object({
  organizationId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  categoryId: v.optional(v.string()),
  status: v.optional(enums.KitStatus),
  condition: v.optional(enums.AssetCondition),
  locationId: v.optional(v.string()),
  weight: v.optional(v.number()),
  caseType: v.optional(v.string()),
  caseDimensions: v.optional(v.string()),
  image: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  notes: v.optional(v.string()),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  customFieldValues: v.optional(v.any()),
  tags: v.optional(v.array(v.string())),
  checkMode: v.optional(enums.KitCheckMode),
  isPrep: v.optional(v.boolean()),
  isActive: v.optional(v.boolean()),
  xeroAccountCode: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isActive: v.optional(v.boolean()),
    xeroAccountCode: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "kit", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    const dup = await ctx.db
      .query("kits")
      .withIndex("by_organizationId_assetTag", (q) =>
        q.eq("organizationId", fields.organizationId).eq("assetTag", fields.assetTag),
      )
      .first();
    if (dup) {
      throw new ConvexError({
        code: "DUPLICATE_ASSET_TAG",
        message: `Asset tag "${fields.assetTag}" already exists`,
      });
    }
    // The assetTag guard is org-scoped and does NOT catch a cross-org cuid collision —
    // dup-guard the client-minted id too (else another org's kit getById .unique() crashes).
    const dupId = await getKitByCuid(ctx, fields.id);
    if (dupId) throw new ConvexError("Kit already exists");
    assertKitFields(fields);
    assertReportedMissingUntouched(undefined, fields.status);

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    if (fields.categoryId) await assertRefInOrg(ctx, "categories", fields.categoryId, fields.organizationId);
    if (fields.locationId) await assertRefInOrg(ctx, "locations", fields.locationId, fields.organizationId);

    // What the kit cost is a cost field: a `noFinancials` key cannot set it on create either (the write follows the read).
    await ctx.db.insert("kits", (await kitCostGuard(ctx)).row(fields));
    await stampLocationMovement(ctx, fields.organizationId, null, fields.locationId ?? null, fields.createdAt ?? fields.updatedAt ?? 0);
    // Advance the asset-tag counter (parity — createKit reserved 1 after insert).
    await reserveAssetTagCounter(ctx, fields.organizationId, 1, fields.createdAt ?? fields.updatedAt ?? 0);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "kit",
      entityId: fields.id,
      entityName: fields.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created kit ${fields.assetTag} - ${fields.name}`,
      // `serverSavedAt` lets the exact Undo (`undoCreateNative`) enforce its window on the server clock.
      details: { kind: "kitCreate", serverSavedAt: Date.now(), created: { assetTag: fields.assetTag, name: fields.name } },
      kitId: fields.id,
      createdAt: fields.createdAt ?? fields.updatedAt ?? 0,
    });

    return { id: fields.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    patch: kitPatch,
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, patch, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await getKitByCuid(ctx, id);
    if (!doc) throw new ConvexError("Kit not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    assertKitFields(patch);
    assertReportedMissingUntouched(doc.status, patch.status);

    if (patch.assetTag && patch.assetTag !== doc.assetTag) {
      const dup = await ctx.db
        .query("kits")
        .withIndex("by_organizationId_assetTag", (q) =>
          q.eq("organizationId", orgId).eq("assetTag", patch.assetTag!),
        )
        .first();
      if (dup && dup.id !== id) {
        throw new ConvexError({
          code: "DUPLICATE_ASSET_TAG",
          message: `Asset tag "${patch.assetTag}" already exists`,
        });
      }
    }

    // Org-validate client-supplied FKs in the patch (by_cuid is GLOBAL — cross-org refs leak).
    if (patch.categoryId) await assertRefInOrg(ctx, "categories", patch.categoryId, orgId);
    if (patch.locationId) await assertRefInOrg(ctx, "locations", patch.locationId, orgId);

    await ctx.db.patch(doc._id, sanitizeClientSet(patch)); // strip organizationId/id — no cross-tenant reassign
    await stampLocationMovement(ctx, orgId, doc.locationId, patch.locationId, now);

    const finalTag = patch.assetTag ?? doc.assetTag;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "kit",
      entityId: id,
      entityName: finalTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated kit ${finalTag} - ${patch.name ?? doc.name}`,
      kitId: id,
      createdAt: now,
    });

    return { id };
  },
});

/** The fields the Kit sheet writes, and so the only ones its Undo restores. Status is NOT here (D75). */
const KIT_EDIT_FIELDS = ["assetTag", "name", "description", "categoryId", "condition", "locationId", "weight", "caseType", "caseDimensions", "notes", "purchaseDate", "purchasePrice", "tags", "checkMode", "xeroAccountCode"] as const;

const kitEditSet = v.object({
  assetTag: v.optional(v.string()),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  categoryId: v.optional(v.string()),
  condition: v.optional(enums.AssetCondition),
  locationId: v.optional(v.string()),
  weight: v.optional(v.number()),
  caseType: v.optional(v.string()),
  caseDimensions: v.optional(v.string()),
  notes: v.optional(v.string()),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  checkMode: v.optional(enums.KitCheckMode),
  xeroAccountCode: v.optional(v.string()),
});

/** Refuses a tag another kit of this org already holds (an Undo restoring an old tag must not collide either). */
async function assertTagFree(ctx: MutationCtx, orgId: string, tag: string, exceptId: string): Promise<void> {
  const dup = await ctx.db.query("kits").withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag)).first();
  if (dup && dup.id !== exceptId) throw new ConvexError({ code: "DUPLICATE_ASSET_TAG", message: `Asset tag "${tag}" already exists` });
}

/** `set` / `clear` with the kit cost fields (`KIT_COST_FIELDS`) removed for a caller whose cost is hidden (a `noFinancials` key). */
async function withoutHiddenKitCost<S extends Record<string, unknown>>(ctx: MutationCtx, set: S, clear: string[]): Promise<{ set: S; clear: string[] }> {
  if (!(await kitCostGuard(ctx)).hidden) return { set, clear };
  const kept = Object.fromEntries(Object.entries(set).filter(([f]) => !(KIT_COST_FIELDS as readonly string[]).includes(f))) as S;
  return { set: kept, clear: clear.filter((f) => !(KIT_COST_FIELDS as readonly string[]).includes(f)) };
}

/** A kit with no tags and a save that sends `[]` are the same state: drop the empty list so a no-op save writes nothing and offers no Undo. */
function withoutNoopEmptyTags<S extends { tags?: string[] }>(set: S, doc: { tags?: string[] | null }): S {
  if (!set.tags || set.tags.length > 0 || doc.tags?.length) return set;
  const { tags: _empty, ...rest } = set;
  void _empty;
  return rest as S;
}

/**
 * An Undo restores EVERY field its edit changed, so for a caller whose cost is hidden (a `noFinancials` key) it
 * refuses as a whole when the plan would touch what the kit cost (set OR clear): otherwise undoing a user's price
 * edit would let the key rewrite a number it cannot read (the write follows the read).
 */
async function assertHiddenCostUntouched(ctx: MutationCtx, fields: string[]): Promise<void> {
  if (!(await kitCostGuard(ctx)).hidden) return;
  if (!fields.some((f) => (KIT_COST_FIELDS as readonly string[]).includes(f))) return;
  throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change touched what the kit cost, which this key can't see, so it can't be undone here." });
}

/**
 * The Kit sheet's save (UX Phase 14, 14b-2): `set` writes fields, `clear` empties them (the old `updateNative`
 * could not clear a field: an omitted arg leaves it alone). Only KIT_EDIT_FIELDS may be named, so status, the
 * photos and the flags are untouched. One field-edit audit row records the changed fields; the toast's Undo is
 * `undoEditNative`. A save that changed nothing writes nothing and returns `changed: false`.
 */
export const editNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean() }),
  args: { orgId: v.string(), id: v.string(), set: kitEditSet, clear: v.array(v.string()), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "kit", "update");
    const actor = await resolveActor(ctx, a.actor);
    const doc = await getKitByCuid(ctx, a.id);
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Kit not found: " + a.id);
    // What the kit COST to buy is a cost field: a `noFinancials` key can neither set nor clear it (the write follows the read).
    const hiddenCost = await withoutHiddenKitCost(ctx, a.set, a.clear);
    const set = withoutNoopEmptyTags(hiddenCost.set, doc);
    const clear = hiddenCost.clear;
    const clears = clear.filter((f) => (KIT_EDIT_FIELDS as readonly string[]).includes(f) && f !== "name" && f !== "assetTag");
    if (clears.length !== clear.length) throw new ConvexError("That field can't be cleared here");
    assertKitFields(set);
    if (set.assetTag && set.assetTag !== doc.assetTag) await assertTagFree(ctx, a.orgId, set.assetTag, a.id);
    if (set.categoryId) await assertRefInOrg(ctx, "categories", set.categoryId, a.orgId);
    if (set.locationId) await assertRefInOrg(ctx, "locations", set.locationId, a.orgId);

    const next: Record<string, unknown> = { ...doc, ...set };
    for (const f of clears) delete next[f];
    const diff = diffFields(doc, next, KIT_EDIT_FIELDS);
    if (!diff) return { id: a.id, changed: false };
    const patch: Record<string, unknown> = { ...set, updatedAt: a.now };
    for (const f of clears) patch[f] = undefined;
    await ctx.db.patch(doc._id, patch);
    await stampLocationMovement(ctx, a.orgId, doc.locationId, (next.locationId as string | undefined) ?? undefined, a.now);
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "kit", entityId: a.id, entityName: (next.assetTag as string) ?? doc.assetTag, auditId: a.auditId, actor, summary: `Updated kit ${doc.assetTag}`, diff, now: a.now, links: { kitId: a.id } });
    return { id: a.id, changed: true };
  },
});

/** The exact Undo of `editNative` (ids only; refuses if a changed field was edited again since, by another person, or after 10 minutes). */
export const undoEditNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "kit", "update");
    const actor = await resolveActor(ctx, a.actor);
    const named = await getKitByCuid(ctx, a.id);
    await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "kit", entityId: a.id, entityName: named?.assetTag ?? a.id, auditId: a.auditId, actor, now: a.now,
      load: async () => (named && named.organizationId === a.orgId ? named : null),
      apply: async (doc, plan) => {
        const fields = [...Object.keys(plan.set), ...plan.clear];
        if (fields.some((f) => !(KIT_EDIT_FIELDS as readonly string[]).includes(f))) throw new ConvexError("This change can't be undone");
        await assertHiddenCostUntouched(ctx, fields);
        if (typeof plan.set.assetTag === "string") await assertTagFree(ctx, a.orgId, plan.set.assetTag, a.id);
        if (typeof plan.set.categoryId === "string") await assertRefInOrg(ctx, "categories", plan.set.categoryId, a.orgId);
        if (typeof plan.set.locationId === "string") await assertRefInOrg(ctx, "locations", plan.set.locationId, a.orgId);
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(doc._id, patch);
        if (fields.includes("locationId")) await stampLocationMovement(ctx, a.orgId, doc.locationId, (plan.set.locationId as string | undefined) ?? undefined, a.now);
      },
    });
    return { id: a.id };
  },
});

/** Every table whose rows point at a kit by `kitId` (each has a `by_kitId` index): a kit any of them names is not "just created". */
const KIT_REFERENCE_TABLES = [
  "kitSerializedItems", "kitBulkItems", "projectLineItems", "kitMedia", "kitCheckItems",
  "groupTemplateItems", "maintenanceRecords", "checkRecords", "assetScanLogs", "kitRevenueAllocations",
] as const;

/** Does ANY row (any org: the indexes are global and a cross-org row still means this id is in use) name this kit? */
async function kitIsReferenced(ctx: MutationCtx, kitId: string): Promise<boolean> {
  for (const table of KIT_REFERENCE_TABLES) {
    const q = ctx.db.query(table) as unknown as {
      withIndex: (n: "by_kitId", f: (b: { eq: (k: "kitId", v: string) => unknown }) => unknown) => { first: () => Promise<unknown> };
    };
    if (await q.withIndex("by_kitId", (b) => b.eq("kitId", kitId)).first()) return true;
  }
  return false;
}

/**
 * The exact Undo of `createNative` (ids only): removes the kit only while it is exactly as created (unedited, and
 * nothing in `KIT_REFERENCE_TABLES` names it: no members, job lines, photos, checks, templates, maintenance,
 * check records, scan history or revenue allocations), by the person who created it, inside the 10-minute server
 * window, once. It deletes only the kit row it created.
 */
export const undoCreateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "kit", "delete");
    const actor = await resolveActor(ctx, a.actor);
    const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
    const d = row?.details as { kind?: string; serverSavedAt?: number } | undefined;
    if (!row || row.organizationId !== a.orgId || row.entityType !== "kit" || row.entityId !== a.id || row.action !== "CREATE" || d?.kind !== "kitCreate" || typeof d.serverSavedAt !== "number") {
      throw new ConvexError("This kit can't be un-created");
    }
    if (row.userId !== actor.userId) throw new ConvexError("Only the person who created this kit can undo it");
    assertWithinUndoWindow(d.serverSavedAt, Date.now(), "change");
    const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", `undo:${a.auditId}`)).first();
    if (marker && marker.organizationId === a.orgId) throw new ConvexError("This kit was already undone");
    const doc = await getKitByCuid(ctx, a.id);
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Kit not found");
    if (doc.updatedAt !== row.createdAt) throw new ConvexError("This kit was changed since: it can't be undone");
    if (await kitIsReferenced(ctx, a.id)) throw new ConvexError("This kit has members, jobs, photos, checks or history now, so it can't be undone");
    await ctx.db.delete(doc._id);
    await stampLocationMovement(ctx, a.orgId, doc.locationId, undefined, a.now);
    await writeActivityLog(ctx, {
      id: `undo:${a.auditId}`, organizationId: a.orgId, action: "UNDO", entityType: "kit", entityId: a.id, entityName: doc.assetTag,
      userId: actor.userId, userName: actor.userName, summary: `Undid the creation of kit ${doc.assetTag}`, details: { undoOf: a.auditId }, createdAt: a.now,
    });
    return { id: a.id };
  },
});

/**
 * "Mark complete": clears the stored INCOMPLETE ("reported missing") marker a MISSING return wrote. It is
 * the ONLY way that marker clears (a found asset set back to AVAILABLE does not), gated as a kit edit.
 * One field-edit audit row (`status` INCOMPLETE -> AVAILABLE) is what its exact Undo reads.
 */
export const markCompleteNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "kit", "update");
    const actor = await resolveActor(ctx, a.actor);
    const doc = await getKitByCuid(ctx, a.id);
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Kit not found: " + a.id);
    const diff = diffFields(doc, { ...doc, status: "AVAILABLE" }, ["status"]);
    if (doc.status !== "INCOMPLETE" || !diff) return { id: a.id, changed: false };
    await ctx.db.patch(doc._id, { status: "AVAILABLE", updatedAt: a.now });
    await recordFieldEdit(ctx, {
      orgId: a.orgId, entityType: "kit", entityId: a.id, entityName: doc.assetTag, auditId: a.auditId, actor, now: a.now, diff,
      summary: `Marked kit ${doc.assetTag} complete`, links: { kitId: a.id },
    });
    return { id: a.id, changed: true };
  },
});

/** Exactly reverses `markCompleteNative` (ids only; refused if the status changed since, by another person, or after 10 minutes). */
export const undoMarkCompleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "kit", "update");
    const actor = await resolveActor(ctx, a.actor);
    const named = await getKitByCuid(ctx, a.id);
    await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "kit", entityId: a.id, entityName: named?.assetTag ?? a.id, auditId: a.auditId, actor, now: a.now,
      load: async () => (named && named.organizationId === a.orgId ? named : null),
      apply: async (doc, plan) => {
        if (Object.keys(plan.set).some((f) => f !== "status") || plan.clear.length > 0) throw new ConvexError("This change can't be undone");
        await ctx.db.patch(doc._id, { ...plan.set, updatedAt: a.now });
      },
    });
    return { id: a.id };
  },
});

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
    await assertWritesEnabled(ctx, "kit"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await getKitByCuid(ctx, id);
    if (!doc) throw new ConvexError("Kit not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { notes: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "kit",
      entityId: id,
      entityName: doc.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated notes on kit ${doc.assetTag}`,
      kitId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});


/**
 * archiveNative / deleteNative — kit soft-retire / hard-delete with the member-release
 * cascade (releaseKitMembers, the SAME helper the service archiveCascade/deleteCascade
 * use) + audit, atomic. RBAC(kit, delete). The status guard (AVAILABLE only) runs
 * inside the mutation.
 */
export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const kit = await getKitByCuid(ctx, id);
    if (!kit || kit.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Kit not found" });
    if (kit.status !== "AVAILABLE" && kit.status !== "INCOMPLETE") throw new ConvexError({ code: "KIT_NOT_AVAILABLE", message: "Only AVAILABLE kits can be archived" });
    await releaseKitMembers(ctx, id, orgId, now);
    await ctx.db.patch(kit._id, { isActive: false, status: "RETIRED", updatedAt: now });
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "DELETE", entityType: "kit", entityId: id,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Archived kit ${kit.assetTag} - ${kit.name}`, kitId: id, createdAt: now,
    });
    return { id };
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const kit = await getKitByCuid(ctx, id);
    if (!kit || kit.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Kit not found" });
    if (kit.status !== "AVAILABLE" && kit.status !== "INCOMPLETE") throw new ConvexError({ code: "KIT_NOT_AVAILABLE", message: "Only AVAILABLE kits can be deleted" });

    // Referencing-line-item guard (org-filtered — by_kitId is GLOBAL). Blocks hard
    // delete if any project line item references the kit (preserve historical data).
    const referencing = (await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect())
      .filter((li) => li.organizationId === orgId).length;
    if (referencing > 0) {
      throw new ConvexError({
        code: "KIT_REFERENCED",
        message: `This kit is referenced by ${referencing} project line item${referencing === 1 ? "" : "s"}. Archive it instead, or remove it from those projects first.`,
      });
    }

    await releaseKitMembers(ctx, id, orgId, now);
    await ctx.db.delete(kit._id);

    // Clean up kit-scoped metadata the member cascade doesn't cover (org-filtered).
    // Files are left in storage (parity with the old cascade).
    const checkItems = (await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect())
      .filter((r) => r.organizationId === orgId);
    for (const r of checkItems) await ctx.db.delete(r._id);
    const mediaRows = (await ctx.db.query("kitMedia").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect())
      .filter((r) => r.organizationId === orgId);
    for (const m of mediaRows) await ctx.db.delete(m._id);

    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "DELETE", entityType: "kit", entityId: id,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Permanently deleted kit ${kit.assetTag} - ${kit.name}`, createdAt: now,
    });
    return { id };
  },
});

/**
 * Kit MEMBER writes (Phase 3 browser-direct — replace kits.addSerializedItems /
 * removeSerializedItem / addBulkItem / removeBulkItem). Each runs the 4 guards +
 * the kit-AVAILABLE + per-asset availability guards (via the shared kits.ts
 * helpers) atomically + an audit row (the old server member ops were unaudited;
 * these consequential inventory changes now log). RBAC(kit, update).
 */

export const addSerializedItemsNative = mutation({
  returns: v.object({ ids: v.array(v.string()) }),
  args: {
    orgId: v.string(),
    kitId: v.string(),
    items: v.array(v.object({ assetId: v.string(), position: v.optional(v.string()) })),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { orgId, kitId, items, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    if (items.length === 0) throw new ConvexError("No items to add");

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const ids: string[] = [];
    for (const it of items) {
      // Mirrors kitSerializedItemSchema's `position` bound (R-8.6.2).
      assertStrLen(it.position, "position", { max: 200 });
      const asset = await getAssetDoc(ctx, it.assetId);
      if (!asset || asset.organizationId !== orgId) throw new ConvexError("Asset not found");
      if (asset.status !== "AVAILABLE") throw new ConvexError(`Asset ${asset.assetTag} is not AVAILABLE`);
      if (asset.kitId) throw new ConvexError(`Asset ${asset.assetTag} is already in another kit`);
      if (asset.parentAssetId) throw new ConvexError(`Asset ${asset.assetTag} is an accessory — detach it first`);
      const id = createId();
      await ctx.db.insert("kitSerializedItems", { id, organizationId: orgId, kitId, assetId: it.assetId, position: it.position, addedById: actor.userId, addedAt: now });
      await assignAssetToKit(ctx, asset, kitId, kit.locationId, now);
      ids.push(id);
    }
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Added ${ids.length} asset${ids.length === 1 ? "" : "s"} to kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { ids };
  },
});

export const removeSerializedItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), kitId: v.string(), assetId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, kitId, assetId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const member = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
      .unique();
    if (!member || member.kitId !== kitId) throw new ConvexError("Kit item not found");
    // Org-check the asset before releasing it (releaseAsset fetches by global cuid).
    const asset = await getAssetDoc(ctx, assetId);
    if (asset && asset.organizationId !== orgId) throw new ConvexError("Asset not found");
    await ctx.db.delete(member._id);
    await releaseAsset(ctx, assetId, now);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Removed an asset from kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { id: member.id };
  },
});

export const addBulkItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(), kitId: v.string(), bulkAssetId: v.string(), quantity: v.number(),
    position: v.optional(v.string()), notes: v.optional(v.string()),
    actor: actorValidator, auditId: v.string(), now: v.number(),
  },
  handler: async (ctx, { orgId, kitId, bulkAssetId, quantity, position, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    if (!Number.isInteger(quantity) || quantity < 1) throw new ConvexError("Quantity must be at least 1");
    // Mirrors kitBulkItemSchema's `position`/`notes` bounds (R-8.6.2).
    assertStrLen(position, "position", { max: 200 });
    assertStrLen(notes, "notes", { max: 500 });

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const id = createId();
    await ctx.db.insert("kitBulkItems", { id, organizationId: orgId, kitId, bulkAssetId, quantity, position, notes, addedById: actor.userId, addedAt: now });
    // Guarded decrement (throws + rolls back if insufficient).
    await adjustBulkAvailability(ctx, orgId, [{ bulkAssetId, delta: -quantity }]);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Added ${quantity}× bulk item to kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { id };
  },
});

export const removeBulkItemNative = mutation({
  returns: v.object({ bulkAssetId: v.string() }),
  args: { orgId: v.string(), kitId: v.string(), bulkItemId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, kitId, bulkItemId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "kit");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const kit = await getKitGuarded(ctx, kitId, orgId);
    const member = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", bulkItemId)).unique();
    if (!member || member.organizationId !== orgId) throw new ConvexError("Bulk item not found");
    if (member.kitId !== kitId) throw new ConvexError("Bulk item does not belong to this kit");
    await ctx.db.delete(member._id);
    await adjustBulkAvailability(ctx, orgId, [{ bulkAssetId: member.bulkAssetId, delta: member.quantity }]);
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "kit", entityId: kitId,
      entityName: kit.assetTag, userId: actor.userId, userName: actor.userName,
      summary: `Removed a bulk item from kit ${kit.assetTag}`, kitId, createdAt: now,
    });
    return { bulkAssetId: member.bulkAssetId };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addBulkItemNative: { danger: "medium" },
  addSerializedItemsNative: { danger: "medium" },
  // Retire tier (§9 delete/archive) — releases every member back to AVAILABLE.
  archiveNative: { danger: "high" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  editNative: { danger: "medium", summary: "Edit a kit's own fields (set and clear); never its status, members or photos." },
  undoEditNative: { danger: "high", summary: "Exactly undo a recent kit edit by its audit id (refuses if a changed field was edited again since)." },
  undoCreateNative: { danger: "high", summary: "Exactly undo the creation of a kit by its audit id (refuses once it has members, jobs, photos, checks or edits)." },
  markCompleteNative: { danger: "medium", summary: "Clear a kit's reported-missing marker (Mark complete). The kit becomes bookable again." },
  undoMarkCompleteNative: { danger: "medium", summary: "Exactly undo a Mark complete by its audit id." },
  removeBulkItemNative: { danger: "medium" },
  removeSerializedItemNative: { danger: "medium" },
  updateNative: { danger: "medium" },
  updateNotesNative: { danger: "low" },
};
