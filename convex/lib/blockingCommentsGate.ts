/**
 * Blocking-comment SEND-OUT gate for browser-direct warehouse checkout mutations.
 *
 * The server path is `assertNoBlockingComments` (src/lib/blocking-comments-read.ts)
 * = `collaboration.getProjectBlockingSummary` (a Convex query) + `evaluateBlockingGate`
 * (src/lib/blocking-comments-gate.ts — PURE). Moving checkout browser-direct means the
 * gate must run INSIDE the mutation, in the SAME transaction as the write, so this
 * module:
 *   1. re-implements `getProjectBlockingSummary`'s read as a `MutationCtx` scan
 *      (`buildBlockingSummary`), and
 *   2. re-implements the pure `evaluateBlockingGate` decision (`evaluateBlockingGate`
 *      here is a BYTE-FOR-BYTE copy of the src/lib original — the Convex bundler can't
 *      resolve the `@/` alias — PINNED by a cross-import equality test in
 *      `convex/warehouseWrites.test.ts`, same pattern as `convex/lib/availabilityCore`).
 *
 * `assertNoBlockingCommentsInMutation` throws a **ConvexError** (never a plain Error —
 * the prod-boundary rule) whose message is surfaced to the user, exactly like the
 * server assertion's thrown `Error.message`.
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

// ── Pure decision logic (copied byte-for-byte from src/lib/blocking-comments-gate.ts,
//    pinned by the cross-import equality test) ──────────────────────────────────────

export interface BlockingGateSummary {
  count: number;
  lineItemTargetIds: string[];
  groupTargetIds: string[];
  hasProjectLevel: boolean;
}

export interface BlockingGateOptions {
  lineItemId?: string;
  groupId?: string | null;
  actionLabel?: string;
}

export type BlockingGateReason = "none" | "project" | "group" | "item";

export interface BlockingGateResult {
  blocked: boolean;
  reason: BlockingGateReason;
  message?: string;
}

export function evaluateBlockingGate(
  summary: BlockingGateSummary,
  opts: BlockingGateOptions = {},
): BlockingGateResult {
  const action = opts.actionLabel ?? "continue";

  if (summary.count === 0) return { blocked: false, reason: "none" };

  const scoped = opts.lineItemId != null || opts.groupId != null;

  if (scoped) {
    // A project-level blocker gates every item regardless of group / line.
    if (summary.hasProjectLevel) {
      return {
        blocked: true,
        reason: "project",
        message:
          `Can't ${action}: this project has an unresolved project-wide blocking comment. ` +
          `Resolve it before prepping or sending out.`,
      };
    }
    if (opts.lineItemId && summary.lineItemTargetIds.includes(opts.lineItemId)) {
      return {
        blocked: true,
        reason: "item",
        message:
          `Can't ${action}: this item has an unresolved blocking comment. ` +
          `Resolve it before prepping or sending out.`,
      };
    }
    if (opts.groupId && summary.groupTargetIds.includes(opts.groupId)) {
      return {
        blocked: true,
        reason: "group",
        message:
          `Can't ${action}: this item's group has an unresolved blocking comment. ` +
          `Resolve it before prepping or sending out.`,
      };
    }
    return { blocked: false, reason: "none" };
  }

  // Full-project gate: any open blocker stops the action.
  const n = summary.count;
  return {
    blocked: true,
    reason: "project",
    message:
      `Can't ${action}: this project has ${n} unresolved blocking comment${n === 1 ? "" : "s"}. ` +
      `Resolve ${n === 1 ? "it" : "them"} before prepping or sending out.`,
  };
}

// ── In-mutation read (mirrors collaboration.getProjectBlockingSummary, minus the
//    caller-org auth that the mutation already ran) ────────────────────────────────

/** Scan `commentThreads` for OPEN + blocking rows on this project and bucket them
 *  into the `BlockingGateSummary` shape — the MutationCtx twin of the
 *  `collaboration.getProjectBlockingSummary` query (same index, same predicates). */
export async function buildBlockingSummary(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
): Promise<BlockingGateSummary> {
  const threads = await ctx.db
    .query("commentThreads")
    .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .collect();
  const open = threads.filter((t) => t.status === "open" && t.isBlocking);
  const lineItemTargetIds: string[] = [];
  const groupTargetIds: string[] = [];
  let hasProjectLevel = false;
  for (const t of open) {
    if (t.targetType === "lineItem" && t.targetId) lineItemTargetIds.push(t.targetId);
    else if (t.targetType === "group" && t.targetId) groupTargetIds.push(t.targetId);
    else if (!t.targetId) hasProjectLevel = true;
  }
  return { count: open.length, lineItemTargetIds, groupTargetIds, hasProjectLevel };
}

/** In-transaction blocking-comment gate for warehouse checkout. Throws a
 *  ConvexError (surfaced to the user) when an open blocker stops the action —
 *  the MutationCtx twin of `assertNoBlockingComments`. */
export async function assertNoBlockingCommentsInMutation(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  opts?: BlockingGateOptions,
): Promise<void> {
  const summary = await buildBlockingSummary(ctx, orgId, projectId);
  const result = evaluateBlockingGate(summary, {
    lineItemId: opts?.lineItemId,
    groupId: opts?.groupId,
    actionLabel: opts?.actionLabel,
  });
  if (result.blocked) throw new ConvexError(result.message ?? "Blocked by an unresolved blocking comment");
}
