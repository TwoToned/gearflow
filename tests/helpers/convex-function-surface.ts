/**
 * Shared harness for the tests that sweep the WHOLE Convex function surface —
 * `convex/agentServiceUnreachable.test.ts` (every service-gated function rejects
 * an agent token) and `convex/agentRegistryProbe.test.ts` (the registry's declared
 * scope is the one actually enforced).
 *
 * Both need the same three things, and having each keep its own copy would be a
 * second implementation of a testing rule (R-3.1): the day the synthesiser learns
 * a new validator type, only one of the two sweeps would widen, and the other
 * would silently start skipping functions while still reporting green.
 */

/** A node of Convex's exported validator tree (`fn.exportArgs()` JSON). */
export interface ValidatorNode {
  type: string;
  value?: unknown;
  tableName?: string;
  fieldType?: ValidatorNode;
  optional?: boolean;
}

/** The properties Convex attaches to a registered function object. */
export interface RegisteredFn {
  isQuery?: boolean;
  isMutation?: boolean;
  isPublic?: boolean;
  exportArgs?: () => string;
}

/**
 * Scalar leaves, by validator type. A lookup rather than a switch arm each so the
 * synthesiser stays one simple recursive step over the three composite types.
 */
const SCALARS: Record<string, () => unknown> = {
  string: () => "x",
  number: () => 0,
  int64: () => BigInt(0),
  bigint: () => BigInt(0),
  boolean: () => false,
  null: () => null,
  any: () => null,
  record: () => ({}),
  array: () => [],
  bytes: () => new ArrayBuffer(0),
  // Syntactically valid but non-existent: every guard under test runs before any
  // read, so the id never has to resolve.
  id: () => "kg000000000000000000000000000",
};

/**
 * Build the SMALLEST argument object that passes a function's validator.
 *
 * The values are meaningless on purpose — the only requirement is that the call
 * reaches the handler, so the guard under test gets to speak. Optional fields are
 * omitted (a smaller payload has fewer ways to fail for an unrelated reason), and
 * a union prefers its `null` branch when it has one.
 */
export function synthesiseValue(node: ValidatorNode): unknown {
  const scalar = SCALARS[node.type];
  if (scalar) return scalar();
  const composite = COMPOSITES[node.type];
  return composite ? composite(node) : null;
}

/** The three validator types whose value depends on their children, plus
 *  `literal`, which is the one leaf that isn't type-determined. */
const COMPOSITES: Record<string, (node: ValidatorNode) => unknown> = {
  literal: (node) => node.value,

  union: (node) => {
    const options = (node.value ?? []) as ValidatorNode[];
    if (!options.length) return null;
    return synthesiseValue(options.find((o) => o.type === "null") ?? options[0]);
  },

  object: (node) => {
    const fields = (node.value ?? {}) as Record<string, ValidatorNode>;
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(fields)) {
      if (spec.optional) continue;
      out[name] = synthesiseValue(spec.fieldType as ValidatorNode);
    }
    return out;
  },
};

/** {@link synthesiseValue} at the top level, where the result must be an object. */
export function synthesiseArgs(argsJson: string): Record<string, unknown> {
  const value = synthesiseValue(JSON.parse(argsJson) as ValidatorNode);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRegisteredPublicFn(value: unknown): value is RegisteredFn {
  if (!value || (typeof value !== "function" && typeof value !== "object")) return false;
  const fn = value as RegisteredFn;
  return fn.isPublic === true && (fn.isQuery === true || fn.isMutation === true);
}

/**
 * Every public query/mutation in the top-level `convex/*.ts` modules, keyed
 * `"module.fn"` to match the registry's operation names.
 *
 * `modules` is the caller's `import.meta.glob("./**\/*.ts")` — vitest resolves the
 * glob relative to the importing file, so it has to be passed in rather than
 * computed here.
 */
export async function loadConvexFunctions(
  modules: Record<string, () => Promise<unknown>>,
): Promise<Map<string, RegisteredFn>> {
  const found = new Map<string, RegisteredFn>();

  for (const [path, load] of Object.entries(modules)) {
    const match = /^\.\/([^/]+)\.ts$/.exec(path);
    if (!match || match[1].endsWith(".test")) continue;

    let imported: Record<string, unknown>;
    try {
      imported = (await load()) as Record<string, unknown>;
    } catch {
      continue; // schema.ts / config modules that register nothing
    }

    for (const [fnName, value] of Object.entries(imported)) {
      if (isRegisteredPublicFn(value)) found.set(`${match[1]}.${fnName}`, value);
    }
  }

  return found;
}

/**
 * Invoke a function chosen at RUNTIME.
 *
 * `convex-test`'s typed `query`/`mutation` signatures infer their args from a
 * statically-known FunctionReference, which a sweep over the whole surface cannot
 * provide — both the reference and its arguments are computed. One narrow,
 * commented cast here beats an `as never` pair at every call site.
 */
type DynamicCaller = {
  withIdentity: (identity: Record<string, unknown>) => {
    query: (ref: unknown, args: unknown) => Promise<unknown>;
    mutation: (ref: unknown, args: unknown) => Promise<unknown>;
  };
};

export function callConvexDynamic(
  t: unknown,
  identity: Record<string, unknown>,
  kind: "query" | "mutation",
  reference: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  return (t as DynamicCaller).withIdentity(identity)[kind](reference, args);
}

/** True when a rejection means the call never reached the handler, so whatever the
 *  test was probing did not actually get a chance to run. */
export function isArgumentValidationError(message: string): boolean {
  return /ArgumentValidationError|Validator error/i.test(message);
}
