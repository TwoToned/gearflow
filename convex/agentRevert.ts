import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertRevertAgentWindowAllowed } from "./lib/agentArgs";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { isAgentAuthored } from "./activityLog";
import { undeployItemsCore, unreturnItemsCore, undeployKitFull, unreturnKitFull } from "./warehouseOps";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * `revertAgentWindow` (docs/designs/api-mcp-reimplementation.md §9, issue #1000) —
 * the operator safety net behind "let the agent write": enumerate one API key's
 * agent-authored activity-log entries in a time window and reverse the ones with
 * a known inverse, using the SAME reverse-mutations a human uses from the
 * Warehouse tab (`undeployItems`/`unreturnItems`/`undeployKit`/`unreturnKit`) —
 * called here via their `*Core` helpers (the pattern `warehouseWrites.ts` itself
 * uses), so the reversal goes through the identical stock-adjustment logic.
 *
 * This works because every agent write's audit row carries `apiKeyId` +
 * `actorType: "apiKey"` (`convex/lib/audit.ts` `writeActivityLog`) — that stamp
 * IS the enumeration key.
 *
 * ## Scope, honestly stated
 *
 * Only the warehouse PHYSICAL-MOVEMENT actions this run recorded have a
 * mechanical, lossless inverse: a deploy (`CHECK_OUT`) reverses via
 * `undeployItems`/`undeployKit`; a return (`CHECK_IN`) reverses via
 * `unreturnItems`/`unreturnKit`. Everything else in the window (creates,
 * updates, deletes, archives, force-returns, financial writes) is reported in
 * `skipped` with a reason — there is no generic "undo any write" primitive in
 * this codebase to call, and inventing one is out of scope here. An operator
 * still gets the full, filterable list of what the key did (the activity log's
 * agent-authored filter, same issue) to review and hand-fix the rest.
 *
 * Deliberately NOT agent-reachable in practice: {@link assertRevertAgentWindowAllowed}
 * requires an explicit scope granted in no preset, same "denied by default"
 * posture as `project:unlock_session` — an agent must never be able to revert
 * its own (or another key's) writes.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

interface RevertedEntry {
  entryId: string;
  action: string;
  entityType: string;
  entityId: string;
  reverseOperation: string;
}

interface SkippedEntry {
  entryId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
}

type LogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  projectId?: string;
  assetId?: string;
  kitId?: string;
  createdAt?: number;
  metadata?: unknown;
};

/** `checkOutItems`/`checkInItems` write `entityName: "Line item ${lineItemId}"`
 *  even when `entityId` is the assetId (see warehouseWrites.ts) — this is the
 *  only place that string survives, so recovering the lineItemId for an
 *  asset-pinned checkout means parsing it back out. Fixed format, own writer —
 *  not a fragile guess. */
function lineItemIdFromEntityName(entityName: unknown): string | null {
  if (typeof entityName !== "string") return null;
  const match = /^Line item (.+)$/.exec(entityName);
  return match ? match[1] : null;
}

async function attemptReverse(
  ctx: Parameters<typeof undeployItemsCore>[0],
  row: LogRow & { entityName?: unknown },
  orgId: string,
  userId: string,
  now: number,
): Promise<{ reverseOperation: string } | { skipReason: string }> {
  if (!row.projectId) return { skipReason: "No projectId recorded on this entry." };

  if (row.entityType === "kit") {
    if (row.action === "CHECK_OUT") {
      await undeployKitFull(ctx, { organizationId: orgId, projectId: row.projectId, userId, kitId: row.entityId, now });
      return { reverseOperation: "warehouseWrites.undeployKit" };
    }
    if (row.action === "CHECK_IN") {
      await unreturnKitFull(ctx, { organizationId: orgId, projectId: row.projectId, userId, kitId: row.entityId, now });
      return { reverseOperation: "warehouseWrites.unreturnKit" };
    }
    return { skipReason: `No reverse rule for kit action "${row.action}".` };
  }

  if (row.entityType === "asset") {
    if (row.action === "CHECK_OUT") {
      // entityId is assetId||lineItemId (warehouseWrites.checkOutItems); recover
      // lineItemId from entityName when an assetId was pinned.
      const lineItemId = row.assetId ? lineItemIdFromEntityName(row.entityName) : row.entityId;
      if (!lineItemId) return { skipReason: "Could not recover the lineItemId for this checkout entry." };
      await undeployItemsCore(ctx, {
        organizationId: orgId, projectId: row.projectId, userId,
        items: [{ lineItemId, assetId: row.assetId }], now,
      });
      return { reverseOperation: "warehouseWrites.undeployItems" };
    }
    if (row.action === "CHECK_IN") {
      // checkInItems always records entityId = lineItemId (never the assetId).
      await unreturnItemsCore(ctx, {
        organizationId: orgId, projectId: row.projectId, userId,
        items: [{ lineItemId: row.entityId, assetId: row.assetId }], now,
      });
      return { reverseOperation: "warehouseWrites.unreturnItems" };
    }
    return { skipReason: `No reverse rule for asset action "${row.action}".` };
  }

  return { skipReason: `No reverse rule for entityType "${row.entityType}".` };
}

export const revertAgentWindow = mutation({
  args: {
    orgId: v.string(),
    apiKeyId: v.string(),
    fromMs: v.number(),
    toMs: v.number(),
    actor: actorValidator,
    now: v.number(),
  },
  returns: v.object({
    reverted: v.array(
      v.object({ entryId: v.string(), action: v.string(), entityType: v.string(), entityId: v.string(), reverseOperation: v.string() }),
    ),
    skipped: v.array(
      v.object({ entryId: v.string(), action: v.string(), entityType: v.string(), entityId: v.string(), reason: v.string() }),
    ),
  }),
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "warehouse");
    await enforceBrowserWriteLimit(ctx);
    // Operator-level RBAC (the same permission a human needs to check gear back
    // in) PLUS the dedicated, no-preset-grants-it scope — see the file docstring.
    await requireOrgPermission(ctx, a.orgId, "warehouse", "check_in");
    await assertRevertAgentWindowAllowed(ctx);
    const actor = await resolveActor(ctx, a.actor);

    if (a.toMs < a.fromMs) throw new ConvexError({ code: "INVALID_FIELD", message: "`toMs` must not be before `fromMs`." });

    const window = (await ctx.db
      .query("activityLogs")
      .withIndex("by_organizationId_createdAt", (q) => q.eq("organizationId", a.orgId))
      .filter((q) => q.gte(q.field("createdAt"), a.fromMs))
      .filter((q) => q.lte(q.field("createdAt"), a.toMs))
      .collect()) as unknown as Array<LogRow & { entityName?: unknown }>;

    const mine = window
      .filter((r) => isAgentAuthored(r) && (r.metadata as Record<string, unknown> | undefined)?.apiKeyId === a.apiKeyId)
      // Newest-first: walk a run backward, so a later write on the same line/kit
      // (if any) is reversed before an earlier one.
      .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));

    const reverted: RevertedEntry[] = [];
    const skipped: SkippedEntry[] = [];

    for (const row of mine) {
      const common = { entryId: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId };
      try {
        const result = await attemptReverse(ctx, row, a.orgId, actor.userId, a.now);
        if ("skipReason" in result) {
          skipped.push({ ...common, reason: result.skipReason });
          continue;
        }
        reverted.push({ ...common, reverseOperation: result.reverseOperation });
      } catch (err) {
        skipped.push({ ...common, reason: err instanceof Error ? err.message : "Reversal failed." });
      }
    }

    await writeActivityLog(ctx, {
      id: createId(),
      organizationId: a.orgId,
      action: "REVERT_AGENT_WINDOW",
      entityType: "apiKey",
      entityId: a.apiKeyId,
      entityName: `API key ${a.apiKeyId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Reverted ${reverted.length} of ${mine.length} agent write(s) from ${new Date(a.fromMs).toISOString()} to ${new Date(a.toMs).toISOString()}`,
      metadata: { apiKeyId: a.apiKeyId, fromMs: a.fromMs, toMs: a.toMs, revertedCount: reverted.length, skippedCount: skipped.length },
      createdAt: a.now,
    });

    return { reverted, skipped };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  // A bulk-reversal operator tool touching physical stock — high by every
  // criterion in the rubric, even though it's denied to agents by construction.
  revertAgentWindow: { danger: "high" },
};
