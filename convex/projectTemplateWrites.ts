import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { assertBulkSizeOk, enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { diffFields, planFieldEditUndo, readSnapshot, recordFieldEdit, undoFieldEdit, undoMarkerId, type FieldEditSnapshot, type FieldValue } from "./lib/fieldEditUndo";
import { recalcProjectTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { MAX_TAGS } from "./lib/tagLimits";
import { duplicateCore, type CopiedPlan } from "./projectWrites";

/**
 * Templates (UX Phase 9, D23). Two families:
 *
 * - ARCHIVE / UNARCHIVE: deleting a template in the manager ARCHIVES it (status
 *   `CANCELLED` on the template row, no schema change) with an exact Undo (`fieldEditUndo`:
 *   ids only, reads the forward audit row). Only an archived template can be deleted for real
 *   (`deleteTemplateNative`), which has no Undo.
 * - APPLY / UNDO APPLY: `Start from template ▾` copies a template's plan and a few scalars
 *   onto the wizard's EMPTY draft (`duplicateCore`, the same copy `duplicateNative` runs),
 *   and its Undo removes exactly what that apply made, from the audit row, ids only.
 */
const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function loadTemplate(ctx: MutationCtx, orgId: string, id: string): Promise<Doc<"projects"> | null> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  // `by_cuid` is global: a row from another org reads as absent.
  return p && p.organizationId === orgId && p.isTemplate ? p : null;
}

// ─── archive / unarchive ─────────────────────────────────────────────────────

export const archiveTemplatesNative = mutation({
  returns: v.object({ archived: v.array(v.object({ id: v.string(), auditId: v.string() })) }),
  args: { orgId: v.string(), ids: v.array(v.string()), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.ids.length);
    await requireOrgPermission(ctx, a.orgId, "project", "delete");
    const actor = await resolveActor(ctx, a.actor);
    const archived: { id: string; auditId: string }[] = [];
    for (const id of new Set(a.ids)) {
      const t = await loadTemplate(ctx, a.orgId, id);
      if (!t) throw new ConvexError({ code: "NOT_FOUND", message: "Template not found." });
      if (t.status === "CANCELLED") continue; // already archived: nothing changed, no Undo for it
      const auditId = `${a.auditId}:${archived.length}`;
      const diff = diffFields({ status: t.status }, { status: "CANCELLED" }, ["status"]);
      await ctx.db.patch(t._id, { status: "CANCELLED", updatedAt: a.now });
      if (diff) {
        await recordFieldEdit(ctx, {
          orgId: a.orgId, entityType: "project", entityId: t.id, entityName: t.projectNumber, auditId, actor,
          summary: `Archived template ${t.projectNumber} - ${t.name}`, diff, now: a.now, links: { projectId: t.id },
        });
      }
      archived.push({ id: t.id, auditId });
    }
    return { archived };
  },
});

export const unarchiveTemplatesNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: {
    orgId: v.string(),
    /** The forward audit ids `archiveTemplatesNative` returned: ids only, nothing else decides what is restored. */
    items: v.array(v.object({ id: v.string(), auditId: v.string() })),
    actor: actorValidator,
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.items.length);
    await requireOrgPermission(ctx, a.orgId, "project", "delete");
    const actor = await resolveActor(ctx, a.actor);
    // One transaction, so a refusal for any one item rolls the whole Undo back (all-or-nothing).
    const restored: string[] = [];
    for (const item of a.items) {
      await undoFieldEdit(ctx, {
        orgId: a.orgId, entityType: "project", entityId: item.id, entityName: item.id, auditId: item.auditId, actor, now: a.now,
        load: () => loadTemplate(ctx, a.orgId, item.id),
        apply: async (doc, plan) => {
          const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
          for (const f of plan.clear) patch[f] = undefined;
          await ctx.db.patch(doc._id, patch);
        },
      });
      restored.push(item.id);
    }
    return { restored };
  },
});

// ─── apply / undo apply ──────────────────────────────────────────────────────

type Fill = (draft: Doc<"projects">, template: Doc<"projects">) => FieldValue | undefined;

/** Each scalar an apply may fill on the draft: the template's value, only where the draft has none (`undefined` = leave it). */
const FILLS: Record<string, Fill> = {
  type: (d, t) => ((!d.type || d.type === "OTHER") && t.type ? t.type : undefined),
  description: (d, t) => (!d.description && t.description ? t.description : undefined),
  discountPercent: (d, t) => (d.discountPercent == null && t.discountPercent != null ? t.discountPercent : undefined),
  tags: (d, t) => {
    const merged = [...new Set([...(d.tags ?? []), ...(t.tags ?? [])])].slice(0, MAX_TAGS);
    return merged.length === (d.tags ?? []).length ? undefined : merged;
  },
};

function scalarsFromTemplate(draft: Doc<"projects">, template: Doc<"projects">): Record<string, FieldValue> {
  const next: Record<string, FieldValue> = {};
  for (const [key, fill] of Object.entries(FILLS)) {
    const value = fill(draft, template);
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** The draft (an empty ENQUIRY in this org) and the live template an apply is about; throws for anything else. */
async function loadApplyTargets(ctx: MutationCtx, a: { orgId: string; draftId: string; templateId: string }) {
  const draft = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.draftId)).first();
  if (!draft || draft.organizationId !== a.orgId) throw new ConvexError({ code: "NOT_FOUND", message: "That draft no longer exists." });
  const versionId = draft.liveVersionId;
  if (draft.isTemplate || draft.status !== "ENQUIRY" || !versionId) {
    throw new ConvexError({ code: "NOT_A_DRAFT", message: "A template can only be applied to a draft enquiry." });
  }
  const template = await loadTemplate(ctx, a.orgId, a.templateId);
  if (!template || template.status === "CANCELLED") throw new ConvexError({ code: "NOT_FOUND", message: "Template not found." });
  const hasLines = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).first();
  if (hasLines) throw new ConvexError({ code: "CONFLICT", message: "This draft already has gear, so a template can't be applied over it." });
  return { draft, template, versionId };
}

export const applyTemplateNative = mutation({
  returns: v.object({ id: v.string(), lineCount: v.number() }),
  args: { orgId: v.string(), draftId: v.string(), templateId: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "create");
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);
    const { draft, template, versionId } = await loadApplyTargets(ctx, a);

    const { copied } = await duplicateCore(
      ctx,
      { sourceId: template.id, newId: draft.id, newProjectNumber: draft.projectNumber, newName: draft.name, orgId: a.orgId, now: a.now, actor, auditId: a.auditId },
      { versionId },
    );
    const after = scalarsFromTemplate(draft, template);
    const before: Record<string, FieldValue> = {};
    for (const k of Object.keys(after)) before[k] = ((draft as Record<string, unknown>)[k] ?? null) as FieldValue;
    if (Object.keys(after).length > 0) await ctx.db.patch(draft._id, { ...after, updatedAt: a.now });

    const fieldEdit: FieldEditSnapshot = { before, after, serverSavedAt: Date.now(), authorId: actor.userId };
    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "project", entityId: draft.id,
      entityName: draft.projectNumber, userId: actor.userId, userName: actor.userName, projectId: draft.id,
      summary: `Applied template ${template.projectNumber} - ${template.name} to ${draft.projectNumber}`,
      details: { fieldEdit, templateApply: { templateId: template.id, copied, copiedAt: a.now } }, createdAt: a.now,
    });
    return { id: draft.id, lineCount: copied.lines.length };
  },
});

/** Everything `applyTemplateNative` made must still be exactly as it left it, and nothing else may be on the draft. */
async function assertApplyUntouched(ctx: MutationCtx, project: Doc<"projects">, copied: CopiedPlan, copiedAt: number): Promise<void> {
  const versionId = project.liveVersionId;
  if (!versionId) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the draft has no live version." });
  const lines = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).take(copied.lines.length + 1);
  const cats = await ctx.db.query("projectCategories").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).take(copied.categories.length + 1);
  const groups = await ctx.db.query("projectGroups").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).take(copied.groups.length + 1);
  const exact = (rows: { id: string; updatedAt?: number }[], ids: string[]) =>
    rows.length === ids.length && ids.every((id) => rows.some((r) => r.id === id && r.updatedAt === copiedAt));
  if (!exact(lines, copied.lines) || !exact(cats, copied.categories) || !exact(groups, copied.groups)) {
    throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the gear from the template has been changed since." });
  }
}

type TemplateApply = { copied: CopiedPlan; copiedAt: number };

/** The apply's own audit row: this org's, this project's, with its template record and field snapshot. */
async function loadApplyAudit(ctx: MutationCtx, a: { orgId: string; projectId: string; applyAuditId: string }) {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.applyAuditId)).first();
  const ta = (row?.details as { templateApply?: TemplateApply } | undefined)?.templateApply;
  if (!row || row.organizationId !== a.orgId || row.entityType !== "project" || row.entityId !== a.projectId || !ta) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That change was not found, so it can't be undone." });
  }
  const snapshot = readSnapshot(row.details);
  if (!snapshot) throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
  return { ta, snapshot };
}

/** The apply's audit, the draft and the exact scalar restore, after every guard (author, window, once, still an Enquiry). */
async function loadUndoTarget(ctx: MutationCtx, a: { orgId: string; projectId: string; applyAuditId: string }, userId: string) {
  const { ta, snapshot } = await loadApplyAudit(ctx, a);
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
  if (!project || project.organizationId !== a.orgId) throw new ConvexError({ code: "NOT_FOUND", message: "That draft no longer exists." });
  if (project.isTemplate || project.status !== "ENQUIRY") {
    throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the job has moved on from an enquiry." });
  }
  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(a.applyAuditId))).first();
  const plan = planFieldEditUndo({
    snapshot, current: project, actorId: userId, serverNow: Date.now(), alreadyUndone: !!marker && marker.organizationId === a.orgId,
  });
  return { project, ta, plan };
}

/** Delete exactly the rows the apply made (ids from its audit row), in the draft's own live version. */
async function removeCopiedPlan(ctx: MutationCtx, orgId: string, project: Doc<"projects">, copied: CopiedPlan): Promise<void> {
  const versionId = project.liveVersionId as string;
  const byVersion = (table: "projectLineItems" | "projectGroups" | "projectCategories", ids: string[]) =>
    Promise.all(ids.map(async (id) => {
      const row = await ctx.db.query(table).withIndex("by_versionId", (q) => q.eq("versionId", versionId)).filter((q) => q.eq(q.field("id"), id)).first();
      if (row) await ctx.db.delete(row._id);
    }));
  await byVersion("projectLineItems", copied.lines);
  await byVersion("projectGroups", copied.groups);
  await byVersion("projectCategories", copied.categories);
  for (const id of copied.managers) {
    const m = await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).filter((q) => q.eq(q.field("id"), id)).first();
    if (m && m.organizationId === orgId) await ctx.db.delete(m._id);
  }
}

export const undoApplyTemplateNative = mutation({
  returns: v.object({ removedLines: v.number() }),
  args: { orgId: v.string(), projectId: v.string(), applyAuditId: v.string(), actor: actorValidator, now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);
    const { project, ta, plan } = await loadUndoTarget(ctx, a, actor.userId);
    await assertApplyUntouched(ctx, project, ta.copied, ta.copiedAt);

    await removeCopiedPlan(ctx, a.orgId, project, ta.copied);
    const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
    for (const f of plan.clear) patch[f] = undefined;
    await ctx.db.patch(project._id, patch);
    await recalcProjectTotals(ctx, a.projectId, a.orgId, await resolveOrgDefaultTaxRate(ctx, a.orgId), a.now);

    await writeActivityLog(ctx, {
      id: undoMarkerId(a.applyAuditId), organizationId: a.orgId, action: "UPDATE", entityType: "project", entityId: a.projectId,
      entityName: project.projectNumber, userId: actor.userId, userName: actor.userName, projectId: a.projectId,
      summary: `Undid applying a template to ${project.projectNumber}`, details: { undoOf: a.applyAuditId }, createdAt: a.now,
    });
    return { removedLines: ta.copied.lines.length };
  },
});

export const agentOps: AgentOpsAnnotations = {
  archiveTemplatesNative: { summary: "Archive job templates (reversible: returns each audit id for the exact Undo); an archived template can then be deleted.", danger: "medium" },
  unarchiveTemplatesNative: { summary: "Undo an archive of job templates, from the audit ids the archive returned.", danger: "low" },
  applyTemplateNative: { summary: "Copy a template's gear, tags, type, description and discount onto an empty draft enquiry; refuses a draft that already has gear.", danger: "medium" },
  undoApplyTemplateNative: { summary: "Undo applying a template to a draft: removes exactly what the apply made, refusing if anything was changed since.", danger: "medium" },
};
