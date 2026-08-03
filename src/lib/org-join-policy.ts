/**
 * Per-org join policy (#1073/A3's deferred half, wired up by B2 #1094) — the
 * single source of truth (R-3.1) for the literal union and its default, so
 * the settings UI, the `/welcome` domain-search server action and the Convex
 * `pendingOrgJoinRequests.request` mutation can't disagree on what a missing
 * value means.
 *
 * Distinct from the platform-global `SiteSettings.registrationPolicy` (which
 * gates *account* creation) — this gates *org membership* self-serve requests
 * for an org that already exists.
 *
 * - `INVITE_ONLY` — the default (byte-identical to pre-B2 behaviour): no
 *   self-serve path, an admin must send an invite.
 * - `DOMAIN_REQUEST` — additionally offers "ask to join" to a user whose
 *   verified email domain matches an existing member's.
 * - `CLOSED` — not even discoverable via domain match; invite is the only way
 *   in, and the org is not shown to anyone searching by domain.
 */

export const ORG_JOIN_POLICIES = ["INVITE_ONLY", "DOMAIN_REQUEST", "CLOSED"] as const;

export type OrgJoinPolicy = (typeof ORG_JOIN_POLICIES)[number];

export const DEFAULT_ORG_JOIN_POLICY: OrgJoinPolicy = "INVITE_ONLY";

/** Narrowing guard for the settings blob's `v.any()`-adjacent JSON boundary. */
export function isOrgJoinPolicy(value: unknown): value is OrgJoinPolicy {
  return (ORG_JOIN_POLICIES as readonly unknown[]).includes(value);
}

/** A stored/untrusted value coerced to a valid policy, defaulting to
 *  `INVITE_ONLY` for anything absent or unrecognised — every pre-B2 org. */
export function toOrgJoinPolicy(value: unknown): OrgJoinPolicy {
  return isOrgJoinPolicy(value) ? value : DEFAULT_ORG_JOIN_POLICY;
}
