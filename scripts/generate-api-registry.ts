/**
 * Generates `src/lib/api/generated/operations.ts` — the machine-readable catalogue
 * of every server action the API + MCP layer can invoke.
 *
 * We parse `src/server/*.ts` with the TypeScript compiler API rather than hand-
 * maintaining 500+ entries, so the registry cannot drift from the code. For each
 * exported async function we record its parameters and the `requirePermission(
 * resource, action)` literal that guards it. That guard is the source of truth for
 * the required scope — and because `requirePermission` itself enforces key scopes
 * at runtime, a wrong entry here degrades discoverability, never safety.
 *
 * Run: pnpm exec tsx scripts/generate-api-registry.ts
 */
import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const SERVER_DIR = path.join(process.cwd(), "src/server");
const OUT_FILE = path.join(process.cwd(), "src/lib/api/generated/operations.ts");

/**
 * Modules the API deliberately cannot reach.
 * Not a safety boundary on their own (RBAC still applies) — these are either
 * cross-org admin surface, session-bound flows that cannot work without a cookie,
 * or internal helpers that were never user-facing operations.
 */
const EXCLUDED_MODULES = new Set([
  "site-admin", // cross-org platform admin, guarded by admin-auth not org RBAC
  "invitations", // reads the Better Auth session directly
  "user-profile", // reads the Better Auth session directly
  "notification-email-sender", // internal transport, not a user operation
  "csv", // helper module, no "use server"
  "split-sibling-collapse", // internal helper, no "use server"
  "public-org", // deliberately unauthenticated public endpoint
]);

/**
 * Read-only modules carry no `requirePermission` guard, so their RBAC resource
 * cannot be derived from the code. Declare it. Every module without a guard MUST
 * appear here or generation fails — that is what stops a new unguarded module
 * from silently defaulting to an over-broad scope.
 */
const READ_RESOURCE_BY_MODULE: Record<string, string> = {
  "activity-log": "reports",
  "api-keys": "orgSettings",
  "asset-media": "asset",
  availability: "project",
  changelog: "orgSettings",
  "client-media": "client",
  "crew-dashboard": "crew",
  dashboard: "reports",
  "document-templates": "document",
  "kit-media": "kit",
  "location-media": "location",
  "model-media": "model",
  "notification-preferences": "orgSettings",
  notifications: "orgSettings",
  "project-costs": "project",
  "project-media": "project",
  "saved-views": "orgSettings",
  "scan-lookup": "asset",
  search: "asset",
  tags: "asset",
  "test-tag-reminders": "testTag",
  "test-tag-reports": "testTag",
};

/** Name prefixes that mark an operation as a read. Everything else is a write. */
const READ_PREFIXES = [
  "get", "list", "search", "check", "peek", "count", "fetch",
  "preview", "lookup", "resolve", "export", "find", "load", "is", "has",
];

/** Irreversible or privilege-sensitive operations. Callers must opt in explicitly. */
const DANGEROUS_PREFIXES = [
  "delete", "remove", "archive", "purge", "revoke", "destroy", "drop", "reset", "kill",
];
const DANGEROUS_MODULES = new Set(["api-keys", "custom-roles", "org-members", "sso", "settings"]);

interface Param {
  name: string;
  type: string;
  optional: boolean;
}

interface Operation {
  name: string;
  module: string;
  fn: string;
  kind: "read" | "write";
  resource: string;
  action: string;
  params: Param[];
  dangerous: boolean;
  summary: string;
}

/** Pull the leading JSDoc/`//` summary line off a declaration, if any. */
function extractSummary(node: ts.Node, source: ts.SourceFile): string {
  const ranges = ts.getLeadingCommentRanges(source.getFullText(), node.getFullStart());
  if (!ranges?.length) return "";
  const raw = source.getFullText().slice(ranges[0].pos, ranges[0].end);
  const firstLine = raw
    .split("\n")
    .map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)\s?/, "").trim())
    .filter((l) => l && !l.startsWith("@"))[0];
  return (firstLine ?? "").replace(/\s+/g, " ").slice(0, 300);
}

/** Find the first `requirePermission("resource", "action")` literal in a body. */
function findGuard(node: ts.Node): { resource: string; action: string } | null {
  let found: { resource: string; action: string } | null = null;

  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "requirePermission" &&
      n.arguments.length >= 2 &&
      ts.isStringLiteral(n.arguments[0]) &&
      ts.isStringLiteral(n.arguments[1])
    ) {
      found = {
        resource: (n.arguments[0] as ts.StringLiteral).text,
        action: (n.arguments[1] as ts.StringLiteral).text,
      };
      return;
    }
    ts.forEachChild(n, visit);
  };

  ts.forEachChild(node, visit);
  return found;
}

/** Does this function body read the Better Auth session directly? Those can't run headless. */
function usesRawSession(node: ts.Node): boolean {
  let hit = false;
  const visit = (n: ts.Node) => {
    if (hit) return;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      (n.expression.text === "getSession" || n.expression.text === "requireSession")
    ) {
      hit = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return hit;
}

function isRead(fnName: string): boolean {
  return READ_PREFIXES.some(
    (p) => fnName.startsWith(p) && (fnName.length === p.length || /[A-Z]/.test(fnName[p.length])),
  );
}

function isDangerous(fnName: string, moduleName: string): boolean {
  const lower = fnName.toLowerCase();
  return (
    DANGEROUS_PREFIXES.some((p) => lower.startsWith(p)) || DANGEROUS_MODULES.has(moduleName)
  );
}

function main() {
  const files = fs
    .readdirSync(SERVER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".int.test."))
    .sort();

  const operations: Operation[] = [];
  const modules = new Set<string>();
  const skipped: string[] = [];
  const undeclared = new Set<string>();

  for (const file of files) {
    const moduleName = file.replace(/\.ts$/, "");
    if (EXCLUDED_MODULES.has(moduleName)) continue;

    const full = path.join(SERVER_DIR, file);
    const source = ts.createSourceFile(
      full,
      fs.readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    const exported = source.statements.filter(
      (s): s is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(s) &&
        Boolean(s.name) &&
        Boolean(s.body) &&
        Boolean(s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) &&
        Boolean(s.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)),
    );

    // An unguarded function (a read, or a mutation gated only by getOrgContext)
    // inherits the resource its guarded siblings use — e.g. every write in
    // projects.ts guards "project", so getProjects scopes to "project:read".
    // Modules with no guard at all must declare their resource explicitly.
    const guardedResources = exported
      .map((s) => findGuard(s.body!)?.resource)
      .filter((r): r is string => Boolean(r));
    const tally = new Map<string, number>();
    for (const r of guardedResources) tally.set(r, (tally.get(r) ?? 0) + 1);
    const dominantResource =
      [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      READ_RESOURCE_BY_MODULE[moduleName];

    for (const stmt of exported) {
      const fn = stmt.name!.text;

      if (usesRawSession(stmt.body!)) {
        skipped.push(`${moduleName}.${fn} (reads the session directly)`);
        continue;
      }

      const guard = findGuard(stmt.body!);
      const kind: "read" | "write" = guard ? "write" : isRead(fn) ? "read" : "write";

      let resource: string;
      let action: string;
      if (guard) {
        ({ resource, action } = guard);
      } else {
        if (!dominantResource) {
          undeclared.add(moduleName);
          continue;
        }
        resource = dominantResource;
        // An unguarded mutation (e.g. notifications.markAsRead) still needs a
        // write-shaped scope so a read-only key cannot call it.
        action = kind === "read" ? "read" : "update";
      }

      const params: Param[] = stmt.parameters.map((p) => ({
        name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(source),
        type: p.type ? p.type.getText(source).replace(/\s+/g, " ") : "unknown",
        optional: Boolean(p.questionToken || p.initializer),
      }));

      // `actor` is injected by the dispatcher, never supplied by the caller.
      const callerParams = params.filter((p) => p.name !== "actor");

      modules.add(moduleName);
      operations.push({
        name: `${moduleName}.${fn}`,
        module: moduleName,
        fn,
        kind,
        resource,
        action,
        params: callerParams,
        dangerous: isDangerous(fn, moduleName),
        summary: extractSummary(stmt, source),
      });
    }
  }

  if (undeclared.size) {
    throw new Error(
      `These modules have no requirePermission guard anywhere, so their operations ` +
        `have no derivable scope. Add each to READ_RESOURCE_BY_MODULE in ` +
        `scripts/generate-api-registry.ts (or to EXCLUDED_MODULES):\n` +
        [...undeclared].sort().map((m) => `  - ${m}`).join("\n"),
    );
  }

  operations.sort((a, b) => a.name.localeCompare(b.name));
  const sortedModules = [...modules].sort();

  const header = `// AUTO-GENERATED by scripts/generate-api-registry.ts — do not edit by hand.
// Regenerate with: pnpm exec tsx scripts/generate-api-registry.ts
//
// Every exported server action the API + MCP layer can invoke, with the RBAC
// guard the action enforces on itself. \`requirePermission\` re-checks the key's
// scope at call time, so this catalogue drives discovery and docs, not security.

export interface OperationParam {
  name: string;
  type: string;
  optional: boolean;
}

export interface OperationMeta {
  /** Stable id: "<module>.<functionName>". */
  name: string;
  module: string;
  fn: string;
  kind: "read" | "write";
  /** RBAC resource, from the action's own requirePermission guard. */
  resource: string;
  action: string;
  /** Scope a key must hold: "<resource>:<action>". */
  scope: string;
  /** Positional parameters, in call order. \`actor\` is injected, never passed. */
  params: OperationParam[];
  /** Irreversible or privilege-sensitive. Excluded from every scope preset. */
  dangerous: boolean;
  summary: string;
}
`;

  const opsBody = operations
    .map((op) => {
      const params = op.params
        .map(
          (p) =>
            `{ name: ${JSON.stringify(p.name)}, type: ${JSON.stringify(p.type)}, optional: ${p.optional} }`,
        )
        .join(", ");
      return (
        `  ${JSON.stringify(op.name)}: { name: ${JSON.stringify(op.name)}, ` +
        `module: ${JSON.stringify(op.module)}, fn: ${JSON.stringify(op.fn)}, ` +
        `kind: ${JSON.stringify(op.kind)}, resource: ${JSON.stringify(op.resource)}, ` +
        `action: ${JSON.stringify(op.action)}, scope: ${JSON.stringify(`${op.resource}:${op.action}`)}, ` +
        `params: [${params}], dangerous: ${op.dangerous}, summary: ${JSON.stringify(op.summary)} },`
      );
    })
    .join("\n");

  // Literal import specifiers keep the module graph statically analysable.
  const loaders = sortedModules
    .map((m) => `  ${JSON.stringify(m)}: () => import(${JSON.stringify(`@/server/${m}`)}),`)
    .join("\n");

  const out = `${header}
export const OPERATIONS: Record<string, OperationMeta> = {
${opsBody}
};

/** Lazy per-module loaders so a single operation call doesn't pull in all of src/server. */
export const MODULE_LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {
${loaders}
};

export const OPERATION_COUNT = ${operations.length};
`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out);

  const reads = operations.filter((o) => o.kind === "read").length;
  const dangerous = operations.filter((o) => o.dangerous).length;
  console.log(`Wrote ${OUT_FILE}`);
  console.log(
    `  ${operations.length} operations across ${sortedModules.length} modules ` +
      `(${reads} read, ${operations.length - reads} write, ${dangerous} dangerous)`,
  );
  if (skipped.length) {
    console.log(`  Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`    - ${s}`);
  }
}

main();
