import type { RegistryOperation } from "./registry.generated";
import { injectedArgNames } from "./arg-normalizer";

/**
 * The coarse JSON Schema builder shared by every generator that publishes a
 * registry operation's argument shape to an external consumer — currently
 * `scripts/generate-api-docs.mts` (OpenAPI) and `scripts/generate-mcp-manifest.mts`
 * (MCP tool `inputSchema`). One implementation so the two contracts can't drift
 * from each other (R-3.1) — both are pure derivations of the same committed
 * `API_REGISTRY`.
 *
 * Coarse types only: `RegistryOperation.args[].type` is one of
 * string/number/boolean/object/array/union/any (the registry generator's own
 * doc comment notes the FULL validator tree is deliberately not committed there
 * — re-reading it here would duplicate that ts-morph pass for marginal schema
 * precision). An `object`/`array`/`union` arg gets its bare JSON Schema type
 * with no nested `properties`, not a fabricated shape.
 */
export type JsonSchema = Record<string, unknown>;

export const ARG_TYPE_MAP: Record<string, JsonSchema> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  object: { type: "object" },
  array: { type: "array" },
  // A Convex union member set isn't tracked at this coarseness (see above) —
  // publish it as "any JSON value" rather than guess a shape.
  union: {},
  any: {},
};

/** The agent-facing arg set for one operation: injected args (actor/id/
 *  auditId/now/org — arg-normalizer.ts) are never something a caller sends. */
export function publicArgs(op: RegistryOperation) {
  const argNames = new Set(op.args.map((a) => a.name));
  const injected = injectedArgNames(argNames, op.fn);
  return op.args.filter((a) => !injected.has(a.name));
}

/** `{type: "object", properties, required, additionalProperties: false}` for
 *  one operation's public (caller-facing) argument set. */
export function argsObjectSchema(op: RegistryOperation): JsonSchema {
  const args = publicArgs(op);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const arg of args) {
    properties[arg.name] = ARG_TYPE_MAP[arg.type] ?? {};
    if (!arg.optional) required.push(arg.name);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}
