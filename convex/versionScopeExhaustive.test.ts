// @vitest-environment node
//
// #1228 (Phase 2 of "Project versioning v2") — THE LIVE-ONLY GATE. Mirrors
// xtenantExhaustive.test.ts's shape exactly (same registry-driven, args-
// synthesised sweep over the WHOLE public surface, not a hand-picked list of
// operations to re-check by hand every time a new one is added): seed a
// project with a LIVE `projectVersions` row and an OLDER, non-live one, put a
// distinguishable row in each of the 4 versioned tables under BOTH versions,
// then call every registered org-scoped, project-scoped QUERY with no
// `versionId` argument (the default path every existing caller uses) and
// prove the non-live rows never appear anywhere in the response — not just
// as a top-level array member, but anywhere in the JSON (equipmentTab/
// projectEquipment-style composite bundles nest line items several levels
// deep, and a leak inside a nested field is exactly as real a bug as one at
// the top level).
//
// This generalises the hand-written assertions in versionScope-adjacent unit
// tests (recalcSplit.differential.test.ts, availabilityCore's own tests) the
// same way xtenantExhaustive generalised xtenantHardening: from "the fix is
// identical across all sites, here are three of them" to "every operation
// that could possibly see a non-live row, proven, not sampled."
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

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asOwner = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

function apiRef(operation: string, api: Record<string, Record<string, unknown>>): unknown {
  const [moduleName, fnName] = operation.split(".");
  return api[moduleName]?.[fnName];
}

const ORG_ARG_NAMES = new Set(["orgId", "organizationId"]);
const PROJECT_ID = "sweepProj";
const LIVE_VERSION = "v-live";
const NONLIVE_VERSION = "v-old";
/** Marker prefix stamped on every non-live row's `id` — a single substring
 *  search across the WHOLE response JSON is a stronger, shape-agnostic proof
 *  than trying to enumerate every possible nesting a bundle-shaped read
 *  could put a leaked row under. */
const NONLIVE_MARKER = "xtenant-nonlive-";

const VERSIONED_TABLES = ["projectCategories", "projectGroups", "projectLineItems", "projectServices"] as const;

/** Minimal, table-specific extra fields beyond the {id, organizationId,
 *  projectId, versionId, lineageId} shared shape every versioned table has —
 *  just enough for a read handler that filters/derives on e.g. `status` or
 *  `type` not to choke on an undefined field. Deliberately NOT the generic
 *  schema synthesiser (unlike xtenantExhaustive's FK-collision sweep): these
 *  4 tables are known ahead of time (this file is scoped to exactly them),
 *  so a hand-written minimal shape is clearer than a synthesised one and
 *  avoids re-deriving enum defaults (status/type unions) generically. */
function extraFieldsFor(table: (typeof VERSIONED_TABLES)[number]): Record<string, unknown> {
  switch (table) {
    case "projectCategories":
      return { name: "Cat", sortOrder: 0 };
    case "projectGroups":
      return { title: "Group", quantity: 1, sortOrder: 0 };
    case "projectLineItems":
      return { type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false, quantity: 1, sortOrder: 0 };
    case "projectServices":
      return { type: "LABOUR", title: "Svc", status: "CONFIRMED", quantity: 1 };
  }
}

async function seedLiveAndNonLiveProject(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m-owner", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("projects", {
      id: PROJECT_ID, organizationId: ORG, projectNumber: "SWEEP-1", name: "Sweep",
      isTemplate: false, status: "CONFIRMED", liveVersionId: LIVE_VERSION, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("projectVersions", {
      id: NONLIVE_VERSION, organizationId: ORG, projectId: PROJECT_ID, number: 1,
      contentState: "ready", createdAt: 0, createdById: USER,
    });
    await ctx.db.insert("projectVersions", {
      id: LIVE_VERSION, organizationId: ORG, projectId: PROJECT_ID, number: 2,
      contentState: "ready", createdAt: 0, createdById: USER,
    });
    for (const table of VERSIONED_TABLES) {
      const liveId = `live-${table}`;
      const nonLiveId = `${NONLIVE_MARKER}${table}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table name is a loop variable over a fixed, known set
      await ctx.db.insert(table as any, {
        id: liveId, organizationId: ORG, projectId: PROJECT_ID, versionId: LIVE_VERSION, lineageId: liveId,
        ...extraFieldsFor(table),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      await ctx.db.insert(table as any, {
        id: nonLiveId, organizationId: ORG, projectId: PROJECT_ID, versionId: NONLIVE_VERSION, lineageId: nonLiveId,
        ...extraFieldsFor(table),
      });
    }
  });
}

/** Every org-scoped QUERY that takes a `projectId` argument — the read
 *  surface that could possibly resolve to this project's rows and therefore
 *  could possibly leak a non-live one. Deliberately not narrowed to the 4
 *  tables' own modules: equipmentTab/projectEquipment/projectCosts/
 *  warehouseDetail-style composite bundles read these tables internally
 *  while living in a different module, and a leak through one of THOSE is
 *  exactly as real as a leak through e.g. projectLineItems.listByProject
 *  itself. `getById`-shaped lookups (a single already-known row id, no
 *  `projectId` arg at all) are out of scope by construction — they don't
 *  match this filter. */
const PROJECT_SCOPED_QUERIES = API_REGISTRY.filter(
  (op) =>
    op.kind === "query" &&
    (op.guard === "orgReadFor" || op.guard === "orgPermission") &&
    op.args.some((a) => a.name === "projectId") &&
    op.args.some((a) => ORG_ARG_NAMES.has(a.name)),
);

describe("version-scope audit — exhaustive live-only sweep (#1228)", () => {
  test("the registry actually contains project-scoped queries to sweep", () => {
    // Guards the guard — see xtenantExhaustive.test.ts's identical rationale.
    expect(PROJECT_SCOPED_QUERIES.length).toBeGreaterThan(15);
  });

  test("no registered project-scoped query, called with the default (no versionId) args, ever surfaces a non-live row", async () => {
    const { api } = (await import("./_generated/api")) as unknown as {
      api: Record<string, Record<string, unknown>>;
    };
    const functions = await loadConvexFunctions(modules);
    const t = makeT();
    await seedLiveAndNonLiveProject(t);

    const leaked: string[] = [];
    let swept = 0;

    for (const op of PROJECT_SCOPED_QUERIES) {
      const fn = functions.get(op.operation);
      const reference = apiRef(op.operation, api);
      if (!fn?.exportArgs || !reference) continue;

      let args: Record<string, unknown>;
      try {
        args = synthesiseArgs(fn.exportArgs());
      } catch {
        continue; // unsynthesisable validator — same carve-out as xtenantExhaustive
      }
      const orgArgName = op.args.find((a) => ORG_ARG_NAMES.has(a.name))?.name;
      if (!orgArgName) continue;
      args[orgArgName] = ORG;
      args.projectId = PROJECT_ID;
      // Deliberately NOT setting `versionId` — the point of this sweep is the
      // DEFAULT path (every pre-#1228 caller, and every caller that never
      // heard of versions) resolves to live-only, same as
      // resolveVersionId(project, undefined) does in convex/lib/versionScope.ts.
      if ("versionId" in args) delete args.versionId;

      swept += 1;
      let result: unknown;
      try {
        result = await callConvexDynamic(t, asOwner, op.kind, reference, args);
      } catch (error) {
        if (isArgumentValidationError(String(error))) swept -= 1; // never reached the handler
        continue; // a handler that rejects this project (e.g. an unrelated required arg didn't resolve) never got a chance to leak
      }

      if (JSON.stringify(result).includes(NONLIVE_MARKER)) leaked.push(op.operation);
    }

    // THE assertion: not one project-scoped query, called the default way,
    // surfaced a non-live row anywhere in its response.
    expect(leaked, `Non-live row LEAKED by:\n${leaked.join("\n")}`).toEqual([]);

    // Coverage floor (ratcheted, same posture as xtenantExhaustive's 90%/20):
    // a handful of operations have unrelated required args (e.g. a specific
    // lineItemId) that the generic synthesiser can't point at a real row, so
    // they throw before reaching the leak check — that's a `continue` above,
    // not a failure. The floor keeps a synthesis regression that silently
    // narrowed the sweep from passing unnoticed while not demanding 100% of
    // operations this test genuinely cannot drive without per-op knowledge.
    expect(swept).toBeGreaterThanOrEqual(10);
  }, 180_000);
});
