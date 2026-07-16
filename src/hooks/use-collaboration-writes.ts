"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct collaboration comment/review-marker writes (Phase 3 — replaces
 * the createThread / addComment / setThreadBlocking / resolveThread / reopenThread
 * / setReviewMarker server actions in src/server/collaboration.ts). The Convex
 * mutations now run the 4-guard bar (assertWritesEnabled + enforceBrowserWriteLimit
 * + requireOrgRead|requireOrgPermission + resolveActor); the author + avatar colour
 * are pinned to the verified token INSIDE the mutation, so this hook does NOT pass a
 * colour and the createdBy/name it sends are advisory (resolveActor overwrites them).
 *
 * Signatures mirror the deleted server actions so consumers only swap the import.
 * The RBAC on the blocking/resolve/reopen paths (project manage_line_items) is now
 * enforced Convex-side; a non-permitted caller's mutation throws (surfaced by the
 * consumer's useServerMutation error handling).
 */
export function useCollaborationWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();

  const createThreadM = useMutation(api.collaboration.createThread);
  const addCommentM = useMutation(api.collaboration.addComment);
  const setThreadBlockingM = useMutation(api.collaboration.setThreadBlocking);
  const resolveThreadM = useMutation(api.collaboration.resolveThread);
  const reopenThreadM = useMutation(api.collaboration.reopenThread);
  const setReviewMarkerM = useMutation(api.collaboration.setReviewMarker);

  const requireOrg = useCallback((): string => {
    const id = activeOrg?.id;
    if (!id) throw new Error("No active organization");
    return id;
  }, [activeOrg?.id]);
  const uid = session?.user.id ?? "";
  const uname = session?.user.name ?? "";

  const createThread = useCallback(
    async (
      entityType: string,
      entityId: string,
      firstComment: string,
      targetType?: string,
      targetId?: string,
      options?: { isBlocking?: boolean; mentionUserIds?: string[]; projectId?: string },
    ): Promise<{ threadId: string }> => {
      const threadId = await createThreadM({
        orgId: requireOrg(),
        entityType,
        entityId,
        targetType,
        targetId,
        firstComment,
        createdBy: uid,
        createdByName: uname,
        isBlocking: options?.isBlocking ?? false,
        projectId: options?.projectId,
        mentionUserIds: options?.mentionUserIds,
      });
      return { threadId: threadId as unknown as string };
    },
    [createThreadM, requireOrg, uid, uname],
  );

  const addComment = useCallback(
    async (threadId: string, body: string, options?: { mentionUserIds?: string[] }): Promise<{ ok: true }> => {
      await addCommentM({
        orgId: requireOrg(),
        threadId,
        body,
        authorId: uid,
        authorName: uname,
        mentionUserIds: options?.mentionUserIds,
      });
      return { ok: true };
    },
    [addCommentM, requireOrg, uid, uname],
  );

  const setThreadBlocking = useCallback(
    async (threadId: string, isBlocking: boolean): Promise<{ ok: true }> => {
      await setThreadBlockingM({ orgId: requireOrg(), threadId, isBlocking, actorUserId: uid, actorName: uname });
      return { ok: true };
    },
    [setThreadBlockingM, requireOrg, uid, uname],
  );

  const resolveThread = useCallback(
    async (threadId: string): Promise<{ ok: true }> => {
      await resolveThreadM({ orgId: requireOrg(), threadId, resolvedBy: uid, actorName: uname });
      return { ok: true };
    },
    [resolveThreadM, requireOrg, uid, uname],
  );

  const reopenThread = useCallback(
    async (threadId: string): Promise<{ ok: true }> => {
      await reopenThreadM({ orgId: requireOrg(), threadId, actorUserId: uid, actorName: uname });
      return { ok: true };
    },
    [reopenThreadM, requireOrg, uid, uname],
  );

  const setReviewMarker = useCallback(
    async (
      entityType: string,
      entityId: string,
      targetType: string,
      targetId: string,
      status: "needs_review" | "follow_up" | "resolved",
      reason?: string,
      note?: string,
    ): Promise<{ ok: true }> => {
      await setReviewMarkerM({
        orgId: requireOrg(),
        entityType,
        entityId,
        targetType,
        targetId,
        status,
        reason,
        note,
        createdBy: uid,
        createdByName: uname,
      });
      return { ok: true };
    },
    [setReviewMarkerM, requireOrg, uid, uname],
  );

  return { createThread, addComment, setThreadBlocking, resolveThread, reopenThread, setReviewMarker };
}
