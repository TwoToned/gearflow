import type { RegistryOperation } from "./registry.generated";
import { publicArgs } from "./json-schema";
import { API_BASE_URL } from "./version";

/**
 * curl / TypeScript / Python snippets for one operation (Phase 8, #1004:
 * "SDK snippets: curl, TypeScript fetch, Python. Generated from the OpenAPI
 * spec, not hand-written, so they can't drift.").
 *
 * "Generated" here means DERIVED, not a committed file: every snippet is a
 * pure function of the already-generated `RegistryOperation` (operation
 * name, kind, args), computed at render time by the docs page
 * (src/app/docs/api/page.tsx). There is nothing here that could go stale
 * the way a hand-written example curl command would the moment an arg is
 * renamed — regenerate the registry and the snippet text follows.
 *
 * Placeholder values are deliberately generic ("...", 0, true) rather than
 * fabricated realistic-looking data — a docs snippet that LOOKS like a real
 * id invites copy-paste bugs when it silently isn't one.
 */

/** A JSON-safe placeholder for one coarse arg type (see json-schema.ts's own
 *  note on why these are coarse: object/array/union get no nested shape). */
function placeholderValue(type: string): unknown {
  switch (type) {
    case "string":
      return "...";
    case "number":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [];
    default:
      return {};
  }
}

/** The example `args` object for one operation: every caller-visible field
 *  (publicArgs already strips injected actor/id/auditId/now/org fields —
 *  json-schema.ts), each set to its type's placeholder. */
function exampleArgsObject(op: RegistryOperation): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  for (const arg of publicArgs(op)) example[arg.name] = placeholderValue(arg.type);
  return example;
}

/** The full request body an operation call takes — `args`, plus
 *  `idempotencyKey` for a mutation (dispatcher.ts's `parseEnvelope` rejects a
 *  mutation without one). */
function exampleBody(op: RegistryOperation): Record<string, unknown> {
  const body: Record<string, unknown> = { args: exampleArgsObject(op) };
  if (op.kind === "mutation") body.idempotencyKey = "REPLACE_WITH_A_UNIQUE_KEY";
  return body;
}

export function curlSnippet(op: RegistryOperation): string {
  const body = JSON.stringify(exampleBody(op), null, 2);
  return [
    `curl -X POST ${API_BASE_URL}/api/v1/ops/${op.operation} \\`,
    `  -H "Authorization: Bearer $RVLT_FLOW_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body}'`,
  ].join("\n");
}

export function typescriptSnippet(op: RegistryOperation): string {
  const body = JSON.stringify(exampleBody(op), null, 2);
  return [
    `const res = await fetch("${API_BASE_URL}/api/v1/ops/${op.operation}", {`,
    `  method: "POST",`,
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.RVLT_FLOW_API_KEY}\`,`,
    `    "Content-Type": "application/json",`,
    `  },`,
    `  body: JSON.stringify(${body}),`,
    `});`,
    `const { data, warnings } = await res.json();`,
  ].join("\n");
}

/** A JSON literal isn't valid Python (`true`/`null` vs. `True`/`None`) — the
 *  one place this module can't just reuse `JSON.stringify`. Placeholder
 *  values are simple enough (string/number/bool/empty array/empty object)
 *  that a small recursive serializer covers every case exampleBody produces. */
function pythonLiteral(value: unknown, depth = 0): string {
  const indent = "    ".repeat(depth + 1);
  const closeIndent = "    ".repeat(depth);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[${value.map((v) => pythonLiteral(v, depth)).join(", ")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "{}";
  const lines = entries.map(([k, v]) => `${indent}${JSON.stringify(k)}: ${pythonLiteral(v, depth + 1)},`);
  return `{\n${lines.join("\n")}\n${closeIndent}}`;
}

export function pythonSnippet(op: RegistryOperation): string {
  return [
    `import os, requests`,
    ``,
    `res = requests.post(`,
    `    "${API_BASE_URL}/api/v1/ops/${op.operation}",`,
    `    headers={"Authorization": f"Bearer {os.environ['RVLT_FLOW_API_KEY']}"},`,
    `    json=${pythonLiteral(exampleBody(op), 0)},`,
    `)`,
    `data = res.json()`,
  ].join("\n");
}

export interface OperationSnippets {
  curl: string;
  typescript: string;
  python: string;
}

export function snippetsFor(op: RegistryOperation): OperationSnippets {
  return { curl: curlSnippet(op), typescript: typescriptSnippet(op), python: pythonSnippet(op) };
}
