/**
 * Generic minimal-row synthesiser for a Convex SCHEMA table validator (#1076,
 * A6). Distinct from `convex-function-surface.ts`'s `synthesiseValue`, which
 * walks a function's exported ARGS validator (`{type, value, fieldType}` JSON)
 * — a schema table's validator is a different runtime shape
 * (`{kind, fields, members, isOptional}`, from `schema.tables[name].validator`).
 * Both exist because they synthesise from different Convex APIs, not because
 * one is a copy of the other (R-3.1) — a schema change widens what a
 * `defineTable` validator can express independently of what a function's `args`
 * validator can express.
 *
 * Used by `convex/xtenantExhaustive.test.ts`'s FK-collision sweep: to prove a
 * `listBy<FK>` query excludes a foreign org's row, the test needs to insert a
 * REAL, schema-valid row into an arbitrary table it was never told the shape
 * of ahead of time — hand-writing that per table (as the original
 * `xtenantHardening.test.ts` did for 3 tables) doesn't scale to 72.
 */

/** A node of `schema.tables[name].validator` (or one of its fields/members). */
export interface SchemaValidatorNode {
  kind: string;
  isOptional?: "required" | "optional";
  fields?: Record<string, SchemaValidatorNode>;
  members?: SchemaValidatorNode[];
  element?: SchemaValidatorNode;
  value?: unknown;
}

const SCALARS: Record<string, () => unknown> = {
  string: () => "x",
  float64: () => 0,
  int64: () => BigInt(0),
  boolean: () => false,
  bytes: () => new ArrayBuffer(0),
  null: () => null,
  any: () => null,
  // Convex's own `_id`-typed reference. Format-only at insert time — Convex
  // does not check the referenced doc exists — so a syntactically-shaped
  // placeholder is enough to pass validation.
  id: () => "kg000000000000000000000000000",
};

/** The three composite kinds whose value depends on their children, keyed by
 *  `kind` — a lookup rather than a chain of ifs so the synthesiser stays one
 *  simple recursive step (same shape as convex-function-surface.ts's
 *  SCALARS/COMPOSITES split, which exists for the identical reason). */
const COMPOSITES: Record<string, (node: SchemaValidatorNode) => unknown> = {
  literal: (node) => node.value,

  union: (node) => {
    const options = node.members ?? [];
    if (!options.length) throw new Error("union with no members");
    return synthesiseSchemaValue(options[0]);
  },

  array: () => [],
  record: () => [],

  object: (node) => {
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(node.fields ?? {})) {
      if (spec.isOptional === "optional") continue;
      out[name] = synthesiseSchemaValue(spec);
    }
    return out;
  },
};

/** Build the smallest document that satisfies a schema table's REQUIRED
 *  fields (optional fields are omitted — fewer ways to fail for an unrelated
 *  reason). Throws on a node shape it doesn't recognise, so the caller can
 *  treat that table as unsynthesisable rather than insert a malformed row. */
export function synthesiseSchemaValue(node: SchemaValidatorNode): unknown {
  const scalar = SCALARS[node.kind];
  if (scalar) return scalar();
  const composite = COMPOSITES[node.kind];
  if (!composite) throw new Error(`unsynthesisable schema validator kind: ${node.kind}`);
  return composite(node);
}

/**
 * Minimal valid document for `tableValidator` (a table's
 * `schema.tables[name].validator`), with `overrides` applied on top — the
 * caller supplies the fields the test actually cares about (`id`,
 * `organizationId`, the FK under test); everything else required-but-
 * uninteresting is filled generically.
 */
export function synthesiseTableDoc(
  tableValidator: SchemaValidatorNode,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const base = synthesiseSchemaValue(tableValidator);
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    throw new Error("table validator did not synthesise an object");
  }
  return { ...(base as Record<string, unknown>), ...overrides };
}
