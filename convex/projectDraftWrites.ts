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
import { transitionProjectStatus } from "./projectWrites";

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
 * `discard` has no window; for the AUTHOR of a draft that is not empty it CANCELS
 * instead (still only while an `ENQUIRY`) through the same status transition
 * `updateStatusNative` uses, with no Undo. A non-author is refused for both verbs: they
 * use the normal status change. A burnt job number is accepted.
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

/**
 * True when anyone else has written to the project (or there are too many rows to tell):
 * an audit row (`activityLogs`) OR a collaboration event (`activityEvents`, which comments
 * and threads write WITHOUT an audit row) by a different user.
 */
async function writtenByOthers(ctx: MutationCtx, a: Args, userId: string): Promise<boolean> {
  const audit = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", a.orgId).eq("projectId", a.projectId))
    .take(MAX_AUDIT_ROWS + 1);
  if (audit.length > MAX_AUDIT_ROWS || audit.some((r) => r.userId !== userId)) return true;
  const events = await ctx.db
    .query("activityEvents")
    .withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", a.orgId).eq("entityId", a.projectId))
    .take(MAX_AUDIT_ROWS + 1);
  return events.length > MAX_AUDIT_ROWS || events.some((e) => e.actorUserId !== userId);
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
    // Collaboration and the rest: none can exist on a fresh enquiry the wizard made, so any hit means
    // someone worked on it. Probed rather than argued, because each has a write path from the job page.
    ["discussion", () => ctx.db.query("commentThreads").withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", id)).first()],
    ["review markers", () => ctx.db.query("reviewMarkers").withIndex("by_orgId_entityId", (q) => q.eq("orgId", orgId).eq("entityId", id)).first()],
    ["maintenance records", () => ctx.db.query("maintenanceRecords").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["scan history", () => ctx.db.query("assetScanLogs").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["warehouse close-outs", () => ctx.db.query("warehouseCloses").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["revenue rollups", () => ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
    ["web orders", () => ctx.db.query("wooCommerceOrderLogs").withIndex("by_projectId", (q) => q.eq("projectId", id)).first()],
  ];
  for (const [label, probe] of probes) if (await probe()) return `it has ${label}`;
  return null;
}

async function deleteEmptyDraft(ctx: MutationCtx, orgId: string, project: Doc<"projects">): Promise<void> {
  // A draft's managers are a handful of org members; bounded, and it refuses rather than leave orphans if it ever fills.
  const managers = await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).take(MAX_DRAFT_MANAGERS);
  if (managers.length >= MAX_DRAFT_MANAGERS) {
    throw new ConvexError({ code: "TOO_MANY_MANAGERS", message: "This draft has too many managers to discard in one go. Cancel it instead." });
  }
  for (const m of managers) if (m.organizationId === orgId) await ctx.db.delete(m._id);
  for (const ver of await listProjectVersions(ctx, orgId, project.id)) await ctx.db.delete(ver._id);
  // An ENQUIRY is never an active project (`ACTIVE_PROJECT_STATUSES`), so this moves no counter today; kept so
  // the delete stays correct if that set ever changes. (Removing it is an equivalent mutant: nothing observable.)
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

    // Only the proven author may discard, for BOTH verbs: a non-author who wants a job
    // gone uses the normal status change (and its gates), never this door.
    const created = await authoredCreate(ctx, a, actor.userId);
    if (!created) {
      throw new ConvexError({ code: "NOT_AUTHOR", message: "Only the person who created this draft can discard it." });
    }
    const blocker = (await writtenByOthers(ctx, a, actor.userId)) ? "someone else has worked on it" : await contentReason(ctx, a.orgId, project);
    if (blocker === null) return finishDelete(ctx, a, actor, project, created);
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

/**
 * The author's draft has content or other hands on it: cancel, not delete. It runs through
 * the SAME transition `updateStatusNative` uses (its gates, audit row and webhook), never a
 * raw patch, so the cancel is indistinguishable from a normal status change.
 */
async function cancelDraft(
  ctx: MutationCtx, a: Args & { auditId: string; now: number }, actor: { userId: string; userName: string }, project: Doc<"projects">,
) {
  await transitionProjectStatus(ctx, { orgId: a.orgId, project, status: "CANCELLED", actor, auditId: a.auditId, emitSideEffects: true, now: a.now });
  return { outcome: "cancelled" as const };
}

export const agentOps: AgentOpsAnnotations = {
  // `via` is deliberately NOT a privileged arg: it only selects Undo (which adds the 10-minute window and
  // once-only marker) or Discard (no window, because Discard never deletes non-empty work: with content or
  // other hands on the draft it cancels through the normal status transition, with no Undo).
  discardDraftNative: {
    summary: "Discard a draft job the caller created: hard-deletes it when it is still an empty enquiry nobody else has touched, otherwise cancels it (through the normal status transition) while it is still an enquiry. Refuses a non-author and any job that has moved on.",
    danger: "high",
  },
};
