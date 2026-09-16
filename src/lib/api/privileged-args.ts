/**
 * The privileged-argument policy register (docs/designs/api-mcp-reimplementation.md §6).
 *
 * A privileged argument is one that lets an already-*permitted* caller SOFTEN a
 * gate — overbook past availability, justify past a lifecycle lock, force a merge,
 * skip a step. They are the only bypass levers in the mutation surface, and they
 * are dangerous in a specific, quiet way: a key holding `project:update` must not
 * thereby be able to overbook, but nothing about the RBAC vocabulary says so.
 *
 * So each one carries its own policy row, and `scripts/generate-api-registry.ts`
 * fails the build if a NEW argument matching the privileged shape
 * (`/^(allow|force|skip|override|ignore|bypass)/` or named `justification`)
 * appears anywhere in `convex/*.ts` without one. That gate is the entire point of
 * this file — it is what stops an eighth bypass lever from being silently exposed
 * to agents in six months' time, which is exactly how the previous build would
 * have regressed.
 *
 * Adding a row is a deliberate act. Read §6 before you do, and give it the
 * narrowest `agentAccess` that still makes the feature work.
 */

/** What an AGENT may do with this argument. */
type PrivilegedArgAccess =
  /** Never reachable by an agent — the dispatcher strips it and Convex rejects it. */
  | "denied"
  /** Reachable only if the key holds the named extra scope. */
  | "scoped"
  /** Reachable; the dispatcher pins the value (agent never controls it). */
  | "injected"
  /** Reachable with no extra scope — genuinely benign. */
  | "allowed";

export interface PrivilegedArgPolicy {
  /** The literal argument name as it appears in a Convex `args` validator. */
  arg: string;
  /** Which gate it softens — in plain words, for the generated docs. */
  softens: string;
  agentAccess: PrivilegedArgAccess;
  /** Required for `agentAccess: "scoped"`: the extra scope the key must hold. */
  requiredScope?: string;
  /** Danger tier, feeding the Phase-4 `confirm: true` requirement. */
  danger: "low" | "medium" | "high";
  /** Why this policy and not a stricter one. */
  rationale: string;
}

export const PRIVILEGED_ARG_POLICIES: readonly PrivilegedArgPolicy[] = [
  {
    arg: "allowOverbook",
    softens: "the in-mutation availability / double-booking check",
    agentAccess: "scoped",
    requiredScope: "project:allow_overbook",
    danger: "high",
    rationale:
      "The archived design said 'do not expose'. Forcing it false in the dispatcher AND " +
      "rejecting it in Convex without the scope is strictly stronger than stripping it in " +
      "Node, because it also holds for a leaked token calling Convex directly. A human " +
      "overbooking is a judgement call; an agent doing it is almost always a mistake, so " +
      "the scope is in no preset (see §16.4 — it may become a permanent deny).",
  },
  {
    arg: "justification",
    softens:
      "NOTHING, as of #1230 (Phase 4, \"Project versioning v2\" parent #1221) — " +
      "`assertLifecycleGuard`'s JUSTIFY tier (ON_SITE / RETURNED projects) this " +
      "argument used to soften is deleted along with the rest of the 4-tier lock " +
      "system. It survives as an accepted-but-IGNORED arg on the two mutations " +
      "wrapped by a stable/v1 curated MCP tool (`lineItemWrites.addNative`, " +
      "`crewAssignmentsWrites.createNative`) purely because a stable operation's " +
      "fields may only be ADDED, never removed (design §13 decision 12) — removing " +
      "the arg outright would need a /v2. Every other mutation that used to accept " +
      "it had the arg deleted outright (not stable, no contract to preserve).",
    agentAccess: "allowed",
    danger: "low",
    rationale:
      "A no-op arg gates nothing, so there is nothing left to bound with `confirm: " +
      "true`. Kept in this register (rather than removed) because the CI scanner " +
      "flags ANY arg literally named `justification` regardless of whether it does " +
      "anything — this row is what satisfies that gate for the two stable holdouts.",
  },
  {
    arg: "emitSideEffects",
    softens: "the webhook / side-effect fold",
    agentAccess: "injected",
    danger: "low",
    rationale:
      "Always pinned true by the dispatcher. An agent that could set it false would make " +
      "its own writes invisible to webhooks and downstream integrations — silent divergence " +
      "is worse than a noisy one.",
  },
  {
    arg: "overrideReason",
    softens: "the line-item override audit trail",
    agentAccess: "allowed",
    danger: "medium",
    rationale: "Records intent rather than skipping a check; string-bounded by fieldGuards.",
  },
  {
    arg: "forceSeparate",
    softens: "merge-dedup on add",
    agentAccess: "allowed",
    danger: "low",
    rationale: "Cosmetic — chooses whether two identical lines merge. No gate is softened.",
  },
  {
    arg: "skipped",
    softens: "check-item completion (marks an item as not performed)",
    agentAccess: "allowed",
    danger: "medium",
    rationale:
      "Part of the normal check workflow, not a bypass: a skipped item is RECORDED as " +
      "skipped and shows on the report, rather than being silently passed.",
  },
  {
    arg: "allowOrgCreation",
    softens: "siteSettings' org-creation gate",
    agentAccess: "denied",
    danger: "high",
    rationale:
      "Site-admin surface, above the org boundary an agent token is scoped to. There is no " +
      "org-scoped key that should ever be able to create organizations.",
  },
];

const BY_ARG = new Map(PRIVILEGED_ARG_POLICIES.map((p) => [p.arg, p]));

/** The shape that triggers the CI gate. Module-private on purpose: callers ask
 *  {@link isPrivilegedArgName}, so there is exactly one place that decides what
 *  counts as privileged and no second copy of the pattern to drift. */
const PRIVILEGED_ARG_PATTERN = /^(allow|force|skip|override|ignore|bypass)/;

/** Does this argument name need a policy row? */
export function isPrivilegedArgName(name: string): boolean {
  return name === "justification" || PRIVILEGED_ARG_PATTERN.test(name);
}

export function policyForArg(name: string): PrivilegedArgPolicy | null {
  return BY_ARG.get(name) ?? null;
}
