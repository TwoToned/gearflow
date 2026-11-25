import type { MutationCtx } from "../_generated/server";
import { getUserColor } from "./collaborationColors";

/**
 * Emit one collaboration-feed row for a project (the Activity rail). UX Phase 10
 * (task, note and file writes). The summary and metadata MUST NOT carry note
 * text or any money: the feed is readable by everyone with job read.
 */
export async function emitProjectActivityEvent(
  ctx: MutationCtx,
  a: {
    orgId: string;
    projectId: string;
    actor: { userId: string; userName: string };
    action: string;
    summary: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, string | number | boolean | null>;
    now: number;
  },
): Promise<void> {
  await ctx.db.insert("activityEvents", {
    orgId: a.orgId,
    actorUserId: a.actor.userId,
    actorName: a.actor.userName,
    actorColor: getUserColor(a.actor.userId),
    entityType: "project",
    entityId: a.projectId,
    targetType: a.targetType,
    targetId: a.targetId,
    action: a.action,
    summary: a.summary,
    metadata: a.metadata,
    createdAt: a.now,
  });
}
