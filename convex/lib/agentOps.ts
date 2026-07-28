/**
 * The per-operation `danger` classification (docs/designs/api-mcp-reimplementation.md
 * §9, Phase 4 / issue #1000).
 *
 * Every agent-reachable MUTATION is annotated `low | medium | high` in a colocated
 * `agentOps` export in its `convex/*Writes.ts` module — colocated so the
 * classification sits next to the code it describes instead of drifting in a
 * separate registry. `scripts/generate-api-registry.mts` reads this export
 * (dynamic-imported alongside the module's validators) and fails the build if an
 * agent-reachable mutation has no entry — the same "unclassified is a build
 * failure, not a silent gap" posture as the privileged-arg gate in
 * `src/lib/api/privileged-args.ts`.
 *
 * `high` — stock-affecting, irreversible, lock-softening, delete/archive,
 *   financial issue/void, warehouse movement, or bulk-destructive. Requires
 *   `confirm: true` (and an idempotency key, already required of every mutation)
 *   at the dispatcher — see `src/lib/api/dispatcher.ts`'s confirmation gate.
 * `medium` — an ordinary create/update with real but recoverable effect.
 * `low` — cosmetic or trivially reversible (sort order, personal preferences,
 *   a boolean toggle that gates nothing else).
 *
 * This file MUST stay import-free / side-effect-free — every `convex/*Writes.ts`
 * module imports it, and the generator script imports it too, so it needs to
 * bundle cleanly into the Convex deployment, the Next build, and a plain Node
 * script (same constraint as `convex/lib/scopes.ts` / `permissionsCore.ts`).
 */

export type AgentOpsDanger = "low" | "medium" | "high";

export interface AgentOpsEntry {
  readonly danger: AgentOpsDanger;
}

/** Keyed by the exported mutation's name within its module, e.g. `addNative`. */
export type AgentOpsAnnotations = Readonly<Record<string, AgentOpsEntry>>;
