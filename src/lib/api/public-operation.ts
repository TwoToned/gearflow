import type { RegistryOperation } from "./registry.generated";
import { injectedArgNames } from "./arg-normalizer";

/**
 * The agent-facing view of one registry operation — what `GET
 * /api/v1/operations{,/[operation]}`, the OpenAPI emitter, and the MCP tool
 * manifest (Phase 3) all publish. Injected args (actor/id/auditId/now/org —
 * design §8) are stripped: the published contract is the shape a caller
 * actually sends, not the UI-shaped Convex validator underneath it.
 */
export interface PublicOperation {
  operation: string;
  kind: "query" | "mutation";
  resource: string | null;
  action: string | null;
  scopePairs: readonly { resource: string; action: string }[];
  args: readonly { name: string; optional: boolean; type: string }[];
  /** Args the caller must NOT send — injected server-side. Documentation only;
   *  the dispatcher overwrites them regardless of what's sent (arg-normalizer.ts). */
  injectedArgs: readonly string[];
  requiresIdempotencyKey: boolean;
}

export function toPublicOperation(op: RegistryOperation): PublicOperation {
  const argNames = new Set(op.args.map((a) => a.name));
  const injected = injectedArgNames(argNames, op.fn);
  return {
    operation: op.operation,
    kind: op.kind,
    resource: op.resource,
    action: op.action,
    scopePairs: op.scopePairs,
    args: op.args.filter((a) => !injected.has(a.name)),
    injectedArgs: [...injected].sort(),
    requiresIdempotencyKey: op.kind === "mutation",
  };
}
