import type { MutationCtx } from "../_generated/server";

/**
 * The audit entry shape written to Convex `activityLogs`. Mirrors the Postgres
 * `logActivity` input (src/lib/activity-log.ts) so the two stores stay comparable
 * during the Phase 5 transition. `id` + `createdAt` are CALLER-supplied (a cuid +
 * Date.now()) — a Convex mutation can't mint a cuid (Math.random is non-deterministic),
 * and passing them keeps the write deterministic and parity-matches Prisma's id shape.
 */
export interface ActivityLogEntry {
  id: string;
  organizationId: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  userId?: string;
  userName: string;
  summary: string;
  details?: unknown;
  metadata?: unknown;
  projectId?: string;
  assetId?: string;
  kitId?: string;
  createdAt: number;
}

/**
 * Write an audit row to Convex `activityLogs` INSIDE the calling mutation's
 * transaction (Phase 5c — the first `activityLogs` writer). Folding the audit into
 * the same atomic write as the domain change means data + audit can never drift —
 * unlike today's `logActivity`, a SEPARATE Postgres write that silently swallows
 * failures (src/lib/activity-log.ts:29). This also unblocks the activity-log screens
 * as reactive native reads once every write path emits here.
 */
export async function writeActivityLog(
  ctx: MutationCtx,
  entry: ActivityLogEntry,
): Promise<void> {
  await ctx.db.insert("activityLogs", { ...entry });
}
