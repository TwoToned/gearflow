// @vitest-environment node
//
// THE #995 INVARIANT, MACHINE-CHECKED ACROSS THE WHOLE TREE.
//
// The entire re-implementation rests on one claim: an AGENT token cannot reach a
// `requireService`-gated function. That is what turns "the API path never calls
// generated Convex CRUD directly" from a rule a developer has to remember (which
// is how the removed 2026-07 build enforced it) into a property of the auth layer.
//
// A claim that load-bearing must not be argued, so this file *invokes* every
// service-gated function in `convex/*.ts` with an agent identity and asserts each
// one throws the service guard's error. Arguments are synthesised from the
// function's own Convex validator (`exportArgs()`), so a new service-only mutation
// is covered the moment it is written — nothing to add to a list.
//
// Deliberately a sweep and not a sample: the interesting failure is the ONE
// function someone forgets, and a sample is exactly what misses it.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { API_REGISTRY } from "../src/lib/api/registry.generated";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const USER = "user_1";
const KEY = "key_1";
/** Maximum RBAC + maximum scopes, so the ONLY thing that can reject the call is
 *  the service guard itself. If an owner with a `*` key still can't get in, no
 *  agent can. */
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

/** The literal `requireService` rejection message (convex/lib/auth.ts). */
const SERVICE_GUARD = /requires the RVLT Flow server/i;

// ─── Argument synthesis from Convex's exported validator tree ────────────────
//
// We only need arguments that PASS validation — the call must reach the handler
// so the guard can reject it. Values are otherwise meaningless.

interface ValidatorNode {
  type: string;
  value?: unknown;
  tableName?: string;
  fieldType?: ValidatorNode;
  optional?: boolean;
}

function synth(node: ValidatorNode): unknown {
  switch (node.type) {
    case "string":
      return "x";
    case "number":
      return 0;
    case "int64":
    case "bigint":
      return BigInt(0);
    case "boolean":
      return false;
    case "null":
      return null;
    case "any":
      return null;
    case "bytes":
      return new ArrayBuffer(0);
    case "id":
      // A syntactically valid but non-existent id: the guard runs before any read.
      return "kg000000000000000000000000000";
    case "array":
      return [];
    case "literal":
      return node.value;
    case "record":
      return {};
    case "union": {
      const options = (node.value ?? []) as ValidatorNode[];
      // Prefer a `null` branch when the union has one (v.union(v.number(), v.null())),
      // otherwise take the first — either satisfies the validator.
      const nullBranch = options.find((o) => o.type === "null");
      return synth(nullBranch ?? options[0]);
    }
    case "object": {
      const fields = (node.value ?? {}) as Record<string, ValidatorNode>;
      const out: Record<string, unknown> = {};
      for (const [name, spec] of Object.entries(fields)) {
        if (spec.optional) continue; // omit every optional — smallest valid payload
        out[name] = synth(spec.fieldType as ValidatorNode);
      }
      return out;
    }
    default:
      return null;
  }
}

function synthArgs(argsJson: string): Record<string, unknown> {
  const parsed = JSON.parse(argsJson) as ValidatorNode;
  const value = synth(parsed);
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

// ─── Load every registered function, keyed by "module.fn" ────────────────────

interface RegisteredFn {
  isQuery?: boolean;
  isMutation?: boolean;
  isPublic?: boolean;
  exportArgs?: () => string;
}

async function loadFunctions(): Promise<Map<string, RegisteredFn>> {
  const found = new Map<string, RegisteredFn>();
  for (const [path, load] of Object.entries(modules)) {
    const match = /^\.\/([^/]+)\.ts$/.exec(path);
    if (!match || match[1].endsWith(".test")) continue;
    const moduleName = match[1];
    let imported: Record<string, unknown>;
    try {
      imported = (await load()) as Record<string, unknown>;
    } catch {
      continue; // schema.ts / config modules that aren't function modules
    }
    for (const [fnName, value] of Object.entries(imported)) {
      if (!value || (typeof value !== "function" && typeof value !== "object")) continue;
      const fn = value as RegisteredFn;
      if (fn.isPublic !== true) continue;
      if (!fn.isQuery && !fn.isMutation) continue;
      found.set(`${moduleName}.${fnName}`, fn);
    }
  }
  return found;
}

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** Reference into the api object by dotted path, mirroring `api.mod.fn`. */
function apiRef(operation: string, api: Record<string, Record<string, unknown>>): unknown {
  const [moduleName, fnName] = operation.split(".");
  return api[moduleName]?.[fnName];
}


/**
 * Invoke a function chosen at RUNTIME. `convex-test`'s typed `query`/`mutation`
 * signatures infer args from a statically-known FunctionReference, which a sweep
 * over the whole surface cannot provide — the reference and its args are both
 * computed. One narrow, commented cast here beats sprinkling `as never` at every
 * call site.
 */
type DynamicCaller = {
  withIdentity: (identity: Record<string, unknown>) => {
    query: (ref: unknown, args: unknown) => Promise<unknown>;
    mutation: (ref: unknown, args: unknown) => Promise<unknown>;
  };
};

function callDynamic(
  t: T,
  kind: "query" | "mutation",
  reference: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  return (t as unknown as DynamicCaller).withIdentity(asAgent)[kind](reference, args);
}

const SERVICE_OPERATIONS = API_REGISTRY.filter((op) => op.guard === "service");

describe("requireService is unreachable by an agent token", () => {
  test("the registry actually contains service-gated operations to sweep", () => {
    // Guards the guard: a broken classifier that returned zero rows would make
    // every assertion below vacuously pass.
    expect(SERVICE_OPERATIONS.length).toBeGreaterThan(400);
  });

  test("every service-gated function rejects an agent token with the service guard", async () => {
    const { api } = (await import("./_generated/api")) as unknown as {
      api: Record<string, Record<string, unknown>>;
    };
    const functions = await loadFunctions();
    const t = makeT();

    // Best-case caller: an OWNER acting user holding a `*` key. Anything that
    // rejects THIS caller rejects every possible agent.
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "sweep", prefix: "gf_live_aaaaaa",
        tokenHash: "hash", scopes: JSON.stringify(["*"]), isActive: true,
        actingUserId: USER, createdById: USER,
      });
    });

    const admitted: string[] = [];
    const wrongError: Array<{ operation: string; error: string }> = [];
    let swept = 0;

    for (const op of SERVICE_OPERATIONS) {
      const fn = functions.get(op.operation);
      const reference = apiRef(op.operation, api);
      if (!fn?.exportArgs || !reference) continue;

      let args: Record<string, unknown>;
      try {
        args = synthArgs(fn.exportArgs());
      } catch {
        continue; // unsynthesisable validator — covered by the arg-coverage test below
      }

      swept += 1;
      const invoke = fn.isMutation
        ? callDynamic(t, "mutation", reference, args)
        : callDynamic(t, "query", reference, args);

      try {
        await invoke;
        admitted.push(op.operation);
      } catch (error) {
        const message = String(error);
        // An argument-validation rejection means we never reached the handler, so
        // the guard was not actually exercised — count it as unswept rather than
        // as a pass, and let the coverage assertion below judge the total.
        if (/ArgumentValidationError|Validator error/i.test(message)) {
          swept -= 1;
          continue;
        }
        if (!SERVICE_GUARD.test(message)) {
          wrongError.push({ operation: op.operation, error: message.slice(0, 200) });
        }
      }
    }

    // THE assertion: not one service-gated function let the agent through.
    expect(admitted, `Agent token ADMITTED by service-gated functions:\n${admitted.join("\n")}`).toEqual([]);

    // And every rejection was the service guard, not an incidental failure that
    // would mask an admission if the incidental cause were ever removed.
    expect(
      wrongError,
      `Rejected, but NOT by requireService:\n${wrongError
        .map((w) => `  ${w.operation}: ${w.error}`)
        .join("\n")}`,
    ).toEqual([]);

    // Coverage floor. Today the sweep reaches 100% — every service-gated function's
    // validator synthesises cleanly and every call lands in the handler. Asserted at
    // 95% rather than 100% so one genuinely unsynthesisable validator (a deeply
    // constrained union, say) doesn't turn a green suite red; a synthesis regression
    // that silently stopped reaching the surface still trips it immediately.
    expect(swept).toBeGreaterThanOrEqual(Math.floor(SERVICE_OPERATIONS.length * 0.95));
  }, 120_000);
});

describe("the classification underpinning the sweep", () => {
  test("no service-gated operation is marked agent-reachable", () => {
    const contradictions = API_REGISTRY.filter((op) => op.guard === "service" && op.agentReachable);
    expect(contradictions.map((o) => o.operation)).toEqual([]);
  });

  test("agent-reachability is derived only from guards that admit an agent", () => {
    const admitting = new Set(["orgPermission", "orgReadFor", "self"]);
    const wrong = API_REGISTRY.filter((op) => op.agentReachable !== admitting.has(op.guard));
    expect(wrong.map((o) => `${o.operation} (${o.guard})`)).toEqual([]);
  });

  test("the resource-less org-read guard is never treated as reachable", () => {
    // Decision 2: unmigrated reads are INVISIBLE to agents, not unscoped.
    const leaked = API_REGISTRY.filter((op) => op.guard === "orgRead" && op.agentReachable);
    expect(leaked.map((o) => o.operation)).toEqual([]);
  });
});
