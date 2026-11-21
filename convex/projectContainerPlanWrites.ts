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
  logContainerChange,
  requireContainerInOrg,
  PLAN_BATCH_KIND,
  PLAN_LINE_KIND,
  planLineAuditId,
} from "./projectContainersWrites";

/**
 * UX Phase 8 (§7b, D21) — the case-seal verbs and the exact Undo of a bulk plan
 * write. Split from `projectContainersWrites.ts` (already past the file-length
 * target); both import its org-checked helpers rather than re-declaring them.
 *
 * Sealing is a PLAN lock only (the guard lives in `setPlannedContainerNative`
 * via `lib/containerSeal.ts`); it never touches a unit. The printed label is
 * what a seal vouches for.
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

type PlanBatch = {
  projectId: string;
  /** The case the forward write left the lines in (`null` = it cleared them). */
  expectedContainerId: string | null;
  /** Each changed line and where it was before, read from the server's own rows. */
  lines: { lineItemId: string; from: string | null }[];
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
  return { projectId: header.projectId, expectedContainerId: meta.plannedContainerId ?? null, lines };
}

/** Restore ONE line if (and only if) it is still as the forward write left it,
 *  on the batch's job, and the case it returns to exists, is open and on that
 *  job. Writes its audit row. Returns whether it restored. */
async function restoreOneLine(
  ctx: MutationCtx,
  a: {
    entry: PlanBatch["lines"][number];
    batch: PlanBatch;
    orgId: string;
    now: number;
    actor: { userId: string; userName: string };
    auditId: string;
    batchAuditId: string;
    cache: CaseLookup;
  },
): Promise<boolean> {
  const { entry, batch, orgId, now, actor, auditId, batchAuditId, cache } = a;
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", entry.lineItemId)).first();
  if (!line || line.organizationId !== orgId || line.projectId !== batch.projectId) return false;
  if ((line.plannedContainerId ?? null) !== batch.expectedContainerId) return false; // edited since: leave it
  const back = await caseOrNull(ctx, entry.from, orgId, cache);
  if (entry.from && (!back || isContainerSealed(back) || back.projectId !== line.projectId)) return false;
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
  return true;
}

/**
 * The exact reverse of one `setPlannedContainerNative` call, addressed by that
 * call's `auditId` (the batch id). The CLIENT SUPPLIES NO PRIOR VALUES: each
 * line's previous case is read from the audit rows the forward write wrote
 * (`loadPlanBatch`), so a caller cannot forge a "restore" to an arbitrary case.
 *
 * A line is restored only while its plan STILL equals the case the forward
 * write left it in (a later edit by someone else is never clobbered), it is on
 * the batch's job, and neither the case it leaves nor the case it returns to is
 * sealed (Undo is not a way around a seal; the return case must also still
 * exist). Anything else is counted in `skipped`, never forced. One audit row per
 * restored line, plus one summary row.
 */
export const restorePlannedContainersNative = mutation({
  returns: v.object({ restored: v.number(), skipped: v.number() }),
  args: {
    orgId: v.string(),
    batchAuditId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { orgId, batchAuditId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const batch = await loadPlanBatch(ctx, batchAuditId, orgId);
    await assertBulkSizeOk(ctx, batch.lines.length);

    const cache: CaseLookup = new Map();
    const leaving = await caseOrNull(ctx, batch.expectedContainerId, orgId, cache);
    const leavingSealed = leaving != null && isContainerSealed(leaving);
    const restoredIds: string[] = [];
    for (const entry of batch.lines) {
      if (leavingSealed) break;
      const done = await restoreOneLine(ctx, { entry, batch, orgId, now, actor, auditId, batchAuditId, cache });
      if (done) restoredIds.push(entry.lineItemId);
    }
    if (restoredIds.length > 0) {
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: orgId,
        action: "UPDATE",
        entityType: "projectLineItem",
        entityId: restoredIds[0],
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
  },
});

export const agentOps: AgentOpsAnnotations = {
  sealNative: { summary: "Seal a packing case: its plan is locked (no lines planned in or out) until unsealed.", danger: "low", mcpTier: 3 },
  unsealNative: { summary: "Unseal a packing case so its plan can change again.", danger: "low", mcpTier: 3 },
  restorePlannedContainersNative: { summary: "Undo a bulk plan change by its batch audit id: put lines back to the case the server recorded, only where they are still as that change left them.", danger: "low", mcpTier: 3 },
};
