import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { assertArrayMax } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { isContainerSealed } from "./lib/containerSeal";
import { actorValidator, logContainerChange, requireContainerInOrg, MAX_PLAN_LINES } from "./projectContainersWrites";

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

/**
 * The exact reverse of a `setPlannedContainerNative` call. The caller passes
 * what that call RETURNED (`changes`) plus the case it planned INTO
 * (`expectedContainerId`, `null` when it cleared). A line is restored only when
 * its plan STILL equals `expectedContainerId` (so a later edit by someone else
 * is never clobbered), the case it returns to still exists and is open, and the
 * case it leaves is open. Anything else is counted in `skipped`, never forced.
 * Undo is not a way around a seal.
 */
export const restorePlannedContainersNative = mutation({
  returns: v.object({ restored: v.number(), skipped: v.number() }),
  args: {
    orgId: v.string(),
    expectedContainerId: v.union(v.string(), v.null()),
    entries: v.array(v.object({ lineItemId: v.string(), from: v.union(v.string(), v.null()) })),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { orgId, expectedContainerId, entries, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, entries.length);
    assertArrayMax(entries, "entries", MAX_PLAN_LINES);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, suppliedActor);

    const cache: CaseLookup = new Map();
    const leaving = await caseOrNull(ctx, expectedContainerId, orgId, cache);
    const leavingSealed = leaving != null && isContainerSealed(leaving);
    let restored = 0;
    let projectId: string | null = null;
    for (const { lineItemId, from } of entries) {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
      if (!line || line.organizationId !== orgId) continue;
      if ((line.plannedContainerId ?? null) !== expectedContainerId) continue; // edited since: leave it
      if (leavingSealed) continue;
      const back = await caseOrNull(ctx, from, orgId, cache);
      if (from && (!back || isContainerSealed(back) || back.projectId !== line.projectId)) continue;
      await ctx.db.patch(line._id, { plannedContainerId: from ?? undefined, updatedAt: now });
      projectId ??= line.projectId;
      restored++;
    }
    if (projectId && restored > 0) {
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: orgId,
        action: "UPDATE",
        entityType: "projectLineItem",
        entityId: entries[0].lineItemId,
        projectId,
        entityName: "Planned container",
        userId: actor.userId,
        userName: actor.userName,
        summary: `Undid a packing plan change on ${restored} ${restored === 1 ? "line" : "lines"}`,
        metadata: { expectedContainerId, lineItemIds: entries.map((e) => e.lineItemId) },
        createdAt: now,
      });
    }
    return { restored, skipped: entries.length - restored };
  },
});

export const agentOps: AgentOpsAnnotations = {
  sealNative: { summary: "Seal a packing case: its plan is locked (no lines planned in or out) until unsealed.", danger: "low", mcpTier: 3 },
  unsealNative: { summary: "Unseal a packing case so its plan can change again.", danger: "low", mcpTier: 3 },
  restorePlannedContainersNative: { summary: "Undo a bulk plan change: put lines back to the case they were planned into, only where they are still as that change left them.", danger: "low", mcpTier: 3 },
};
