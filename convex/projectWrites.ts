import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertNoBlockingCommentsInMutation } from "./lib/blockingCommentsGate";

/** Forward status transitions that a project's open BLOCKING comments must gate
 *  (parity with src/server/projects.ts BLOCKED_FORWARD_PROJECT_STATUSES). */
const BLOCKED_FORWARD_STATUSES = new Set(["PREPPING", "CHECKED_OUT", "ON_SITE"]);
const blockedForwardLabel = (status: string): string =>
  `move this project to ${status.toLowerCase().replaceAll("_", " ")}`;
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import { bumpProjectCounters } from "./lib/counters";
import * as enums from "./lib/validators";
import { projectWriteFields } from "./projects";

/**
 * Native PROJECT write mutations (Phase 5) — the MONEY-FREE project writes only:
 * status change, notes, archive. Each does RBAC(requireOrgPermission "project",
 * "update") + invariant + atomic audit in one transaction.
 *
 * The financial writes (createProject/updateProject and every line-item write) call
 * recalculateProjectTotals and are deliberately NOT here — those stay server-side so
 * the totals math is untouched (parity preserved by construction) until they get the
 * dedicated recalc-parity treatment. Gated behind NATIVE_PROJECT_WRITES.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const NOTES_FIELD = v.union(
  v.literal("crewNotes"),
  v.literal("internalNotes"),
  v.literal("clientNotes"),
);

export const updateStatusNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    status: enums.ProjectStatus,
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, status, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_STATUS", message: "Templates don't have a status." });
    }

    const from = project.status ?? "";
    // Open blocking comments gate a FORWARD move into PREPPING/CHECKED_OUT/ON_SITE (parity
    // with the deleted server action). Only on an actual status change (template excluded above).
    if (from !== status && BLOCKED_FORWARD_STATUSES.has(status)) {
      await assertNoBlockingCommentsInMutation(ctx, orgId, id, { actionLabel: blockedForwardLabel(status) });
    }
    await ctx.db.patch(project._id, { status, updatedAt: now });
    await bumpProjectCounters(ctx, orgId, project, { ...project, status });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "STATUS_CHANGE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Changed project ${project.projectNumber} status from ${from} to ${status}`,
      details: { changes: [{ field: "status", from, to: status }] },
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

export const updateNotesNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    field: NOTES_FIELD,
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, field, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // `undefined` clears the field (matches the server action's notes || null).
    await ctx.db.patch(project._id, { [field]: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated ${field} on project ${project.projectNumber}`,
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(project._id, { status: "CANCELLED", updatedAt: now });
    await bumpProjectCounters(ctx, orgId, project, { ...project, status: "CANCELLED" });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Archived project ${project.projectNumber}`,
      details: { archived: true },
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * The recalc-OWNED money totals. They are derived from the full line-item/service/
 * sub-hire/assignment set by `recalcProjectTotals` (convex/lib/recalc.ts) and must NEVER
 * come from a client — a browser-direct caller could otherwise `set:{ total:0, margin:1e9 }`
 * and forge the project's financials. The legit server path never sends these (createProject
 * omits them; updateProject builds a Zod-validated set with no totals), so stripping is
 * non-breaking. `taxRate`/`discountPercent` are recalc INPUTS and stay settable.
 */
const PROJECT_MONEY_ANCHORS = [
  "equipmentRevenue", "serviceCostTotal", "labourCostTotal", "subHireCostTotal",
  "subtotal", "discountAmount", "taxAmount", "total", "margin",
] as const;

/** Immutable on a general `updateNative` patch: the money anchors + `isTemplate` (a project
 * is never flipped to a template in place — that's a saveAsTemplate copy). `projectNumber`
 * stays editable (a legit code edit). */
const PROJECT_UPDATE_IMMUTABLE = [...PROJECT_MONEY_ANCHORS, "isTemplate"] as const;

const PROJECT_NEVER_CLEAR = new Set<string>([
  "id", "organizationId", "projectNumber", ...PROJECT_UPDATE_IMMUTABLE,
]);

/**
 * updateNative — general project field patch (set/clear) + UPDATE audit, atomic.
 * RBAC(project, update). Option A: the server action keeps Zod validation + the
 * conditional recalc (only when taxRate changes — recalc stays server-side, totals
 * identical); the write + audit move here.
 */
export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    set: v.any(),
    clear: v.array(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // strip organizationId/id (no cross-tenant reassign) + the recalc-owned money anchors
    // and isTemplate (no client-forged totals / in-place template flip).
    const setObj = sanitizeClientSet(set, PROJECT_UPDATE_IMMUTABLE);

    // A general update that also moves the status FORWARD into PREPPING/CHECKED_OUT/ON_SITE
    // must clear the blocking-comment gate too (parity with the server updateProject path).
    const nextStatus = typeof setObj.status === "string" ? setObj.status : undefined;
    if (nextStatus && nextStatus !== project.status && BLOCKED_FORWARD_STATUSES.has(nextStatus) && !project.isTemplate) {
      await assertNoBlockingCommentsInMutation(ctx, orgId, id, { actionLabel: blockedForwardLabel(nextStatus) });
    }
    if (clear.length === 0) {
      await ctx.db.patch(project._id, setObj);
      await bumpProjectCounters(ctx, orgId, project, { ...project, ...setObj });
    } else {
      const { _id, _creationTime, ...rest } = project;
      const merged: Record<string, unknown> = { ...rest, ...setObj };
      for (const k of clear) {
        if (PROJECT_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(project._id, merged as typeof rest);
      await bumpProjectCounters(ctx, orgId, project, merged);
    }

    const name = (typeof setObj.name === "string" ? setObj.name : undefined) ?? project.name;
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated project ${project.projectNumber} - ${name}`,
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * createNative — insert a project with the unique-project-number check + CREATE
 * audit, atomic. RBAC(project, create). Mirrors createWithUniqueNumber: returns
 * {created:false} without inserting/auditing when the number clashes (the server
 * action's allocation retry loop handles that), {created:true} + audit on success.
 * generateProjectNumber (the auto-number allocator) stays server-side.
 */
export const createNative = mutation({
  returns: v.object({ created: v.boolean(), id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    ...projectWriteFields,
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "project", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", fields.organizationId).eq("projectNumber", fields.projectNumber),
      )
      .unique();
    if (clash) return { created: false as const, id: clash.id };

    // The projectNumber clash-guard is org-scoped and doesn't catch a cross-org cuid
    // collision — dup-guard the client-minted id too. THROW (not the `{created:false}`
    // number-clash signal, which callers retry with the SAME id): a cuid collision is a
    // hard error, else another org's by_cuid reads get muddied.
    const dupId = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", fields.id)).first();
    if (dupId) throw new ConvexError("Project already exists");

    // Strip the recalc-owned money totals: a new project starts with none, and
    // recalcProjectTotals is the only writer. A browser-direct caller could otherwise
    // mint a project with forged financials (projectWriteFields exposes them as args).
    // Non-breaking: createProject never sends these. (bumpProjectCounters keys off
    // status/isTemplate, not money, so it's unaffected by the strip.)
    const insertFields = { ...fields };
    for (const k of PROJECT_MONEY_ANCHORS) delete (insertFields as Record<string, unknown>)[k];

    await ctx.db.insert("projects", insertFields);
    await bumpProjectCounters(ctx, fields.organizationId, null, fields);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "project",
      entityId: fields.id,
      entityName: fields.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created ${fields.isTemplate ? "template" : "project"} ${fields.projectNumber} - ${fields.name}`,
      projectId: fields.id,
      createdAt: typeof fields.createdAt === "number" ? fields.createdAt : 0,
    });

    return { created: true as const, id: fields.id };
  },
});

/**
 * deleteNative — remove the project row + DELETE audit, atomic. RBAC(project, delete).
 * Option A: the server action runs the multi-table cascade (line items, crew
 * assignments, managers/tasks/services, freeing checked-out assets/kits) via the
 * existing mutations first; this does the final project-row delete + audit. `freed*`
 * counts are computed server-side and passed for the audit detail.
 */
export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    freedAssets: v.number(),
    freedKits: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, freedAssets, freedKits, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.delete(project._id);
    await bumpProjectCounters(ctx, orgId, project, null);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted project ${project.projectNumber} - ${project.name}`,
      details: { deleted: { projectNumber: project.projectNumber, name: project.name }, freedAssets, freedKits },
      projectId: id,
      createdAt: now,
    });

    return { id };
  },
});
