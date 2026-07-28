import type { MutationCtx } from "../_generated/server";
import { getAuthContext } from "./auth";

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

/** Metadata keys stamped onto EVERY agent-authored audit row. Kept as named
 *  constants because the activity-log filters, the per-key request log and the
 *  Phase-4 `revertAgentWindow` operator tool all query on them — one definition,
 *  read everywhere (R-3.1). */
export const AGENT_AUDIT_ACTOR_TYPE = "apiKey";
export const AGENT_AUDIT_KEYS = { apiKeyId: "apiKeyId", actorType: "actorType" } as const;

function asMetadataObject(metadata: unknown): Record<string, unknown> {
  if (metadata == null) return {};
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }
  // A non-object metadata value (a string/array from an older call site) would be
  // destroyed by a spread. Nest it instead of dropping it.
  return { value: metadata };
}

/**
 * Write an audit row to Convex `activityLogs` INSIDE the calling mutation's
 * transaction (Phase 5c — the first `activityLogs` writer). Folding the audit into
 * the same atomic write as the domain change means data + audit can never drift —
 * unlike today's `logActivity`, a SEPARATE Postgres write that silently swallows
 * failures (src/lib/activity-log.ts:29). This also unblocks the activity-log screens
 * as reactive native reads once every write path emits here.
 *
 * For AGENT (API-key) callers it additionally stamps `apiKeyId` + `actorType` into
 * `metadata`, derived from the VERIFIED token rather than anything the caller sent.
 * Doing it here rather than at each call site is what makes "every agent write is
 * filterable, and a bad agent run is bulk-revertible" true for all ~272 write paths
 * at once, with no schema change and nothing for a new mutation to remember.
 */
export async function writeActivityLog(
  ctx: MutationCtx,
  entry: ActivityLogEntry,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  const metadata =
    auth?.kind === "agent"
      ? {
          ...asMetadataObject(entry.metadata),
          [AGENT_AUDIT_KEYS.apiKeyId]: auth.apiKeyId,
          [AGENT_AUDIT_KEYS.actorType]: AGENT_AUDIT_ACTOR_TYPE,
        }
      : entry.metadata;
  await ctx.db.insert("activityLogs", { ...entry, metadata });
}
