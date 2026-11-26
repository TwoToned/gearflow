import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { requireOrgPermission } from "./lib/auth";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import { assertStrLen, assertNumRange, assertTags } from "./lib/fieldGuards";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { loadMaintenanceRecord, maintenanceWritePrelude } from "./lib/maintenanceRecordAccess";
import { assertNewMaintenancePhotos, releaseRemovedMaintenancePhotos } from "./lib/maintenancePhotos";
import { storageIdOf } from "./lib/checkPhotos";
import { assertMemberInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";
import { existingLinks, insertLink } from "./maintenanceWrites";

/**
 * The maintenance EDIT SHEET's save (UX Phase 14, 14b-3): `set` writes fields, `clear` empties them (the legacy
 * `updateNative` is a full replace and could not leave a field alone). It is a plain field edit with ONE audit row
 * (`recordFieldEdit`) and an ids-only exact Undo (`undoEditNative` on `undoFieldEdit`):
 *
 *  - STATUS is not a field. It moves only through `Complete…` / `Reopen` (`maintenanceLifecycleWrites`), so a sheet
 *    save never changes a hold. The result and completed date are those verbs' too, and `partsUsed` (the old free
 *    text) is never written here.
 *  - Asset MEMBERSHIP (`assetIds`) is editable only while the job is `SCHEDULED`, when it holds nothing, so adding
 *    or removing a link cannot move an asset's status. On a live or closed job it is refused (`JOB_LIVE`).
 *  - Labour (`cost`) is job cost: a hidden caller (a `noFinancials` key) can neither set nor clear it, and cannot undo
 *    an edit that touched it. A NEW photo passes the attach rule (`lib/maintenancePhotos.ts`); photos the save drops
 *    have their bytes deleted only through `deleteStoredFileIfUnreferenced`, and then the edit is `undoable: false`
 *    (an Undo never deletes or resurrects a stored file).
 */
const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const MAINTENANCE_EDIT_FIELDS = ["title", "type", "description", "scheduledDate", "assignedToId", "reportedById", "tags", "photos", "nextDueDate", "cost", "assetIds"] as const;
const CLEARABLE = ["description", "scheduledDate", "assignedToId", "reportedById", "nextDueDate", "cost"] as const;
const COST_FIELDS = ["cost"] as const;

const editSet = v.object({
  title: v.optional(v.string()),
  type: v.optional(enums.MaintenanceType),
  description: v.optional(v.string()),
  scheduledDate: v.optional(v.number()),
  assignedToId: v.optional(v.string()),
  reportedById: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  photos: v.optional(v.array(v.string())),
  nextDueDate: v.optional(v.number()),
  cost: v.optional(v.number()),
});
type EditSet = { title?: string; type?: string; description?: string; scheduledDate?: number; assignedToId?: string; reportedById?: string; tags?: string[]; photos?: string[]; nextDueDate?: number; cost?: number };

const refuse = (code: string, message: string) => new ConvexError({ code, message });
const isCostField = (f: string) => (COST_FIELDS as readonly string[]).includes(f);

/** `set` / `clear` without the cost fields for a caller who cannot see job cost (the write follows the read). */
async function withoutHiddenCost(ctx: MutationCtx, orgId: string, set: EditSet, clear: string[]): Promise<{ set: EditSet; clear: string[] }> {
  if (await canSeeJobCost(ctx, orgId)) return { set, clear };
  const { cost: _hidden, ...rest } = set;
  void _hidden;
  return { set: rest, clear: clear.filter((f) => !isCostField(f)) };
}

/** Field-level bounds and references (a browser caller can bypass the sheet's own checks). */
async function assertEditable(ctx: MutationCtx, orgId: string, rec: Doc<"maintenanceRecords">, set: EditSet, clear: string[]): Promise<void> {
  if (clear.some((f) => !(CLEARABLE as readonly string[]).includes(f))) throw refuse("INVALID_FIELD", "That field can't be cleared.");
  if (set.title !== undefined && !set.title.trim()) throw refuse("INVALID_FIELD", "A job needs a title.");
  assertStrLen(set.title, "title", { max: 200 });
  assertStrLen(set.description, "description", { max: 5000 });
  assertNumRange(set.cost, "cost", { min: 0 });
  assertNumRange(set.scheduledDate, "scheduled date", {});
  assertNumRange(set.nextDueDate, "next due", {});
  if ((set.photos?.length ?? 0) > 20) throw refuse("INVALID_FIELD", "A job can have at most 20 photos.");
  // Members are validated only when CHANGED, so a job whose assignee has since left can still be edited.
  if (set.assignedToId && set.assignedToId !== rec.assignedToId) await assertMemberInOrg(ctx, orgId, set.assignedToId);
  if (set.reportedById && set.reportedById !== rec.reportedById) await assertMemberInOrg(ctx, orgId, set.reportedById);
}

/** The distinct assets a job links, sorted (the one stable order the snapshot compares). */
async function linkedAssetIdsSorted(ctx: MutationCtx, recordId: string): Promise<string[]> {
  const links = await existingLinks(ctx, recordId);
  return [...new Set(links.map((l) => l.assetId).filter((x): x is string => x != null))].sort();
}

/** The new membership, proven editable: the job holds nothing (SCHEDULED), at least one asset, no duplicates. */
function nextAssetIds(rec: Doc<"maintenanceRecords">, requested: string[]): string[] {
  if ((rec.status ?? "SCHEDULED") !== "SCHEDULED") {
    throw refuse("JOB_LIVE", "Assets can only be changed while the job is Scheduled: once it is under way they are held, so use Complete or Reopen.");
  }
  const ids = [...new Set(requested)].sort();
  if (ids.length === 0) throw refuse("INVALID_FIELD", "A job needs at least one asset.");
  return ids;
}

/** Link the assets that are new and unlink the ones that are gone. The job is SCHEDULED, so no hold moves. */
async function applyAssetLinks(ctx: MutationCtx, orgId: string, recordId: string, current: string[], next: string[]): Promise<void> {
  const keep = new Set(next);
  for (const l of await existingLinks(ctx, recordId)) if (l.assetId && !keep.has(l.assetId)) await ctx.db.delete(l._id);
  const had = new Set(current);
  for (const assetId of next) if (!had.has(assetId)) await insertLink(ctx, orgId, recordId, createId(), assetId);
}

// ─── edit ────────────────────────────────────────────────────────────────────
export const editNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean(), undoable: v.boolean() }),
  args: { orgId: v.string(), id: v.string(), set: editSet, clear: v.array(v.string()), assetIds: v.optional(v.array(v.string())), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    const actor = await maintenanceWritePrelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadMaintenanceRecord(ctx, a.orgId, a.id);
    const { set, clear } = await withoutHiddenCost(ctx, a.orgId, a.set, a.clear);
    await assertEditable(ctx, a.orgId, rec, set, clear);
    await assertNewMaintenancePhotos(ctx, { orgId: a.orgId, actorUserId: actor.userId, photos: set.photos, existing: rec.photos ?? [] });
    const tags = set.tags === undefined ? undefined : assertTags(set.tags);

    const currentIds = await linkedAssetIdsSorted(ctx, a.id);
    const nextIds = a.assetIds === undefined ? currentIds : nextAssetIds(rec, a.assetIds);
    const next: Record<string, unknown> = { ...rec, ...set, ...(set.title !== undefined ? { title: set.title.trim() } : {}), ...(tags ? { tags } : {}), assetIds: nextIds };
    for (const f of clear) delete next[f];
    const diff = diffFields({ ...rec, assetIds: currentIds }, next, MAINTENANCE_EDIT_FIELDS);
    if (!diff) return { id: a.id, changed: false, undoable: false };

    const patch: Record<string, unknown> = { ...set, ...(set.title !== undefined ? { title: next.title } : {}), ...(tags ? { tags } : {}), updatedAt: a.now };
    for (const f of clear) patch[f] = undefined;
    await ctx.db.patch(rec._id, patch);
    if (nextIds !== currentIds) await applyAssetLinks(ctx, a.orgId, a.id, currentIds, nextIds);
    const deleted = set.photos ? await releaseRemovedMaintenancePhotos(ctx, { orgId: a.orgId, before: rec.photos ?? [], after: set.photos }) : 0;
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "maintenance", entityId: a.id, entityName: String(next.title), auditId: a.auditId, actor, summary: `Edited maintenance record: ${rec.title}`, diff, now: a.now });
    return { id: a.id, changed: true, undoable: deleted === 0 };
  },
});

// ─── undo ────────────────────────────────────────────────────────────────────
/** A photo the Undo would restore must still exist: an edit that deleted its bytes cannot be undone. */
async function assertPhotosRestorable(ctx: MutationCtx, orgId: string, restoring: string[], current: string[]): Promise<void> {
  const here = new Set(current);
  for (const url of restoring.filter((u) => !here.has(u))) {
    const storageId = storageIdOf(url);
    const stored = storageId ? await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique() : null;
    if (!stored || stored.organizationId !== orgId) throw refuse("NOT_UNDOABLE", "A photo that edit removed has been deleted, so it can't be undone.");
  }
}

export const undoEditNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    const actor = await maintenanceWritePrelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadMaintenanceRecord(ctx, a.orgId, a.id);
    const currentIds = await linkedAssetIdsSorted(ctx, a.id);
    const hidden = !(await canSeeJobCost(ctx, a.orgId));
    await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "maintenance", entityId: a.id, entityName: rec.title, auditId: a.auditId, actor, now: a.now,
      load: async () => ({ ...rec, assetIds: currentIds }) as Record<string, unknown> & { _id: Doc<"maintenanceRecords">["_id"] },
      apply: async (_doc, plan) => {
        const fields = [...Object.keys(plan.set), ...plan.clear];
        if (fields.some((f) => !(MAINTENANCE_EDIT_FIELDS as readonly string[]).includes(f))) throw refuse("NOT_UNDOABLE", "This change can't be undone.");
        if (hidden && fields.some(isCostField)) throw refuse("NOT_UNDOABLE", "That change touched labour, which this key can't see, so it can't be undone here.");
        if (Array.isArray(plan.set.photos)) await assertPhotosRestorable(ctx, a.orgId, plan.set.photos as string[], rec.photos ?? []);
        const { assetIds, ...fieldsSet } = plan.set;
        const patch: Record<string, unknown> = { ...fieldsSet, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        if (Array.isArray(assetIds)) {
          nextAssetIds(rec, assetIds as string[]); // refuses (JOB_LIVE) once the job is under way
          await applyAssetLinks(ctx, a.orgId, a.id, currentIds, assetIds as string[]);
        }
        await ctx.db.patch(rec._id, patch);
      },
    });
    return { id: a.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  editNative: { danger: "medium", summary: "Edit a maintenance job's own fields (set and clear): title, type, description, dates, people, tags, photos, labour; assets only while it is Scheduled. Never its status." },
  undoEditNative: { danger: "high", summary: "Exactly undo a recent maintenance edit by its audit id (refuses if a changed field or the asset list changed since)." },
};
