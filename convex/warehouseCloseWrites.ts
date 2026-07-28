import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { writeActivityLog } from "./lib/audit";

/**
 * Native WAREHOUSE-CLOSE write mutations (Phase 3 browser-direct — replaces the
 * closeOutProject/batchCloseOut server actions in src/server/warehouse-close.ts).
 * Both gate on `warehouse:close` (exact parity with the deleted actions'
 * requirePermission("warehouse", "close")).
 *
 * The old actions did three Convex round-trips (listByProject read → the
 * closeOutIfNotClosed uniqueness-safe insert → a separate Postgres logActivity).
 * The whole close-out — pending-items guard, return-condition tally, race-safe
 * single insert, and audit — now runs as ONE atomic mutation (serializable OCC
 * forces a concurrent close of the same project to observe the existing row,
 * exactly the invariant the folded-in closeOutIfNotClosed enforced). Standard
 * shape: 4 guards + resolveActor + per-row org re-check on every by_cuid /
 * global-index fetch + atomic writeActivityLog.
 *
 * The `requireService` mirrors + closeOutIfNotClosed in warehouseCloses.ts are
 * intentionally UNTOUCHED (backfill / project-delete cascade / parity infra).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * The shared close-out core — the byte-parity port of closeOutProject's body,
 * MINUS the 4 guards + resolveActor (which the public mutations run once each).
 * closeOutNative wraps this once; batchCloseOutNative loops it (catching per-project
 * ConvexErrors). It writes the per-project audit using the supplied `auditId`.
 *
 * Throws ConvexError on: project-not-found (missing / other-org / template),
 * pending (unreturned) items, or an already-closed project. Returns the tally +
 * the project name (for the batch result rows).
 */
async function closeOutCore(
  ctx: MutationCtx,
  args: {
    id: string;
    orgId: string;
    projectId: string;
    now: number;
    actor: Actor;
    auditId: string;
  },
): Promise<{ storedCount: number; damagedCount: number; lostCount: number; projectName: string }> {
  // closedById is the VERIFIED actor (resolveActor overwrites a user token's userId with
  // the unspoofable subject) — never a client arg. Parity with the deleted action's userId.
  const { id, orgId, projectId, now, actor, auditId } = args;
  const closedById = actor.userId;

  // 1. Load the project (by_cuid is global — re-check org + reject templates).
  const project = await ctx.db
    .query("projects")
    .withIndex("by_cuid", (q) => q.eq("id", projectId))
    .first();
  if (!project || project.organizationId !== orgId || project.isTemplate) {
    throw new ConvexError("Project not found");
  }

  // 2. Top-level EQUIPMENT lines only (by_projectId is global — org-filter).
  const lines = (
    await ctx.db
      .query("projectLineItems")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()
  ).filter(
    (li) => li.organizationId === orgId && li.type === "EQUIPMENT" && li.isKitChild !== true,
  );

  // 3. Every line must be in a terminal state (returned / cancelled).
  const pending = lines.filter(
    (li) => li.status !== "RETURNED" && li.status !== "CANCELLED",
  ).length;
  if (pending > 0) {
    throw new ConvexError(
      `Cannot close: ${pending} item${pending === 1 ? "" : "s"} still not returned`,
    );
  }

  // 4. Tally the return conditions of the RETURNED lines.
  const returned = lines.filter((li) => li.status === "RETURNED");
  const storedCount = returned.filter(
    (li) => !li.returnCondition || li.returnCondition === "GOOD",
  ).length;
  const damagedCount = returned.filter((li) => li.returnCondition === "DAMAGED").length;
  const lostCount = returned.filter((li) => li.returnCondition === "MISSING").length;

  // 5. Race-safe single close-out (folds in closeOutIfNotClosed's uniqueness check).
  const existing = await ctx.db
    .query("warehouseCloses")
    .withIndex("by_projectId_organizationId", (q) =>
      q.eq("projectId", projectId).eq("organizationId", orgId),
    )
    .first();
  if (existing) throw new ConvexError("Project has already been closed out");

  await ctx.db.insert("warehouseCloses", {
    id,
    organizationId: orgId,
    projectId,
    closedById,
    closedAt: now,
    storedCount,
    damagedCount,
    lostCount,
  });

  // 6. Audit (parity: uppercase "UPDATE" action, same summary as the server action).
  await writeActivityLog(ctx, {
    id: auditId,
    organizationId: orgId,
    action: "UPDATE",
    entityType: "project",
    entityId: projectId,
    projectId,
    entityName: project.name,
    userId: actor.userId,
    userName: actor.userName,
    summary: `Closed out warehouse for "${project.name}" — ${storedCount} stored, ${damagedCount} damaged, ${lostCount} lost`,
    createdAt: now,
  });

  return { storedCount, damagedCount, lostCount, projectName: project.name };
}

/** Extract a ConvexError's user-facing message for the batch result rows. */
function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    return typeof e.data === "string" ? e.data : "Unknown error";
  }
  return e instanceof Error ? e.message : "Unknown error";
}

/**
 * Close out a single project. The client mints the warehouseClose cuid (`id`) +
 * `auditId` and passes `closedById` (the session user). Returns the tally so the
 * caller can surface the stored/damaged/lost counts.
 */
export const closeOutNative = mutation({
  returns: v.object({
    id: v.string(),
    storedCount: v.number(),
    damagedCount: v.number(),
    lostCount: v.number(),
  }),
  args: {
    id: v.string(),
    orgId: v.string(),
    projectId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, projectId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "warehouseClose");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "warehouse", "close");
    const actor = await resolveActor(ctx, suppliedActor);

    const { storedCount, damagedCount, lostCount } = await closeOutCore(ctx, {
      id,
      orgId,
      projectId,
      now,
      actor,
      auditId,
    });
    return { id, storedCount, damagedCount, lostCount };
  },
});

/**
 * Batch close-out (the warehouse landing "close out N returned projects" bar).
 * Partial-success: each project runs the SAME closeOutCore; a per-project failure
 * (pending items / already closed / not found) is captured as a result row rather
 * than aborting the batch. The client mints a {id, auditId} per item + one
 * batchAuditId. A single batch-summary audit is written only when ≥1 project closes
 * (parity with the server action, which also emitted the per-project audits via
 * each closeOutCore call).
 */
export const batchCloseOutNative = mutation({
  returns: v.array(
    v.object({
      projectId: v.string(),
      projectName: v.string(),
      success: v.boolean(),
      error: v.optional(v.string()),
    }),
  ),
  args: {
    orgId: v.string(),
    items: v.array(v.object({ projectId: v.string(), id: v.string(), auditId: v.string() })),
    now: v.number(),
    actor: actorValidator,
    batchAuditId: v.string(),
  },
  handler: async (ctx, { orgId, items, now, actor: suppliedActor, batchAuditId }) => {
    await assertWritesEnabled(ctx, "warehouseClose");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "warehouse", "close");
    const actor = await resolveActor(ctx, suppliedActor);

    if (items.length === 0) throw new ConvexError("No projects selected");
    if (items.length > 25) throw new ConvexError("Maximum 25 projects per batch close-out");

    const results: Array<{
      projectId: string;
      projectName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const item of items) {
      // Resolve a display name up front (parity with the server's getProjectById
      // fallback) — closeOutCore may throw before we'd otherwise learn it.
      const project = await ctx.db
        .query("projects")
        .withIndex("by_cuid", (q) => q.eq("id", item.projectId))
        .first();
      const projectName =
        project && project.organizationId === orgId ? project.name : item.projectId;
      try {
        const core = await closeOutCore(ctx, {
          id: item.id,
          orgId,
          projectId: item.projectId,
          now,
          actor,
          auditId: item.auditId,
        });
        results.push({ projectId: item.projectId, projectName: core.projectName, success: true });
      } catch (e) {
        results.push({
          projectId: item.projectId,
          projectName,
          success: false,
          error: errorMessage(e),
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    if (successCount > 0) {
      await writeActivityLog(ctx, {
        id: batchAuditId,
        organizationId: orgId,
        action: "UPDATE",
        entityType: "project",
        entityId: items[0].projectId,
        entityName: "Batch close-out",
        userId: actor.userId,
        userName: actor.userName,
        summary: `Batch closed ${successCount} of ${items.length} projects`,
        createdAt: now,
      });
    }

    return results;
  },
});

/**
 * Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9).
 * Both are `high`: closing a project's warehouse activity is a one-way finalisation
 * — `closeOutCore` throws "already closed" on a second attempt, and there is no
 * reopen path, so it's irreversible from the API's point of view.
 */
export const agentOps: AgentOpsAnnotations = {
  batchCloseOutNative: { danger: "high" },
  closeOutNative: { danger: "high" },
};
