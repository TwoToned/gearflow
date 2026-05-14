/**
 * Soft warn-only AST lint for the multi-tenancy harness.
 *
 * Per P10 (single-tenant operational reality), GearFlow has the multi-tenancy
 * plumbing (`organizationId` columns, `getOrgContext`, `requirePermission`,
 * Better Auth Organization plugin) but only one tenant will ever exist at a
 * time. The harness is defense-in-depth dead plumbing, not a live security
 * boundary.
 *
 * This script keeps the harness coherent. Every exported async function in
 * `src/server/*.ts` should call one of the org-scoping helpers — that's the
 * project convention and it should stay that way so future contributors don't
 * accidentally drift the codebase into half-enforced multi-tenancy.
 *
 * **WARN-ONLY**: emits a list of suspect functions to stdout but always exits
 * 0. If you ever need this to be a hard CI block (e.g. you onboard a second
 * tenant), change the exit code at the bottom.
 *
 * Usage:
 *   npm run lint:server-actions
 *
 * Exempt a function with a JSDoc tag:
 *
 *   ʼ@org-scoped-exempt: public webhook endpoint, no session yetʼ
 *   export async function ingestWebhook(...) { ... }
 */

import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

// Gate functions — any exported async function in src/server/ that doesn't
// call one of these (or isn't explicitly exempted) gets a warning.
const ALLOWED_GATES = [
  "requirePermission",
  "getOrgContext",
  "requireSession",
  "requireSiteAdmin",
  "requireOrganization",
];

const EXEMPT_RE = /@org-scoped-exempt:\s*(.+)/;

interface Finding {
  file: string;
  line: number;
  name: string;
}

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: true,
});

project.addSourceFilesAtPaths("src/server/**/*.ts");

const findings: Finding[] = [];

for (const file of project.getSourceFiles()) {
  const filePath = path.relative(process.cwd(), file.getFilePath());

  // Skip test files and the file's own type-only exports
  if (/\.(test|int\.test|d)\.ts$/.test(filePath)) continue;

  for (const fn of file.getFunctions()) {
    if (!fn.isExported()) continue;
    if (!fn.isAsync()) continue;

    const name = fn.getName() || "(anonymous)";
    const bodyNode = fn.getBody();
    const body = bodyNode ? bodyNode.getText() : "";

    // Check JSDoc for an exempt tag
    const jsDocs = fn.getJsDocs();
    const exempt = jsDocs.some((d) => EXEMPT_RE.test(d.getText()));
    if (exempt) continue;

    // Check inline comment immediately preceding the function
    const leading = fn.getLeadingCommentRanges().map((r) => r.getText()).join("");
    if (EXEMPT_RE.test(leading)) continue;

    // Does the body reference any gate?
    const hasGate = ALLOWED_GATES.some(
      (g) => new RegExp(`\\b${g}\\b`).test(body),
    );
    if (hasGate) continue;

    findings.push({
      file: filePath,
      line: fn.getStartLineNumber(),
      name,
    });
  }

  // Also catch exported async arrow-function variables:
  //   export const foo = async () => { ... }
  for (const varStmt of file.getVariableStatements()) {
    if (!varStmt.isExported()) continue;
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      if (
        init.getKind() !== SyntaxKind.ArrowFunction &&
        init.getKind() !== SyntaxKind.FunctionExpression
      )
        continue;

      const text = init.getText();
      const isAsync = /^\s*async\b/.test(text) || init.getFirstChildByKind(SyntaxKind.AsyncKeyword);
      if (!isAsync) continue;

      const name = decl.getName();
      const jsDocs = varStmt.getJsDocs?.() ?? [];
      const exempt = jsDocs.some((d) => EXEMPT_RE.test(d.getText()));
      if (exempt) continue;

      const leading = varStmt.getLeadingCommentRanges().map((r) => r.getText()).join("");
      if (EXEMPT_RE.test(leading)) continue;

      const body = init.getText();
      const hasGate = ALLOWED_GATES.some(
        (g) => new RegExp(`\\b${g}\\b`).test(body),
      );
      if (hasGate) continue;

      findings.push({
        file: filePath,
        line: varStmt.getStartLineNumber(),
        name,
      });
    }
  }
}

if (findings.length === 0) {
  console.log("✓ All exported async server functions appear to enforce the multi-tenancy harness.");
  process.exit(0);
}

console.log(`⚠ ${findings.length} server functions missing an org-scoping gate (warn-only per P10):\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  →  ${f.name}`);
}
console.log();
console.log("These are warnings, not errors — single-tenant operational reality (P10).");
console.log("If a function legitimately doesn't need a gate, add a JSDoc tag:");
console.log();
console.log("  /** @org-scoped-exempt: brief reason */");
console.log("  export async function foo() { ... }");
console.log();

// Warn-only: always exit 0
process.exit(0);
