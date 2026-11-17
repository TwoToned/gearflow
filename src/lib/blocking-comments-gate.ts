/**
 * Pure decision logic for the blocking-comment prep / send-out gates.
 *
 * Kept free of any Convex / Prisma imports so it can be unit-tested directly and
 * reused by `assertNoBlockingComments` (the server-only wrapper that fetches the
 * summary and throws). A "blocking comment" is an open `commentThreads` row with
 * `isBlocking: true`. Threads attach at three levels:
 *   - project-level (no target)      → gates everything on the project
 *   - group-level   (targetType group) → gates line items inside that group
 *   - line-item     (targetType lineItem) → gates only that line item
 *
 * The full-project gate (check-out, send-out, forward status) blocks on ANY open
 * blocker. The per-line-item gate (prep / pull / check & pack) blocks only when a
 * project-level blocker exists, the item itself is blocked, or the item's group
 * is blocked — so an unrelated item's blocker never stalls prepping others.
 */

export interface BlockingGateSummary {
  /** Total open blocking threads on the project (all levels). */
  count: number;
  /** Line-item ids with an open blocking thread. */
  lineItemTargetIds: string[];
  /** Project-group ids with an open blocking thread. */
  groupTargetIds: string[];
  /** True when an open project-level (untargeted) blocker exists. */
  hasProjectLevel: boolean;
}

export interface BlockingGateOptions {
  /** Scope the gate to a single line item (prep flows). */
  lineItemId?: string;
  /** The line item's project group, so a group-level blocker gates it too. */
  groupId?: string | null;
  /** Verb for the user-facing message, e.g. "prep this item". */
  actionLabel?: string;
}

export type BlockingGateReason = "none" | "project" | "group" | "item";

export interface BlockingGateResult {
  blocked: boolean;
  reason: BlockingGateReason;
  /** User-facing message when blocked; undefined otherwise. */
  message?: string;
}

/**
 * Decide whether an action should be blocked by open blocking comments.
 * Pure — callers fetch the summary and surface `message` on `blocked`.
 */
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
