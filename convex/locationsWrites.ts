import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { applyMove, planMove, undoMove, type MovedRow } from "./lib/locationMove";

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
    if (a.isDefault) await unsetOtherDefaults(ctx, a.orgId, undefined, a.now);

    await ctx.db.insert("locations", {
      id: a.id, organizationId: a.orgId, name: a.name,
      address: a.address || undefined, latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined,
      type: a.type ?? "WAREHOUSE", isDefault: a.isDefault ?? false,
      parentId: a.parentId || undefined, notes: a.notes || undefined, tags: a.tags ?? [],
      capacity: a.capacity ?? undefined,
      createdAt: a.now, updatedAt: a.now,
    });
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created location ${a.name}` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
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
    if (a.isDefault) await unsetOtherDefaults(ctx, a.orgId, a.id, a.now);

    // Clears use `undefined` (schema optionals reject null).
    await ctx.db.patch(doc._id, {
      name: a.name, address: a.address || undefined,
      latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined,
      type: a.type ?? "WAREHOUSE", isDefault: a.isDefault ?? false,
      parentId: a.parentId || undefined, notes: a.notes || undefined, tags: a.tags ?? [], updatedAt: a.now,
      ...(a.capacity !== undefined ? { capacity: a.capacity ?? undefined } : {}),
    });
    await logLocation(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated location ${a.name}` });
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
    const history = await ctx.db
      .query("activityLogs")
      .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", a.orgId).eq("entityType", "location").eq("entityId", row.entityId))
      .order("desc")
      .take(50);
    if (history.some((h) => h.action === "UNDO" && (h.details as { undoOf?: string } | undefined)?.undoOf === a.auditId)) throw new ConvexError("This move was already undone");

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
  // Notes-only patch — cosmetic, trivially reversible.
  updateNotesNative: { danger: "low" },
  // Delete = high (§9): irreversible from the API's point of view, even though
  // guarded against locations with children/assets attached.
  removeNative: { danger: "high" },
};
