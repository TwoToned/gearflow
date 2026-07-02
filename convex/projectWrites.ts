import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";
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
  args: {
    id: v.string(),
    orgId: v.string(),
    status: enums.ProjectStatus,
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, status, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "update");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_STATUS", message: "Templates don't have a status." });
    }

    const from = project.status ?? "";
    await ctx.db.patch(project._id, { status, updatedAt: now });

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
  args: {
    id: v.string(),
    orgId: v.string(),
    field: NOTES_FIELD,
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, field, notes, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "update");

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
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "update");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(project._id, { status: "CANCELLED", updatedAt: now });

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

const PROJECT_NEVER_CLEAR = new Set(["id", "organizationId", "projectNumber"]);

/**
 * updateNative — general project field patch (set/clear) + UPDATE audit, atomic.
 * RBAC(project, update). Option A: the server action keeps Zod validation + the
 * conditional recalc (only when taxRate changes — recalc stays server-side, totals
 * identical); the write + audit move here.
 */
export const updateNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    set: v.any(),
    clear: v.array(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "update");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    const setObj = (set ?? {}) as Record<string, unknown>;
    if (clear.length === 0) {
      await ctx.db.patch(project._id, setObj);
    } else {
      const { _id, _creationTime, ...rest } = project;
      const merged: Record<string, unknown> = { ...rest, ...setObj };
      for (const k of clear) {
        if (PROJECT_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(project._id, merged as typeof rest);
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
    const { actor, auditId, ...fields } = args;
    await requireOrgPermission(ctx, fields.organizationId, "project", "create");

    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", fields.organizationId).eq("projectNumber", fields.projectNumber),
      )
      .unique();
    if (clash) return { created: false as const, id: clash.id };

    await ctx.db.insert("projects", fields);

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
  args: {
    id: v.string(),
    orgId: v.string(),
    freedAssets: v.number(),
    freedKits: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, freedAssets, freedKits, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "delete");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.delete(project._id);

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
