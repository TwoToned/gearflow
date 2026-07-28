/**
 * The API/MCP contract registry generator
 * (docs/designs/api-mcp-reimplementation.md §7).
 *
 * ONE generator, run in CI, output committed. The registry is never hand-written:
 * an operation absent from it is a 404, so the API surface is closed by default,
 * and every fact in it is extracted from a source of truth that already exists.
 *
 * Inputs
 * ------
 *  1. **Convex arg/return validators** — each `convex/*.ts` module is imported
 *     IN-PROCESS and every registered function's `exportArgs()` / `exportReturns()`
 *     is read. Convex attaches those to the object `query()`/`mutation()` returns,
 *     so this works entirely OFFLINE: no deployment, no `CONVEX_DEPLOY_KEY`, no
 *     network. That matters because it means the staleness gate can run on every
 *     PR, including from forks. (The deploy workflow cross-checks the same data
 *     against `convex function-spec`, where a deployment does exist.)
 *  2. **Guard classification** — a static read of each handler for
 *     `requireService` / `requireOrgPermission(ctx, org, "<resource>", "<action>")`
 *     / `requireOrgRead*` / `requireSelfScope`. This yields both agent-reachability
 *     and the `(resource, action)` pair, with no annotation to keep in sync.
 *     `convex/agentRegistryProbe.test.ts` asserts the statically-extracted pair
 *     matches what the function actually enforces at runtime.
 *
 * Outputs (all committed; `--check` re-generates and diffs)
 * --------------------------------------------------------
 *  • `src/lib/api/registry.generated.ts` — the allowlist + per-operation contract
 *  • `docs/api-coverage.md`              — the §4 reachability table
 *
 * Gates (any failure exits non-zero)
 * ----------------------------------
 *  1. **Privileged-arg gate** — a new arg matching
 *     `/^(allow|force|skip|override|ignore|bypass)/` or named `justification`,
 *     with no row in `src/lib/api/privileged-args.ts`, fails the build.
 *  2. **Staleness gate** (`--check`) — regenerate and diff; a stale committed
 *     registry fails.
 *  3. **Reachability gate** — the agent-reachable count may not silently drop.
 *  4. **Runtime-probe gate** — lives in `convex/agentRegistryProbe.test.ts`; the
 *     statically extracted `(resource, action)` must match the guard that actually
 *     runs.
 *
 * Usage:
 *   pnpm run api:registry          # regenerate
 *   pnpm run api:registry:check    # verify committed output is current (CI)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Project, SyntaxKind, type VariableDeclaration } from "ts-morph";
import { SELF_RESOURCE } from "../convex/lib/scopes.js";
import type { AgentOpAnnotation, AgentOpsAnnotations } from "../convex/lib/agentOps.js";
import {
  isPrivilegedArgName,
  policyForArg,
} from "../src/lib/api/privileged-args.js";

const ROOT = resolve(import.meta.dirname, "..");
const CONVEX_DIR = join(ROOT, "convex");
const REGISTRY_OUT = join(ROOT, "src/lib/api/registry.generated.ts");
const COVERAGE_OUT = join(ROOT, "docs/api-coverage.md");

/** Convex modules that register no user-facing functions. */
const SKIP_FILES = new Set([
  "schema.ts",
  "auth.config.ts",
  "convex.config.ts",
  "crons.ts",
  "http.ts",
  "tsconfig.json",
]);

type GuardKind =
  | "service"
  | "orgPermission"
  | "orgReadFor"
  | "orgRead"
  | "self"
  | "none";

interface ArgDescriptor {
  name: string;
  optional: boolean;
  type: string;
}

interface ScopePair {
  resource: string;
  action: string;
}

interface Operation {
  operation: string;
  module: string;
  fn: string;
  kind: "query" | "mutation";
  guard: GuardKind;
  /** The single enforced pair, or null when the handler gates conditionally on
   *  more than one (see `scopePairs`). */
  resource: string | null;
  action: string | null;
  /** EVERY (resource, action) the handler can enforce. Usually one; more when the
   *  guard is conditional — `collaboration.createThread` demands
   *  `project:manage_line_items` for a blocking comment and `project:read`
   *  otherwise. Publishing only the first would tell an operator to grant a scope
   *  that isn't what their call actually needs. */
  scopePairs: ScopePair[];
  agentReachable: boolean;
  args: ArgDescriptor[];
  privilegedArgs: string[];
  /** sha256 of the full exportArgs()/exportReturns() JSON — schema drift detector
   *  without committing megabytes of validator JSON. Phase 2's OpenAPI emitter
   *  re-reads the full validators at build time from the same source. */
  argsSha: string;
  returnsSha: string;
  /** Phase 5 (#1001) colocated annotation — see convex/lib/agentOps.ts. Absent
   *  when the module has no `agentOps` export, or the export has no entry for
   *  this function. Purely additive metadata; never affects `agentReachable`. */
  summary: string | null;
  danger: "low" | "medium" | "high" | null;
  mcpTier: 1 | 2 | 3 | null;
  agentAccess: "denied" | null;
  deniedReason: string | null;
}

// ─── 1. Static guard classification ─────────────────────────────────────────

interface ModuleGuards {
  /** exported fn name -> guard facts */
  byFn: Map<string, GuardFacts>;
}

const GUARD_PATTERNS: Array<{
  kind: GuardKind;
  re: RegExp;
  resourceGroup?: number;
  actionGroup?: number;
}> = [
  // requireOrgPermission(ctx, orgId, "project", "manage_line_items")
  {
    kind: "orgPermission",
    re: /requireOrgPermission\s*\([^,]+,[^,]+,\s*["'`]([\w]+)["'`]\s*,\s*["'`]([\w]+)["'`]/,
    resourceGroup: 1,
    actionGroup: 2,
  },
  // requireOrgReadFor(ctx, orgId, "asset") / requireOrgReadDocFor(ctx, doc, "asset")
  {
    kind: "orgReadFor",
    re: /requireOrgRead(?:Doc)?For\s*\([^,]+,[^,]+,\s*["'`]([\w]+)["'`]/,
    resourceGroup: 1,
  },
  // requireSelfScope(ctx, "read")
  { kind: "self", re: /requireSelfScope\s*\([^,]+,\s*["'`](read|write)["'`]/, actionGroup: 1 },
  { kind: "service", re: /requireService\s*\(/ },
  { kind: "orgRead", re: /requireOrgRead(?:Doc)?\s*\(/ },
];

/**
 * Classify one handler body. Precedence follows how much the guard tells us:
 * a resource-carrying guard wins over a resource-less one, because a function may
 * legitimately call both (`requireOrgRead` for the org check plus
 * `requireOrgPermission` for the action).
 *
 * `service` is checked before the read guards: a function that calls
 * `requireService` is service-only regardless of what else it calls, since that
 * guard throws for every non-service caller.
 */
interface GuardFacts {
  guard: GuardKind;
  resource: string | null;
  action: string | null;
  scopePairs: ScopePair[];
}

const NO_GUARD: GuardFacts = { guard: "none", resource: null, action: null, scopePairs: [] };

/** Which (resource, action) does one regex match name? `requireOrgReadFor` carries
 *  only a resource — its action is always "read" — and `requireSelfScope` carries
 *  only an action, on the pseudo-resource `self`. */
function pairFromMatch(
  pattern: (typeof GUARD_PATTERNS)[number],
  match: RegExpMatchArray,
): ScopePair | null {
  const resource = pattern.resourceGroup
    ? match[pattern.resourceGroup]
    : pattern.kind === "self"
      ? SELF_RESOURCE
      : null;
  const action = pattern.actionGroup
    ? match[pattern.actionGroup]
    : pattern.kind === "orgReadFor"
      ? "read"
      : null;
  return resource && action ? { resource, action } : null;
}

/** All distinct pairs a pattern finds in one handler body, in source order. */
function pairsFor(pattern: (typeof GUARD_PATTERNS)[number], body: string): ScopePair[] {
  const pairs: ScopePair[] = [];
  for (const match of body.matchAll(new RegExp(pattern.re, "g"))) {
    const pair = pairFromMatch(pattern, match);
    if (!pair) continue;
    if (pairs.some((p) => p.resource === pair.resource && p.action === pair.action)) continue;
    pairs.push(pair);
  }
  return pairs;
}

function classifyBody(body: string): GuardFacts {
  // Checked first and unconditionally: a function that calls requireService is
  // service-only regardless of what else it calls, because that guard throws for
  // every non-service identity.
  if (/requireService\s*\(/.test(body)) {
    return { guard: "service", resource: null, action: null, scopePairs: [] };
  }

  for (const pattern of GUARD_PATTERNS) {
    if (pattern.kind === "service") continue;
    if (!pattern.re.test(body)) continue;

    // ALL matches, not just the first. A handler can gate conditionally, and
    // reporting only the first pair would publish a scope requirement that is
    // wrong for the other branch — exactly the defect the runtime probe
    // (convex/agentRegistryProbe.test.ts) caught in collaboration.createThread.
    const pairs = pairsFor(pattern, body);
    const single = pairs.length === 1 ? pairs[0] : null;
    return {
      guard: pattern.kind,
      // A conditional guard reports null here, forcing consumers to read
      // `scopePairs` rather than silently trusting one branch.
      resource: single?.resource ?? null,
      action: single?.action ?? null,
      scopePairs: pairs,
    };
  }

  return NO_GUARD;
}

/**
 * Read a module's guard facts. Handles the common indirection of a handler
 * delegating its guard to a module-local helper (`await assertCanEdit(ctx, org)`)
 * by inlining, one level deep, the body of any locally-declared function the
 * handler names. Deeper chains fall through to `guard: "none"`, which the
 * coverage table reports as unclassified rather than silently treating as open.
 */
function readModuleGuards(filePath: string, project: Project): ModuleGuards {
  const source = project.addSourceFileAtPath(filePath);
  const byFn = new Map<string, GuardFacts>();

  // Module-local helper bodies, for the one-level inline pass.
  const localBodies = new Map<string, string>();
  for (const fn of source.getFunctions()) {
    const name = fn.getName();
    if (name) localBodies.set(name, fn.getText());
  }

  const exportedDecls: VariableDeclaration[] = source
    .getVariableDeclarations()
    .filter((d) => d.isExported());

  for (const decl of exportedDecls) {
    const initializer = decl.getInitializer();
    if (!initializer || initializer.getKind() !== SyntaxKind.CallExpression) continue;
    let body = initializer.getText();

    // Inline one level of module-local helpers the handler calls.
    for (const [name, helperBody] of localBodies) {
      if (body.includes(`${name}(`)) body += `\n/*inlined ${name}*/\n${helperBody}`;
    }

    byFn.set(decl.getName(), classifyBody(body));
  }

  return { byFn };
}

// ─── 2. Runtime validator extraction ────────────────────────────────────────

interface RegisteredFn {
  isQuery?: boolean;
  isMutation?: boolean;
  isPublic?: boolean;
  isInternal?: boolean;
  exportArgs?: () => string;
  exportReturns?: () => string;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Pull top-level arg names/optionality/type out of Convex's exported validator JSON. */
function describeArgs(argsJson: string): ArgDescriptor[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { type?: string }).type !== "object"
  ) {
    return [];
  }
  const fields = (parsed as { value?: Record<string, { fieldType?: { type?: string }; optional?: boolean }> })
    .value;
  if (!fields) return [];
  return Object.entries(fields)
    .map(([name, spec]) => ({
      name,
      optional: spec.optional === true,
      type: spec.fieldType?.type ?? "unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Guards that admit an AGENT token. Everything else is unreachable BY
 *  CONSTRUCTION — service-gated functions throw, and the resource-less org-read
 *  guard fails closed (decision 2) — so reachability is derived from the guard the
 *  function actually calls and cannot drift from reality. */
const AGENT_ADMITTING_GUARDS = new Set<GuardKind>(["orgPermission", "orgReadFor", "self"]);

/** A registered Convex function is a *callable* carrying the isQuery/isMutation/
 *  exportArgs properties, not a plain object. Internal functions are unaddressable
 *  from outside Convex at all, so they aren't registry rows. */
function asPublicFn(value: unknown): { fn: RegisteredFn; kind: "query" | "mutation" } | null {
  if (!value || (typeof value !== "function" && typeof value !== "object")) return null;
  const fn = value as RegisteredFn;
  if (fn.isPublic !== true) return null;
  if (fn.isQuery) return { fn, kind: "query" };
  if (fn.isMutation) return { fn, kind: "mutation" };
  return null;
}

/** Split out of `annotationFields` so neither function's branch count trips
 *  the complexity ratchet on its own. */
function deniedReasonFor(annotation: AgentOpAnnotation | undefined): string | null {
  if (annotation?.agentAccess !== "denied") return null;
  return annotation.reason ?? null;
}

/** Pulls the agentOps-derived fields out of `toOperation` so its own branch
 *  count stays under the complexity ratchet — this is the only part of an
 *  operation that comes from optional, annotation-shaped data. */
function annotationFields(annotation: AgentOpAnnotation | undefined): Pick<
  Operation,
  "summary" | "danger" | "mcpTier" | "agentAccess" | "deniedReason"
> {
  return {
    summary: annotation?.summary ?? null,
    danger: annotation?.danger ?? null,
    mcpTier: annotation?.mcpTier ?? null,
    agentAccess: annotation?.agentAccess ?? null,
    deniedReason: deniedReasonFor(annotation),
  };
}

function toOperation(
  moduleName: string,
  fnName: string,
  fn: RegisteredFn,
  kind: "query" | "mutation",
  guard: GuardFacts,
  annotation: AgentOpAnnotation | undefined,
): Operation {
  const argsJson = fn.exportArgs?.() ?? "{}";
  const returnsJson = fn.exportReturns?.() ?? "{}";
  const args = describeArgs(argsJson);
  return {
    operation: `${moduleName}.${fnName}`,
    module: moduleName,
    fn: fnName,
    kind,
    guard: guard.guard,
    resource: guard.resource,
    action: guard.action,
    scopePairs: guard.scopePairs,
    agentReachable: AGENT_ADMITTING_GUARDS.has(guard.guard),
    args,
    privilegedArgs: args.map((a) => a.name).filter(isPrivilegedArgName),
    argsSha: sha(argsJson),
    returnsSha: sha(returnsJson),
    ...annotationFields(annotation),
  };
}

async function collectOperations(): Promise<Operation[]> {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const files = readdirSync(CONVEX_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !SKIP_FILES.has(f))
    .sort();

  const operations: Operation[] = [];

  for (const file of files) {
    const filePath = join(CONVEX_DIR, file);
    const moduleName = file.replace(/\.ts$/, "");
    const guards = readModuleGuards(filePath, project);
    const imported: Record<string, unknown> = await import(pathToFileURL(filePath).href);
    const agentOps = imported.agentOps as AgentOpsAnnotations | undefined;

    for (const [fnName, value] of Object.entries(imported)) {
      const registered = asPublicFn(value);
      if (!registered) continue;
      operations.push(
        toOperation(
          moduleName,
          fnName,
          registered.fn,
          registered.kind,
          guards.byFn.get(fnName) ?? NO_GUARD,
          agentOps?.[fnName],
        ),
      );
    }
  }

  return operations.sort((a, b) => a.operation.localeCompare(b.operation));
}

// ─── 3. Gates ───────────────────────────────────────────────────────────────

/** Gate 1 — every privileged-shaped argument must carry a policy row. */
function checkPrivilegedArgs(operations: Operation[]): string[] {
  const offenders = new Map<string, string[]>();
  for (const op of operations) {
    for (const arg of op.privilegedArgs) {
      if (policyForArg(arg)) continue;
      const sites = offenders.get(arg) ?? [];
      sites.push(op.operation);
      offenders.set(arg, sites);
    }
  }
  return [...offenders.entries()].map(
    ([arg, sites]) =>
      `Privileged argument '${arg}' has no policy row in src/lib/api/privileged-args.ts.\n` +
      `  It softens a gate (or looks like it does), so it must be classified before it can ship.\n` +
      `  Sites (${sites.length}): ${sites.slice(0, 5).join(", ")}${sites.length > 5 ? ", …" : ""}\n` +
      `  Read docs/designs/api-mcp-reimplementation.md §6, then add a row with the narrowest agentAccess that works.`,
  );
}

/** Gate — an `agentAccess: "denied"` annotation must carry a reason, and must
 *  not contradict a guard that already admits agent tokens (fix the guard or
 *  drop the denial; don't keep both — see convex/lib/agentOps.ts). */
function checkAgentOpsAnnotations(operations: Operation[]): string[] {
  const problems: string[] = [];
  for (const op of operations) {
    if (op.agentAccess !== "denied") continue;
    if (!op.deniedReason || op.deniedReason.trim().length === 0) {
      problems.push(
        `'${op.operation}' is annotated agentAccess:"denied" with no reason.\n` +
          `  "We didn't get to it" is not a reason — add one in the module's agentOps export.`,
      );
    }
    if (op.agentReachable) {
      problems.push(
        `'${op.operation}' is annotated agentAccess:"denied" but its guard (${op.guard}) ` +
          `already admits agent tokens.\n` +
          `  This is a contradiction — either the denial is stale (remove it) or the guard ` +
          `needs to go back to a SERVICE-only/resource-less guard.`,
      );
    }
  }
  return problems;
}

/**
 * Gate 3 — the agent-reachable count may only drop deliberately.
 *
 * The floor lives in the committed coverage doc, so lowering it is a visible diff
 * in a PR rather than an invisible side effect of adding a `requireService`.
 */
const REACHABILITY_FLOOR_MARKER = "<!-- reachability-floor:";

function readReachabilityFloor(): number | null {
  try {
    const existing = readFileSync(COVERAGE_OUT, "utf8");
    const match = new RegExp(`${REACHABILITY_FLOOR_MARKER}\\s*(\\d+)`).exec(existing);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// ─── 4. Emitters ────────────────────────────────────────────────────────────

const BANNER = `// GENERATED FILE — DO NOT EDIT.
// Run \`pnpm run api:registry\` to regenerate; CI fails if this file is stale.
// Source of truth: convex/*.ts (validators + guards). See scripts/generate-api-registry.mts.
`;

function emitRegistry(operations: Operation[]): string {
  const reachable = operations.filter((o) => o.agentReachable);
  return `${BANNER}
/**
 * The API/MCP operation allowlist. An operation absent from here is a 404 — the
 * surface is closed by default (design §7).
 *
 * \`agentReachable\` is DERIVED from the guard the function actually calls, not
 * declared: a \`requireService\`-gated function throws for an agent token by
 * construction, and a function still on the resource-less \`requireOrgRead\` guard
 * fails closed for agents (decision 2) until it is migrated to
 * \`requireOrgReadFor\`. So this flag cannot drift from reality — changing it
 * requires changing the guard.
 *
 * \`argsSha\`/\`returnsSha\` fingerprint the FULL Convex validator JSON. The full
 * schemas are re-read from \`convex/*.ts\` at build time by the Phase-2 OpenAPI
 * emitter rather than committed here, because inlining ~1,100 validator trees
 * would make every unrelated Convex tweak a thousand-line diff. The hashes still
 * make a schema change visible to the staleness gate.
 */
export interface RegistryOperation {
  readonly operation: string;
  readonly module: string;
  readonly fn: string;
  readonly kind: "query" | "mutation";
  readonly guard: "service" | "orgPermission" | "orgReadFor" | "orgRead" | "self" | "none";
  readonly resource: string | null;
  readonly action: string | null;
  /** Every (resource, action) the handler can enforce. One entry for the common
   *  case; more when the guard is conditional, in which case the singular
   *  resource/action fields are null so a consumer cannot silently trust one
   *  branch. Example: collaboration.createThread demands
   *  project:manage_line_items for a blocking comment and project:read otherwise. */
  readonly scopePairs: readonly { readonly resource: string; readonly action: string }[];
  readonly agentReachable: boolean;
  readonly args: readonly { readonly name: string; readonly optional: boolean; readonly type: string }[];
  readonly privilegedArgs: readonly string[];
  readonly argsSha: string;
  readonly returnsSha: string;
  /** Phase 5 (#1001) colocated annotation — see convex/lib/agentOps.ts. Purely
   *  additive metadata; never affects \`agentReachable\`. */
  readonly summary: string | null;
  readonly danger: "low" | "medium" | "high" | null;
  readonly mcpTier: 1 | 2 | 3 | null;
  readonly agentAccess: "denied" | null;
  readonly deniedReason: string | null;
}

export const API_REGISTRY: readonly RegistryOperation[] = ${JSON.stringify(operations, null, 2)} as const;

/** Fast lookup for the dispatcher: unknown name ⇒ UNKNOWN_OPERATION (a 404). */
export const API_REGISTRY_BY_OPERATION: ReadonlyMap<string, RegistryOperation> = new Map(
  API_REGISTRY.map((op) => [op.operation, op]),
);

/** Counts published so the coverage table and any consumer agree by construction. */
export const REGISTRY_COUNTS = {
  total: ${operations.length},
  agentReachable: ${reachable.length},
  queries: ${operations.filter((o) => o.kind === "query").length},
  mutations: ${operations.filter((o) => o.kind === "mutation").length},
  agentReachableQueries: ${reachable.filter((o) => o.kind === "query").length},
  agentReachableMutations: ${reachable.filter((o) => o.kind === "mutation").length},
} as const;
`;
}

function emitCoverage(operations: Operation[], floor: number): string {
  const bucket = (kind: "query" | "mutation", guard: GuardKind) =>
    operations.filter((o) => o.kind === kind && o.guard === guard).length;

  const reachable = operations.filter((o) => o.agentReachable);
  const byModule = new Map<string, { total: number; reachable: number }>();
  for (const op of operations) {
    const entry = byModule.get(op.module) ?? { total: 0, reachable: 0 };
    entry.total += 1;
    if (op.agentReachable) entry.reachable += 1;
    byModule.set(op.module, entry);
  }

  const unmigrated = [...byModule.entries()]
    .filter(([, v]) => v.reachable === 0 && v.total > 0)
    .map(([m, v]) => `| \`${m}\` | ${v.total} |`)
    .sort();

  const denied = operations
    .filter((o) => o.agentAccess === "denied")
    .map((o) => `| \`${o.operation}\` | ${o.deniedReason ?? ""} |`);

  return `<!-- GENERATED FILE — DO NOT EDIT. Run \`pnpm run api:registry\`. -->
${REGISTRY_ISSUE_HEADER}

## Totals

| | Total public | Agent-reachable | SERVICE-only | Org-read (fails closed for agents) | Unclassified |
|---|---|---|---|---|---|
| Queries | ${operations.filter((o) => o.kind === "query").length} | ${reachable.filter((o) => o.kind === "query").length} | ${bucket("query", "service")} | ${bucket("query", "orgRead")} | ${bucket("query", "none")} |
| Mutations | ${operations.filter((o) => o.kind === "mutation").length} | ${reachable.filter((o) => o.kind === "mutation").length} | ${bucket("mutation", "service")} | ${bucket("mutation", "orgRead")} | ${bucket("mutation", "none")} |
| **Total** | **${operations.length}** | **${reachable.length}** | **${bucket("query", "service") + bucket("mutation", "service")}** | **${bucket("query", "orgRead") + bucket("mutation", "orgRead")}** | **${bucket("query", "none") + bucket("mutation", "none")}** |

${REACHABILITY_FLOOR_MARKER} ${floor} -->

The reachability floor above is a CI gate: the agent-reachable count may not drop
below it. Lowering it is allowed but must be a visible, explained line in a PR
diff — that is the whole mechanism. Raising it happens naturally as Phase 5
migrates \`requireOrgRead\` call sites to \`requireOrgReadFor\`.

## Modules with no agent-reachable operation

Each of these is either genuinely closed (site-admin surfaces, mirrors, backfills,
org export) or simply not migrated yet. Phase 5 triages them per domain — widen,
add a redacted sibling, or record as permanently denied with a reason.

| Module | Public operations |
|---|---|
${unmigrated.join("\n")}

## Deliberately denied (Phase 5 triage, #1001)

Operations annotated \`agentAccess: "denied"\` in their module's \`agentOps\`
export (\`convex/lib/agentOps.ts\`) — a recorded decision to keep the surface
closed, not an oversight. Every row here has a written reason; the generator
fails the build otherwise.

| Operation | Reason |
|---|---|
${denied.length ? denied.join("\n") : "| _(none yet)_ | |"}
`;
}

const REGISTRY_ISSUE_HEADER = `# API/MCP coverage

Printed by \`scripts/generate-api-registry.mts\` on every PR. "Agent-reachable"
means the function's guard admits an AGENT token — i.e. it calls
\`requireOrgPermission\`, \`requireOrgReadFor\`/\`requireOrgReadDocFor\`, or
\`requireSelfScope\`. Everything else is unreachable *by construction*, not by
convention:

- **SERVICE-only** — \`requireService\` throws for any non-service identity, so
  raw generated CRUD, mirror writes and backfills cannot be addressed from the
  API/MCP surface at all. This is the load-bearing invariant of the whole design
  (§3), machine-checked in \`convex/agentServiceUnreachable.test.ts\`.
- **Org-read** — still on the resource-less \`requireOrgRead\`/\`requireOrgReadDoc\`
  guard, which carries no resource to intersect an API key's scopes against, so it
  fails closed for agents (decision 2). Migrating one is a one-argument change.
- **Unclassified** — the static classifier found no guard it recognises (usually
  a guard reached through more than one level of local indirection). Treated as
  NOT reachable, which is the safe default; worth a look if the count grows.`;

// ─── 5. Main ────────────────────────────────────────────────────────────────

/** Gates 1 + 3, which both run before anything is written. Exits the process on
 *  failure — a gate that merely warned would be a comment. */
function runPreWriteGates(operations: Operation[], floor: number | null): void {
  const privilegedProblems = checkPrivilegedArgs(operations);
  if (privilegedProblems.length) {
    console.error("\n✖ Privileged-argument gate failed:\n");
    for (const problem of privilegedProblems) console.error(`${problem}\n`);
    process.exit(1);
  }

  const agentOpsProblems = checkAgentOpsAnnotations(operations);
  if (agentOpsProblems.length) {
    console.error("\n✖ agentOps annotation gate failed:\n");
    for (const problem of agentOpsProblems) console.error(`${problem}\n`);
    process.exit(1);
  }

  const reachableCount = operations.filter((o) => o.agentReachable).length;
  if (floor != null && reachableCount < floor) {
    console.error(
      `\n✖ Reachability gate failed: ${reachableCount} agent-reachable operations, ` +
        `floor is ${floor}.\n  Something narrowed the agent surface. If that was ` +
        `deliberate, lower the floor in docs/api-coverage.md in the same PR and say why.\n`,
    );
    process.exit(1);
  }
}

/** Gate 2. Regenerate in memory and compare; a stale committed output fails. */
function runStalenessGate(outputs: ReadonlyArray<readonly [string, string]>): void {
  const stale = outputs
    .filter(([path, expected]) => {
      try {
        return readFileSync(path, "utf8") !== expected;
      } catch {
        return true; // missing counts as stale
      }
    })
    .map(([path]) => path);

  if (stale.length) {
    console.error(
      `\n✖ Registry staleness gate failed. Out of date:\n${stale
        .map((p) => `  - ${p}`)
        .join("\n")}\n\n  Run \`pnpm run api:registry\` and commit the result.\n`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const operations = await collectOperations();
  const floor = readReachabilityFloor();

  runPreWriteGates(operations, floor);

  const reachableCount = operations.filter((o) => o.agentReachable).length;
  // Ratchet: regenerating raises the floor to whatever we just measured, so the
  // gate tightens automatically as Phase 5 migrates read guards. It never lowers
  // itself — a drop trips the gate above and has to be hand-edited with a reason.
  const outputs = [
    [REGISTRY_OUT, emitRegistry(operations)],
    [COVERAGE_OUT, emitCoverage(operations, Math.max(floor ?? 0, reachableCount))],
  ] as const;

  if (check) {
    runStalenessGate(outputs);
    console.log(
      `✓ API registry current — ${operations.length} public operations, ${reachableCount} agent-reachable.`,
    );
    return;
  }

  for (const [path, contents] of outputs) writeFileSync(path, contents);
  console.log(
    `✓ Wrote ${operations.length} operations (${reachableCount} agent-reachable) to:\n` +
      outputs.map(([path]) => `  ${path}`).join("\n"),
  );
}

await main();
