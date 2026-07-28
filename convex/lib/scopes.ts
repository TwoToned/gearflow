/**
 * Isomorphic API-key scope logic — the pure `resource:action` grant algebra shared
 * by the Convex guards (`convex/lib/auth.ts` `requireAgentScope`) AND the Next.js
 * side (`src/lib/api-key.ts` re-exports it).
 *
 * This file MUST stay import-free / side-effect-free so it bundles cleanly into
 * BOTH the Next build and the Convex deployment — same constraint (and same
 * reason) as `convex/lib/permissionsCore.ts`. Do NOT add Prisma, Node, browser or
 * `@/`-aliased imports here.
 *
 * Why one file rather than a copy on each side: the scope grant rule is a business
 * rule, and a second hand-maintained implementation of it is a defect even while
 * the two agree (POLICY.md R-3.1). The Convex-side check is the load-bearing one
 * (§5 of docs/designs/api-mcp-reimplementation.md — it runs inside the transaction,
 * so a leaked agent token calling Convex directly can't dodge it); the Node-side
 * check is UX/fail-fast. They must never disagree about what a scope grants.
 *
 * Vocabulary: scopes reuse the RBAC vocabulary verbatim — `permissionsCore`'s
 * `RESOURCES` × their actions (`asset:read`, `project:manage_line_items`,
 * `warehouse:check_out`, …), plus the two personal-scope strings below. There is
 * deliberately NO parallel scope vocabulary to keep in sync.
 */

/**
 * The pseudo-resource for personal-scope operations (`savedTableViews*`,
 * `userNotificationPreferences`, `notificationDismissals`). Those guard on
 * "the verified user's own row", not resource RBAC, so folding them into a
 * resource scope would over-grant. They get `self:read` / `self:write` instead,
 * enforced via `requireSelfScope`.
 */
export const SELF_RESOURCE = "self";

/** The two actions valid on {@link SELF_RESOURCE}. */
export const SELF_ACTIONS = ["read", "write"] as const;
export type SelfAction = (typeof SELF_ACTIONS)[number];

/** Parse the stored `scopes` JSON string into a string[] (never throws). */
export function parseScopes(scopesJson: string | null | undefined): string[] {
  if (!scopesJson) return [];
  try {
    const parsed: unknown = JSON.parse(scopesJson);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Does this scope set grant `resource:action`? Supports `*` (all), `resource:*`
 * (all actions on a resource), and exact `resource:action`.
 */
export function hasScope(
  scopes: readonly string[],
  resource: string,
  action: string,
): boolean {
  return (
    scopes.includes("*") ||
    scopes.includes(`${resource}:*`) ||
    scopes.includes(`${resource}:${action}`)
  );
}

/**
 * Does `granting` cover the whole of `scope`? Unlike {@link hasScope} (which asks
 * about one concrete `resource:action`), this compares a scope STRING that may
 * itself be a wildcard — so `"*"` is only granted by `"*"`, and `"asset:*"` needs
 * `"*"` or `"asset:*"`. A malformed scope is never granted.
 */
export function isScopeGranted(granting: readonly string[], scope: string): boolean {
  if (granting.includes("*")) return true;
  if (scope === "*") return false; // only a `*` holder can grant `*`
  const [resource, action, ...rest] = scope.split(":");
  if (!resource || !action || rest.length) return false;
  return hasScope(granting, resource, action);
}
