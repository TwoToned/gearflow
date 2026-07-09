import { API_DOCS_URL } from "./http";
import { ALL_OPERATIONS, isGuardedWrite, schemaForParam } from "./dispatch";
import type { OperationMeta } from "./generated/operations";

/**
 * An OpenAPI 3.1 description of the whole operation surface, generated from the
 * same registry the dispatcher runs on. Never hand-written, so it cannot drift.
 *
 * 3.1 matters specifically: its schema objects are JSON Schema 2020-12, which is
 * the dialect `PARAM_SCHEMAS` (from Zod) and MCP's `inputSchema` already speak.
 * One generator, three consumers.
 *
 * This is the artifact for HUMANS, SDK generators and request-validation tooling.
 * It is NOT the agent path — the document describes 537 operations and is large.
 * An agent should use `GET /api/v1/operations` + `/operations/{name}`, which are
 * filtered to its scopes and paginated. See public/llms.txt.
 */

const OPENAPI_VERSION = "3.1.0";
const BASE_URL = "https://flow.rvlt.app";

/** Build the requestBody schema for one operation from its parameter list. */
function requestBodySchema(meta: OperationMeta): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of meta.params) {
    const schema = schemaForParam(param);
    if (schema) {
      const { $schema: _drop, ...body } = schema as Record<string, unknown>;
      properties[param.name] = body;
    } else {
      // No Zod schema behind this type. Say so rather than pretend.
      properties[param.name] = {
        description: `TypeScript type: ${param.type}. No JSON Schema available for this type.`,
      };
    }
    if (!param.optional) required.push(param.name);
  }

  const args: Record<string, unknown> = {
    type: "object",
    description: "Arguments keyed by the operation's parameter names.",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };

  const guarded = isGuardedWrite(meta);
  const bodyProps: Record<string, unknown> = { arguments: args };

  if (meta.kind === "write") {
    bodyProps.confirm = {
      type: "boolean",
      description: guarded
        ? "Required (true). This operation is irreversible or changes stock availability."
        : "Not required for this operation.",
    };
    bodyProps.idempotencyKey = {
      type: "string",
      description: guarded
        ? "Required. A unique id per intended action; a retry with the same key replays rather than re-applying."
        : "Optional but recommended. Makes a retry safe.",
    };
  }

  return {
    type: "object",
    properties: bodyProps,
    ...(guarded ? { required: ["confirm", "idempotencyKey"] } : {}),
  };
}

/**
 * Referenced, not inlined. Inlining the envelope on 7 status codes across 540 paths
 * ballooned the document to ~1.5 MB; a `$ref` cuts it by roughly two thirds.
 */
const ERROR_RESPONSE = { $ref: "#/components/responses/Error" };

const ERROR_RESPONSE_DEFINITION = {
  description: "Structured error envelope. Branch on `error.code`, never the message.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorEnvelope" },
    },
  },
};

/** Also referenced — the success envelope is identical for every operation. */
const OK_RESPONSE = { $ref: "#/components/responses/OperationResult" };

const OK_RESPONSE_DEFINITION = {
  description: "The operation's result.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          operation: { type: "string" },
          kind: { type: "string", enum: ["read", "write"] },
          replayed: {
            type: "boolean",
            description: "True when this idempotencyKey already ran; `result` is the original.",
          },
          result: { description: "The action's return value." },
        },
        required: ["operation", "kind", "replayed", "result"],
      },
    },
  },
};

function buildDocument(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const meta of Object.values(ALL_OPERATIONS)) {
    const guarded = isGuardedWrite(meta);
    paths[`/api/v1/ops/${meta.name}`] = {
      post: {
        operationId: meta.name.replace(/[.-]/g, "_"),
        summary: meta.summary || `${meta.kind} ${meta.name}`,
        description:
          `Runs the guarded server action \`${meta.name}\`, as the user your API key acts for.` +
          (guarded
            ? `\n\n**Requires \`confirm: true\` and an \`idempotencyKey\`.** ${meta.dangerous ? "This operation is irreversible." : "This operation changes stock availability."}`
            : ""),
        tags: [meta.module],
        security: [{ bearerAuth: [] }],
        "x-required-scope": meta.scope,
        "x-kind": meta.kind,
        "x-dangerous": meta.dangerous,
        requestBody: {
          required: meta.params.length > 0 || guarded,
          content: { "application/json": { schema: requestBodySchema(meta) } },
        },
        responses: {
          "200": OK_RESPONSE,
          "400": ERROR_RESPONSE,
          "401": ERROR_RESPONSE,
          "403": ERROR_RESPONSE,
          "404": ERROR_RESPONSE,
          "409": ERROR_RESPONSE,
          "428": ERROR_RESPONSE,
          "500": ERROR_RESPONSE,
        },
      },
    };
  }

  // Discovery + identity endpoints (the paths an agent should actually use).
  paths["/api/v1/whoami"] = {
    get: {
      operationId: "whoami",
      summary: "Verify the API key; returns org, acting user, scopes.",
      tags: ["discovery"],
      security: [{ bearerAuth: [] }],
      responses: { "200": { description: "Identity and scopes." }, "401": ERROR_RESPONSE },
    },
  };
  paths["/api/v1/operations"] = {
    get: {
      operationId: "listOperations",
      summary: "Discover operations this key can call. Filtered to its scopes.",
      tags: ["discovery"],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "search", in: "query", schema: { type: "string" } },
        { name: "kind", in: "query", schema: { type: "string", enum: ["read", "write"] } },
        { name: "module", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 0 } },
      ],
      responses: { "200": { description: "Matching operations." }, "401": ERROR_RESPONSE },
    },
  };
  paths["/api/v1/operations/{name}"] = {
    get: {
      operationId: "describeOperation",
      summary: "The exact call signature of one operation, with JSON Schema per parameter.",
      tags: ["discovery"],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": { description: "The signature." }, "404": ERROR_RESPONSE },
    },
  };

  const modules = [...new Set(Object.values(ALL_OPERATIONS).map((o) => o.module))].sort();

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "GearFlow API",
      version: "v1",
      description:
        "Every read and write the GearFlow web app can perform, exposed as operations. " +
        "Each runs the same guarded code path the UI runs: same RBAC, overbooking prevention, validation and audit log.\n\n" +
        `Agents should prefer the MCP server at \`/api/v1/mcp\` and the discovery endpoints over this document — it describes ${Object.keys(ALL_OPERATIONS).length} operations and is large. Full agent guide: ${API_DOCS_URL}`,
      "x-docs-url": API_DOCS_URL,
    },
    servers: [{ url: BASE_URL }],
    tags: [
      { name: "discovery", description: "Identity and operation discovery." },
      ...modules.map((m) => ({ name: m })),
    ],
    components: {
      responses: {
        Error: ERROR_RESPONSE_DEFINITION,
        OperationResult: OK_RESPONSE_DEFINITION,
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "An API key: `Authorization: Bearer gf_live_...`",
        },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description: "Stable machine-readable code. Branch on this.",
                  enum: [
                    "INVALID_KEY",
                    "KEY_INACTIVE",
                    "KEY_EXPIRED",
                    "ORG_KILL_SWITCH",
                    "MISSING_SCOPE",
                    "FORBIDDEN",
                    "VALIDATION_ERROR",
                    "IDEMPOTENCY_KEY_REQUIRED",
                    "IDEMPOTENCY_IN_PROGRESS",
                    "CONFIRMATION_REQUIRED",
                    "INVENTORY_CONFLICT",
                    "STALE_PREVIEW",
                    "NOT_FOUND",
                    "INTERNAL",
                  ],
                },
                message: { type: "string" },
                retryable: { type: "boolean" },
                requiredScope: { type: "string" },
                details: { type: "object", additionalProperties: true },
                documentation_url: { type: "string" },
              },
              required: ["code", "message", "retryable", "documentation_url"],
            },
          },
          required: ["error"],
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

/** Built once per process — the registry is static, so the document is too. */
let cached: Record<string, unknown> | null = null;

export function getOpenApiDocument(): Record<string, unknown> {
  if (!cached) cached = buildDocument();
  return cached;
}
