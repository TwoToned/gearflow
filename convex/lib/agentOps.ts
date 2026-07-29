/**
 * The `agentOps` annotation format (design §7, Phase 5 / #1001).
 *
 * Colocated per `convex/*.ts` module, next to the guard calls the registry
 * generator already reads. Deliberately carries NO resource/action/scope —
 * those are extracted from the guard call itself (`requireOrgPermission` /
 * `requireOrgReadFor` / `requireSelfScope`), so there is nothing here that
 * could drift from it (R-3.1). What this format adds is the metadata that
 * genuinely has no other home:
 *
 *   - `summary`   — one sentence: what this operation does for an agent
 *                   caller. Feeds `/operations` and the generated OpenAPI doc.
 *   - `danger`    — "low" | "medium" | "high". Phase 4 (#1000) is what makes
 *                   `high` actually require `confirm:true` + an
 *                   `idempotencyKey`; recording it now is forward-compatible
 *                   groundwork, not enforcement — there is no consumer yet.
 *   - `mcpTier`   — 1 (curated-tool candidate) | 2 (discoverable via
 *                   `call_operation`, not curated) | 3 (rarely useful to an
 *                   agent, but not hidden).
 *   - `agentAccess: "denied"` — records a DELIBERATE decision to keep an
 *                   otherwise-classifiable operation closed. The operation's
 *                   actual guard (usually `service`, or an unmigrated
 *                   resource-less `requireOrgRead`) is what enforces the
 *                   denial — this field only records WHY, so "we didn't get
 *                   to it" can't masquerade as a decision. Requires `reason`;
 *                   the registry generator fails the build on a denied entry
 *                   with no reason, and on a denied entry whose guard already
 *                   admits an agent token (a contradiction — fix the guard or
 *                   drop the denial, don't keep both).
 *
 * Export ONE `agentOps` object per module, keyed by the exported function
 * name. A function absent from the map is simply unannotated (fine — this is
 * additive metadata, not a required gate for reachability):
 *
 *   export const agentOps: AgentOpsAnnotations = {
 *     list: { summary: "List suppliers visible to the caller's org.", danger: "low", mcpTier: 2 },
 *     exportOrgData: { agentAccess: "denied", reason: "Unredacted full-org export; no scope model covers it (design §4)." },
 *   };
 */

export type AgentOpDanger = "low" | "medium" | "high";
export type AgentOpMcpTier = 1 | 2 | 3;

export interface AgentOpAnnotation {
  /** One sentence: what this operation does for an agent caller. */
  readonly summary?: string;
  /** Phase 4 (#1000) will make "high" require confirm:true + idempotencyKey.
   *  No enforcement consumes this yet — see the file header. */
  readonly danger?: AgentOpDanger;
  /** 1 = curated-tool candidate, 2 = call_operation-discoverable, 3 = low-value. */
  readonly mcpTier?: AgentOpMcpTier;
  /** Marks a deliberate, permanent denial. Always pair with `reason`. */
  readonly agentAccess?: "denied";
  /** Required when `agentAccess: "denied"`. "We didn't get to it" is not a reason. */
  readonly reason?: string;
}

export type AgentOpsAnnotations = Readonly<Record<string, AgentOpAnnotation>>;
