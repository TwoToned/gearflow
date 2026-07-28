/**
 * Deploy-time drift check: the committed registry vs. what the deployment
 * actually exposes (design §7, input 1).
 *
 * `scripts/generate-api-registry.mts` reads Convex's validators IN-PROCESS, which
 * is what lets the staleness gate run on every PR with no deployment and no
 * `CONVEX_DEPLOY_KEY`. The trade is that it reads the *source tree*, not a
 * deployment — so in principle the two could disagree (a module that fails to
 * bundle, a function the push drops, a stale committed registry that slipped
 * through on a branch that never ran CI).
 *
 * This closes that gap where a deployment does exist: the deploy workflow, right
 * after `convex deploy`. `convex function-spec` is the deployment's own account of
 * its public surface; if it disagrees with the committed registry, the API would
 * be advertising operations that don't exist (404s for callers who trusted the
 * contract) or hiding ones that do (unlisted, unreviewed surface).
 *
 * Deliberately NOT part of the PR gate: it needs a deployment, and making the
 * offline gate depend on one would put a secret in the critical path of every
 * fork PR for a check that only matters at the moment of publishing.
 *
 * Usage:  pnpm run api:registry:spec        (deploy workflow, after convex deploy)
 */
import { execFileSync } from "node:child_process";
import { API_REGISTRY } from "../src/lib/api/registry.generated.js";

interface SpecFunction {
  identifier: string;
  functionType: string;
  visibility?: { kind?: string } | null;
}

/** `convex function-spec` names functions `module.js:fn`; the registry uses `module.fn`. */
function toOperation(identifier: string): string {
  const [modulePath, fnName] = identifier.split(":");
  return `${modulePath.replace(/\.js$/, "")}.${fnName}`;
}

function loadSpec(): SpecFunction[] {
  const raw = execFileSync("pnpm", ["exec", "convex", "function-spec"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(raw);
  const functions = (parsed as { functions?: SpecFunction[] }).functions;
  if (!Array.isArray(functions)) {
    throw new Error("convex function-spec returned no `functions` array.");
  }
  return functions;
}

function main(): void {
  const deployed = new Set(
    loadSpec()
      .filter(
        (fn) =>
          (fn.functionType === "Query" || fn.functionType === "Mutation") &&
          fn.visibility?.kind === "public",
      )
      .map((fn) => toOperation(fn.identifier)),
  );

  const committed = new Set(API_REGISTRY.map((op) => op.operation));

  // Only top-level `convex/*.ts` modules are registry rows, so ignore anything the
  // deployment reports from a subdirectory (components, generated helpers).
  const missingFromRegistry = [...deployed].filter(
    (op) => !committed.has(op) && !op.includes("/"),
  );
  const missingFromDeployment = [...committed].filter((op) => !deployed.has(op));

  if (!missingFromRegistry.length && !missingFromDeployment.length) {
    console.log(`✓ Registry matches the deployment — ${committed.size} public operations.`);
    return;
  }

  console.error("\n✖ API registry drifted from the deployment.\n");
  if (missingFromRegistry.length) {
    console.error(
      `  Deployed but NOT in the committed registry (${missingFromRegistry.length}) —\n` +
        "  these are live and unlisted, so nothing reviewed their reachability:\n" +
        missingFromRegistry.map((op) => `    ${op}`).join("\n"),
    );
  }
  if (missingFromDeployment.length) {
    console.error(
      `\n  In the registry but NOT deployed (${missingFromDeployment.length}) —\n` +
        "  the API would advertise operations that 404:\n" +
        missingFromDeployment.map((op) => `    ${op}`).join("\n"),
    );
  }
  console.error("\n  Run `pnpm run api:registry` and commit the result.\n");
  process.exit(1);
}

main();
