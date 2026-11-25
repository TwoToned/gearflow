import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { assertAuditIdFree, writeActivityLog } from "./lib/audit";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { applyMove, planMove, undoMove, type MovedRow } from "./lib/locationMove";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";

/**
 * Native LOCATION write mutations (Phase 3 browser-direct — replaces createLocation/
 * updateLocation/deleteLocation/updateLocationNotes in src/server/locations.ts). Gates on
 * location:*. Standard shape: 4 guards + per-row org re-check + atomic audit. Invariants
 * re-implemented (no FK cascades): single-default-per-org (clear other defaults before
 * setting one), delete-guards (children / assets / bulkAssets block), and the dropped
 * locationMedia Cascade (remove the location's media rows on delete).
 *
 * `useLocationWrites()` runs `locationSchema` (src/lib/validations/asset.ts) client-side
 * before calling `createNative`/`updateNative` directly (no server action in this path);
 * `assertLocationFields` re-enforces the same string-length bounds + the
 * latitude/longitude both-or-neither `.refine()` here so a caller invoking the mutation
 * directly can't skip them (R-8.6.1/R-8.6.2).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Mirrors locationSchema (src/lib/validations/asset.ts), including its `.refine()`. */
function assertLocationFields(f: { name?: string; address?: string; notes?: string; latitude?: number | null; longitude?: number | null; capacity?: number | null }): void {
  assertNumRange(f.capacity ?? undefined, "capacity", { min: 1, integer: true });
  assertStrLen(f.name, "name", { min: 1, max: 200 });
  assertStrLen(f.address, "address", { max: 500 });
  assertStrLen(f.notes, "notes", { max: 1000 });
  if ((f.latitude != null) !== (f.longitude != null)) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "Both latitude and longitude must be provided together." });
  }
}

export const locationFields = {
  name: v.string(),
  address: v.optional(v.string()),
  latitude: v.optional(v.union(v.number(), v.null())),
  longitude: v.optional(v.union(v.number(), v.null())),
  type: v.optional(enums.LocationType),
  isDefault: v.optional(v.boolean()),
  parentId: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  // D42/D78: whole number >= 1. On update, absent = leave alone, null = clear (so a caller that
  // does not know the field, like the pre-sheet form, never wipes a stored capacity).
  capacity: v.optional(v.union(v.number(), v.null())),
};

/** Clear isDefault on every other current default in the org (single-default invariant). */
async function unsetOtherDefaults(ctx: MutationCtx, orgId: string, exceptId: string | undefined, now: number) {
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
  for (const l of locs) {
    if (l.isDefault && l.id !== exceptId) await ctx.db.patch(l._id, { isDefault: false, updatedAt: now });
  }
}

async function logLocation(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; details?: unknown },
) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "location",
    entityId: a.id, entityName: a.name, userId: a.actor.userId, userName: a.actor.userName,
    summary: a.summary, details: a.details, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...locationFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "create");
    const actor = await resolveActor(ctx, a.actor);
    assertLocationFields(a);

    const dup = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Location already exists");
    // Org-validate the client-supplied parent FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.parentId) await assertRefInOrg(ctx, "locations", a.parentId, a.orgId);
    // The exact Undo of a create finds its row by the audit id: it must name no existing row (the id is checked above).
    await assertAuditIdFree(ctx, a.auditId);
    if (a.isDefault) await unsetOtherDefaults(ctx, a.orgId, undefined, a.now);

    await ctx.db.insert("locations", {
      id: a.id, organizationId: a.orgId, name: a.name,
      address: a.address || undefined, latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined,
      type: a.type ?? "WAREHOUSE", isDefault: a.isDefault ?? false,
      parentId: a.parentId || undefined, notes: a.notes || undefined, tags: a.tags ?? [],
      capacity: a.capacity ?? undefined,
      createdAt: a.now, updatedAt: a.now,
    });
    // `serverSavedAt` lets the exact Undo (`undoCreateNative`) enforce its window on the server clock.
    const details: LocationCreateDetails = { kind: "locationCreate", serverSavedAt: Date.now(), setDefault: !!a.isDefault };
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created location ${a.name}`, details });
    return { id: a.id };
  },
});

interface LocationCreateDetails {
  kind: "locationCreate";
  serverSavedAt: number;
  /** The create cleared another location's default flag: that has no exact reverse, so no Undo. */
  setDefault: boolean;
}

const isCreateDetails = (d: unknown): d is LocationCreateDetails => {
  const x = d as Partial<LocationCreateDetails> | null;
  return !!x && x.kind === "locationCreate" && typeof x.serverSavedAt === "number";
};

/** Fields a location edit (and so its exact Undo) covers. `isDefault` is deliberately not one: changing it moves ANOTHER location's flag. */
const LOCATION_EDIT_FIELDS = ["name", "address", "latitude", "longitude", "type", "parentId", "notes", "tags", "capacity"] as const;

/** A location may not be moved under itself or one of its own descendants. */
async function assertNoParentCycle(ctx: MutationCtx, orgId: string, id: string, parentId: string | undefined): Promise<void> {
  const seen = new Set<string>();
  for (let cur = parentId; cur; ) {
    if (cur === id) throw new ConvexError("A location can't be placed inside itself or one of its own bins");
    if (seen.has(cur)) return; // a cycle already in the data: not this write's to fix
    seen.add(cur);
    const next = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", cur!)).first();
    cur = next && next.organizationId === orgId ? next.parentId : undefined;
  }
}

/**
 * The exact Undo of `createNative` (ids only): refuses unless it is by the person who created the
 * location, inside the 10-minute server-clock window, the first undo, and the location is exactly
 * as created (untouched, no bins, nothing stored in it, no files) and did not take over the default flag.
 */
export const undoCreateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "delete");
    const actor = await resolveActor(ctx, a.actor);
    const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
    if (!row || row.organizationId !== a.orgId || row.entityType !== "location" || row.entityId !== a.id || row.action !== "CREATE" || !isCreateDetails(row.details)) {
      throw new ConvexError("This location can't be un-created");
    }
    if (row.userId !== actor.userId) throw new ConvexError("Only the person who created this location can undo it");
    assertWithinUndoWindow(row.details.serverSavedAt, Date.now(), "change");
    if (row.details.setDefault) throw new ConvexError("This location took over as the default, so it can't be undone: edit it instead");
    const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", `undo:${a.auditId}`)).first();
    if (marker && marker.organizationId === a.orgId) throw new ConvexError("This location was already undone");

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");
    if (doc.updatedAt !== row.createdAt) throw new ConvexError("This location was changed since: it can't be undone");
    await assertLocationEmpty(ctx, a.orgId, a.id);
    await ctx.db.delete(doc._id);
    await writeActivityLog(ctx, {
      id: `undo:${a.auditId}`, organizationId: a.orgId, action: "UNDO", entityType: "location", entityId: a.id, entityName: doc.name,
      userId: actor.userId, userName: actor.userName, summary: `Undid the creation of ${doc.name}`, details: { undoOf: a.auditId }, createdAt: a.now,
    });
    return { id: a.id };
  },
});

/** No bins, nothing stored here, no files. */
async function assertLocationEmpty(ctx: MutationCtx, orgId: string, id: string): Promise<void> {
  const [bin, asset, bulk, kit, media] = await Promise.all([
    ctx.db.query("locations").withIndex("by_parentId", (q) => q.eq("parentId", id)).first(),
    ctx.db.query("assets").withIndex("by_locationId", (q) => q.eq("locationId", id)).first(),
    ctx.db.query("bulkAssets").withIndex("by_locationId", (q) => q.eq("locationId", id)).first(),
    ctx.db.query("kits").withIndex("by_locationId", (q) => q.eq("locationId", id)).first(),
    ctx.db.query("locationMedia").withIndex("by_locationId", (q) => q.eq("locationId", id)).first(),
  ]);
  const used = [bin, asset, bulk, kit, media].some((r) => r && r.organizationId === orgId);
  if (used) throw new ConvexError("This location has bins, contents or files now: it can't be undone");
}

export const updateNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean(), undoable: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), ...locationFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "update");
    const actor = await resolveActor(ctx, a.actor);
    assertLocationFields(a);

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");
    // Org-validate the client-supplied parent FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.parentId) await assertRefInOrg(ctx, "locations", a.parentId, a.orgId);
    await assertNoParentCycle(ctx, a.orgId, a.id, a.parentId || undefined);
    if (a.isDefault) await unsetOtherDefaults(ctx, a.orgId, a.id, a.now);

    // Clears use `undefined` (schema optionals reject null).
    const fields = {
      name: a.name, address: a.address || undefined,
      latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined,
      type: a.type ?? "WAREHOUSE", parentId: a.parentId || undefined, notes: a.notes || undefined, tags: a.tags ?? [],
      ...(a.capacity !== undefined ? { capacity: a.capacity ?? undefined } : {}),
    };
    const isDefault = a.isDefault ?? false;
    // The exact-Undo snapshot: only the fields that changed (convex/lib/fieldEditUndo.ts).
    const diff = diffFields(doc, { ...doc, ...fields }, LOCATION_EDIT_FIELDS);
    await ctx.db.patch(doc._id, { ...fields, isDefault, updatedAt: a.now });
    const defaultChanged = (doc.isDefault ?? false) !== isDefault;
    if (diff) {
      await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "location", entityId: a.id, entityName: a.name, auditId: a.auditId, actor, summary: `Updated location ${a.name}`, diff, now: a.now });
    } else if (defaultChanged) {
      await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated location ${a.name}` });
    }
    // Changing the default flag also moves ANOTHER location's flag, which has no exact reverse: no Undo then.
    return { id: a.id, changed: !!diff || defaultChanged, undoable: !!diff && !defaultChanged };
  },
});

/**
 * The exact Undo of `updateNative` (ids only), through `convex/lib/fieldEditUndo.ts`: refused as a whole by
 * another person, past 10 minutes, already undone, or when any changed field was edited again since.
 */
export const undoUpdateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "update");
    const actor = await resolveActor(ctx, a.actor);
    const named = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "location", entityId: a.id, entityName: named?.name ?? a.id, auditId: a.auditId, actor, now: a.now,
      load: async () => (named && named.organizationId === a.orgId ? named : null),
      apply: async (doc, plan) => {
        const unsupported = [...Object.keys(plan.set), ...plan.clear].filter((f) => !(LOCATION_EDIT_FIELDS as readonly string[]).includes(f));
        if (unsupported.length > 0) throw new ConvexError("This change can't be undone");
        if (typeof plan.set.parentId === "string") {
          await assertRefInOrg(ctx, "locations", plan.set.parentId, a.orgId);
          // The tree may have changed since: restoring the old parent must not close a loop (A cleared, X moved under A, Undo sets A under X).
          await assertNoParentCycle(ctx, a.orgId, doc.id, plan.set.parentId);
        }
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(doc._id, patch);
      },
    });
    return { id: a.id };
  },
});

export const updateNotesNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), notes: v.union(v.string(), v.null()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "update");
    await resolveActor(ctx, a.actor); // pins identity (no audit row in the original notes path)
    assertStrLen(a.notes, "notes", { max: 1000 });

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");
    await ctx.db.patch(doc._id, { notes: a.notes || undefined, updatedAt: a.now });
    return { id: a.id };
  },
});

export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Location not found");

    // Delete-guards (old Prisma _count): children / assets / bulkAssets block.
    const children = (
      await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect() // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
    ).filter((l) => l.parentId === a.id);
    if (children.length > 0) throw new ConvexError("Cannot delete location with sub-locations");
    const asset = await ctx.db.query("assets").withIndex("by_locationId", (q) => q.eq("locationId", a.id)).first();
    const bulkAsset = asset ? null : await ctx.db.query("bulkAssets").withIndex("by_locationId", (q) => q.eq("locationId", a.id)).first();
    if (asset || bulkAsset) {
      throw new ConvexError("Cannot delete location with assets assigned to it");
    }

    // locationMedia Cascade re-implementation: remove the location's media rows.
    const media = await ctx.db.query("locationMedia").withIndex("by_locationId", (q) => q.eq("locationId", a.id)).collect();
    for (const m of media) if (m.organizationId === a.orgId) await ctx.db.delete(m._id);

    await ctx.db.delete(doc._id);
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: doc.name, summary: `Deleted location ${doc.name}`, details: { deleted: { name: doc.name } } });
    return { id: a.id };
  },
});

/** The permissions a bulk move needs: it writes locations' contents, i.e. assets, bulk lines and kits. */
async function requireMovePermissions(ctx: MutationCtx, orgId: string): Promise<void> {
  await requireOrgPermission(ctx, orgId, "location", "update");
  await requireOrgPermission(ctx, orgId, "asset", "update");
  await requireOrgPermission(ctx, orgId, "bulkAsset", "update");
  await requireOrgPermission(ctx, orgId, "kit", "update");
}

interface MoveAuditDetails {
  kind: "moveContents";
  serverSavedAt: number;
  movedAt: number;
  toId: string;
  moved: MovedRow[];
}

function isMoveDetails(d: unknown): d is MoveAuditDetails {
  const x = d as Partial<MoveAuditDetails> | null;
  return !!x && x.kind === "moveContents" && typeof x.serverSavedAt === "number" && typeof x.movedAt === "number" && typeof x.toId === "string" && Array.isArray(x.moved);
}

/**
 * `Move contents…` (bulk, Locations list): everything stored at `fromIds` moves to `toId`. Rows out
 * on a job, kit members, accessories and partly-out bulk lines are skipped and counted by reason.
 * Returns the audit id the toast's Undo takes (`undoMoveContentsNative`, ids only).
 */
export const moveContentsNative = mutation({
  returns: v.object({
    auditId: v.string(),
    moved: v.number(),
    skipped: v.array(v.object({ reason: v.string(), count: v.number() })),
  }),
  args: { orgId: v.string(), fromIds: v.array(v.string()), toId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireMovePermissions(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.fromIds.length);
    const fromIds = [...new Set(a.fromIds)];
    if (fromIds.length === 0) throw new ConvexError("Nothing selected");
    if (fromIds.includes(a.toId)) throw new ConvexError("Choose a destination that is not one of the selected locations");
    const [target, ...sources] = await Promise.all([a.toId, ...fromIds].map((id) => ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first()));
    if (!target || target.organizationId !== a.orgId) throw new ConvexError("Destination not found");
    if (sources.some((s) => !s || s.organizationId !== a.orgId)) throw new ConvexError("Location not found");

    await assertAuditIdFree(ctx, a.auditId); // the Undo trusts the row with this id
    const plan = await planMove(ctx, a.orgId, fromIds);
    if (plan.rows.length === 0) throw new ConvexError("Nothing here can be moved");
    const moved = await applyMove(ctx, a.orgId, plan, a.toId, a.now);
    const details: MoveAuditDetails = { kind: "moveContents", serverSavedAt: Date.now(), movedAt: a.now, toId: a.toId, moved };
    await logLocation(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "MOVE", id: a.toId, name: target.name,
      summary: `Moved ${moved.length} item${moved.length === 1 ? "" : "s"} from ${fromIds.length} location${fromIds.length === 1 ? "" : "s"} to ${target.name}`,
      details,
    });
    return { auditId: a.auditId, moved: moved.length, skipped: Object.entries(plan.skipped).map(([reason, count]) => ({ reason, count })) };
  },
});

/**
 * The exact Undo of `moveContentsNative` (ids only). Refuses the whole call unless it is by the person
 * who moved, inside the 10-minute server-clock window, and the first undo; then puts back only the
 * rows still exactly where the move left them and reports how many it left (moved on since).
 */
export const undoMoveContentsNative = mutation({
  returns: v.object({ restored: v.number(), left: v.number() }),
  args: { orgId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireMovePermissions(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
    if (!row || row.organizationId !== a.orgId || row.entityType !== "location" || !isMoveDetails(row.details)) throw new ConvexError("This move can't be undone");
    if (row.userId !== actor.userId) throw new ConvexError("Only the person who moved these items can undo it");
    assertWithinUndoWindow(row.details.serverSavedAt, Date.now(), "change");
    // The Undo's own row has the deterministic id `${auditId}:undo`: ONE by_cuid lookup, never a history scan.
    const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", `${a.auditId}:undo`)).first();
    if (marker && marker.organizationId === a.orgId) throw new ConvexError("This move was already undone");

    const result = await undoMove(ctx, a.orgId, row.details.moved, row.details.toId, row.details.movedAt, a.now);
    await writeActivityLog(ctx, {
      id: `${a.auditId}:undo`, organizationId: a.orgId, action: "UNDO", entityType: "location", entityId: row.entityId, entityName: row.entityName,
      userId: actor.userId, userName: actor.userName, summary: `Undid a move: ${result.restored} item${result.restored === 1 ? "" : "s"} put back`,
      details: { undoOf: a.auditId, ...result }, createdAt: a.now,
    });
    return result;
  },
});

/** `Print bin labels`: record that these locations' labels were printed (print only: no Undo, a reprint is the correction). */
export const setLabelsPrintedNative = mutation({
  returns: v.object({ count: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "location");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "location", "update");
    await assertBulkSizeOk(ctx, a.ids.length);
    let count = 0;
    for (const id of new Set(a.ids)) {
      const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) continue;
      await ctx.db.patch(doc._id, { labelPrintedAt: a.now });
      count++;
    }
    return { count };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  moveContentsNative: { danger: "high", summary: "Move everything stored at the given locations to another location (units out on a job are skipped)." },
  undoMoveContentsNative: { danger: "high", summary: "Exactly undo a recent Move contents by its audit id (puts back only rows the move left untouched)." },
  setLabelsPrintedNative: { danger: "low", summary: "Record that the given locations' bin labels were printed." },
  createNative: { danger: "medium" },
  updateNative: { danger: "medium" },
  undoCreateNative: { danger: "high", summary: "Exactly undo the creation of a location by its audit id (refuses once it has bins, contents or files)." },
  undoUpdateNative: { danger: "high", summary: "Exactly undo an edit of a location by its audit id (refuses if a changed field was edited again since)." },
  // Notes-only patch — cosmetic, trivially reversible.
  updateNotesNative: { danger: "low" },
  // Delete = high (§9): irreversible from the API's point of view, even though
  // guarded against locations with children/assets attached.
  removeNative: { danger: "high" },
};
