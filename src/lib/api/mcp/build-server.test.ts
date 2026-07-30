/**
 * `routeToolCall` (Phase 3, #999) — the MCP tool-call router. What's tested
 * here is exactly what MCP owns before/after `dispatch()`: name→operation
 * routing for the ~20 curated tools + the 3 discovery tools + `whoami`,
 * `idempotencyKey` extraction, and error/success shaping into `CallToolResult`.
 * `dispatch()` itself (registry lookup, idempotency, arg normalization,
 * Convex round-trip) is proven by dispatcher.test.ts and the convex/*.test.ts
 * suite — mocked at the boundary here, same posture as dispatcher.test.ts
 * mocks agent-auth/request-log/convex-client.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const dispatchMock = vi.fn();
vi.mock("../dispatcher", () => ({ dispatch: (...args: unknown[]) => dispatchMock(...args) }));

const getWhoamiDataMock = vi.fn();
vi.mock("../whoami", () => ({ getWhoamiData: (...args: unknown[]) => getWhoamiDataMock(...args) }));

const listOperationsPageMock = vi.fn();
const describeOperationMock = vi.fn();
vi.mock("../operations-listing", () => ({
  listOperationsPage: (...args: unknown[]) => listOperationsPageMock(...args),
  describeOperation: (...args: unknown[]) => describeOperationMock(...args),
}));

const resolveProjectDocumentMock = vi.fn();
vi.mock("../documents", () => ({ resolveProjectDocument: (...args: unknown[]) => resolveProjectDocumentMock(...args) }));

const getFileAsDataUriMock = vi.fn();
vi.mock("@/lib/storage", () => ({
  getFileAsDataUri: (...args: unknown[]) => getFileAsDataUriMock(...args),
  getProxyUrl: (storageId: string) => `/api/files/${storageId}`,
}));

const { routeToolCall } = await import("./build-server");
const { MCP_NAMESPACE, MCP_CURATED_TOOLS } = await import("../mcp-manifest.generated");

const mockAgent = {
  key: { id: "key_1", organizationId: "org_A", actingUserId: "user_1" },
  actor: { organizationId: "org_A", userId: "user_1", userName: "Ada", actorType: "apiKey" as const, apiKeyId: "key_1", scopes: ["*"] },
  client: { query: vi.fn(), mutation: vi.fn() },
};

const opts = { agent: mockAgent as never, authorizationHeader: "Bearer gf_live_test", requestId: "req_1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("routeToolCall — whoami", () => {
  test("answers from the pre-resolved agent, without calling dispatch", async () => {
    getWhoamiDataMock.mockResolvedValueOnce({ organizationId: "org_A", role: "owner" });
    const result = await routeToolCall(`${MCP_NAMESPACE}.whoami`, {}, opts);
    expect(getWhoamiDataMock).toHaveBeenCalledWith(mockAgent);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.data).toEqual({ organizationId: "org_A", role: "owner" });
  });
});

describe("routeToolCall — list_operations / describe_operation", () => {
  test("list_operations forwards filters and pagination", async () => {
    listOperationsPageMock.mockReturnValueOnce({ data: [], total: 0, cursor: 0, nextCursor: null });
    await routeToolCall(`${MCP_NAMESPACE}.list_operations`, { resource: "asset", kind: "query", cursor: 10, limit: 5 }, opts);
    expect(listOperationsPageMock).toHaveBeenCalledWith({ resource: "asset", kind: "query", cursor: 10, limit: 5 });
  });

  test("describe_operation returns UNKNOWN_OPERATION as a tool-level error, not a thrown exception", async () => {
    describeOperationMock.mockReturnValueOnce(null);
    const result = await routeToolCall(`${MCP_NAMESPACE}.describe_operation`, { operation: "nope.nope" }, opts);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe("UNKNOWN_OPERATION");
  });

  test("describe_operation returns the described operation on success", async () => {
    describeOperationMock.mockReturnValueOnce({ operation: "assets.list", kind: "query" });
    const result = await routeToolCall(`${MCP_NAMESPACE}.describe_operation`, { operation: "assets.list" }, opts);
    expect(result.isError).toBe(false);
    expect((result.structuredContent as { data: { operation: string } }).data.operation).toBe("assets.list");
  });
});

describe("routeToolCall — call_operation (generic dispatch)", () => {
  test("requires a string operation argument", async () => {
    const result = await routeToolCall(`${MCP_NAMESPACE}.call_operation`, {}, opts);
    expect(result.isError).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test("forwards operation/args/idempotencyKey straight to dispatch()", async () => {
    dispatchMock.mockResolvedValueOnce({ status: 200, body: { data: { ok: true }, requestId: "req_1" } });
    const result = await routeToolCall(
      `${MCP_NAMESPACE}.call_operation`,
      { operation: "assets.getById", args: { id: "asset_1" }, idempotencyKey: "idem-key-123" },
      opts,
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      "assets.getById",
      { args: { id: "asset_1" }, idempotencyKey: "idem-key-123" },
      opts.authorizationHeader,
      opts.requestId,
    );
    expect(result.isError).toBe(false);
  });

  test("a >=400 dispatch status becomes isError: true", async () => {
    dispatchMock.mockResolvedValueOnce({ status: 403, body: { error: { code: "MISSING_SCOPE" } } });
    const result = await routeToolCall(`${MCP_NAMESPACE}.call_operation`, { operation: "assets.list" }, opts);
    expect(result.isError).toBe(true);
  });
});

describe("routeToolCall — curated tools", () => {
  test("every curated (non-whoami) tool dispatches to its manifest operation, stripping idempotencyKey out of args", async () => {
    dispatchMock.mockResolvedValue({ status: 200, body: { data: {}, requestId: "req_1" } });

    for (const tool of MCP_CURATED_TOOLS) {
      if (tool.operation === null) continue; // whoami / get_project_document — covered in their own describe blocks
      dispatchMock.mockClear();
      await routeToolCall(tool.name, { idempotencyKey: "idem-1", foo: "bar" }, opts);
      expect(dispatchMock).toHaveBeenCalledWith(
        tool.operation,
        { args: { foo: "bar" }, idempotencyKey: "idem-1" },
        opts.authorizationHeader,
        opts.requestId,
      );
    }
  });

  test("an unknown tool name is UNKNOWN_OPERATION, not a thrown error", async () => {
    const result = await routeToolCall(`${MCP_NAMESPACE}.does_not_exist`, {}, opts);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe("UNKNOWN_OPERATION");
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe("routeToolCall — get_project_document (the other operation:null special tool)", () => {
  test("a live-rendered ('bytes') outcome returns a base64 resource block, without calling dispatch", async () => {
    resolveProjectDocumentMock.mockResolvedValueOnce({
      kind: "bytes",
      docType: "delivery-docket",
      status: "live",
      fileName: "delivery-docket-proj_1.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("pdf-bytes"),
    });

    const result = await routeToolCall(
      `${MCP_NAMESPACE}.get_project_document`,
      { projectId: "proj_1", docType: "delivery-docket" },
      opts,
    );

    expect(resolveProjectDocumentMock).toHaveBeenCalledWith(mockAgent.actor, "proj_1", "delivery-docket");
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(getFileAsDataUriMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      docType: "delivery-docket",
      status: "live",
      fileName: "delivery-docket-proj_1.pdf",
      contentType: "application/pdf",
    });
    const resourceBlock = result.content.find((c) => c.type === "resource") as { resource: { mimeType: string; blob: string } };
    expect(resourceBlock.resource.mimeType).toBe("application/pdf");
    expect(resourceBlock.resource.blob).toBe(Buffer.from("pdf-bytes").toString("base64"));
  });

  test("a stored-artifact outcome fetches the bytes via getFileAsDataUri and returns them as a blob", async () => {
    resolveProjectDocumentMock.mockResolvedValueOnce({
      kind: "stored",
      docType: "quote",
      status: "sent",
      fileName: "RVLT-2026-0001-quote-v1.pdf",
      organizationId: "org_A",
      storageId: "storage_1",
    });
    getFileAsDataUriMock.mockResolvedValueOnce("data:application/pdf;base64,AAAA");

    const result = await routeToolCall(`${MCP_NAMESPACE}.get_project_document`, { projectId: "proj_1", docType: "quote" }, opts);

    expect(getFileAsDataUriMock).toHaveBeenCalledWith("/api/files/storage_1");
    expect(result.isError).toBe(false);
    const resourceBlock = result.content.find((c) => c.type === "resource") as { resource: { mimeType: string; blob: string } };
    expect(resourceBlock.resource.mimeType).toBe("application/pdf");
    expect(resourceBlock.resource.blob).toBe("AAAA");
  });

  test("a stored artifact whose bytes can't be fetched is a DOCUMENT_NOT_READY tool-level error", async () => {
    resolveProjectDocumentMock.mockResolvedValueOnce({
      kind: "stored",
      docType: "invoice",
      status: "issued",
      fileName: "INV-1-invoice.pdf",
      organizationId: "org_A",
      storageId: "storage_missing",
    });
    getFileAsDataUriMock.mockResolvedValueOnce(null);

    const result = await routeToolCall(`${MCP_NAMESPACE}.get_project_document`, { projectId: "proj_1", docType: "invoice" }, opts);

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe("DOCUMENT_NOT_READY");
  });

  test("a thrown error (e.g. missing scope / not found) becomes an in-band error envelope, not a rejection", async () => {
    resolveProjectDocumentMock.mockRejectedValueOnce(Object.assign(new Error("No issued invoice found for this project yet."), { code: "NOT_FOUND" }));

    const result = await routeToolCall(`${MCP_NAMESPACE}.get_project_document`, { projectId: "proj_1", docType: "invoice" }, opts);

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
