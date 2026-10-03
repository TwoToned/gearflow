import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";

/**
 * The mentions-inbox write (work-layer phase 0, #1241, work-layer.md §10.2/§9).
 *
 * NOT a public Convex function — called in-process from the comment mutations in
 * convex/collaboration.ts so the notification insert lands INSIDE the SAME
 * transaction as the comment it announces. Comment and notification commit
 * together or neither does (deliberately unlike `logActivity`, which is
 * best-effort because it crosses into another system — this doesn't cross
 * anything).
 *
 * Dedupe key is `mention:<commentId>:<userId>` (§9's sourceKey shape) — stable
 * across retries because it names the underlying comment + recipient, not a
 * computation. Checked against `by_organizationId_dedupeKey`, so a retried
 * mutation (or the same user mentioned twice in one body) never produces a
 * second row — "one notification per event" (§10.2).
 */

/** Where the bell/Today should send the reader for each comment-thread entityType.
 *  commentThreads today are mounted on projects, assets, clients and suppliers
 *  only (work-layer.md §3) — an entityType outside that set falls back to the
 *  dashboard rather than guessing a route that doesn't exist. */
function hrefForCommentEntity(entityType: string, entityId: string): string {
  switch (entityType) {
    case "project":
      return `/projects/${entityId}`;
    case "asset":
      return `/assets/registry/${entityId}`;
    case "client":
      return `/clients/${entityId}`;
    case "supplier":
      return `/suppliers/${entityId}`;
    default:
      return "/";
  }
}

/** Trim a comment body to a notification-sized snippet. */
function snippet(body: string, max = 140): string {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export interface NotifyMentionsArgs {
  organizationId: string;
  /** Raw mentioned-user ids from the comment; deduped and self-filtered here. */
  mentionedUserIds: string[];
  /** The comment's author — never notified about mentioning themselves. */
  actorUserId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  /** Convex `commentThreads` doc id (as a string) — the dedupe key's identity. */
  commentId: string;
  commentBody: string;
}

/**
 * Write one `notifications` row per newly-mentioned user (minus the author),
 * skipping any (organizationId, dedupeKey) pair that already exists. Call this
 * from inside a mutation, after the comment/thread write, passing the SAME ctx.
 */
export async function notifyMentions(ctx: MutationCtx, args: NotifyMentionsArgs): Promise<void> {
  const recipients = Array.from(new Set(args.mentionedUserIds)).filter(
    (userId) => userId && userId !== args.actorUserId,
  );
  if (recipients.length === 0) return;

  const href = hrefForCommentEntity(args.entityType, args.entityId);
  const title = `${args.actorName} mentioned you`;
  const body = snippet(args.commentBody);
  const now = Date.now();

  for (const userId of recipients) {
    const dedupeKey = `mention:${args.commentId}:${userId}`;
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_organizationId_dedupeKey", (q) =>
        q.eq("organizationId", args.organizationId).eq("dedupeKey", dedupeKey),
      )
      .first();
    if (existing) continue;

    await ctx.db.insert("notifications", {
      id: createId(),
      organizationId: args.organizationId,
      userId,
      type: "mentioned",
      entityType: args.entityType,
      entityId: args.entityId,
      title,
      body,
      href,
      dedupeKey,
      createdAt: now,
    });
  }
}
