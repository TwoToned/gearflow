import { ConvexError } from "convex/values";
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

/**
 * Throw if an AGENT caller sent `emitSideEffects: false`.
 *
 * The dispatcher already forces this arg to `true` before the Convex call
 * (`src/lib/api/arg-normalizer.ts`), so this only fires for a token used to call
 * Convex directly, bypassing the dispatcher — the same "force in Node AND assert
 * in Convex" redundancy as {@link assertOverbookAllowed}. No-op for browser/service
 * callers: a human turning webhooks off for one write (rare, deliberate) is
 * existing, intended behaviour.
 */
export async function assertEmitSideEffectsAgentTrue(
  ctx: QueryCtx | MutationCtx,
  emitSideEffects: boolean | undefined,
): Promise<void> {
  if (emitSideEffects !== false) return;
  const auth = await getAuthContext(ctx);
  if (auth?.kind !== "agent") return;
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "An API key may not suppress side effects (emitSideEffects must be true).",
  });
}

/** The extra scope a key must hold to open a project unlock session at all — the
 *  one true HARD_LOCKED / FINANCE_LOCKED escape hatch. Granted in no preset. */
export const UNLOCK_SESSION_SCOPE = { resource: "project", action: "unlock_session" } as const;

/**
 * Throw unless the caller may open a project unlock session.
 *
 * Unlike {@link assertOverbookAllowed}, this is unconditional for agents — opening
 * ANY unlock session (`FULL` or `PARTIAL` scope) is the one true lock override, so
 * an agent token needs the explicit scope regardless of which scope it's opening.
 * No-op for browser/service callers, who are still gated by
 * `isHardLockOverrideAllowed`'s ordinary RBAC/assignment check.
 */
export async function assertUnlockSessionAllowed(
  ctx: QueryCtx | MutationCtx,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind !== "agent") return;
  await requireAgentScope(ctx, auth, UNLOCK_SESSION_SCOPE.resource, UNLOCK_SESSION_SCOPE.action);
}

/** The extra scope a key must hold to run `agentRevert.revertAgentWindow` on
 *  itself. Granted in no preset — this is an OPERATOR safety-net tool for a
 *  human to clean up after a bad agent run, not something an agent should ever
 *  be able to invoke on its own writes. */
export const REVERT_AGENT_WINDOW_SCOPE = { resource: "warehouse", action: "revert_agent_window" } as const;

/**
 * Throw unless the caller may run `revertAgentWindow`. Unconditional for
 * agents, same posture as {@link assertUnlockSessionAllowed} — there is no
 * legitimate agent use case for this mutation, only a human operator's.
 */
export async function assertRevertAgentWindowAllowed(
  ctx: QueryCtx | MutationCtx,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind !== "agent") return;
  await requireAgentScope(ctx, auth, REVERT_AGENT_WINDOW_SCOPE.resource, REVERT_AGENT_WINDOW_SCOPE.action);
}
