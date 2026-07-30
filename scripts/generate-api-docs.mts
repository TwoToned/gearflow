/**
 * OpenAPI 3.1 + llms.txt generator (Phase 2, #998, design §11).
 *
 * Reads the ALREADY-generated `API_REGISTRY` (scripts/generate-api-registry.mts
 * must run first — CI's api:registry:check step precedes this one) rather than
 * re-walking convex/*.ts itself, so there is exactly one extraction pass and
 * these two artifacts can never disagree with the registry about what exists.
 *
 * Coarse types only: `RegistryOperation.args[].type` is one of
 * string/number/boolean/object/array/union/any (the registry generator's own
 * doc comment notes the FULL validator tree is deliberately not committed
 * there — re-reading it here would duplicate that ts-morph pass for marginal
 * schema precision). The JSON Schema below is honest about that: an
 * `object`/`array`/`union` arg gets its bare JSON Schema type with no nested
 * `properties`, not a fabricated shape.
 *
 * Outputs (all committed; `--check` re-generates and diffs, same pattern as
 * generate-api-registry.mts):
 *   • src/lib/api/openapi.generated.ts — OPENAPI_DOCUMENT, served (unauthenticated
 *     — it's a schema, not org data) by GET /api/v1/openapi.json
 *   • src/lib/api/llms-txt.generated.ts — LLMS_TXT, same text as a TS constant
 *     (so a test can import + assert on it without a filesystem read)
 *   • public/llms.txt — the actual served artifact. Static, at the ROOT (not
 *     under /api/v1) per convention (llmstxt.org) — Next serves anything under
 *     `public/` verbatim, so this needs no route handler at all.
 *
 * Usage:
 *   pnpm run api:docs          # regenerate
 *   pnpm run api:docs:check    # verify committed output is current (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { API_REGISTRY, type RegistryOperation } from "../src/lib/api/registry.generated.js";
import { argsObjectSchema, type JsonSchema } from "../src/lib/api/json-schema.js";
import { API_BASE_URL } from "../src/lib/api/version.js";

const ROOT = resolve(import.meta.dirname, "..");
const OPENAPI_OUT = join(ROOT, "src/lib/api/openapi.generated.ts");
const LLMS_OUT = join(ROOT, "src/lib/api/llms-txt.generated.ts");
const LLMS_PUBLIC_OUT = join(ROOT, "public/llms.txt");

const BASE_URL = API_BASE_URL;

function reachableOps(): RegistryOperation[] {
  return API_REGISTRY.filter((op) => op.agentReachable);
}

function operationPath(op: RegistryOperation): JsonSchema {
  const bodyProperties: Record<string, JsonSchema> = {
    args: argsObjectSchema(op),
  };
  const bodyRequired = ["args"];
  if (op.kind === "mutation") {
    bodyProperties.idempotencyKey = {
      type: "string",
      minLength: 8,
      maxLength: 200,
      description: "Required for mutations. A retry with the same key replays the first result instead of double-writing.",
    };
    bodyRequired.push("idempotencyKey");
  }

  const scopeNote =
    op.scopePairs.length > 0 ? `Requires scope: ${op.scopePairs.map((p) => `${p.resource}:${p.action}`).join(" or ")}.` : undefined;
  const stabilityNote =
    op.stability === "stable"
      ? "Stability: stable — one of the additive-only /v1 curated operations (design §13 decision 12); fields are only ever added, never removed."
      : "Stability: tracks-app — follows the app's internals directly; shape can change between ordinary refactors.";

  return {
    post: {
      operationId: op.operation,
      summary: `${op.operation} (${op.kind})`,
      description: [scopeNote, stabilityNote].filter(Boolean).join(" "),
      "x-stability": op.stability,
      tags: op.resource ? [op.resource] : undefined,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: bodyProperties, required: bodyRequired },
          },
        },
      },
      responses: {
        "200": { description: "Success (read, or a replayed write).", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" } } } },
        "201": { description: "Success (a write took effect).", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" } } } },
        default: { description: "Error.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
      },
    },
  };
}

function buildOpenApiDocument(ops: RegistryOperation[]): JsonSchema {
  const paths: Record<string, JsonSchema> = {
    "/api/v1/whoami": {
      get: {
        operationId: "whoami",
        summary: "Test your credentials — org, acting user, live permissions, scopes, limits.",
        responses: { "200": { description: "OK" }, default: { description: "Error.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } } },
      },
    },
    "/api/v1/operations": {
      get: {
        operationId: "listOperations",
        summary: "Paginated list of every operation this key can call.",
        parameters: [
          { name: "resource", in: "query", schema: { type: "string" } },
          { name: "kind", in: "query", schema: { type: "string", enum: ["query", "mutation"] } },
          { name: "cursor", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/v1/operations/{operation}": {
      get: {
        operationId: "getOperation",
        summary: "One operation's schema, scope, and error codes.",
        parameters: [{ name: "operation", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "404": { description: "Unknown or not agent-reachable." } },
      },
    },
    "/api/v1/documents/{projectId}": {
      get: {
        operationId: "getProjectDocument",
        summary: "Fetch a project's PDF — delivery docket, pick slip, quote (draft or sent), or invoice (if issued).",
        description:
          "Live-rendered from today's project state for delivery-docket/packing-list/return-sheet. For quote/invoice, " +
          "streams the frozen stored PDF if one has been sent/issued (never re-rendered); quote falls back to a " +
          'watermarked DRAFT PREVIEW live render when none has been sent yet (invoice has no draft form). Requires ' +
          "`project:read` for the first three types, `invoice:read` for quote/invoice. Not a registry operation — " +
          "PDF rendering needs Node/Prisma, which the Convex-only dispatcher can't reach (src/lib/api/documents.ts).",
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "type",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["quote", "invoice", "packing-list", "return-sheet", "delivery-docket"] },
          },
        ],
        responses: {
          "200": { description: "The PDF bytes.", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } },
          default: { description: "Error.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
        },
      },
    },
  };

  for (const op of ops) {
    paths[`/api/v1/ops/${op.operation}`] = operationPath(op);
  }

  // Sort keys before serializing — belt-and-braces determinism. `ops` is
  // already registry-order (itself fixed by the committed registry file), so
  // this shouldn't change anything in practice; it just makes "the same
  // operation set always serializes identically" a property of the object
  // itself rather than of insertion order alone.
  const sortedPaths: Record<string, JsonSchema> = {};
  for (const key of Object.keys(paths).sort()) sortedPaths[key] = paths[key];

  return {
    openapi: "3.1.0",
    info: {
      title: "RVLT Flow Agent API",
      version: "2.0.0",
      description:
        "Agent-accessible REST API over the same Convex-native surface + gates a human operator faces in the UI " +
        "(docs/designs/api-mcp-reimplementation.md). Generated from the operation registry — never hand-authored.",
    },
    servers: [{ url: BASE_URL }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "An org API key (Settings → API keys)." },
      },
      schemas: {
        SuccessEnvelope: {
          type: "object",
          properties: {
            data: {},
            requestId: { type: ["string", "null"] },
            replayed: { type: "boolean" },
            warnings: {
              type: "array",
              items: { type: "string" },
              description:
                "Design §13 versioning mechanics: the in-band deprecation channel — the only one an autonomous " +
                "agent reliably consumes. Empty today (nothing is deprecated yet); always present so a future " +
                "deprecation notice needs no response-shape change.",
            },
          },
        },
        ErrorEnvelope: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                category: { type: "string" },
                retryable: { type: "boolean" },
                message: { type: "string" },
                recovery: { type: ["object", "null"] },
                requiredScope: { type: ["string", "null"] },
                requestId: { type: ["string", "null"] },
                details: { type: ["object", "null"] },
              },
            },
          },
        },
      },
    },
    paths: sortedPaths,
  };
}

function buildLlmsTxt(ops: RegistryOperation[]): string {
  const byResource = new Map<string, RegistryOperation[]>();
  for (const op of ops) {
    const key = op.resource ?? "(uncategorised)";
    const list = byResource.get(key) ?? [];
    list.push(op);
    byResource.set(key, list);
  }

  const lines: string[] = [
    "# RVLT Flow Agent API",
    "",
    `Base URL: ${BASE_URL}/api/v1`,
    "Auth: `Authorization: Bearer <api key>` (Settings → API keys). Bearer-only — there is no cookie/session path.",
    "",
    "## Getting started",
    "1. `GET /whoami` — verify your key: org, acting user, live permissions, scopes, limits.",
    "2. `GET /operations` — list every operation your key can call (paginated; filter by `resource`/`kind`).",
    "3. `GET /operations/{operation}` — one operation's arg schema, scope, and possible error codes.",
    "4. `POST /ops/{operation}` — call it. Body: `{\"args\": {...}, \"idempotencyKey\": \"...\"}` (idempotencyKey required for mutations).",
    "5. `GET /openapi.json` — the full machine-readable contract.",
    "",
    "`GET /documents/{projectId}?type=<quote|invoice|packing-list|return-sheet|delivery-docket>` fetches a project's " +
      "PDF (binary `application/pdf` response, not a JSON-wrapped operation) — see the MCP `get_project_document` " +
      "tool for the same capability with the bytes returned inline as a base64 resource.",
    "",
    "An operation absent from `/operations` is a 404 at `/ops/{operation}` — the surface is closed by default.",
    "",
    `## Operations (${ops.length} agent-reachable)`,
    "",
  ];

  for (const resource of [...byResource.keys()].sort()) {
    lines.push(`### ${resource}`);
    for (const op of byResource.get(resource)!.sort((a, b) => a.operation.localeCompare(b.operation))) {
      const scope = op.scopePairs.map((p) => `${p.resource}:${p.action}`).join(",") || "none";
      lines.push(`- \`${op.operation}\` (${op.kind}, scope: ${scope})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function emitOpenApi(doc: JsonSchema): string {
  return (
    "// GENERATED FILE — DO NOT EDIT.\n" +
    "// Run `pnpm run api:docs` to regenerate; CI fails if this file is stale.\n" +
    "// Source of truth: src/lib/api/registry.generated.ts. See scripts/generate-api-docs.mts.\n" +
    "\n" +
    "export const OPENAPI_DOCUMENT = " +
    JSON.stringify(doc, null, 2) +
    " as const;\n"
  );
}

function emitLlmsTxt(text: string): string {
  return (
    "// GENERATED FILE — DO NOT EDIT.\n" +
    "// Run `pnpm run api:docs` to regenerate; CI fails if this file is stale.\n" +
    "// Source of truth: src/lib/api/registry.generated.ts. See scripts/generate-api-docs.mts.\n" +
    "\n" +
    "export const LLMS_TXT = " +
    JSON.stringify(text) +
    ";\n"
  );
}

function runStalenessGate(outputs: readonly (readonly [string, string])[]): void {
  const stale = outputs
    .filter(([path, contents]) => {
      let existing: string;
      try {
        existing = readFileSync(path, "utf8");
      } catch {
        return true;
      }
      return existing !== contents;
    })
    .map(([path]) => path);

  if (stale.length) {
    console.error(
      `\n✖ API docs staleness gate failed. Out of date:\n${stale.map((p) => `  - ${p}`).join("\n")}\n\n  Run \`pnpm run api:docs\` and commit the result.\n`,
    );
    process.exit(1);
  }
}

function main(): void {
  const check = process.argv.includes("--check");
  const ops = reachableOps();
  const openapiDoc = buildOpenApiDocument(ops);
  const llmsTxt = buildLlmsTxt(ops);

  const outputs = [
    [OPENAPI_OUT, emitOpenApi(openapiDoc)],
    [LLMS_OUT, emitLlmsTxt(llmsTxt)],
    [LLMS_PUBLIC_OUT, llmsTxt],
  ] as const;

  if (check) {
    runStalenessGate(outputs);
    console.log(`✓ API docs current — ${ops.length} operations documented.`);
    return;
  }

  for (const [path, contents] of outputs) writeFileSync(path, contents);
  console.log(`✓ Wrote OpenAPI + llms.txt (${ops.length} operations) to:\n` + outputs.map(([path]) => `  ${path}`).join("\n"));
}

main();
