import "server-only";

import { getConvexClient } from "@/lib/convex-client";
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
  opts?: { lineItemId?: string; actionLabel?: string },
): Promise<void> {
  const summary = await getProjectBlockingSummary(orgId, projectId);
  if (summary.count === 0) return;

  const action = opts?.actionLabel ?? "continue";

  if (opts?.lineItemId) {
    const blockedByItem = summary.lineItemTargetIds.includes(opts.lineItemId);
    if (!summary.hasProjectLevel && !blockedByItem) return;
    throw new Error(
      `Can't ${action}: this item has an unresolved blocking comment. ` +
        `Resolve it before prepping or sending out.`,
    );
  }

  const n = summary.count;
  throw new Error(
    `Can't ${action}: this project has ${n} unresolved blocking comment${n === 1 ? "" : "s"}. ` +
      `Resolve ${n === 1 ? "it" : "them"} before prepping or sending out.`,
  );
}
