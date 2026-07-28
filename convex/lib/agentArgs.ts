import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getAuthContext, requireAgentScope } from "./auth";

/**
 * Server-side enforcement of the privileged-argument policy
 * (docs/designs/api-mcp-reimplementation.md §6).
 *
 * A privileged argument lets an already-*permitted* caller soften a gate. The
 * danger is specific and quiet: a key holding `project:manage_line_items` must
 * not thereby be able to overbook, but nothing in the RBAC vocabulary says so —
 * `allowOverbook` is just another boolean on the same mutation.
 *
 * The dispatcher will also force these to safe defaults before the call. That is
 * NOT sufficient on its own, and the redundancy is deliberate: an agent token is
 * a valid Convex JWT, so anything enforced only in the Node dispatcher is
 * bypassed by calling Convex directly. Forcing in the dispatcher plus asserting
 * here is strictly stronger than the archived design's "strip it in Node".
 *
 * The policy register (`src/lib/api/privileged-args.ts`) and the CI gate in
 * `scripts/generate-api-registry.mts` make sure a NEW argument of this shape
 * can't reach the surface unclassified.
 */

/** The extra scope a key must hold to soften the availability check. Granted in
 *  no preset — a human overbooking is a judgement call, an agent doing it is
 *  almost always a mistake (see design §16.4). */
export const OVERBOOK_SCOPE = { resource: "project", action: "allow_overbook" } as const;

/**
 * Throw unless the caller may pass `allowOverbook: true`.
 *
 * No-op when the flag is false (the overwhelmingly common case, so this costs
 * nothing on the hot path), and no-op for browser/service callers — a human with
 * `project:manage_line_items` overbooking through the UI is existing, intended
 * behaviour and this must not change it.
 */
export async function assertOverbookAllowed(
  ctx: QueryCtx | MutationCtx,
  allowOverbook: boolean,
): Promise<void> {
  if (!allowOverbook) return;
  const auth = await getAuthContext(ctx);
  if (auth?.kind !== "agent") return;
  await requireAgentScope(ctx, auth, OVERBOOK_SCOPE.resource, OVERBOOK_SCOPE.action);
}
