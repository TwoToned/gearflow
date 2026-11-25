import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { bumpProjectCounters } from "./lib/counters";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { listProjectVersions } from "./lib/projectVersionState";

/**
 * Discard a wizard draft (UX Phase 9, D24): ONE server-guarded verb behind both
 * `Discard draft…` and the `Create as enquiry` Undo, so neither is a client closure
 * that can cancel or delete a job someone else has since worked on.
 *
 * A draft is hard-deleted only when it is provably the empty row the wizard made:
 *  - the caller authored the create (the audit row the wizard keeps the id of,
 *    org-checked, this project's, `CREATE`);
 *  - it is still an `ENQUIRY`, not a template;
 *  - no one else has written to it (every activity row on it is the caller's);
 *  - it has no lines, services, cases, categories, groups, crew calls, quotes,
 *    invoices, files, tasks, sub-hires, supplier orders, snapshots, and no
 *    version beyond the first.
 * `undo` additionally needs the server-clock `UNDO_WINDOW_MS` and runs once (a
 * deterministic `undo:<createAuditId>` marker, which is also the audit row).
 * `discard` has no window; when the draft is not empty it CANCELS instead (still
 * only while it is an `ENQUIRY`), with no Undo. A burnt job number is accepted.
 */
const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const markerId = (createAuditId: string) => `undo:${createAuditId}`;
const MAX_AUDIT_ROWS = 50;
const MAX_DRAFT_MANAGERS = 200;

type Args = { orgId: string; projectId: string; createAuditId: string; via: "undo" | "discard" };

/** The create audit row, when it proves `userId` authored this project's creation. */
async function authoredCreate(ctx: MutationCtx, a: Args, userId: string): Promise<Doc<"activityLogs"> | null> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.createAuditId)).first();
  const ok =
    !!row && row.organizationId === a.orgId && row.entityType === "project" && row.entityId === a.projectId &&
    row.action === "CREATE" && row.userId === userId;
  return ok ? row : null;
}

/** True when anyone else has an activity row on the project (or there are too many to tell). */
async function writtenByOthers(ctx: MutationCtx, a: Args, userId: string): Promise<boolean> {
  const rows = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", a.orgId).eq("projectId", a.projectId))
    .take(MAX_AUDIT_ROWS + 1);
  return rows.length > MAX_AUDIT_ROWS || rows.some((r) => r.userId !== userId);
}

/** The first thing the draft has that makes it more than the empty row, or null. */
async function contentReason(ctx: MutationCtx, orgId: string, project: Doc<"projects">): Promise<string | null> {
  const id = project.id;
  const versions = await listProjectVersions(ctx, orgId, id);
  if (versions.length !== 1) return "it has more than one version";
  const vid = versions[0].id;
  const probes: [string, () => Promise<unknown>][] = [
    ["lines", () => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", vid)).first()],
    ["services", () => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", vid)).first()],
    ["cases", () => ctx.db.query("projectContainers").withIndex("by_versionId", (q) => q.eq("versionId", vid)).first()],
    ["categories", () => ctx.db.query("projectCategories").withIndex("by_versionId", (q) => q.eq("versionId", vid)).first()],
    ["groups", () => ctx.db.query("projectGroups").withIndex("by_versionId", (q) => q.eq("versionId", vid)).first()],
    ["crew calls", () => ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["quotes", () => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["invoices", () => ctx.db.query("invoices").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["files", () => ctx.db.query("projectMedia").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["tasks", () => ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["sub-hires", () => ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["supplier orders", () => ctx.db.query("supplierOrders").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["snapshots", () => ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
  ];
  for (const [label, probe] of probes) if (await probe()) return `it has ${label}`;
  return null;
}

async function deleteEmptyDraft(ctx: MutationCtx, orgId: string, project: Doc<"projects">): Promise<void> {
  // A draft's managers are a handful of org members; bounded, not a scan.
  const managers = await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).take(MAX_DRAFT_MANAGERS);
  for (const m of managers) if (m.organizationId === orgId) await ctx.db.delete(m._id);
  for (const ver of await listProjectVersions(ctx, orgId, project.id)) await ctx.db.delete(ver._id);
  await bumpProjectCounters(ctx, orgId, project, null);
  await ctx.db.delete(project._id);
}

export const discardDraftNative = mutation({
  returns: v.object({ outcome: v.union(v.literal("deleted"), v.literal("cancelled")) }),
  args: {
    orgId: v.string(),
    projectId: v.string(),
    /** The audit id the create carried (the wizard mints and keeps it). */
    createAuditId: v.string(),
    via: v.union(v.literal("undo"), v.literal("discard")),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "That draft no longer exists." });
    if (project.organizationId !== a.orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (project.isTemplate || project.status !== "ENQUIRY") {
      throw new ConvexError({ code: "NOT_A_DRAFT", message: "This job has moved on from an enquiry, so it can't be discarded." });
    }
    const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", markerId(a.createAuditId))).first();
    if (marker && marker.organizationId === a.orgId) throw new ConvexError({ code: "ALREADY_UNDONE", message: "That draft was already discarded." });

    const created = await authoredCreate(ctx, a, actor.userId);
    const blocker = !created ? "you did not create it" : (await writtenByOthers(ctx, a, actor.userId)) ? "someone else has worked on it" : await contentReason(ctx, a.orgId, project);
    if (blocker === null && created) return finishDelete(ctx, a, actor, project, created);
    if (a.via === "undo") {
      throw new ConvexError({ code: "CHANGED_SINCE", message: `Can't undo: ${blocker}.` });
    }
    return cancelDraft(ctx, a, actor, project);
  },
});

async function finishDelete(
  ctx: MutationCtx, a: Args & { actor: { userId: string; userName: string }; now: number }, actor: { userId: string; userName: string },
  project: Doc<"projects">, created: Doc<"activityLogs">,
) {
  if (a.via === "undo") assertWithinUndoWindow(created._creationTime, Date.now(), "change");
  await requireOrgPermission(ctx, a.orgId, "project", "create");
  await deleteEmptyDraft(ctx, a.orgId, project);
  await writeActivityLog(ctx, {
    id: markerId(a.createAuditId), organizationId: a.orgId, action: "DELETE", entityType: "project", entityId: a.projectId,
    entityName: project.projectNumber, userId: actor.userId, userName: actor.userName,
    summary: `Discarded draft ${project.projectNumber}`, createdAt: a.now,
  });
  return { outcome: "deleted" as const };
}

/** A draft that has content or other hands on it is cancelled, not deleted (still only while an Enquiry). */
async function cancelDraft(
  ctx: MutationCtx, a: Args & { auditId: string; now: number }, actor: { userId: string; userName: string }, project: Doc<"projects">,
) {
  await ctx.db.patch(project._id, { status: "CANCELLED", updatedAt: a.now });
  await bumpProjectCounters(ctx, a.orgId, project, { ...project, status: "CANCELLED" });
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "project", entityId: a.projectId,
    entityName: project.projectNumber, userId: actor.userId, userName: actor.userName,
    summary: `Cancelled draft ${project.projectNumber}`, projectId: a.projectId, createdAt: a.now,
  });
  return { outcome: "cancelled" as const };
}

export const agentOps: AgentOpsAnnotations = {
  discardDraftNative: {
    summary: "Discard a draft job the caller created: hard-deletes it when it is still an empty enquiry nobody else has touched, otherwise cancels it while it is still an enquiry. Refuses once it has moved on.",
    danger: "high",
  },
};
