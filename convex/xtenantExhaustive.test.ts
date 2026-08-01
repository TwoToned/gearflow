// @vitest-environment node
//
// #1076 (A6) — THE PHASE A GATE. Extends xtenantHardening.test.ts's
// representative, hand-written coverage ("the fix is identical across all
// sites") to a REGISTRY-DRIVEN EXHAUSTIVE sweep, mirroring the shape
// agentServiceUnreachable.test.ts already proved scales to 602 functions:
// synthesise each operation's own args from its Convex validator so a new
// operation joins the sweep automatically, with nothing to add to a list.
//
// Two independent sweeps, because they catch two different bug shapes:
//
//   A. ORG-MISMATCH — every org-scoped operation (guard: orgReadFor |
//      orgPermission) MUST reject a caller whose session/agent identity
//      belongs to org A, when the request's own orgId/organizationId arg
//      names org B. This generalises the one hand-written case in
//      xtenantHardening.test.ts ("...and organizationId in the request
//      naming the OTHER org doesn't widen it either") to every operation
//      that takes an org arg — ~550 of them, not one.
//
//   B. FK-COLLISION LEAK — for the `listBy<FK>` queries specifically (the
//      72 the issue names), a GLOBAL index read filtered only by the FK can
//      return a foreign org's row unless the handler ALSO org-filters. This
//      seeds a same-FK row in org A and org B (schema-driven, via
//      convex-schema-synthesis.ts) and asserts org B's row never comes back
//      to an org-A caller — same class of proof as the hand-written
//      `assets.listByModel` case, generalised to every `listBy*` operation
//      whose target table can be synthesised generically.
//
// Both sweeps skip an operation it cannot safely drive (unsynthesisable
// validator, non-scalar FK, target table not found) rather than fail on it —
// same posture as agentServiceUnreachable's 95% floor: the interesting
// failure is a genuine admission, and a ratcheted floor on the swept COUNT
// (not 100%) keeps one incidental unsynthesisable case from turning a green
// suite red while a synthesis regression that silently narrowed the sweep
// still trips it immediately.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { API_REGISTRY } from "../src/lib/api/registry.generated";
import {
  callConvexDynamic,
  isArgumentValidationError,
  loadConvexFunctions,
  synthesiseArgs,
} from "../tests/helpers/convex-function-surface";
import { synthesiseTableDoc } from "../tests/helpers/convex-schema-synthesis";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const A = "org_A";
const B = "org_B";
const USER = "user_1";
const asA = { subject: USER, orgId: A, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** Reference into the api object by dotted path, mirroring `api.mod.fn`
 *  (same helper as agentServiceUnreachable/agentRegistryProbe — not
 *  re-exported from convex-function-surface because it's a two-line
 *  destructure over a runtime shape those two sweeps happen to also need). */
function apiRef(operation: string, api: Record<string, Record<string, unknown>>): unknown {
  const [moduleName, fnName] = operation.split(".");
  return api[moduleName]?.[fnName];
}

const ORG_ARG_NAMES = new Set(["orgId", "organizationId"]);

// ────────────────────────────────────────────────────────────────────────────
// SWEEP A — org-mismatch, every org-scoped operation
// ────────────────────────────────────────────────────────────────────────────

const ORG_SCOPED_OPERATIONS = API_REGISTRY.filter(
  (op) =>
    (op.guard === "orgReadFor" || op.guard === "orgPermission") &&
    op.args.some((a) => ORG_ARG_NAMES.has(a.name)),
);

describe("cross-tenant audit — exhaustive org-mismatch sweep (#1076, A6)", () => {
  test("the registry actually contains org-scoped operations to sweep", () => {
    // Guards the guard: a broken filter that returned zero rows would make
    // the assertion below vacuously pass.
    expect(ORG_SCOPED_OPERATIONS.length).toBeGreaterThan(400);
  });

  test("every org-scoped operation rejects a caller whose own org is NOT the requested org", async () => {
    const { api } = (await import("./_generated/api")) as unknown as {
      api: Record<string, Record<string, unknown>>;
    };
    const functions = await loadConvexFunctions(modules);
    const t = makeT();

    await t.run(async (ctx) => {
      // OWNER, so the only thing that can reject the call is the org-mismatch
      // check itself — never an incidental permission shortfall.
      await ctx.db.insert("members", { id: "m-" + A, organizationId: A, userId: USER, role: "owner" });
    });

    const admitted: string[] = [];
    let swept = 0;

    for (const op of ORG_SCOPED_OPERATIONS) {
      const fn = functions.get(op.operation);
      const reference = apiRef(op.operation, api);
      if (!fn?.exportArgs || !reference) continue;

      let args: Record<string, unknown>;
      try {
        args = synthesiseArgs(fn.exportArgs());
      } catch {
        continue; // unsynthesisable validator — same carve-out as agentServiceUnreachable
      }
      const orgArgName = op.args.find((a) => ORG_ARG_NAMES.has(a.name))?.name;
      if (!orgArgName) continue;
      args[orgArgName] = B; // A's identity, asking about org B

      swept += 1;
      try {
        await callConvexDynamic(t, asA, op.kind, reference, args);
        admitted.push(op.operation);
      } catch (error) {
        if (isArgumentValidationError(String(error))) swept -= 1; // never reached the guard
      }
    }

    // THE assertion: not one org-scoped operation let org A act on org B.
    expect(admitted, `A's identity was ADMITTED into org B by:\n${admitted.join("\n")}`).toEqual([]);

    // Coverage floor (ratcheted): today's sweep reaches the vast majority of
    // ORG_SCOPED_OPERATIONS cleanly. 90% rather than 100% so one genuinely
    // unsynthesisable validator doesn't turn a green suite red; a synthesis
    // regression that silently narrowed the sweep still trips it immediately.
    expect(swept).toBeGreaterThanOrEqual(Math.floor(ORG_SCOPED_OPERATIONS.length * 0.9));
  }, 180_000);
});

// ────────────────────────────────────────────────────────────────────────────
// SWEEP B — FK-collision leak, every listBy* operation
// ────────────────────────────────────────────────────────────────────────────

/** `listBy*` queries whose module is a real table and whose non-org required
 *  args are all scalars (batched `listByIds`-style array args aren't a single
 *  colliding-FK read, so they're out of scope for this sweep — the org-
 *  mismatch sweep above still covers them). */
const LISTBY_OPERATIONS = API_REGISTRY.filter(
  (op) =>
    (op.guard === "orgReadFor" || op.guard === "orgPermission") &&
    /\.listBy/i.test(op.operation) &&
    op.args.some((a) => ORG_ARG_NAMES.has(a.name)) &&
    op.args
      .filter((a) => !a.optional && !ORG_ARG_NAMES.has(a.name))
      .every((a) => a.type === "string" || a.type === "number" || a.type === "boolean"),
);

type SchemaTables = Record<string, { validator: import("../tests/helpers/convex-schema-synthesis").SchemaValidatorNode }>;
type ProbeResult = "skip" | "unswept" | "clean" | "leaked";

/** Seeds org A's and org B's rows sharing the same FK value(s) for one
 *  `listBy*` operation's probe. Returns `null` when the operation's target
 *  table can't be resolved, its FK args synthesised, or the synthesised rows
 *  rejected by the schema — any of which makes the operation a `skip`. Split
 *  out of {@link probeListByOperation} to keep both under the complexity
 *  ratchet (R-3.6); the try/catch-per-step shape is what keeps a synthesis or
 *  schema failure a `skip` rather than a hard test failure (file-level comment). */
async function seedCollisionRows(
  t: T,
  op: (typeof LISTBY_OPERATIONS)[number],
  tables: SchemaTables,
): Promise<{ orgArgName: string; collision: Record<string, unknown> } | null> {
  const tableValidator = tables[op.module]?.validator;
  if (!tableValidator) return null;

  const fkArgs = op.args.filter((a) => !a.optional && !ORG_ARG_NAMES.has(a.name));
  const orgArgName = op.args.find((a) => ORG_ARG_NAMES.has(a.name))?.name;
  if (!orgArgName || fkArgs.length === 0) return null;

  const collision: Record<string, unknown> = {};
  for (const fk of fkArgs) collision[fk.name] = `shared-${fk.name}`;

  try {
    const docA = synthesiseTableDoc(tableValidator, { id: "rowA", organizationId: A, ...collision });
    const docB = synthesiseTableDoc(tableValidator, { id: "rowB", organizationId: B, ...collision });
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table name is dynamic (driven by the registry sweep)
      await ctx.db.insert(op.module as any, docA as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      await ctx.db.insert(op.module as any, docB as any);
    });
  } catch {
    return null; // unsynthesisable table shape, or the schema rejected the row
  }
  return { orgArgName, collision };
}

/** One `listBy*` operation's FK-collision probe: seed a same-FK row in org A
 *  and org B, call the operation as org A, judge whether org B's row came
 *  back. */
async function probeListByOperation(
  t: T,
  op: (typeof LISTBY_OPERATIONS)[number],
  tables: SchemaTables,
  api: Record<string, Record<string, unknown>>,
): Promise<ProbeResult> {
  const reference = apiRef(op.operation, api);
  if (!reference) return "skip";

  const seeded = await seedCollisionRows(t, op, tables);
  if (!seeded) return "skip";
  const { orgArgName, collision } = seeded;

  const args: Record<string, unknown> = { [orgArgName]: A, ...collision };
  let result: unknown;
  try {
    result = await callConvexDynamic(t, asA, op.kind, reference, args);
  } catch {
    return "unswept"; // handler rejected the synthesised args entirely — not a leak check
  }
  if (!Array.isArray(result)) return "unswept"; // not a list-shaped result

  const ids = result.map((row) => (row as { id?: unknown }).id);
  return ids.includes("rowB") ? "leaked" : "clean";
}

describe("cross-tenant audit — exhaustive listBy* FK-collision sweep (#1076, A6)", () => {
  test("the registry actually contains listBy* operations to sweep", () => {
    expect(LISTBY_OPERATIONS.length).toBeGreaterThan(30);
  });

  test("every listBy* operation excludes a foreign-org row sharing its FK", async () => {
    const { api } = (await import("./_generated/api")) as unknown as {
      api: Record<string, Record<string, unknown>>;
    };
    const schemaModule = (await import("./schema")) as unknown as { default: { tables: SchemaTables } };
    const tables = schemaModule.default.tables;

    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m-" + A, organizationId: A, userId: USER, role: "owner" });
    });

    const leaked: string[] = [];
    let swept = 0;

    for (const op of LISTBY_OPERATIONS) {
      const result = await probeListByOperation(t, op, tables, api);
      if (result === "skip") continue;
      swept += 1;
      if (result === "unswept") swept -= 1;
      if (result === "leaked") leaked.push(op.operation);
    }

    // THE assertion: not one listBy* operation leaked a foreign-org row.
    expect(leaked, `Foreign-org row LEAKED by:\n${leaked.join("\n")}`).toEqual([]);

    // Coverage floor (ratcheted) — see the file-level comment on why this
    // isn't asserted at LISTBY_OPERATIONS.length (100%).
    expect(swept).toBeGreaterThanOrEqual(20);
  }, 180_000);
});
