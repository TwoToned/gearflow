import { describe, it, expect, vi } from "vitest";

vi.mock("../prisma", () => ({ prisma: { apiIdempotency: {} } }));
vi.mock("../convex-client", () => ({ getConvexClient: vi.fn() }));

const { getOpenApiDocument } = await import("./openapi");
const { ALL_OPERATIONS } = await import("./dispatch");

const doc = getOpenApiDocument() as {
  openapi: string;
  paths: Record<string, { post?: Record<string, unknown>; get?: unknown }>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  tags: { name: string }[];
};

describe("OpenAPI document", () => {
  it("declares 3.1 — its schemas are JSON Schema 2020-12, same dialect as MCP inputSchema", () => {
    expect(doc.openapi).toBe("3.1.0");
  });

  it("covers every operation in the registry, plus the discovery endpoints", () => {
    const opCount = Object.keys(ALL_OPERATIONS).length;
    const opPaths = Object.keys(doc.paths).filter((p) => p.startsWith("/api/v1/ops/"));
    expect(opPaths).toHaveLength(opCount);
    expect(doc.paths["/api/v1/operations"]).toBeDefined();
    expect(doc.paths["/api/v1/operations/{name}"]).toBeDefined();
    expect(doc.paths["/api/v1/whoami"]).toBeDefined();
  });

  it("is cached — the registry is static, so the document is built once", () => {
    expect(getOpenApiDocument()).toBe(doc);
  });

  it("embeds the real generated schema for a Zod-backed parameter", () => {
    const post = doc.paths["/api/v1/ops/clients.createClient"].post!;
    const body = post.requestBody as {
      content: { "application/json": { schema: { properties: { arguments: { properties: { data: { properties: Record<string, unknown>; required: string[] } } } } } } };
    };
    const data = body.content["application/json"].schema.properties.arguments.properties.data;
    expect(Object.keys(data.properties)).toContain("contactEmail");
    expect(data.required).toEqual(["name"]);
  });

  it("does not pretend to have a schema it lacks", () => {
    // activity-log.exportActivityLogCSV takes ActivityLogFilters, a plain interface.
    const post = doc.paths["/api/v1/ops/activity-log.exportActivityLogCSV"].post!;
    const body = post.requestBody as {
      content: { "application/json": { schema: { properties: { arguments: { properties: Record<string, { description?: string }> } } } } };
    };
    const filters = body.content["application/json"].schema.properties.arguments.properties.filters;
    expect(filters.description).toContain("No JSON Schema available");
  });

  it("carries the required scope and danger flag per operation", () => {
    const del = doc.paths["/api/v1/ops/projects.deleteProject"].post!;
    expect(del["x-required-scope"]).toBe("project:delete");
    expect(del["x-dangerous"]).toBe(true);
    expect(del["x-kind"]).toBe("write");
  });

  it("makes confirm + idempotencyKey required on guarded writes only", () => {
    const guarded = doc.paths["/api/v1/ops/projects.deleteProject"].post!.requestBody as {
      content: { "application/json": { schema: { required?: string[] } } };
    };
    expect(guarded.content["application/json"].schema.required).toEqual([
      "confirm",
      "idempotencyKey",
    ]);

    const ordinary = doc.paths["/api/v1/ops/clients.createClient"].post!.requestBody as {
      content: { "application/json": { schema: { required?: string[] } } };
    };
    expect(ordinary.content["application/json"].schema.required).toBeUndefined();

    const read = doc.paths["/api/v1/ops/projects.getProjects"].post!.requestBody as {
      content: { "application/json": { schema: { properties: Record<string, unknown> } } };
    };
    // Reads carry no confirmation controls at all.
    expect(read.content["application/json"].schema.properties.confirm).toBeUndefined();
  });

  it("strips $schema from embedded subschemas (they are not standalone documents)", () => {
    const post = doc.paths["/api/v1/ops/clients.createClient"].post!;
    const json = JSON.stringify(post);
    expect(json).not.toContain("$schema");
  });

  it("references shared responses instead of inlining them 7x per path", () => {
    const post = doc.paths["/api/v1/ops/projects.getProjects"].post as {
      responses: Record<string, { $ref?: string }>;
    };
    expect(post.responses["400"].$ref).toBe("#/components/responses/Error");
    expect(post.responses["200"].$ref).toBe("#/components/responses/OperationResult");
    const components = doc.components as unknown as { responses: Record<string, unknown> };
    expect(components.responses.Error).toBeDefined();
    expect(components.responses.OperationResult).toBeDefined();
  });

  it("stays under 1 MB — the whole point of $ref-ing the responses", () => {
    expect(JSON.stringify(doc).length).toBeLessThan(1_000_000);
  });

  it("declares bearer auth and the error envelope", () => {
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    const env = doc.components.schemas.ErrorEnvelope as {
      properties: { error: { properties: { code: { enum: string[] } } } };
    };
    expect(env.properties.error.properties.code.enum).toContain("CONFIRMATION_REQUIRED");
    expect(env.properties.error.properties.code.enum).toContain("IDEMPOTENCY_IN_PROGRESS");
  });

  it("tags every operation by module so the document is navigable", () => {
    const names = doc.tags.map((t) => t.name);
    expect(names).toContain("discovery");
    expect(names).toContain("projects");
  });
});
