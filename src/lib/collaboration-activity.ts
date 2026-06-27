import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getUserColor } from "@/lib/collaboration-colors";

/**
 * Server-side helper for writing collaboration activity events to Convex.
 *
 * This is a plain library function (NOT a server action): exporting it from a
 * `"use server"` module would register it as a public, callable endpoint with no
 * permission gate, letting any org member inject arbitrary activity events.
 * Callers are already inside an authorized server action and pass their
 * resolved actor context, so there is no second `getOrgContext()` round trip.
 *
 * The collaboration lifecycle events (comment/blocking/resolve/reopen/review)
 * are logged atomically *inside* their Convex mutations — see
 * `convex/collaboration.ts`. This helper is for activity that originates from
 * other server mutations (e.g. quote/line-item edits) where the realtime feed
 * should also reflect the change.
 */
export interface CollabActivityActor {
  organizationId: string;
  userId: string;
  userName: string;
}

export interface CollabActivityEvent {
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeCollabActivityEvent(
  actor: CollabActivityActor,
  event: CollabActivityEvent,
): Promise<void> {
  // Best-effort (mirrors logActivity): the realtime collaboration feed is
  // non-critical, so a failure here must never fail the surrounding write — and
  // this lets callers run it concurrently with recalc/audit in the post-write tail
  // without a throw aborting the action.
  try {
    const convex = await getConvexClient();
    await convex.mutation(api.collaboration.logActivityEvent, {
      orgId: actor.organizationId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: getUserColor(actor.userId),
      entityType: event.entityType,
      entityId: event.entityId,
      targetType: event.targetType,
      targetId: event.targetId,
      action: event.action,
      summary: event.summary,
      metadata: event.metadata,
    });
  } catch (error) {
    console.error("Failed to write collab activity event:", error);
  }
}
