import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "../actor-context";
import type { OperationMeta } from "./generated/operations";

const getProjects = vi.hoisted(() => vi.fn());
const deleteProject = vi.hoisted(() => vi.fn());
const addLineItem = vi.hoisted(() => vi.fn());
const authorizeApiOperation = vi.hoisted(() => vi.fn());
const idempotencyFindUnique = vi.hoisted(() => vi.fn());
const idempotencyCreate = vi.hoisted(() => vi.fn());
const idempotencyUpdate = vi.hoisted(() => vi.fn());
const idempotencyDelete = vi.hoisted(() => vi.fn());

const meta = (over: Partial<OperationMeta> & Pick<OperationMeta, "name">): OperationMeta => ({
  module: "projects",
  fn: "getProjects",
  kind: "read",
  resource: "project",
  action: "read",
  scope: "project:read",
  params: [],
  dangerous: false,
  summary: "",
  ...over,
});

vi.mock("./generated/operations", () => ({
  OPERATIONS: {
    "projects.getProjects": meta({
      name: "projects.getProjects",
      params: [{ name: "params", type: "object", optional: true }],
      summary: "List projects.",
    }),
    "projects.deleteProject": meta({
      name: "projects.deleteProject",
      fn: "deleteProject",
      kind: "write",
      action: "delete",
      scope: "project:delete",
      params: [{ name: "id", type: "string", optional: false }],
      dangerous: true,
    }),
    "line-items.addLineItem": meta({
      name: "line-items.addLineItem",
      module: "line-items",
      fn: "addLineItem",
      kind: "write",
      action: "manage_line_items",
      scope: "project:manage_line_items",
      params: [
        { name: "projectId", type: "string", optional: false },
        { name: "data", type: "object", optional: false },
        { name: "allowOverbook", type: "boolean", optional: true },
      ],
    }),
    "clients.updateClient": meta({
      name: "clients.updateClient",
      module: "clients",
      fn: "updateClient",
      kind: "write",
      resource: "client",
      action: "update",
      scope: "client:update",
      params: [{ name: "id", type: "string", optional: false }],
    }),
  },
  MODULE_LOADERS: {
    projects: async () => ({ getProjects, deleteProject }),
    "line-items": async () => ({ addLineItem }),
    clients: async () => ({}), // handler intentionally missing
  },
  OPERATION_COUNT: 4,
}));

// This suite exercises the server-action path against a fake registry; the Convex
// read bridge has its own suite (convex-reads.test.ts).
vi.mock("./convex-reads", () => ({ CONVEX_READS: {}, INJECTED_ARGS: new Set(["orgId"]) }));
vi.mock("./tool-aliases", () => ({
  TOOL_ALIASES: { list_projects: "projects.getProjects" },
  TOOL_BY_OPERATION: { "projects.getProjects": "list_projects" },
}));
vi.mock("../convex-client", () => ({ getConvexClient: vi.fn() }));
vi.mock("./authorize", () => ({ authorizeApiOperation }));
vi.mock("../prisma", () => ({
  prisma: {
    apiIdempotency: {
      findUnique: idempotencyFindUnique,
      create: idempotencyCreate,
      update: idempotencyUpdate,
      delete: idempotencyDelete,
    },
  },
}));

const {
  invokeOperation,
  listOperations,
  describeOperation,
  buildArgList,
  getOperation,
  isGuardedWrite,
} = await import("./dispatch");

const actor: ActorContext = {
  organizationId: "org_1",
  userId: "user_1",
  userName: "Agent",
  actorType: "apiKey",
  apiKeyId: "key_1",
  scopes: ["project:read", "project:delete", "project:manage_line_items"],
};

beforeEach(() => {
  vi.clearAllMocks();
  authorizeApiOperation.mockResolvedValue({
    organizationId: "org_1",
    userId: "user_1",
    userName: "Agent",
  });
  idempotencyFindUnique.mockResolvedValue(null);
  idempotencyCreate.mockResolvedValue({});
  idempotencyUpdate.mockResolvedValue({});
  idempotencyDelete.mockResolvedValue({});
  getProjects.mockResolvedValue([{ id: "p1", name: "Gig" }]);
  deleteProject.mockResolvedValue({ success: true });
  addLineItem.mockResolvedValue({ id: "li_1" });
});

describe("getOperation", () => {
  it("throws NOT_FOUND with a discovery hint for an unknown name", () => {
    expect(() => getOperation("nope.nothing")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("resolves an MCP tool name as an alias for its operation", () => {
    // An agent falling back from MCP to REST shouldn't have to rediscover that
    // `list_projects` is really `projects.getProjects`.
    expect(getOperation("list_projects").name).toBe("projects.getProjects");
  });
});

describe("buildArgList", () => {
  const op = getOperation("line-items.addLineItem");

  it("maps named args onto positional parameters in order", () => {
    expect(buildArgList(op, { projectId: "p1", data: { q: 1 }, allowOverbook: true })).toEqual([
      "p1",
      { q: 1 },
      true,
    ]);
  });

  it("trims trailing optionals so the action's own defaults apply", () => {
    expect(buildArgList(op, { projectId: "p1", data: { q: 1 } })).toEqual(["p1", { q: 1 }]);
  });

  it("rejects unknown arguments instead of silently dropping them", () => {
    expect(() => buildArgList(op, { projectID: "p1", data: {} })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("rejects missing required arguments and lists what was expected", () => {
    try {
      buildArgList(op, { projectId: "p1" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; message: string; details?: { expected?: unknown[] } };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("data");
      expect(err.details?.expected).toHaveLength(3);
    }
  });
});

describe("isGuardedWrite", () => {
  it("guards dangerous writes", () => {
    expect(isGuardedWrite(getOperation("projects.deleteProject"))).toBe(true);
  });
  it("guards availability-affecting writes", () => {
    expect(isGuardedWrite(getOperation("line-items.addLineItem"))).toBe(true);
  });
  it("does not guard ordinary writes", () => {
    expect(isGuardedWrite(getOperation("clients.updateClient"))).toBe(false);
  });
  it("does not guard reads", () => {
    expect(isGuardedWrite(getOperation("projects.getProjects"))).toBe(false);
  });
});

describe("invokeOperation", () => {
  it("authorizes before running the handler", async () => {
    await invokeOperation(actor, { operation: "projects.getProjects" });
    expect(authorizeApiOperation).toHaveBeenCalledWith(actor, "project", "read");
  });

  it("does not run the handler when authorization fails", async () => {
    authorizeApiOperation.mockRejectedValue(new Error("You don't have permission"));
    await expect(invokeOperation(actor, { operation: "projects.getProjects" })).rejects.toThrow();
    expect(getProjects).not.toHaveBeenCalled();
  });

  it("runs a read and returns the serialized result", async () => {
    const res = await invokeOperation(actor, { operation: "projects.getProjects" });
    expect(res).toEqual({
      operation: "projects.getProjects",
      kind: "read",
      replayed: false,
      result: [{ id: "p1", name: "Gig" }],
    });
  });

  it("serializes Dates to ISO strings", async () => {
    getProjects.mockResolvedValue([{ id: "p1", start: new Date("2026-01-02T03:04:05Z") }]);
    const res = await invokeOperation(actor, { operation: "projects.getProjects" });
    expect(res.result).toEqual([{ id: "p1", start: "2026-01-02T03:04:05.000Z" }]);
  });

  it("refuses a dangerous write without confirm", async () => {
    await expect(
      invokeOperation(actor, { operation: "projects.deleteProject", arguments: { id: "p1" } }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("refuses an availability-affecting write without confirm, and points at reserve_items", async () => {
    try {
      await invokeOperation(actor, {
        operation: "line-items.addLineItem",
        arguments: { projectId: "p1", data: {} },
      });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; details?: { hint?: string } };
      expect(err.code).toBe("CONFIRMATION_REQUIRED");
      expect(err.details?.hint).toContain("reserve_items");
    }
    expect(addLineItem).not.toHaveBeenCalled();
  });

  it("refuses a confirmed dangerous write with no idempotencyKey", async () => {
    await expect(
      invokeOperation(actor, {
        operation: "projects.deleteProject",
        arguments: { id: "p1" },
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  const dangerousCall = (over: Record<string, unknown> = {}) => ({
    operation: "projects.deleteProject",
    arguments: { id: "p1" },
    confirm: true,
    idempotencyKey: "idem-1",
    ...over,
  });

  it("reserves the idempotency key BEFORE running the handler, then records the result", async () => {
    const order: string[] = [];
    idempotencyCreate.mockImplementation(async () => void order.push("reserve"));
    deleteProject.mockImplementation(async () => {
      order.push("effect");
      return { success: true };
    });
    idempotencyUpdate.mockImplementation(async () => void order.push("record"));

    const res = await invokeOperation(actor, dangerousCall());

    // Recording only after the effect would leave no ledger row if we crashed
    // in between — and the retry would delete the project twice.
    expect(order).toEqual(["reserve", "effect", "record"]);
    expect(res.replayed).toBe(false);
    expect(idempotencyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKeyId: "key_1",
          key: "idem-1",
          verb: "projects.deleteProject",
          result: expect.stringContaining("pending"),
        }),
      }),
    );
    expect(idempotencyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { result: JSON.stringify({ success: true }) } }),
    );
  });

  it("RECORDS the failure instead of freeing the key, because the write may have partially applied", async () => {
    // addLineItem writes, then reads back. "The handler threw" does not prove
    // nothing applied — freeing the key would let a retry apply it twice.
    deleteProject.mockRejectedValue(new Error("boom"));
    await expect(invokeOperation(actor, dangerousCall())).rejects.toMatchObject({ code: "INTERNAL" });
    expect(idempotencyDelete).not.toHaveBeenCalled();
    expect(idempotencyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { result: expect.stringContaining("__gearflow_failed__") },
      }),
    );
  });

  it("replays a recorded failure as the same error, without re-running the handler", async () => {
    idempotencyFindUnique.mockResolvedValue({
      verb: "projects.deleteProject",
      result: JSON.stringify({ __gearflow_failed__: { code: "INVENTORY_CONFLICT", message: "no stock" } }),
    });
    await expect(invokeOperation(actor, dangerousCall())).rejects.toMatchObject({
      code: "INVENTORY_CONFLICT",
    });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("still returns the result when the final ledger write fails (the effect applied)", async () => {
    idempotencyUpdate.mockRejectedValue(new Error("db down"));
    const res = await invokeOperation(actor, dangerousCall());
    expect(res.replayed).toBe(false);
    expect(res.result).toEqual({ success: true });
  });

  it("KEEPS the reservation when the effect applied but the result won't serialize", async () => {
    // Effect committed; only the response failed to encode. A retry must replay,
    // not re-apply.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    deleteProject.mockResolvedValue(circular);

    await expect(invokeOperation(actor, dangerousCall())).rejects.toMatchObject({ code: "INTERNAL" });
    expect(idempotencyDelete).not.toHaveBeenCalled();
    expect(idempotencyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { result: JSON.stringify({ applied: true, unserializable: true }) } }),
    );
  });

  it("replays a prior idempotent write without re-running the handler", async () => {
    idempotencyFindUnique.mockResolvedValue({
      verb: "projects.deleteProject",
      result: JSON.stringify({ success: true }),
    });
    const res = await invokeOperation(actor, dangerousCall());
    expect(res.replayed).toBe(true);
    expect(res.result).toEqual({ success: true });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("REJECTS reusing an idempotencyKey across different operations", async () => {
    // Otherwise the caller gets the first operation's stale result and this
    // operation silently never runs.
    idempotencyFindUnique.mockResolvedValue({
      verb: "warehouse.checkOutItems",
      result: JSON.stringify({ success: true }),
    });
    await expect(invokeOperation(actor, dangerousCall())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("refuses to re-run an interrupted call rather than risk applying it twice", async () => {
    idempotencyFindUnique.mockResolvedValue({
      verb: "projects.deleteProject",
      result: "__gearflow_pending__",
    });
    await expect(invokeOperation(actor, dangerousCall())).rejects.toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      retryable: false,
    });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("returns the winner's result when a concurrent commit loses the idempotency race", async () => {
    idempotencyCreate.mockRejectedValue(new Error("unique constraint"));
    idempotencyFindUnique
      .mockResolvedValueOnce(null) // pre-flight: no prior record
      .mockResolvedValueOnce({
        verb: "projects.deleteProject",
        result: JSON.stringify({ success: "winner" }),
      });

    const res = await invokeOperation(actor, dangerousCall());
    expect(res.replayed).toBe(true);
    expect(res.result).toEqual({ success: "winner" });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("commits an ordinary write with no confirm ceremony", async () => {
    // clients.updateClient has no handler exported -> proves we got past the gates.
    await expect(
      invokeOperation(actor, { operation: "clients.updateClient", arguments: { id: "c1" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a permission error from the guarded action to FORBIDDEN", async () => {
    getProjects.mockRejectedValue(new Error("You don't have permission to perform this action."));
    await expect(invokeOperation(actor, { operation: "projects.getProjects" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });

  it("does not echo the raw error message when classifying FORBIDDEN", async () => {
    getProjects.mockRejectedValue(new Error("permission denied for relation projects at 10.0.0.5"));
    try {
      await invokeOperation(actor, { operation: "projects.getProjects" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; message: string };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).not.toContain("10.0.0.5");
      expect(err.message).not.toContain("relation");
    }
  });

  it("does not echo the raw error message when classifying NOT_FOUND", async () => {
    getProjects.mockRejectedValue(new Error('relation "projects_shadow" not found in schema public'));
    try {
      await invokeOperation(actor, { operation: "projects.getProjects" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; message: string };
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).not.toContain("projects_shadow");
    }
  });

  it("maps an unexpected error to an opaque INTERNAL, leaking nothing", async () => {
    getProjects.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    try {
      await invokeOperation(actor, { operation: "projects.getProjects" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; message: string };
      expect(err.code).toBe("INTERNAL");
      expect(err.message).not.toContain("ECONNREFUSED");
    }
  });
});

describe("listOperations", () => {
  it("hides operations the key has no scope for", () => {
    const res = listOperations(actor);
    const names = res.operations.map((o) => o.name);
    expect(names).toContain("projects.getProjects");
    expect(names).not.toContain("clients.updateClient"); // no client:update scope
  });

  it("honours a resource wildcard scope", () => {
    const wide: ActorContext = { ...actor, scopes: ["client:*"] };
    expect(listOperations(wide).operations.map((o) => o.name)).toContain("clients.updateClient");
  });

  it("shows everything to a session actor", () => {
    const session: ActorContext = { ...actor, actorType: "session", scopes: undefined };
    expect(listOperations(session).total).toBe(4);
  });

  it("pages with offset + limit, and reports total/offset/hasMore", () => {
    const session: ActorContext = { ...actor, actorType: "session", scopes: undefined };
    const all = listOperations(session, { limit: 100 });
    expect(all.total).toBe(4);

    const p1 = listOperations(session, { limit: 2, offset: 0 });
    const p2 = listOperations(session, { limit: 2, offset: 2 });
    const p3 = listOperations(session, { limit: 2, offset: 4 });

    expect([p1.returned, p2.returned, p3.returned]).toEqual([2, 2, 0]);
    expect([p1.hasMore, p2.hasMore, p3.hasMore]).toEqual([true, false, false]);
    expect(p2.offset).toBe(2);

    // Every operation is reachable exactly once across the pages.
    const seen = [...p1.operations, ...p2.operations].map((o) => o.name);
    expect(new Set(seen).size).toBe(4);
    expect(seen).toEqual(all.operations.map((o) => o.name));
  });

  it("orders deterministically, or paging would drop or duplicate entries", () => {
    const session: ActorContext = { ...actor, actorType: "session", scopes: undefined };
    const names = listOperations(session).operations.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("reports the MCP tool that runs an operation, when there is one", () => {
    const session: ActorContext = { ...actor, actorType: "session", scopes: undefined };
    const ops = listOperations(session).operations as Array<{ name: string; mcpTool?: string }>;
    expect(ops.find((o) => o.name === "projects.getProjects")?.mcpTool).toBe("list_projects");
    expect(ops.find((o) => o.name === "projects.deleteProject")?.mcpTool).toBeUndefined();
  });

  it("filters by kind and search", () => {
    expect(listOperations(actor, { kind: "read" }).operations).toHaveLength(1);
    expect(listOperations(actor, { search: "delete" }).operations[0].name).toBe(
      "projects.deleteProject",
    );
  });

  it("flags which operations need confirmation", () => {
    const del = listOperations(actor).operations.find((o) => o.name === "projects.deleteProject");
    expect(del).toMatchObject({ dangerous: true, requiresConfirmation: true });
  });
});

describe("describeOperation", () => {
  it("returns the full call signature", () => {
    expect(describeOperation("line-items.addLineItem")).toEqual({
      name: "line-items.addLineItem",
      module: "line-items",
      kind: "write",
      scope: "project:manage_line_items",
      dangerous: false,
      requiresConfirmation: true,
      summary: "",
      parameters: [
        { name: "projectId", type: "string", required: true },
        { name: "data", type: "object", required: true },
        { name: "allowOverbook", type: "boolean", required: false },
      ],
    });
  });
});
