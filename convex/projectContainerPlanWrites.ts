import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { isContainerSealed } from "./lib/containerSeal";
import {
  actorValidator,
  insertContainerWithLine,
  lineHasPackedUnit,
  logContainerChange,
  requireContainerInOrg,
  PLAN_BATCH_KIND,
  PLAN_LINE_KIND,
  planLineAuditId,
  type DeletedCaseSnapshot,
} from "./projectContainersWrites";

/**
 * UX Phase 8 (§7b, D21) — the case-seal verbs and the exact Undos of a plan
 * write and of a case delete. Split from `projectContainersWrites.ts` (already
 * past the file-length target); both import its org-checked helpers rather than
 * re-declaring them.
 *
 * Sealing is a PLAN lock only (the guard lives in `lib/containerSeal.ts`); it
 * never touches a unit. The printed label is what a seal vouches for.
 */

const guard = async (ctx: MutationCtx, orgId: string) => {
  await assertWritesEnabled(ctx, "warehouse");
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
};

/** Seal a case. Idempotent: sealing a sealed case changes nothing and reports
 *  `changed: false` (so a client only offers Undo for a real change). */
export const sealNative = mutation({
  returns: v.object({ ok: v.boolean(), changed: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, { id, orgId, now, actor: suppliedActor, auditId }) => {
    await guard(ctx, orgId);
    const actor = await resolveActor(ctx, suppliedActor);
    const container = await requireContainerInOrg(ctx, id, orgId);
    if (isContainerSealed(container)) return { ok: true, changed: false };

    await ctx.db.patch(container._id, { sealedAt: now, updatedAt: now });
    await logContainerChange(ctx, {
      orgId, projectId: container.projectId, actor, auditId, now,
      action: "UPDATE", entityId: id, entityName: container.label,
      summary: `Sealed case "${container.label}"`,
    });
    return { ok: true, changed: true };
  },
});

/** Unseal a case: its own write (and its own audit row), the exact reverse of
 *  `sealNative`. Idempotent. */
export const unsealNative = mutation({
  returns: v.object({ ok: v.boolean(), changed: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, { id, orgId, now, actor: suppliedActor, auditId }) => {
    await guard(ctx, orgId);
    const actor = await resolveActor(ctx, suppliedActor);
    const container = await requireContainerInOrg(ctx, id, orgId);
    if (!isContainerSealed(container)) return { ok: true, changed: false };

    await ctx.db.patch(container._id, { sealedAt: undefined, updatedAt: now });
    await logContainerChange(ctx, {
      orgId, projectId: container.projectId, actor, auditId, now,
      action: "UPDATE", entityId: id, entityName: container.label,
      summary: `Unsealed case "${container.label}"`,
    });
    return { ok: true, changed: true };
  },
});

type CaseLookup = Map<string, Doc<"projectContainers"> | null>;

/** An org-checked container by cuid, memoised for one call; `null` when it is
 *  gone or foreign. */
async function caseOrNull(ctx: MutationCtx, id: string | null, orgId: string, cache: CaseLookup) {
  if (!id) return null;
  if (!cache.has(id)) {
    const c = await ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    cache.set(id, c && c.organizationId === orgId ? c : null);
  }
  return cache.get(id) ?? null;
}

/** An org-checked activity row by cuid (`by_cuid` is global). */
async function auditRowOrNull(ctx: MutationCtx, id: string, orgId: string) {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return row && row.organizationId === orgId ? row : null;
}

/** Deterministic id of the marker an Undo writes for a batch: its presence is
 *  what makes a second Undo of the same batch refuse (no ABA replay). */
export const undoMarkerId = (batchAuditId: string) => `undo:${batchAuditId}`;

async function assertNotAlreadyUndone(ctx: MutationCtx, batchAuditId: string, orgId: string): Promise<void> {
  if (await auditRowOrNull(ctx, undoMarkerId(batchAuditId), orgId)) {
    throw new ConvexError({ code: "ALREADY_UNDONE", message: "That change was already undone." });
  }
}

type PlanBatch = {
  projectId: string;
  /** The case the forward write left the lines in (`null` = it cleared them). */
  expectedContainerId: string | null;
  /** Each changed line and where it was before, read from the server's own rows. */
  lines: { lineItemId: string; from: string | null }[];
  /** The batch's header row (a delete's carries the deleted case's snapshot). */
  header: Doc<"activityLogs">;
};

/** Rebuild a forward plan write from the audit rows IT wrote: the batch header
 *  (kind `PLAN_BATCH`) lists the changed lines and where they went; each line's
 *  own row (kind `PLAN_LINE`) holds its previous case. Nothing here comes from
 *  the caller except the batch id, and every row is org-checked. */
async function loadPlanBatch(ctx: MutationCtx, batchAuditId: string, orgId: string): Promise<PlanBatch> {
  const notFound = () => new ConvexError({ code: "NOT_FOUND", message: "That plan change was not found, so it can't be undone." });
  const header = await auditRowOrNull(ctx, batchAuditId, orgId);
  const meta = header?.metadata as { kind?: string; lineItemIds?: string[]; plannedContainerId?: string | null } | undefined;
  if (!header || !header.projectId || meta?.kind !== PLAN_BATCH_KIND || !Array.isArray(meta.lineItemIds)) throw notFound();

  const lines: PlanBatch["lines"] = [];
  for (const lineItemId of meta.lineItemIds) {
    const row = await auditRowOrNull(ctx, planLineAuditId(batchAuditId, lineItemId), orgId);
    const rowMeta = row?.metadata as { kind?: string; batchId?: string; from?: string | null } | undefined;
    if (!row || rowMeta?.kind !== PLAN_LINE_KIND || rowMeta.batchId !== batchAuditId) continue;
    lines.push({ lineItemId, from: rowMeta.from ?? null });
  }
  return { projectId: header.projectId, expectedContainerId: meta.plannedContainerId ?? null, lines, header };
}

type RestoreArgs = {
  batch: PlanBatch;
  orgId: string;
  now: number;
  actor: { userId: string; userName: string };
  auditId: string;
  batchAuditId: string;
  cache: CaseLookup;
};

/** Why a line was NOT restored: `sealed` names the case whose seal blocked it. */
type RestoreOutcome = { restored: true } | { restored: false; sealedCase?: string };

/** How many of a line's newest audit rows are scanned for its latest plan change. */
const PLAN_HISTORY_LOOKBACK = 50;

/**
 * True when the line's newest PLAN_LINE audit row belongs to a DIFFERENT batch than the one being
 * undone (a later plan, unplan, case delete or Undo touched it). Comparing the current case alone
 * is fooled by A→B→A: the line can look exactly as this batch left it while a newer plan has
 * since moved it away and back. Fails closed: no row of this batch in the window counts as newer.
 */
async function hasNewerPlanChange(ctx: MutationCtx, lineItemId: string, orgId: string, batchAuditId: string): Promise<boolean> {
  const rows = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "projectLineItem").eq("entityId", lineItemId))
    .order("desc")
    .take(PLAN_HISTORY_LOOKBACK);
  for (const row of rows) {
    const meta = row.metadata as { kind?: string; batchId?: string } | undefined;
    if (meta?.kind !== PLAN_LINE_KIND) continue;
    return meta.batchId !== batchAuditId;
  }
  return true;
}

/** Restore ONE line if (and only if) it is still as the forward write left it,
 *  on the batch's job, NOT packed since (packed wins, as on the forward write),
 *  and the case it returns to exists, is open and on that job. Writes its audit
 *  row. */
async function restoreOneLine(ctx: MutationCtx, entry: PlanBatch["lines"][number], a: RestoreArgs): Promise<RestoreOutcome> {
  const { batch, orgId, now, actor, auditId, batchAuditId, cache } = a;
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", entry.lineItemId)).first();
  if (!line || line.organizationId !== orgId || line.projectId !== batch.projectId) return { restored: false };
  if ((line.plannedContainerId ?? null) !== batch.expectedContainerId) return { restored: false }; // edited since: leave it
  if (await lineHasPackedUnit(ctx, line.id, orgId)) return { restored: false };
  if (await hasNewerPlanChange(ctx, line.id, orgId, batchAuditId)) return { restored: false };
  const back = await caseOrNull(ctx, entry.from, orgId, cache);
  if (entry.from && (!back || back.projectId !== line.projectId)) return { restored: false };
  if (back && isContainerSealed(back)) return { restored: false, sealedCase: back.label };
  await ctx.db.patch(line._id, { plannedContainerId: entry.from ?? undefined, updatedAt: now });
  await writeActivityLog(ctx, {
    id: planLineAuditId(auditId, entry.lineItemId),
    organizationId: orgId,
    action: "UPDATE",
    entityType: "projectLineItem",
    entityId: entry.lineItemId,
    projectId: batch.projectId,
    entityName: "Planned container",
    userId: actor.userId,
    userName: actor.userName,
    summary: "Undid a planned container change",
    metadata: { kind: PLAN_LINE_KIND, batchId: auditId, undoOf: batchAuditId, from: batch.expectedContainerId, to: entry.from },
    createdAt: now,
  });
  return { restored: true };
}

/** Restore every line of a loaded batch and write the batch's Undo marker.
 *  Throws `CASE_SEALED` when NOTHING could be restored because a seal blocked it
 *  (so the client never reports "Undone" for a no-op); `markAlways` writes the
 *  marker even when no line moved (a case delete's Undo). */
async function runRestore(ctx: MutationCtx, a: RestoreArgs & { markAlways?: boolean }): Promise<{ restored: number; skipped: number }> {
  const { batch, orgId, now, actor, batchAuditId } = a;
  const leaving = await caseOrNull(ctx, batch.expectedContainerId, orgId, a.cache);
  const leavingSealed = leaving != null && isContainerSealed(leaving);
  const restoredIds: string[] = [];
  let sealedCase: string | undefined = leavingSealed ? leaving.label : undefined;
  for (const entry of batch.lines) {
    if (leavingSealed) break;
    const outcome = await restoreOneLine(ctx, entry, a);
    if (outcome.restored) restoredIds.push(entry.lineItemId);
    else sealedCase ??= outcome.sealedCase;
  }
  if (restoredIds.length === 0 && sealedCase) {
    throw new ConvexError({ code: "CASE_SEALED", message: `${sealedCase} is sealed. Unseal it to undo this.` });
  }
  if (restoredIds.length > 0 || a.markAlways) {
    await writeActivityLog(ctx, {
      id: undoMarkerId(batchAuditId),
      organizationId: orgId,
      action: "UPDATE",
      entityType: "projectLineItem",
      entityId: restoredIds[0] ?? batchAuditId,
      projectId: batch.projectId,
      entityName: "Planned container",
      userId: actor.userId,
      userName: actor.userName,
      summary: `Undid a packing plan change on ${restoredIds.length} ${restoredIds.length === 1 ? "line" : "lines"}`,
      metadata: { kind: "PLAN_UNDO", undoOf: batchAuditId, lineItemIds: restoredIds },
      createdAt: now,
    });
  }
  return { restored: restoredIds.length, skipped: batch.lines.length - restoredIds.length };
}

const undoArgs = {
  orgId: v.string(),
  batchAuditId: v.string(),
  now: v.number(),
  actor: actorValidator,
  auditId: v.string(),
};

/**
 * The exact reverse of one `setPlannedContainerNative` call, addressed by that
 * call's `auditId` (the batch id). The CLIENT SUPPLIES NO PRIOR VALUES: each
 * line's previous case is read from the audit rows the forward write wrote
 * (`loadPlanBatch`), so a caller cannot forge a "restore" to an arbitrary case.
 *
 * A line is restored only while its plan STILL equals the case the forward
 * write left it in (a later edit by someone else is never clobbered), it is on
 * the batch's job, nothing of it is packed, and neither the case it leaves nor
 * the case it returns to is sealed (Undo is not a way around a seal). Anything
 * else is counted in `skipped`, never forced; a call blocked ONLY by a seal
 * throws `CASE_SEALED`. One audit row per restored line, plus ONE marker
 * (`undo:<batchAuditId>`): a batch can be undone once, so an old Undo can never
 * replay over a later plan (A→B, undo, B again, stale Undo).
 */
export const restorePlannedContainersNative = mutation({
  returns: v.object({ restored: v.number(), skipped: v.number() }),
  args: undoArgs,
  handler: async (ctx, { orgId, batchAuditId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    await assertNotAlreadyUndone(ctx, batchAuditId, orgId);
    const batch = await loadPlanBatch(ctx, batchAuditId, orgId);
    await assertBulkSizeOk(ctx, batch.lines.length);
    return runRestore(ctx, { batch, orgId, now, actor, auditId, batchAuditId, cache: new Map() });
  },
});

/**
 * The exact reverse of `deleteNative` for a CUSTOM case, as ONE transaction:
 * re-create the case under its old id, label, parent (if that case is still
 * there and open), version and sort position, then put its planned lines back
 * (the same exact restore as a plan Undo, from the delete's own audit rows). It
 * can run once per delete (the same `undo:<batchAuditId>` marker), and refuses
 * if a case with that id exists again.
 */
export const undoDeleteContainerNative = mutation({
  // `recreated` is always true on success (the case is back even when no line had to be restored);
  // `parentSealed` says it was put back at the top level because its old parent is sealed now.
  returns: v.object({ id: v.string(), restored: v.number(), skipped: v.number(), recreated: v.boolean(), parentSealed: v.boolean() }),
  args: undoArgs,
  handler: async (ctx, { orgId, batchAuditId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    await assertNotAlreadyUndone(ctx, batchAuditId, orgId);
    const batch = await loadPlanBatch(ctx, batchAuditId, orgId);
    const snapshot = (batch.header.metadata as { deleted?: DeletedCaseSnapshot } | undefined)?.deleted;
    const caseId = batch.header.entityId;
    if (batch.header.action !== "DELETE" || !snapshot || !caseId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That delete was not found, so it can't be undone." });
    }
    const exists = await ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", caseId)).first();
    if (exists) throw new ConvexError({ code: "ALREADY_EXISTS", message: "That case is already back." });
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", batch.projectId)).first();
    const versionId = snapshot.versionId ?? project?.liveVersionId;
    if (!project || project.organizationId !== orgId || !versionId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }

    // A version deleted since takes its cases with it: there is nothing to put the case back on.
    const ver = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
    if (!ver || ver.organizationId !== orgId || ver.projectId !== project.id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "The version that case was on no longer exists, so it can't be restored." });
    }

    const cache: CaseLookup = new Map();
    const parent = await caseOrNull(ctx, snapshot.parentContainerId, orgId, cache);
    const parentSealed = parent != null && isContainerSealed(parent);
    const parentOk = parent != null && parent.projectId === project.id && !parentSealed;
    await assertBulkSizeOk(ctx, batch.lines.length);
    await insertContainerWithLine(ctx, {
      id: caseId,
      orgId,
      projectId: project.id,
      versionId,
      kind: "CUSTOM",
      label: snapshot.label,
      description: snapshot.description ?? undefined,
      parentContainerId: parentOk ? parent.id : undefined,
      now,
      sortOrder: snapshot.sortOrder ?? undefined,
      lineageId: snapshot.lineageId ?? undefined,
    });
    await logContainerChange(ctx, {
      orgId, projectId: project.id, actor, auditId, now,
      action: "CREATE", entityId: caseId, entityName: snapshot.label,
      summary: `Restored container "${snapshot.label}"`,
    });
    const r = await runRestore(ctx, { batch, orgId, now, actor, auditId, batchAuditId, cache, markAlways: true });
    return { id: caseId, ...r, recreated: true, parentSealed };
  },
});

export const agentOps: AgentOpsAnnotations = {
  sealNative: { summary: "Seal a packing case: its plan is locked (no lines planned in or out) until unsealed.", danger: "low", mcpTier: 3 },
  unsealNative: { summary: "Unseal a packing case so its plan can change again.", danger: "low", mcpTier: 3 },
  restorePlannedContainersNative: { summary: "Undo a bulk plan change by its batch audit id: put lines back to the case the server recorded, only where they are still as that change left them. Once per change.", danger: "low", mcpTier: 3 },
  undoDeleteContainerNative: { summary: "Undo a custom case delete by its batch audit id: re-create the case in place and put its planned lines back. Once per delete.", danger: "low", mcpTier: 3 },
};
