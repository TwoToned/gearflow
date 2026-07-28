import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, test, expect } from "vitest";
import { API_REGISTRY, API_REGISTRY_BY_OPERATION, REGISTRY_COUNTS } from "./registry.generated";
import {
  PRIVILEGED_ARG_POLICIES,
  isPrivilegedArgName,
  policyForArg,
} from "./privileged-args";

/**
 * The four CI gates of #997, each proved to FAIL on a deliberately-introduced
 * violation. A gate that has never been seen to fail is not a gate — it is a
 * comment, and this suite exists so nobody has to take the difference on trust.
 *
 * The "deliberate violation" tests copy the repo's convex/ and script inputs into
 * a temp directory, break exactly one thing, and run the real generator against
 * it. Nothing is mocked, so a gate that stops working here has genuinely stopped
 * working.
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const GENERATOR = join(ROOT, "scripts/generate-api-registry.mts");

/**
 * Run the real generator, returning its exit status and combined output.
 *
 * `generator` must be the copy INSIDE the tree being tested: the script resolves
 * its own repo root from `import.meta.dirname`, so pointing the temp-tree runs at
 * the checked-in script would silently scan the real repo and report a pass.
 */
function runGenerator(
  args: string[],
  { cwd = ROOT, generator = GENERATOR }: { cwd?: string; generator?: string } = {},
): { ok: boolean; output: string } {
  try {
    const output = execFileSync("pnpm", ["exec", "tsx", generator, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The registry's own invariants
// ────────────────────────────────────────────────────────────────────────────

describe("registry shape", () => {
  test("the surface is closed by default — a name not in the registry is unknown", () => {
    expect(API_REGISTRY_BY_OPERATION.get("lineItemWrites.addNative")).toBeDefined();
    expect(API_REGISTRY_BY_OPERATION.get("evil.dropEverything")).toBeUndefined();
  });

  test("operation names are unique", () => {
    expect(API_REGISTRY_BY_OPERATION.size).toBe(API_REGISTRY.length);
  });

  test("the published counts match the rows", () => {
    expect(REGISTRY_COUNTS.total).toBe(API_REGISTRY.length);
    expect(REGISTRY_COUNTS.agentReachable).toBe(
      API_REGISTRY.filter((op) => op.agentReachable).length,
    );
    expect(REGISTRY_COUNTS.queries + REGISTRY_COUNTS.mutations).toBe(REGISTRY_COUNTS.total);
  });

  test("the whole generated CRUD layer is service-gated, hence unreachable", () => {
    // Spot-check the shape of the invariant on a table whose generated CRUD is the
    // classic IDOR vector. The exhaustive runtime version is
    // convex/agentServiceUnreachable.test.ts.
    for (const name of ["projectLineItems.create", "assets.create", "projects.remove"]) {
      const op = API_REGISTRY_BY_OPERATION.get(name);
      expect(op, `${name} should be in the registry`).toBeDefined();
      expect(op?.guard).toBe("service");
      expect(op?.agentReachable).toBe(false);
    }
  });

  test("no agent-reachable operation is missing its scope pairs", () => {
    // An agent-reachable operation with no pair would be reachable with NO scope —
    // the exact hole the intersection is supposed to close.
    const holes = API_REGISTRY.filter((op) => op.agentReachable && op.scopePairs.length === 0);
    expect(holes.map((o) => o.operation)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GATE 1 — privileged arguments
// ────────────────────────────────────────────────────────────────────────────

describe("gate 1: privileged-arg policy", () => {
  test("the pattern catches the documented bypass-lever shapes", () => {
    for (const name of [
      "allowOverbook", "forceSeparate", "skipValidation",
      "overrideReason", "ignoreConflicts", "bypassLock", "justification",
    ]) {
      expect(isPrivilegedArgName(name), name).toBe(true);
    }
    // …and doesn't fire on ordinary arguments, or the gate is noise nobody reads.
    for (const name of ["allocation", "id", "quantity", "notes", "allocatedTo", "formData"]) {
      expect(isPrivilegedArgName(name), name).toBe(false);
    }
  });

  test("every privileged arg in the live tree has a policy row", () => {
    const unclassified = API_REGISTRY.flatMap((op) =>
      op.privilegedArgs.filter((a) => !policyForArg(a)).map((a) => `${op.operation}:${a}`),
    );
    expect(unclassified).toEqual([]);
  });

  test("the register still covers exactly the §6 set", () => {
    expect(PRIVILEGED_ARG_POLICIES.map((p) => p.arg).sort()).toEqual([
      "allowOrgCreation", "allowOverbook", "emitSideEffects",
      "forceSeparate", "justification", "overrideReason", "skipped",
    ]);
  });

  test("every `scoped` policy names the scope it requires", () => {
    for (const policy of PRIVILEGED_ARG_POLICIES) {
      if (policy.agentAccess !== "scoped") continue;
      expect(policy.requiredScope, `${policy.arg} is scoped but names no scope`).toBeTruthy();
      expect(policy.requiredScope).toMatch(/^[a-zA-Z]+:[a-z_]+$/);
    }
  });

  test("allowOverbook is scoped, high-danger, and NOT plain-allowed", () => {
    // The single most consequential row: it softens the availability check, which
    // is the gate standing between an agent and physically double-booked gear.
    const policy = policyForArg("allowOverbook");
    expect(policy?.agentAccess).toBe("scoped");
    expect(policy?.requiredScope).toBe("project:allow_overbook");
    expect(policy?.danger).toBe("high");
  });

  test("emitSideEffects is dispatcher-injected, never agent-controlled", () => {
    // An agent that could set it false would make its own writes invisible to
    // webhooks and downstream integrations.
    expect(policyForArg("emitSideEffects")?.agentAccess).toBe("injected");
  });

  test("DELIBERATE VIOLATION: a new privileged arg with no policy row fails the build", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-registry-gate-"));
    try {
      // A minimal but real tree: the generator needs convex/ (source + generated),
      // the policy register, and the packages they import.
      for (const path of ["convex", "src", "scripts", "package.json", "tsconfig.json"]) {
        cpSync(join(ROOT, path), join(dir, path), { recursive: true });
      }
      mkdirSync(join(dir, "docs"), { recursive: true });
      // Symlink node_modules rather than copying ~1GB of dependencies.
      execFileSync("ln", ["-s", join(ROOT, "node_modules"), join(dir, "node_modules")]);

      // The violation: a public mutation taking an unclassified bypass-lever arg.
      writeFileSync(
        join(dir, "convex/zzGateProbe.ts"),
        [
          'import { v } from "convex/values";',
          'import { mutation } from "./_generated/server";',
          'import { requireOrgPermission } from "./lib/auth";',
          "",
          "export const probe = mutation({",
          "  args: { orgId: v.string(), bypassEverything: v.boolean() },",
          "  handler: async (ctx, { orgId }) => {",
          '    await requireOrgPermission(ctx, orgId, "project", "update");',
          "    return null;",
          "  },",
          "});",
          "",
        ].join("\n"),
      );

      const result = runGenerator([], {
        cwd: dir,
        generator: join(dir, "scripts/generate-api-registry.mts"),
      });
      expect(result.ok, "the generator should have FAILED on the unclassified arg").toBe(false);
      expect(result.output).toMatch(/bypassEverything/);
      expect(result.output).toMatch(/privileged-args/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});

// ────────────────────────────────────────────────────────────────────────────
// GATE 2 — staleness
// ────────────────────────────────────────────────────────────────────────────

describe("gate 2: registry staleness", () => {
  test("the committed registry is current", () => {
    const result = runGenerator(["--check"]);
    expect(result.output).toMatch(/API registry current/);
    expect(result.ok).toBe(true);
  }, 180_000);

  test("DELIBERATE VIOLATION: a hand-edited registry fails --check", () => {
    const path = join(ROOT, "src/lib/api/registry.generated.ts");
    const original = readFileSync(path, "utf8");
    try {
      writeFileSync(path, original.replace('"agentReachable": false', '"agentReachable": true'));
      const result = runGenerator(["--check"]);
      expect(result.ok, "the staleness gate should have FAILED").toBe(false);
      expect(result.output).toMatch(/staleness gate failed/i);
    } finally {
      writeFileSync(path, original);
    }
  }, 180_000);
});

// ────────────────────────────────────────────────────────────────────────────
// GATE 3 — reachability ratchet
// ────────────────────────────────────────────────────────────────────────────

describe("gate 3: reachability floor", () => {
  test("the committed floor matches the measured count", () => {
    const coverage = readFileSync(join(ROOT, "docs/api-coverage.md"), "utf8");
    const floor = Number(/reachability-floor:\s*(\d+)/.exec(coverage)?.[1]);
    expect(floor).toBe(REGISTRY_COUNTS.agentReachable);
  });

  test("DELIBERATE VIOLATION: a floor above the measured count fails the build", () => {
    // Simulates the real regression: someone adds `requireService` to an
    // agent-reachable query, the count drops below the committed floor, and CI
    // refuses rather than letting the surface silently narrow.
    const path = join(ROOT, "docs/api-coverage.md");
    const original = readFileSync(path, "utf8");
    try {
      writeFileSync(
        path,
        original.replace(/reachability-floor:\s*\d+/, `reachability-floor: ${REGISTRY_COUNTS.agentReachable + 5}`),
      );
      const result = runGenerator([]);
      expect(result.ok, "the reachability gate should have FAILED").toBe(false);
      expect(result.output).toMatch(/Reachability gate failed/i);
    } finally {
      writeFileSync(path, original);
    }
  }, 180_000);
});

// ────────────────────────────────────────────────────────────────────────────
// GATE 4 lives in convex/agentRegistryProbe.test.ts (it needs a Convex runtime).
// ────────────────────────────────────────────────────────────────────────────

describe("gate 4: runtime probe", () => {
  test("is implemented where it can actually run", () => {
    const probe = readFileSync(join(ROOT, "convex/agentRegistryProbe.test.ts"), "utf8");
    expect(probe).toMatch(/static \(resource, action\) extraction matches runtime enforcement/);
  });
});
