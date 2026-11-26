import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { assertRefInOrg } from "./lib/orgRef";
import { deriveNextDueDate } from "./lib/testTagNextDue";
import * as enums from "./lib/validators";

/**
 * The Test & tag item's real Edit (UX Phase 14, 14b-4, D80): a plain `recordFieldEdit` of an allow-listed set of the
 * item's own fields, with the ONE exact Undo (`undoEditNative`, ids only: author, 10-minute server window, once,
 * compare-and-set on the fields it changed; `lib/fieldEditUndo.ts`).
 *
 *  - Status is NOT a field: it moves only through a test, Retire and Reactivate. The tag id is not a field either.
 *  - Next due is DERIVED (last test + interval, D52), never typed: it is not in `set`. When the interval changes on an
 *    item that has been tested, the stored `nextDueDate` is re-derived in the SAME write and recorded in the snapshot,
 *    so the list's Overdue / Due and the Undo both stay exact.
 *  - A retired item is not edited (Reactivate it first).
 */
const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** The fields the edit sets (the allow-list) and the derived one its snapshot also tracks. */
export const TEST_TAG_EDIT_FIELDS = ["description", "equipmentClass", "applianceType", "make", "modelName", "serialNumber", "location", "testIntervalMonths", "testProfileId", "outletCount", "notes", "assetId", "bulkAssetId"] as const;
const TRACKED = [...TEST_TAG_EDIT_FIELDS, "nextDueDate"] as const;
const CLEARABLE = ["make", "modelName", "serialNumber", "location", "testProfileId", "outletCount", "notes", "assetId", "bulkAssetId"] as const;

const editSet = v.object({
  description: v.optional(v.string()),
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
});
type EditSet = {
  description?: string; equipmentClass?: string; applianceType?: string; make?: string; modelName?: string; serialNumber?: string; location?: string;
  testIntervalMonths?: number; testProfileId?: string; outletCount?: number; notes?: string; assetId?: string; bulkAssetId?: string;
};

const refuse = (code: string, message: string) => new ConvexError({ code, message });
const isRetired = (item: Doc<"testTagAssets">) => item.status === "RETIRED" || item.isActive === false;

async function loadItem(ctx: MutationCtx, orgId: string, id: string): Promise<Doc<"testTagAssets">> {
  const item = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!item || item.organizationId !== orgId) throw new ConvexError("Test tag asset not found");
  return item;
}

/** Field-level bounds (a browser caller can bypass the sheet's own checks), mirroring the create write's. */
function assertBounds(set: EditSet, clear: string[]): void {
  if (clear.some((f) => !(CLEARABLE as readonly string[]).includes(f))) throw refuse("INVALID_FIELD", "That field can't be cleared.");
  if (set.description !== undefined && !set.description.trim()) throw refuse("INVALID_FIELD", "An item needs a description.");
  assertStrLen(set.description, "Description", { max: 500 });
  assertStrLen(set.make, "Make", { max: 200 });
  assertStrLen(set.modelName, "Model", { max: 200 });
  assertStrLen(set.serialNumber, "Serial number", { max: 200 });
  assertStrLen(set.location, "Location", { max: 200 });
  assertStrLen(set.notes, "Notes", { max: 2000 });
  assertNumRange(set.testIntervalMonths, "Test interval", { min: 1, max: 120, integer: true });
  assertNumRange(set.outletCount, "Outlet count", { min: 1, max: 50, integer: true });
}

/** Linked records are validated only when CHANGED (`by_cuid` is global, so a foreign id would leak). */
async function assertLinks(ctx: MutationCtx, orgId: string, item: Doc<"testTagAssets">, set: EditSet): Promise<void> {
  if (set.assetId && set.assetId !== item.assetId) await assertRefInOrg(ctx, "assets", set.assetId, orgId);
  if (set.bulkAssetId && set.bulkAssetId !== item.bulkAssetId) await assertRefInOrg(ctx, "bulkAssets", set.bulkAssetId, orgId);
  if (set.testProfileId && set.testProfileId !== item.testProfileId) await assertRefInOrg(ctx, "testProfiles", set.testProfileId, orgId);
}

/** The item as it would read after the edit, with next due re-derived when the interval moved on a tested item. */
function nextState(item: Doc<"testTagAssets">, set: EditSet, clear: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...item, ...set, ...(set.description !== undefined ? { description: set.description.trim() } : {}) };
  for (const f of clear) delete next[f];
  if (set.testIntervalMonths !== undefined && set.testIntervalMonths !== item.testIntervalMonths && item.lastTestDate != null) {
    next.nextDueDate = deriveNextDueDate(item.lastTestDate, set.testIntervalMonths);
  }
  return next;
}

export const editNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean() }),
  args: { orgId: v.string(), id: v.string(), set: editSet, clear: v.array(v.string()), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "update");
    const actor = await resolveActor(ctx, a.actor);
    const item = await loadItem(ctx, a.orgId, a.id);
    if (isRetired(item)) throw refuse("RETIRED", "A retired item can't be edited. Reactivate it first.");
    assertBounds(a.set, a.clear);
    await assertLinks(ctx, a.orgId, item, a.set);

    const next = nextState(item, a.set, a.clear);
    // One link at a time: a serialised asset OR a bulk asset (only judged when this edit touches a link).
    if ((a.set.assetId || a.set.bulkAssetId) && next.assetId && next.bulkAssetId) throw refuse("INVALID_FIELD", "An item links one asset or one bulk asset, not both.");
    const diff = diffFields(item, next, TRACKED);
    if (!diff) return { id: a.id, changed: false };

    const patch: Record<string, unknown> = { updatedAt: a.now };
    for (const f of Object.keys(diff.after)) patch[f] = next[f]; // an absent value (`undefined`) clears the field
    await ctx.db.patch(item._id, patch);
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "testTagAsset", entityId: a.id, entityName: item.testTagId, auditId: a.auditId, actor, summary: `Edited test tag asset ${item.testTagId}`, diff, now: a.now });
    return { id: a.id, changed: true };
  },
});

export const undoEditNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "update");
    const actor = await resolveActor(ctx, a.actor);
    const item = await loadItem(ctx, a.orgId, a.id);
    await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "testTagAsset", entityId: a.id, entityName: item.testTagId, auditId: a.auditId, actor, now: a.now,
      load: async () => item as Record<string, unknown> & { _id: Doc<"testTagAssets">["_id"] },
      apply: async (_doc, plan) => {
        const fields = [...Object.keys(plan.set), ...plan.clear];
        if (fields.some((f) => !(TRACKED as readonly string[]).includes(f))) throw refuse("NOT_UNDOABLE", "This change can't be undone.");
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(item._id, patch);
      },
    });
    return { id: a.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  editNative: { danger: "medium", summary: "Edit a test & tag item's own fields (set and clear): description, class, type, make, model, serial, location, interval, profile, outlets, notes, links. Never its status; next due is re-derived when the interval changes." },
  undoEditNative: { danger: "high", summary: "Exactly undo a recent test & tag item edit by its audit id (refuses if a changed field changed since)." },
};
