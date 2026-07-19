import "server-only";
import { logger } from "@/lib/logger";

import { getConvexClient } from "@/lib/convex-client";
import { evaluateBlockingGate } from "@/lib/blocking-comments-gate";
import { api } from "../../convex/_generated/api";

/**
 * Server-only reads for blocking comments (Convex), plus the assertion guard the
 * prep / send-out / project-forward server actions call.
 *
 * A "blocking comment" is an open `commentThreads` row with `isBlocking: true`.
 * Resolving the thread (status → resolved) clears the block. These reads run
 * through the trusted Convex service token; the calling server action has
 * already run requirePermission/getOrgContext, so org scoping is enforced
 * upstream — we pass `orgId` straight through.
 *
 * NOT a `"use server"` module: these are plain server helpers imported by the
 * gate server actions, like `src/lib/clients-read.ts`.
 */

export interface ProjectBlockingSummary {
  count: number;
  lineItemTargetIds: string[];
  groupTargetIds: string[];
  hasProjectLevel: boolean;
}

export async function getProjectBlockingSummary(
  orgId: string,
  projectId: string,
): Promise<ProjectBlockingSummary> {
  const convex = await getConvexClient();
  const res = await convex.query(api.collaboration.getProjectBlockingSummary, {
    orgId,
    projectId,
  });
  return {
    count: res.count,
    lineItemTargetIds: res.lineItemTargetIds,
    groupTargetIds: res.groupTargetIds ?? [],
    hasProjectLevel: res.hasProjectLevel,
  };
}

export async function getBlockingCountsForProjects(
  orgId: string,
  projectIds: string[],
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {};
  const convex = await getConvexClient();
  return await convex.query(api.collaboration.listBlockingForProjects, {
    orgId,
    projectIds,
  });
}

export interface OpenBlockingThread {
  threadId: string;
  projectId: string;
  entityType: string;
  entityId: string;
  targetType: string | null;
  targetId: string | null;
  createdByName: string;
  createdAt: number;
  mentionUserIds: string[];
  snippet: string;
}

export async function listOpenBlockingThreads(
  orgId: string,
): Promise<OpenBlockingThread[]> {
  const convex = await getConvexClient();
  return await convex.query(api.collaboration.listOpenBlockingThreads, { orgId });
}

/**
 * Throw if the project has open blocking comments that should stop the requested
 * action. Two modes:
 *  - project-wide (no `lineItemId`): ANY open blocking comment blocks. Use for
 *    check-out, send-out, and forward status transitions.
 *  - per-line-item (`lineItemId` given): blocks only when there's a
 *    project-level blocker OR a blocker on that exact line item. Use for prep
 *    operations so an unrelated item's blocker doesn't stall prepping others.
 *
 * Throws a plain Error whose message is surfaced to the user (server actions in
 * this app toast `error.message`). Never blocks deprep / returns — callers only
 * invoke this on forward operations.
 */
export async function assertNoBlockingComments(
  orgId: string,
  projectId: string,
  opts?: { lineItemId?: string; groupId?: string | null; actionLabel?: string },
): Promise<void> {
  let summary: ProjectBlockingSummary;
  try {
    summary = await getProjectBlockingSummary(orgId, projectId);
  } catch (error) {
    logger.error("Failed to read blocking comments before warehouse action", { error: error });
    throw new Error(
      "Can't verify blocking comments right now, so this action is paused. Try again once collaboration status is reachable.",
    );
  }

  const result = evaluateBlockingGate(summary, {
    lineItemId: opts?.lineItemId,
    groupId: opts?.groupId,
    actionLabel: opts?.actionLabel,
  });
  if (result.blocked) throw new Error(result.message);
}
