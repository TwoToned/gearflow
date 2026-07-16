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
import { setAssetsStatus } from "./warehouseOps";
import { removeLineItemCascadeCore } from "./projectLineItems";
import { deleteCrewAssignmentCascadeCore } from "./crewAssignments";
import { deleteAllForProjectCore } from "./projectCategories";

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
 * deleteNative — the FULL, atomic project-delete cascade + DELETE audit.
 * RBAC(project, delete). Parity with the (former) server `deleteProject`: only a
 * CANCELLED, non-template project may be deleted; every dependent Convex row is
 * purged in ONE transaction (no more N server→Convex round-trips, no orphan window):
 *
 *   1. Free loose checked-out/confirmed assets → setAssetsStatus (dashboard counters!)
 *   2. Free checked-out/confirmed kits inline (kits carry no counter)
 *   3. Free those kits' serialized member assets → setAssetsStatus
 *   4. Cascade every top-level line item (children + units) → removeLineItemCascadeCore
 *   5. Crew assignments (→ shifts + linked time entries) → deleteCrewAssignmentCascadeCore
 *   6. Project managers / tasks / services (inline)
 *   7. Grouping (categories / groups / slots) → deleteAllForProjectCore
 *   8. projectModelRevenues rollup (Convex-only cache — MUST purge or it orphans)
 *   then bumpProjectCounters + delete the project row + DELETE audit.
 *
 * `freedAssets`/`freedKits` are computed IN-mutation (never trusted from the client)
 * and returned + audited. `defaultLocationId` is the org's default location (resolved
 * by the caller, mirrors getDefaultLocation) applied to every freed asset/kit.
 * Convex forbids mutation→mutation, so the cascade reuses extracted `*Core` fns.
 */
/** Free a set of assets to AVAILABLE, but ONLY the ones that belong to `orgId` — a
 *  forged line/kit-member could otherwise point at a foreign asset, and setAssetsStatus
 *  resolves by the GLOBAL by_cuid index. Routes through setAssetsStatus so the sharded
 *  asset counters stay in sync. Returns the count actually freed. */
async function freeOrgAssets(
  ctx: Parameters<typeof setAssetsStatus>[0],
  assetIds: string[],
  orgId: string,
  locationId: string | null,
  now: number,
): Promise<number> {
  const owned: string[] = [];
  for (const aid of [...new Set(assetIds)]) {
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", aid)).first();
    if (asset && asset.organizationId === orgId) owned.push(aid);
  }
  if (owned.length > 0) await setAssetsStatus(ctx, owned, "AVAILABLE", locationId, true, now);
  return owned.length;
}

export const deleteNative = mutation({
  returns: v.object({ id: v.string(), freedAssets: v.number(), freedKits: v.number() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    defaultLocationId: v.union(v.string(), v.null()),
    // Legacy args — retained for wire-compat but IGNORED: the freed counts are now
    // computed in-mutation (a client must not be able to forge the audit detail).
    freedAssets: v.optional(v.number()),
    freedKits: v.optional(v.number()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, defaultLocationId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "delete");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (project.status !== "CANCELLED") {
      throw new ConvexError({ code: "DELETE_GUARD", message: "Only cancelled projects can be deleted." });
    }
    if (project.isTemplate) {
      throw new ConvexError({ code: "DELETE_GUARD", message: "Templates must be deleted via deleteTemplateNative." });
    }

    // Validate the client-supplied default location belongs to this org (by_cuid is global)
    // before it's written onto freed assets/kits — else use null (clear the location).
    let safeLocationId: string | null = null;
    if (defaultLocationId != null) {
      const loc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", defaultLocationId)).first();
      if (loc && loc.organizationId === orgId) safeLocationId = defaultLocationId;
    }

    // ── Step 0: scan the project's line items (org-filtered) → collect the assets
    // and kits to free. by_projectId is a project-scoped index; the org re-check is
    // defensive (a project's lines always share its org).
    const lineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((li) => li.organizationId === orgId);

    const checkedOutAssetIds: string[] = [];
    const checkedOutKitIds: string[] = [];
    for (const li of lineItems) {
      if (li.assetId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) checkedOutAssetIds.push(li.assetId);
      if (li.kitId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) checkedOutKitIds.push(li.kitId);
    }

    // Step 1 — free loose checked-out assets (org-scoped; routes through setAssetsStatus so
    // the sharded dashboard counters stay in sync; clear location when there's no default).
    await freeOrgAssets(ctx, checkedOutAssetIds, orgId, safeLocationId, now);

    // Step 2 — free checked-out kits inline (status AVAILABLE + location; kits have
    // no counter). Leave the kit's location untouched when there's no default.
    for (const kitId of checkedOutKitIds) {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).first();
      if (!kit || kit.organizationId !== orgId) continue;
      await ctx.db.patch(kit._id, {
        status: "AVAILABLE",
        ...(safeLocationId != null ? { locationId: safeLocationId } : {}),
        updatedAt: now,
      });
    }

    // Step 3 — free those kits' serialized member assets (org-scoped, counter-safe path).
    const kitAssetIds: string[] = [];
    for (const kitId of checkedOutKitIds) {
      const members = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
      for (const m of members) if (m.organizationId === orgId) kitAssetIds.push(m.assetId);
    }
    await freeOrgAssets(ctx, kitAssetIds, orgId, safeLocationId, now);

    // Step 4 — cascade every top-level line (its children + all units go with it).
    for (const li of lineItems) {
      if (li.parentLineItemId == null) await removeLineItemCascadeCore(ctx, li.id);
    }

    // Step 5 — crew assignments (→ shifts + linked time entries + offer counter).
    const assignments = (
      await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((a) => a.organizationId === orgId);
    for (const a of assignments) await deleteCrewAssignmentCascadeCore(ctx, a);

    // Step 6 — project managers / tasks / services (org-filtered inline deletes).
    // NOT projectServices.removeManyCascade — that would re-cascade lines/crew we
    // already handled above.
    const pms = (
      await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of pms) await ctx.db.delete(r._id);
    const tasks = (
      await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of tasks) await ctx.db.delete(r._id);
    const services = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of services) await ctx.db.delete(r._id);

    // Step 7 — grouping (categories / groups / slots).
    await deleteAllForProjectCore(ctx, id);

    // Step 8 — projectModelRevenues rollup (Convex-only cache; no FK to cascade —
    // the (former) native stub missed this, orphaning one row per model per delete).
    const rollups = (
      await ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of rollups) await ctx.db.delete(r._id);

    // Finally — project row + active-project counter + DELETE audit.
    await bumpProjectCounters(ctx, orgId, project, null);
    await ctx.db.delete(project._id);

    const freedAssets = checkedOutAssetIds.length;
    const freedKits = checkedOutKitIds.length;
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

    return { id, freedAssets, freedKits };
  },
});

/**
 * deleteTemplateNative — the atomic template-delete cascade. RBAC(project, delete).
 * Parity with the (former) server `deleteTemplate`: a template has NO CANCELLED
 * precondition, frees NO assets/kits (a template holds none checked out), has NO
 * crew cascade and writes NO audit. Cascade: PM/tasks/services → grouping → line
 * items → projectModelRevenues → the project row (+ counter).
 */
export const deleteTemplateNative = mutation({
  returns: v.object({ success: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "delete");
    await resolveActor(ctx, suppliedActor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!project) throw new ConvexError({ code: "NOT_FOUND", message: "Template not found." });
    if (project.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (!project.isTemplate) {
      throw new ConvexError({ code: "NOT_A_TEMPLATE", message: "That ID points at a project, not a template." });
    }

    // Project managers / tasks / services (org-filtered inline deletes).
    const pms = (
      await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of pms) await ctx.db.delete(r._id);
    const tasks = (
      await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of tasks) await ctx.db.delete(r._id);
    const services = (
      await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of services) await ctx.db.delete(r._id);

    // Grouping (categories / groups / slots).
    await deleteAllForProjectCore(ctx, id);

    // Template line items (top-level cascade → children + units).
    const lineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((li) => li.organizationId === orgId);
    for (const li of lineItems) {
      if (li.parentLineItemId == null) await removeLineItemCascadeCore(ctx, li.id);
    }

    // projectModelRevenues rollup (Convex-only cache).
    const rollups = (
      await ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", id)).collect()
    ).filter((r) => r.organizationId === orgId);
    for (const r of rollups) await ctx.db.delete(r._id);

    // Delete the template row (+ active-project counter — templates never count as
    // active, so the delta is 0, but keep the call uniform with deleteNative).
    await bumpProjectCounters(ctx, orgId, project, null);
    await ctx.db.delete(project._id);

    return { success: true };
  },
});
