import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertAuditIdFree, writeActivityLog } from "./lib/audit";
import { assertStrLen, assertNumRange, assertTags } from "./lib/fieldGuards";
import { diffFields, recordFieldEdit, undoFieldEdit, undoMarkerId } from "./lib/fieldEditUndo";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { assertNotUsedBySettings } from "./lib/categorySettingsRefs";
import * as enums from "./lib/validators";

/**
 * The category record's Edit and Delete (UX Phase 14, 14b-5, D77), each with an exact Undo (ids only).
 *
 *  - **Edit** is a plain `recordFieldEdit` of an allow-listed set of the category's own fields, including its optional
 *    default Test & tag class and interval (the ONLY T&T defaults: no profile, no appliance type). A parent is set to a
 *    category of this org that is not the category itself or one of its descendants (no cycles); clearing goes through
 *    `clear`. `undoEditNative`: author, 10-minute server window, once, compare-and-set on the fields it changed.
 *  - **Delete** moves the category's models and kits to Uncategorised and its subcategories up one level (to the deleted
 *    category's own parent, or the top), then removes it. The forward audit row records the exact ids it moved and the
 *    category's whole stored document; `undoDeleteNative` recreates the category under the same id and puts exactly those
 *    rows back, and refuses as a whole unless each is still exactly as the delete left it.
 */
const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const CATEGORY_EDIT_FIELDS = ["name", "parentId", "description", "icon", "tags", "xeroAccountCode", "defaultEquipmentClass", "defaultTestIntervalMonths"] as const;
const CLEARABLE = ["parentId", "description", "icon", "xeroAccountCode", "defaultEquipmentClass", "defaultTestIntervalMonths"] as const;
/** The most rows one delete moves (models + kits + subcategories each), so the audit row and the transaction stay bounded. */
const MAX_MOVED = 500;

const editSet = v.object({
  name: v.optional(v.string()),
  parentId: v.optional(v.string()),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  xeroAccountCode: v.optional(v.string()),
  defaultEquipmentClass: v.optional(enums.EquipmentClass),
  defaultTestIntervalMonths: v.optional(v.number()),
});
type EditSet = {
  name?: string; parentId?: string; description?: string; icon?: string; tags?: string[]; xeroAccountCode?: string;
  defaultEquipmentClass?: string; defaultTestIntervalMonths?: number;
};

const refuse = (code: string, message: string) => new ConvexError({ code, message });

async function loadCategory(ctx: MutationCtx, orgId: string, id: string): Promise<Doc<"categories">> {
  const cat = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!cat || cat.organizationId !== orgId) throw new ConvexError("Category not found");
  return cat;
}

async function orgCategories(ctx: MutationCtx, orgId: string): Promise<Doc<"categories">[]> {
  return await ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: categories is a small bounded per-org tree — see docs/exceptions.md R-8.3.3
}

/** `id` and every category below it (a parentId walk over the org's tree). */
function subtreeIds(cats: Doc<"categories">[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of cats) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
  }
  return ids;
}

function assertBounds(set: EditSet, clear: string[]): void {
  if (clear.some((f) => !(CLEARABLE as readonly string[]).includes(f))) throw refuse("INVALID_FIELD", "That field can't be cleared.");
  if (set.name !== undefined && !set.name.trim()) throw refuse("INVALID_FIELD", "A category needs a name.");
  assertStrLen(set.name, "name", { max: 100 });
  assertStrLen(set.description, "description", { max: 500 });
  assertStrLen(set.icon, "icon", { max: 10 });
  assertStrLen(set.xeroAccountCode, "xeroAccountCode", { max: 50 });
  assertStrLen(set.parentId, "parent", { min: 1 });
  assertNumRange(set.defaultTestIntervalMonths, "default test interval", { min: 1, max: 120, integer: true });
}

/** A new parent must be a category of this org below which nothing of this category's own subtree sits. */
async function assertParentOk(ctx: MutationCtx, orgId: string, id: string, parentId: string): Promise<void> {
  const cats = await orgCategories(ctx, orgId);
  if (!cats.some((c) => c.id === parentId)) throw new ConvexError("Parent category not found");
  if (subtreeIds(cats, id).has(parentId)) throw refuse("INVALID_FIELD", "A category can't be moved inside itself or one of its own subcategories.");
}

export const editNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean() }),
  args: { orgId: v.string(), id: v.string(), set: editSet, clear: v.array(v.string()), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    const cat = await loadCategory(ctx, a.orgId, a.id);
    assertBounds(a.set, a.clear);
    const tags = a.set.tags === undefined ? undefined : assertTags(a.set.tags);
    if (a.set.parentId && a.set.parentId !== cat.parentId) await assertParentOk(ctx, a.orgId, a.id, a.set.parentId);

    const next: Record<string, unknown> = { ...cat, ...a.set, ...(a.set.name !== undefined ? { name: a.set.name.trim() } : {}), ...(tags ? { tags } : {}) };
    for (const f of a.clear) delete next[f];
    const diff = diffFields(cat, next, CATEGORY_EDIT_FIELDS);
    if (!diff) return { id: a.id, changed: false };

    const patch: Record<string, unknown> = { updatedAt: a.now };
    for (const f of Object.keys(diff.after)) patch[f] = next[f]; // an absent value (`undefined`) clears the field
    await ctx.db.patch(cat._id, patch);
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "category", entityId: a.id, entityName: String(next.name), auditId: a.auditId, actor, summary: `Edited category ${cat.name}`, diff, now: a.now });
    return { id: a.id, changed: true };
  },
});

export const undoEditNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "update");
    const actor = await resolveActor(ctx, a.actor);
    const cat = await loadCategory(ctx, a.orgId, a.id);
    await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "category", entityId: a.id, entityName: cat.name, auditId: a.auditId, actor, now: a.now,
      load: async () => cat as Record<string, unknown> & { _id: Doc<"categories">["_id"] },
      apply: async (_doc, plan) => {
        const fields = [...Object.keys(plan.set), ...plan.clear];
        if (fields.some((f) => !(CATEGORY_EDIT_FIELDS as readonly string[]).includes(f))) throw refuse("NOT_UNDOABLE", "This change can't be undone.");
        // The old parent must still exist and still not sit below this category.
        if (typeof plan.set.parentId === "string") await assertParentOk(ctx, a.orgId, a.id, plan.set.parentId);
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(cat._id, patch);
      },
    });
    return { id: a.id };
  },
});

// ─── delete (models and kits to Uncategorised, subcategories up) ─────────────────────────────

interface DeleteSnapshot {
  category: Record<string, unknown>;
  models: string[];
  kits: string[];
  children: string[];
  serverSavedAt: number;
  authorId: string;
}

const stripSystem = (doc: Doc<"categories">): Record<string, unknown> => {
  const { _id, _creationTime, ...rest } = doc;
  void _id; void _creationTime;
  return Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
};

/** The rows a delete would move, org-checked and bounded; refuses a category too large to move atomically. */
async function rowsToMove(ctx: MutationCtx, orgId: string, id: string) {
  const models = (await ctx.db.query("models").withIndex("by_categoryId", (q) => q.eq("categoryId", id)).take(MAX_MOVED + 1)).filter((m) => m.organizationId === orgId);
  const kits = (await ctx.db.query("kits").withIndex("by_categoryId", (q) => q.eq("categoryId", id)).take(MAX_MOVED + 1)).filter((k) => k.organizationId === orgId);
  const children = (await ctx.db.query("categories").withIndex("by_parentId", (q) => q.eq("parentId", id)).take(MAX_MOVED + 1)).filter((c) => c.organizationId === orgId);
  if (models.length > MAX_MOVED || kits.length > MAX_MOVED || children.length > MAX_MOVED) {
    throw refuse("TOO_MANY", `This category holds more than ${MAX_MOVED} models, kits or subcategories. Move some out first, then delete it.`);
  }
  return { models, kits, children };
}

export const deleteNative = mutation({
  returns: v.object({ id: v.string(), movedModels: v.number(), movedKits: v.number(), movedSubcategories: v.number() }),
  args: { orgId: v.string(), id: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "delete");
    const actor = await resolveActor(ctx, a.actor);
    const cat = await loadCategory(ctx, a.orgId, a.id);
    await assertAuditIdFree(ctx, a.auditId);
    await assertNotUsedBySettings(ctx, a.orgId, a.id);
    const { models, kits, children } = await rowsToMove(ctx, a.orgId, a.id);

    for (const m of models) await ctx.db.patch(m._id, { categoryId: undefined });
    for (const k of kits) await ctx.db.patch(k._id, { categoryId: undefined });
    for (const c of children) await ctx.db.patch(c._id, { parentId: cat.parentId });
    await ctx.db.delete(cat._id);

    const snapshot: DeleteSnapshot = {
      category: stripSystem(cat), models: models.map((m) => m.id), kits: kits.map((k) => k.id), children: children.map((c) => c.id),
      serverSavedAt: Date.now(), authorId: actor.userId,
    };
    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "DELETE", entityType: "category", entityId: a.id, entityName: cat.name,
      userId: actor.userId, userName: actor.userName, summary: `Deleted category ${cat.name}`, details: { categoryDelete: snapshot }, createdAt: a.now,
    });
    return { id: a.id, movedModels: models.length, movedKits: kits.length, movedSubcategories: children.length };
  },
});

function readDeleteSnapshot(details: unknown): DeleteSnapshot | null {
  const s = (details as { categoryDelete?: Partial<DeleteSnapshot> } | null | undefined)?.categoryDelete;
  if (!s || typeof s.authorId !== "string" || typeof s.serverSavedAt !== "number" || !s.category || !Array.isArray(s.models) || !Array.isArray(s.kits) || !Array.isArray(s.children)) return null;
  return s as DeleteSnapshot;
}

/** The forward delete row this Undo reverses, proven undoable by `actorUserId`: this org's, not undone, the author, in the window. */
async function loadUndoableDelete(ctx: MutationCtx, a: { orgId: string; id: string; auditId: string; actorUserId: string }): Promise<DeleteSnapshot> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  if (!row || row.organizationId !== a.orgId || row.entityType !== "category" || row.entityId !== a.id) throw refuse("NOT_FOUND", "That change was not found, so it can't be undone.");
  const s = readDeleteSnapshot(row.details);
  if (!s) throw refuse("NOT_UNDOABLE", "That change can't be undone.");
  if (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(a.auditId))).first()) throw refuse("ALREADY_UNDONE", "That change was already undone.");
  if (s.authorId !== a.actorUserId) throw refuse("NOT_AUTHOR", "Only the person who made a change can undo it.");
  assertWithinUndoWindow(s.serverSavedAt, Date.now(), "change");
  return s;
}

/** Every moved row must still be exactly as the delete left it; otherwise nothing is restored. */
async function assertStillAsLeft(ctx: MutationCtx, orgId: string, s: DeleteSnapshot): Promise<void> {
  const formerParent = s.category.parentId as string | undefined;
  const rows = [
    ...(await Promise.all(s.models.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first()))).map((r) => ({ r, left: r?.categoryId === undefined })),
    ...(await Promise.all(s.kits.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first()))).map((r) => ({ r, left: r?.categoryId === undefined })),
    ...(await Promise.all(s.children.map((id) => ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).first()))).map((r) => ({ r, left: r?.parentId === formerParent })),
  ];
  if (rows.some(({ r, left }) => !r || r.organizationId !== orgId || !left)) throw refuse("CHANGED_SINCE", "Can't undo: something it moved has changed since.");
}

export const undoDeleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "category");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "model", "delete");
    const actor = await resolveActor(ctx, a.actor);
    const s = await loadUndoableDelete(ctx, { orgId: a.orgId, id: a.id, auditId: a.auditId, actorUserId: actor.userId });
    if (s.category.organizationId !== a.orgId) throw refuse("NOT_UNDOABLE", "That change can't be undone.");
    if (await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", a.id)).first()) throw refuse("CHANGED_SINCE", "Can't undo: a category with that id exists again.");
    const parentId = s.category.parentId as string | undefined;
    if (parentId && !(await orgCategories(ctx, a.orgId)).some((c) => c.id === parentId)) throw refuse("CHANGED_SINCE", "Can't undo: its parent category has been deleted since.");
    await assertStillAsLeft(ctx, a.orgId, s);

    await ctx.db.insert("categories", s.category as never);
    for (const id of s.models) { const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first(); await ctx.db.patch(m!._id, { categoryId: a.id }); }
    for (const id of s.kits) { const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first(); await ctx.db.patch(k!._id, { categoryId: a.id }); }
    for (const id of s.children) { const c = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).first(); await ctx.db.patch(c!._id, { parentId: a.id }); }
    await writeActivityLog(ctx, {
      id: undoMarkerId(a.auditId), organizationId: a.orgId, action: "UNDO", entityType: "category", entityId: a.id, entityName: String(s.category.name),
      userId: actor.userId, userName: actor.userName, summary: `Restored category ${String(s.category.name)} (undo of delete)`, details: { undoOf: a.auditId }, createdAt: a.now,
    });
    return { id: a.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  editNative: { danger: "medium", summary: "Edit a category's own fields (set and clear): name, parent, description, icon, tags, Xero code, default test & tag class and interval. A parent can't be the category itself or below it." },
  undoEditNative: { danger: "high", summary: "Exactly undo a recent category edit by its audit id (refuses if a changed field changed since)." },
  deleteNative: { danger: "high", summary: "Delete a category: its models and kits become Uncategorised and its subcategories move up one level. Exactly undoable by its audit id." },
  undoDeleteNative: { danger: "high", summary: "Exactly undo a recent category delete by its audit id (refuses unless everything it moved is still as it left it)." },
};
