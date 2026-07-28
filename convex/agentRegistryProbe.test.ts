// @vitest-environment node
//
// THE RUNTIME PROBE — CI gate 4 of #997.
//
// The registry's `(resource, action)` pair is extracted STATICALLY, by reading
// each handler's `requireOrgPermission(ctx, org, "<resource>", "<action>")` call.
// That is the right source (the mutation already declares the pair, so there is
// nothing to keep in sync — design §7) but it is still a text match, and a text
// match can be wrong in ways that are invisible: a guard behind a conditional, a
// second guard later in the handler, a pair passed through a variable.
//
// A wrong pair here is not cosmetic. It is what the published OpenAPI/MCP docs
// tell an operator to grant, so a stale pair means keys are issued with a scope
// that doesn't open the operation — or worse, one that opens more than intended.
//
// So: for each agent-reachable operation, mint a key holding every scope in the
// vocabulary EXCEPT the one(s) the registry declares, and assert the call is
// rejected — for exactly one of the declared scopes and no other. Withholding only
// the declared scope is what makes this a real test: a key holding *nothing* would
// be rejected by a function with any scope check at all, proving nothing about
// whether the published pair is the right one.
//
// This is not hypothetical. On its first run it found `collaboration.createThread`
// advertising `project:manage_line_items` when a non-blocking comment actually
// needs only `project:read` — the classifier had flattened a conditional guard to
// its first match. `scopePairs` exists because of that finding.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { RESOURCES } from "./lib/permissionsCore";
import { API_REGISTRY } from "../src/lib/api/registry.generated";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const USER = "user_1";
const KEY = "key_1";
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

interface ValidatorNode {
  type: string;
  value?: unknown;
  fieldType?: ValidatorNode;
  optional?: boolean;
}

function synth(node: ValidatorNode): unknown {
  switch (node.type) {
    case "string": return "x";
    case "number": return 0;
    case "int64": case "bigint": return BigInt(0);
    case "boolean": return false;
    case "null": case "any": return null;
    case "bytes": return new ArrayBuffer(0);
    case "id": return "kg000000000000000000000000000";
    case "array": return [];
    case "record": return {};
    case "literal": return node.value;
    case "union": {
      const options = (node.value ?? []) as ValidatorNode[];
      return synth(options.find((o) => o.type === "null") ?? options[0]);
    }
    case "object": {
      const fields = (node.value ?? {}) as Record<string, ValidatorNode>;
      const out: Record<string, unknown> = {};
      for (const [name, spec] of Object.entries(fields)) {
        if (spec.optional) continue;
        out[name] = synth(spec.fieldType as ValidatorNode);
      }
      return out;
    }
    default: return null;
  }
}

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
    let imported: Record<string, unknown>;
    try {
      imported = (await load()) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const [fnName, value] of Object.entries(imported)) {
      if (!value || (typeof value !== "function" && typeof value !== "object")) continue;
      const fn = value as RegisteredFn;
      if (fn.isPublic !== true || (!fn.isQuery && !fn.isMutation)) continue;
      found.set(`${match[1]}.${fnName}`, fn);
    }
  }
  return found;
}

/** Every scope in the vocabulary EXCEPT the declared ones, so the ONLY thing that
 *  can produce a MISSING_SCOPE rejection is a pair we're probing. Resources named
 *  by any declared pair lose their wildcard and are re-granted action by action,
 *  minus the declared actions — without that, a wrong `action` in the registry
 *  would be indistinguishable from a wrong `resource`. */
const PROBE_ACTIONS = [
  "read", "create", "update", "delete", "write", "import", "export",
  "manage_line_items", "generate_documents", "check_out", "check_in", "scan", "close",
  "publish", "issue", "void", "xero_push", "xero_manage", "quick_test",
  "generate_reports", "view", "invite", "update_role", "remove", "generate", "send",
];

function everyScopeExcept(pairs: readonly { resource: string; action: string }[]): string[] {
  const targeted = new Set(pairs.map((p) => p.resource));
  const denied = new Set(pairs.map((p) => `${p.resource}:${p.action}`));
  const scopes: string[] = [];
  for (const resource of [...RESOURCES, "self"]) {
    if (!targeted.has(resource)) {
      scopes.push(`${resource}:*`);
      continue;
    }
    for (const action of PROBE_ACTIONS) {
      if (!denied.has(`${resource}:${action}`)) scopes.push(`${resource}:${action}`);
    }
  }
  return scopes;
}

async function seedKey(t: T, scopes: string[]) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_cuid", (q) => q.eq("id", KEY))
      .first();
    if (existing) await ctx.db.patch(existing._id, { scopes: JSON.stringify(scopes) });
    else {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "probe", prefix: "gf_live_aaaaaa",
        tokenHash: "h", scopes: JSON.stringify(scopes), isActive: true,
        actingUserId: USER, createdById: USER,
      });
    }
  });
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

const MISSING_SCOPE = /missing the '([^']+)' scope/;

/** Operations whose scope pairs the classifier extracted. Includes the
 *  conditionally-gated ones (more than one pair) — those are precisely the
 *  entries most likely to be wrong, so excluding them would defeat the purpose. */
const PROBED = API_REGISTRY.filter(
  (op) => op.guard === "orgPermission" && op.scopePairs.length > 0,
);

describe("static (resource, action) extraction matches runtime enforcement", () => {
  test("there is a meaningful population to probe", () => {
    expect(PROBED.length).toBeGreaterThan(200);
  });

  test("a key holding every scope BUT the declared one is rejected — and rejected for exactly that scope", async () => {
    const { api } = (await import("./_generated/api")) as unknown as {
      api: Record<string, Record<string, unknown>>;
    };
    const functions = await loadFunctions();

    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiter");
    registerShardedCounter(t, "shardedCounter");
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    });

    const notEnforced: string[] = [];
    const wrongPair: Array<{ operation: string; declared: string; enforced: string }> = [];
    let probed = 0;

    for (const op of PROBED) {
      const fn = functions.get(op.operation);
      const [moduleName, fnName] = op.operation.split(".");
      const reference = api[moduleName]?.[fnName];
      if (!fn?.exportArgs || !reference) continue;

      let args: Record<string, unknown>;
      try {
        const value = synth(JSON.parse(fn.exportArgs()) as ValidatorNode);
        if (typeof value !== "object" || value === null) continue;
        args = value as Record<string, unknown>;
      } catch {
        continue;
      }
      // Force the org args to the caller's org so the call fails on SCOPE, not on
      // an org mismatch that would mask the result.
      for (const key of ["orgId", "organizationId"]) {
        if (key in args) args[key] = ORG;
      }

      const declared = op.scopePairs.map((p) => `${p.resource}:${p.action}`);
      await seedKey(t, everyScopeExcept(op.scopePairs));
      probed += 1;

      try {
        await (fn.isMutation
          ? callDynamic(t, "mutation", reference, args)
          : callDynamic(t, "query", reference, args));
        // Reaching the handler without a scope rejection means the declared pairs
        // are NOT what the function enforces.
        notEnforced.push(`${op.operation} (declared ${declared.join(" | ")})`);
      } catch (error) {
        const message = String(error);
        const match = MISSING_SCOPE.exec(message);
        if (match) {
          // The enforced scope must be one the registry published. Any other
          // string means the docs would send an operator to grant the wrong thing.
          if (!declared.includes(match[1])) {
            wrongPair.push({ operation: op.operation, declared: declared.join(" | "), enforced: match[1] });
          }
          continue;
        }
        if (/ArgumentValidationError|Validator error/i.test(message)) {
          probed -= 1;
          continue;
        }
        // Rejected for some OTHER reason before the scope check could speak (a
        // kill switch, a not-found on a synthesised id). That tells us nothing
        // about the pair, so it isn't counted either way.
        probed -= 1;
      }
    }

    expect(
      wrongPair,
      `Registry declares a scope the function does not enforce:\n${wrongPair
        .map((w) => `  ${w.operation}: declared ${w.declared}, enforces ${w.enforced}`)
        .join("\n")}`,
    ).toEqual([]);

    expect(
      notEnforced,
      `Registry declares a scope, but the call went through without it:\n${notEnforced.join("\n")}`,
    ).toEqual([]);

    // The probe is only evidence if it actually landed on the surface. Today it
    // reaches 100% of the probed population; asserted at 90% so one operation that
    // starts rejecting earlier for an unrelated reason doesn't turn the suite red,
    // while a synthesis regression that quietly reached nothing still trips it.
    expect(probed).toBeGreaterThanOrEqual(Math.floor(PROBED.length * 0.9));
  }, 120_000);

  test("every declared resource is a real member of the RBAC vocabulary", () => {
    // No parallel scope vocabulary (design §5) — a resource the registry invents
    // could never be granted, because the key UI only offers RESOURCES.
    const vocabulary = new Set<string>([...RESOURCES, "self"]);
    const unknown = API_REGISTRY.flatMap((op) =>
      op.scopePairs.filter((p) => !vocabulary.has(p.resource)).map((p) => `${op.operation} -> ${p.resource}`),
    );
    expect(unknown).toEqual([]);
  });

  test("a conditional guard publishes ALL its pairs, and singular fields go null", () => {
    // The regression this locks: the classifier originally reported only the FIRST
    // requireOrgPermission call, so `collaboration.createThread` advertised
    // project:manage_line_items while a non-blocking comment actually needed only
    // project:read. The runtime probe caught it; this keeps it caught.
    const conditional = API_REGISTRY.filter((op) => op.scopePairs.length > 1);
    expect(conditional.length).toBeGreaterThan(0);
    for (const op of conditional) {
      expect(op.resource, `${op.operation} must not publish one branch as THE resource`).toBeNull();
      expect(op.action).toBeNull();
    }

    const createThread = API_REGISTRY.find((op) => op.operation === "collaboration.createThread");
    expect(createThread?.scopePairs.map((p) => `${p.resource}:${p.action}`).sort()).toEqual([
      "project:manage_line_items",
      "project:read",
    ]);
  });
});
